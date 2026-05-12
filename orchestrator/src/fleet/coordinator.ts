import { AuditLogger } from '../audit/index.js';
import {
  DEFAULT_GATES_CONFIG,
  DefaultBudgetGate,
  DefaultPolicyGate,
  DefaultValidator,
  BudgetExceededError,
  toBudgetOverrunPartialResultV1
} from '../gates/index.js';
import type { BudgetGate, BudgetLimitConfig, PolicyGate, Validator } from '../gates/index.js';
import { DEFAULT_MODEL } from '../runtime/index.js';
import type {
  AgentCapabilityFlags,
  AgentResult,
  BudgetUsage,
  Evidence,
  EvidencePack,
  ToolCallRecord,
  TurnState
} from '../runtime/index.js';
import type {
  AgentDefinition,
  AgentRole,
  BlindCriticInput,
  BlindCriticScore,
  FleetCandidate,
  FleetCoordinatorInput,
  FleetPlan,
  FleetPlanStep,
  FleetSession,
  FleetWorktreeMode,
  MockFleetCandidateDraft,
  ReviewerDraft
} from './types.js';
import { W10_FLEET_PROMPT_VERSION, W10_FLEET_SESSION_SCHEMA } from './types.js';

export interface FleetCoordinatorOptions {
  readonly auditLogger: AuditLogger;
  readonly budgetGate?: BudgetGate;
  readonly budgetLimit?: BudgetLimitConfig;
  readonly policyGate?: PolicyGate;
  readonly validator?: Validator;
  readonly candidateFactory?: (
    plan: FleetPlan,
    fanout: number
  ) => readonly MockFleetCandidateDraft[];
}

const DEFAULT_ACCEPTANCE: readonly string[] = [
  'mock fleet plan is bounded',
  'candidate diff remains anonymous',
  'reviewer emits draft artifact only'
];

const MOCK_CAPABILITIES: AgentCapabilityFlags = {
  canSpawn: false,
  canUseTools: false,
  canResume: false,
  canReadMemory: false,
  canWriteMemory: false,
  canUseMcp: false,
  supportsSessions: false,
  supportsHooks: false,
  supportsReasoningEffort: true,
  supportsHeadless: true,
  externalExecution: false,
  capabilitySupported: true,
  unsupportedReasons: ['W10 fleet coordinator uses deterministic mock mode only']
};

export class FleetValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FleetValidationError';
  }
}

export class FleetCoordinator {
  private readonly auditLogger: AuditLogger;
  private readonly budgetGate: BudgetGate;
  private readonly budgetLimit: BudgetLimitConfig;
  private readonly policyGate: PolicyGate;
  private readonly validator: Validator;
  private readonly candidateFactory:
    | ((plan: FleetPlan, fanout: number) => readonly MockFleetCandidateDraft[])
    | undefined;

  constructor(options: FleetCoordinatorOptions) {
    this.auditLogger = options.auditLogger;
    this.budgetGate = options.budgetGate ?? new DefaultBudgetGate();
    this.budgetLimit = options.budgetLimit ?? DEFAULT_GATES_CONFIG;
    this.policyGate = options.policyGate ?? new DefaultPolicyGate();
    this.validator = options.validator ?? new DefaultValidator();
    this.candidateFactory = options.candidateFactory;
  }

  async run(input: FleetCoordinatorInput): Promise<FleetSession> {
    const parentTaskId = input.parentTaskId ?? input.taskId;
    const fleetSessionId = createFleetSessionId(parentTaskId);
    const auditTraceId = `${fleetSessionId}:budget`;
    const fanout = input.fanout ?? 3;
    const acceptance = input.acceptance ?? DEFAULT_ACCEPTANCE;
    const budgetUsage: BudgetUsage = {
      fanout: 1,
      fleetFanout: fanout,
      toolCalls: 0,
      inputTokens: estimateTokens(input.prompt),
      outputTokens: 0,
      premiumRequests: 0
    };

    try {
      this.budgetGate.evaluate({
        taskId: input.taskId,
        usage: budgetUsage,
        budgetLimit: this.budgetLimit,
        fleetFanout: fanout,
        traceId: auditTraceId
      });
    } catch (error: unknown) {
      if (!(error instanceof BudgetExceededError)) throw error;
      const partial = toBudgetOverrunPartialResultV1(error, {
        summary: 'BudgetGate denied W10 /fleet before mock implementers started.',
        completed_steps: ['budget_gate_evaluated'],
        blocked_reason: error.message
      });
      const evidencePack = createEvidencePack(input.taskId, input.intent, [
        {
          source_ref: `fleet://${fleetSessionId}/budget`,
          content: JSON.stringify(partial),
          tool: 'BudgetGate'
        }
      ]);
      const result = buildAgentResult({
        taskId: input.taskId,
        parentTaskId,
        fleetSessionId,
        agentRole: 'planner',
        worktreeMode: 'mock',
        turnState: 'blocked',
        output: JSON.stringify(partial),
        evidencePack,
        auditTraceId,
        policyDecision: 'deny',
        budgetUsage
      });
      await this.validateAndAudit(result);
      return {
        schemaVersion: W10_FLEET_SESSION_SCHEMA,
        fleetSessionId,
        parentTaskId,
        taskId: input.taskId,
        turnState: 'blocked',
        worktreeMode: 'mock',
        realFanout: 'real_disabled',
        realMergeRequest: 'real_disabled',
        candidates: [],
        criticScores: [],
        evidencePack,
        auditTraceId,
        blockedPartialResult: {
          summary: partial.partial_result.summary,
          completedSteps: partial.partial_result.completed_steps,
          blockedReason: partial.partial_result.blocked_reason
        }
      };
    }

    const plan = this.buildPlan(input, parentTaskId, fleetSessionId, acceptance);
    await this.validateAndAudit(
      buildAgentResult({
        taskId: `${input.taskId}:planner`,
        parentTaskId,
        fleetSessionId,
        agentRole: 'planner',
        worktreeMode: 'mock',
        turnState: 'done',
        output: JSON.stringify(plan),
        evidencePack: plan.evidencePack,
        auditTraceId: `${fleetSessionId}:planner`,
        policyDecision: 'allow',
        budgetUsage
      })
    );

    const candidates = await this.buildCandidates(plan, fanout, input.intent);
    const blockedCandidate = candidates.find((candidate) => candidate.turnState === 'blocked');
    if (blockedCandidate !== undefined) {
      const evidencePack = mergeEvidencePacks(input.taskId, input.intent, [
        plan.evidencePack,
        ...candidates.map((candidate) => candidate.evidencePack)
      ]);
      return {
        schemaVersion: W10_FLEET_SESSION_SCHEMA,
        fleetSessionId,
        parentTaskId,
        taskId: input.taskId,
        turnState: 'blocked',
        worktreeMode: 'mock',
        realFanout: 'real_disabled',
        realMergeRequest: 'real_disabled',
        plan,
        candidates,
        criticScores: [],
        evidencePack,
        auditTraceId: `${fleetSessionId}:implementer`,
        blockedPartialResult: {
          summary: 'Mock implementer was blocked by step file scope policy.',
          completedSteps: ['planner_done', 'implementer_scope_checked'],
          blockedReason:
            blockedCandidate.blockedReason ?? 'implementer touched files outside step scope'
        }
      };
    }

    const criticScores = await this.scoreCandidates(candidates, input.intent);
    const reviewerDraft = await this.buildReviewerDraft(
      plan,
      candidates,
      criticScores,
      input.intent
    );
    const evidencePack = mergeEvidencePacks(input.taskId, input.intent, [
      plan.evidencePack,
      ...candidates.map((candidate) => candidate.evidencePack),
      ...criticScores.map((score) => score.evidencePack),
      reviewerDraft.evidencePack
    ]);

    return {
      schemaVersion: W10_FLEET_SESSION_SCHEMA,
      fleetSessionId,
      parentTaskId,
      taskId: input.taskId,
      turnState: 'done',
      worktreeMode: 'mock',
      realFanout: 'real_disabled',
      realMergeRequest: 'real_disabled',
      plan,
      candidates,
      criticScores,
      reviewerDraft,
      evidencePack,
      auditTraceId: `${fleetSessionId}:done`
    };
  }

  private buildPlan(
    input: FleetCoordinatorInput,
    parentTaskId: string,
    fleetSessionId: string,
    acceptance: readonly string[]
  ): FleetPlan {
    const files = input.allowedFiles.length > 0 ? input.allowedFiles : [`${input.taskId}.mock.md`];
    const stepCount = clamp(files.length, 3, 7);
    const steps = Array.from({ length: stepCount }, (_, index): FleetPlanStep => {
      const file = files[index % files.length] ?? `${input.taskId}.mock.md`;
      const acceptanceItem =
        acceptance[index % acceptance.length] ?? DEFAULT_ACCEPTANCE[0] ?? 'mock accepted';
      return {
        stepId: `step-${index + 1}`,
        title: `Atomic mock step ${index + 1}`,
        description: `Apply deterministic mock change for ${file}`,
        filesTouched: [file],
        acceptance: [acceptanceItem]
      };
    });

    return {
      fleetSessionId,
      parentTaskId,
      taskId: input.taskId,
      planner: agentDefinition('planner', 'mock'),
      steps,
      acceptance,
      evidencePack: createEvidencePack(`${input.taskId}:planner`, input.intent, [
        {
          source_ref: `fleet://${fleetSessionId}/plan`,
          content: `Planner produced ${steps.length} atomic mock steps.`,
          tool: 'fleet-coordinator'
        }
      ])
    };
  }

  private async buildCandidates(
    plan: FleetPlan,
    fanout: number,
    intent: string
  ): Promise<readonly FleetCandidate[]> {
    const drafts =
      this.candidateFactory?.(plan, fanout) ?? createDefaultCandidateDrafts(plan, fanout);
    const candidates: FleetCandidate[] = [];

    for (let index = 0; index < drafts.length; index += 1) {
      const draft = drafts[index];
      if (draft === undefined) continue;
      const candidateId = `candidate-${index + 1}`;
      const step = plan.steps.find((item) => item.stepId === draft.stepId) ?? plan.steps[0];
      const allowedFiles = new Set(step?.filesTouched ?? []);
      const outOfScope = draft.filesTouched.filter((file) => !allowedFiles.has(file));
      const blockedReason =
        outOfScope.length > 0
          ? `implementer touched files outside step.files_touched: ${outOfScope.join(', ')}`
          : undefined;
      const evidencePack = createEvidencePack(`${plan.taskId}:${candidateId}`, intent, [
        {
          source_ref: `fleet://${plan.fleetSessionId}/${candidateId}`,
          content: blockedReason ?? `Mock implementer produced anonymous diff for ${draft.stepId}.`,
          tool: 'fleet-coordinator'
        }
      ]);
      const candidate: FleetCandidate = {
        fleetSessionId: plan.fleetSessionId,
        parentTaskId: plan.parentTaskId,
        candidateId,
        stepId: draft.stepId,
        filesTouched: draft.filesTouched,
        anonymousDiff: draft.anonymousDiff,
        selfTest: draft.selfTest,
        acceptance: step?.acceptance ?? plan.acceptance,
        turnState: blockedReason === undefined ? 'done' : 'blocked',
        policyDecision: blockedReason === undefined ? 'allow' : 'deny',
        ...(blockedReason !== undefined ? { blockedReason } : {}),
        evidencePack
      };
      candidates.push(candidate);
      await this.validateAndAudit(
        buildAgentResult({
          taskId: `${plan.taskId}:${candidateId}`,
          parentTaskId: plan.parentTaskId,
          fleetSessionId: plan.fleetSessionId,
          agentRole: 'implementer',
          candidateId,
          worktreeMode: 'mock',
          turnState: candidate.turnState,
          output: JSON.stringify(toCandidateAuditPayload(candidate)),
          evidencePack,
          auditTraceId: `${plan.fleetSessionId}:${candidateId}`,
          policyDecision: candidate.policyDecision,
          budgetUsage: {
            fanout: 1,
            fleetFanout: drafts.length,
            toolCalls: 0,
            inputTokens: 0,
            outputTokens: 0,
            premiumRequests: 0
          }
        })
      );
    }

    return candidates;
  }

  private async scoreCandidates(
    candidates: readonly FleetCandidate[],
    intent: string
  ): Promise<readonly BlindCriticScore[]> {
    const scores: BlindCriticScore[] = [];
    for (const candidate of candidates) {
      const blindInput: BlindCriticInput = {
        candidateId: candidate.candidateId,
        anonymousDiff: candidate.anonymousDiff,
        selfTest: candidate.selfTest,
        acceptance: candidate.acceptance
      };
      const score = scoreBlindInput(blindInput);
      const evidencePack = createEvidencePack(
        `${candidate.parentTaskId}:${candidate.candidateId}:critic`,
        intent,
        [
          {
            source_ref: `fleet://${candidate.fleetSessionId}/${candidate.candidateId}/critic`,
            content: `Blind critic scored ${candidate.candidateId} without producer identity.`,
            tool: 'fleet-coordinator'
          }
        ]
      );
      const criticScore: BlindCriticScore = {
        fleetSessionId: candidate.fleetSessionId,
        parentTaskId: candidate.parentTaskId,
        candidateId: candidate.candidateId,
        score,
        verdict: score >= 85 ? 'accept' : score >= 65 ? 'revise' : 'reject',
        strengths: candidate.selfTest.passed
          ? ['self_test passed', 'acceptance criteria referenced']
          : ['acceptance criteria referenced'],
        risks: candidate.selfTest.passed ? [] : ['self_test did not pass'],
        blindInput,
        evidencePack
      };
      scores.push(criticScore);
      await this.validateAndAudit(
        buildAgentResult({
          taskId: `${candidate.parentTaskId}:${candidate.candidateId}:critic`,
          parentTaskId: candidate.parentTaskId,
          fleetSessionId: candidate.fleetSessionId,
          agentRole: 'critic',
          candidateId: candidate.candidateId,
          worktreeMode: 'mock',
          turnState: 'done',
          output: JSON.stringify(criticScore),
          evidencePack,
          auditTraceId: `${candidate.fleetSessionId}:${candidate.candidateId}:critic`,
          policyDecision: 'allow'
        })
      );
    }
    return scores.sort(
      (left, right) => right.score - left.score || left.candidateId.localeCompare(right.candidateId)
    );
  }

  private async buildReviewerDraft(
    plan: FleetPlan,
    candidates: readonly FleetCandidate[],
    criticScores: readonly BlindCriticScore[],
    intent: string
  ): Promise<ReviewerDraft> {
    const selectedScore = criticScores[0];
    const selectedCandidateId =
      selectedScore?.candidateId ?? candidates[0]?.candidateId ?? 'candidate-1';
    const policyDecision = this.policyGate.evaluate({
      toolName: 'createMergeRequest',
      declaredTools: ['createMergeRequest'],
      toolDescriptor: {
        name: 'createMergeRequest',
        level: 'L2',
        risk: 'write'
      },
      policyLevel: 'L2'
    });
    const evidencePack = createEvidencePack(`${plan.taskId}:reviewer`, intent, [
      {
        source_ref: `fleet://${plan.fleetSessionId}/reviewer-draft`,
        content: 'Reviewer produced draft MR artifact only; real MR creation is disabled.',
        tool: 'fleet-coordinator'
      }
    ]);
    const draft: ReviewerDraft = {
      fleetSessionId: plan.fleetSessionId,
      parentTaskId: plan.parentTaskId,
      artifactId: `${plan.fleetSessionId}-draft-mr`,
      title: `Draft MR for ${plan.parentTaskId}`,
      body: [
        `Selected candidate: ${selectedCandidateId}`,
        `Planner steps: ${plan.steps.length}`,
        'Real push: real_disabled',
        'Real GitLab MR creation: real_disabled'
      ].join('\n'),
      selectedCandidateId,
      isDraft: true,
      pushed: false,
      mergeRequestCreated: false,
      policyDecision: policyDecision.decision,
      approvalRequired: 'L2',
      worktreeMode: 'real_disabled',
      evidencePack
    };
    await this.validateAndAudit(
      buildAgentResult({
        taskId: `${plan.taskId}:reviewer`,
        parentTaskId: plan.parentTaskId,
        fleetSessionId: plan.fleetSessionId,
        agentRole: 'reviewer',
        candidateId: selectedCandidateId,
        worktreeMode: 'real_disabled',
        turnState: 'done',
        output: JSON.stringify(draft),
        evidencePack,
        auditTraceId: `${plan.fleetSessionId}:reviewer`,
        policyDecision: policyDecision.decision,
        toolCalls: [
          {
            toolName: 'reviewerDraftArtifact',
            decision: policyDecision.decision,
            timestampIso: new Date().toISOString()
          }
        ]
      })
    );
    return draft;
  }

  private async validateAndAudit(result: AgentResult): Promise<void> {
    const validation = this.validator.validate({
      turnState: result.turnState,
      evidencePack: result.evidencePack,
      output: result.output
    });
    if (!validation.allowed) {
      throw new FleetValidationError(validation.reason);
    }
    await this.auditLogger.logTurn(result);
  }
}

function createDefaultCandidateDrafts(
  plan: FleetPlan,
  fanout: number
): readonly MockFleetCandidateDraft[] {
  return Array.from({ length: fanout }, (_, index): MockFleetCandidateDraft => {
    const step = plan.steps[index % plan.steps.length] ?? plan.steps[0];
    const file = step?.filesTouched[0] ?? `${plan.taskId}.mock.md`;
    return {
      stepId: step?.stepId ?? 'step-1',
      filesTouched: [file],
      anonymousDiff: [
        `diff --mock a/${file} b/${file}`,
        `+ W10 mock candidate ${index + 1} keeps real fanout disabled.`
      ].join('\n'),
      selfTest: {
        command: `mock-self-test ${index + 1}`,
        passed: true,
        summary: 'deterministic mock self-test passed'
      }
    };
  });
}

function toCandidateAuditPayload(candidate: FleetCandidate): Readonly<{
  candidate_id: string;
  step_id: string;
  files_touched: readonly string[];
  anonymous_diff: string;
  self_test: FleetCandidate['selfTest'];
  acceptance: readonly string[];
  blocked_reason?: string;
}> {
  return {
    candidate_id: candidate.candidateId,
    step_id: candidate.stepId,
    files_touched: candidate.filesTouched,
    anonymous_diff: candidate.anonymousDiff,
    self_test: candidate.selfTest,
    acceptance: candidate.acceptance,
    ...(candidate.blockedReason !== undefined ? { blocked_reason: candidate.blockedReason } : {})
  };
}

function scoreBlindInput(input: BlindCriticInput): number {
  const selfTestScore = input.selfTest.passed ? 35 : 0;
  const acceptanceScore = Math.min(input.acceptance.length * 15, 45);
  const diffScore = input.anonymousDiff.trim().length > 0 ? 20 : 0;
  return selfTestScore + acceptanceScore + diffScore;
}

function buildAgentResult(input: {
  readonly taskId: string;
  readonly parentTaskId: string;
  readonly fleetSessionId: string;
  readonly agentRole: AgentRole;
  readonly candidateId?: string;
  readonly worktreeMode: FleetWorktreeMode;
  readonly turnState: TurnState;
  readonly output: string;
  readonly evidencePack: EvidencePack;
  readonly auditTraceId: string;
  readonly policyDecision: 'deny' | 'allow' | 'escalate';
  readonly budgetUsage?: BudgetUsage;
  readonly toolCalls?: readonly ToolCallRecord[];
}): AgentResult {
  return {
    taskId: input.taskId,
    fleetSessionId: input.fleetSessionId,
    parentTaskId: input.parentTaskId,
    agentRole: input.agentRole,
    ...(input.candidateId !== undefined ? { candidateId: input.candidateId } : {}),
    worktreeMode: input.worktreeMode,
    turnState: input.turnState,
    output: input.output,
    evidencePack: input.evidencePack,
    auditTraceId: input.auditTraceId,
    model: DEFAULT_MODEL,
    runtime: {
      name: 'contract_stub'
    },
    reasoningEffort: 'medium',
    promptVersion: W10_FLEET_PROMPT_VERSION,
    policyDecision: input.policyDecision,
    ...(input.budgetUsage !== undefined ? { budgetUsage: input.budgetUsage } : {}),
    capabilities: MOCK_CAPABILITIES,
    toolCalls: input.toolCalls ?? []
  };
}

function createEvidencePack(
  taskId: string,
  intent: string,
  evidences: readonly Evidence[]
): EvidencePack {
  return {
    taskId,
    intent,
    evidences,
    assumptions: [],
    confidence: 1
  };
}

function mergeEvidencePacks(
  taskId: string,
  intent: string,
  packs: readonly EvidencePack[]
): EvidencePack {
  return {
    taskId,
    intent,
    evidences: packs.flatMap((pack) => pack.evidences),
    assumptions: packs.flatMap((pack) => pack.assumptions),
    confidence: Math.min(...packs.map((pack) => pack.confidence))
  };
}

function agentDefinition(role: AgentRole, worktreeMode: FleetWorktreeMode): AgentDefinition {
  return {
    id: `w10-${role}`,
    role,
    model: DEFAULT_MODEL,
    promptPath: `orchestrator/docs/agents/${role}.agent.md`,
    allowedTools: [],
    worktreeMode
  };
}

function createFleetSessionId(parentTaskId: string): string {
  return `fleet-${slugify(parentTaskId)}`;
}

function estimateTokens(value: string): number {
  return Math.max(1, Math.ceil(value.length / 4));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return slug.length > 0 ? slug : 'task';
}
