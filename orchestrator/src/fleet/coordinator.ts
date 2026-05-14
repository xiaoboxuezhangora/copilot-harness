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
  ArenaCandidateScore,
  ArenaCriticRun,
  ArenaSanitizationReport,
  ArenaSession,
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
import {
  W10_FLEET_PROMPT_VERSION,
  W10_FLEET_SESSION_SCHEMA,
  W12_ARENA_SESSION_SCHEMA
} from './types.js';
import {
  ARENA_CONSISTENCY_THRESHOLD,
  ARENA_REAL_SCORER_STATUS,
  ARENA_SCORER_MODE,
  MockArenaScorer,
  W12_ARENA_ALLOWED_RUBRIC,
  toPercentScore
} from './arenaScorer.js';
import type { ArenaScorer } from './arenaScorer.js';
import { DEFAULT_ARENA_ARCHIVE_PATH, SqliteArenaStore, type ArenaStore } from './arenaStore.js';

export interface FleetCoordinatorOptions {
  readonly auditLogger: AuditLogger;
  readonly budgetGate?: BudgetGate;
  readonly budgetLimit?: BudgetLimitConfig;
  readonly policyGate?: PolicyGate;
  readonly validator?: Validator;
  readonly arenaScorer?: ArenaScorer;
  readonly shadowArenaScorer?: ArenaScorer;
  readonly arenaStore?: ArenaStore;
  readonly arenaArchiveRoot?: string;
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

const MIN_ARENA_FANOUT = 3;

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
  private readonly arenaScorer: ArenaScorer;
  private readonly shadowArenaScorer: ArenaScorer | undefined;
  private readonly arenaStore: ArenaStore | undefined;
  private readonly arenaArchiveRoot: string;
  private readonly candidateFactory:
    | ((plan: FleetPlan, fanout: number) => readonly MockFleetCandidateDraft[])
    | undefined;

  constructor(options: FleetCoordinatorOptions) {
    this.auditLogger = options.auditLogger;
    this.budgetGate = options.budgetGate ?? new DefaultBudgetGate();
    this.budgetLimit = options.budgetLimit ?? DEFAULT_GATES_CONFIG;
    this.policyGate = options.policyGate ?? new DefaultPolicyGate();
    this.validator = options.validator ?? new DefaultValidator();
    this.arenaScorer = options.arenaScorer ?? new MockArenaScorer();
    this.shadowArenaScorer = options.shadowArenaScorer;
    this.arenaStore = options.arenaStore;
    this.arenaArchiveRoot = options.arenaArchiveRoot ?? DEFAULT_ARENA_ARCHIVE_PATH;
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

    if (fanout < MIN_ARENA_FANOUT) {
      const partial = {
        schema_version: 'phase-2-w12-arena-fanout-policy@1',
        task_id: input.taskId,
        turn_state: 'blocked',
        policy_decision: 'deny',
        requested_fanout: fanout,
        min_fanout: MIN_ARENA_FANOUT,
        max_fanout: this.budgetLimit.maxFleetFanout ?? DEFAULT_GATES_CONFIG.maxFleetFanout,
        partial_result: {
          summary: 'W12 Arena requires fanout between three and five candidates.',
          completed_steps: ['budget_gate_evaluated', 'arena_fanout_policy_evaluated'],
          blocked_reason: `fanout=${fanout} is below W12 Arena minimum ${MIN_ARENA_FANOUT}`
        },
        audit_trace_id: `${fleetSessionId}:fanout-policy`
      };
      const evidencePack = createEvidencePack(input.taskId, input.intent, [
        {
          source_ref: `arena://${fleetSessionId}/fanout-policy`,
          content: JSON.stringify(partial),
          tool: 'fleet-coordinator'
        }
      ]);
      await this.validateAndAudit(
        buildAgentResult({
          taskId: input.taskId,
          parentTaskId,
          fleetSessionId,
          agentRole: 'planner',
          worktreeMode: 'mock',
          turnState: 'blocked',
          output: JSON.stringify(partial),
          evidencePack,
          auditTraceId: `${fleetSessionId}:fanout-policy`,
          policyDecision: 'deny',
          budgetUsage
        })
      );
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
        auditTraceId: `${fleetSessionId}:fanout-policy`,
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
    if (candidates.length < MIN_ARENA_FANOUT || candidates.length > this.maxArenaFanout()) {
      return await this.buildBlockedSession({
        input,
        parentTaskId,
        fleetSessionId,
        plan,
        candidates,
        summary: 'W12 Arena candidate count policy blocked winner selection.',
        blockedReason: `candidate_count=${candidates.length} must be between ${MIN_ARENA_FANOUT} and ${this.maxArenaFanout()}`,
        completedSteps: [
          'planner_done',
          'implementer_done',
          'arena_candidate_count_policy_evaluated'
        ],
        auditTraceId: `${fleetSessionId}:candidate-count-policy`
      });
    }

    const arena = await this.buildArenaSession(plan, candidates, input.intent);
    if (!arena.winner.hardGatePassed || !arena.winner.consistencyPassed) {
      return await this.buildBlockedSession({
        input,
        parentTaskId,
        fleetSessionId,
        plan,
        candidates,
        arena,
        summary: 'W12 Arena hard gate blocked automatic winner selection.',
        blockedReason: `winner eligibility failed for ${arena.winner.candidateId}`,
        completedSteps: [
          'planner_done',
          'implementer_done',
          'critic_done',
          'arena_winner_gate_evaluated'
        ],
        auditTraceId: `${fleetSessionId}:winner-gate`
      });
    }
    const criticScores = this.toBlindCriticScores(arena);
    const reviewerDraft = await this.buildReviewerDraft(
      plan,
      candidates,
      criticScores,
      arena,
      input.intent
    );
    await this.saveArenaSession(arena, candidates);
    const evidencePack = mergeEvidencePacks(input.taskId, input.intent, [
      plan.evidencePack,
      findRequiredCandidate(candidates, arena.winner.candidateId).evidencePack,
      arena.evidencePack,
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
      arena,
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

  private async buildArenaSession(
    plan: FleetPlan,
    candidates: readonly FleetCandidate[],
    intent: string
  ): Promise<ArenaSession> {
    const criticRuns: ArenaCriticRun[] = [];
    const shadowCriticRuns: ArenaCriticRun[] = [];
    const candidateScores: ArenaCandidateScore[] = [];

    for (const candidate of candidates) {
      const criticInput = toBlindCriticInput(candidate);
      const mockScore = this.arenaScorer.scoreCandidate({
        fleetSessionId: candidate.fleetSessionId,
        parentTaskId: candidate.parentTaskId,
        candidateId: candidate.candidateId,
        blindInput: criticInput.blindInput,
        sanitizationReport: criticInput.sanitizationReport
      });
      candidateScores.push(mockScore.candidateScore);

      for (const run of mockScore.runs) {
        const criticRun = await this.auditCriticRun(candidate, run, intent);
        criticRuns.push(criticRun);
      }

      if (this.shadowArenaScorer !== undefined) {
        const shadowScore = this.shadowArenaScorer.scoreCandidate({
          fleetSessionId: candidate.fleetSessionId,
          parentTaskId: candidate.parentTaskId,
          candidateId: candidate.candidateId,
          blindInput: criticInput.blindInput,
          sanitizationReport: criticInput.sanitizationReport
        });
        for (const run of shadowScore.runs) {
          const shadowRun = await this.auditCriticRun(candidate, run, intent);
          shadowCriticRuns.push(shadowRun);
        }
      }
    }

    const winnerScore = selectWinner(candidateScores);
    const winner: ArenaSession['winner'] = {
      candidateId: winnerScore.candidateId,
      dimensions: winnerScore.dimensions,
      overallScore: winnerScore.overallScore,
      hardGateFindings: winnerScore.hardGateFindings,
      hardGatePassed: winnerScore.hardGatePassed,
      consistencyDelta: winnerScore.consistency.delta,
      consistencyPassed: winnerScore.consistency.passed,
      criticRunIds: winnerScore.criticRunIds
    };
    const evidencePack = createEvidencePack(`${plan.taskId}:arena`, intent, [
      {
        source_ref: `arena://${plan.fleetSessionId}/winner/${winner.candidateId}`,
        content: JSON.stringify({
          schema_version: W12_ARENA_SESSION_SCHEMA,
          scorer_mode: ARENA_SCORER_MODE,
          real_scorer: ARENA_REAL_SCORER_STATUS,
          winner_candidate_id: winner.candidateId,
          dimensions: winner.dimensions,
          overall_score: winner.overallScore,
          hard_gate_passed: winner.hardGatePassed,
          hard_gate_findings: winner.hardGateFindings,
          consistency_delta: winner.consistencyDelta,
          consistency_passed: winner.consistencyPassed
        }),
        tool: 'fleet-coordinator'
      }
    ]);

    return {
      schemaVersion: W12_ARENA_SESSION_SCHEMA,
      fleetSessionId: plan.fleetSessionId,
      parentTaskId: plan.parentTaskId,
      taskId: plan.taskId,
      scorerMode: ARENA_SCORER_MODE,
      realScorer: ARENA_REAL_SCORER_STATUS,
      candidateCount: candidates.length,
      consistencyThreshold: ARENA_CONSISTENCY_THRESHOLD,
      criticRuns,
      ...(shadowCriticRuns.length > 0 ? { shadowCriticRuns } : {}),
      candidateScores,
      winner,
      archivePath: `${this.arenaArchiveRoot}/${plan.fleetSessionId}`,
      evidencePack
    };
  }

  private async auditCriticRun(
    candidate: FleetCandidate,
    run: Omit<ArenaCriticRun, 'evidencePack'>,
    intent: string
  ): Promise<ArenaCriticRun> {
    const evidencePack = createEvidencePack(
      `${candidate.parentTaskId}:${candidate.candidateId}:critic:${run.runIndex}`,
      intent,
      [
        {
          source_ref: `arena://${candidate.fleetSessionId}/${candidate.candidateId}/critic/${run.runIndex}`,
          content: [
            'Arena critic used sanitized blind input.',
            `scorer=${run.scorerMode}`,
            `real_scorer=${run.realScorer}`,
            `rubric=${run.rubricVersion}`,
            `grader_input_hash=${run.graderInputHash}`,
            `hard_gate_passed=${run.hardGatePassed}`
          ].join(' '),
          tool: 'fleet-coordinator'
        }
      ]
    );
    const criticRun: ArenaCriticRun = {
      ...run,
      evidencePack
    };
    await this.validateAndAudit(
      buildAgentResult({
        taskId: `${candidate.parentTaskId}:${candidate.candidateId}:critic:${run.runIndex}`,
        parentTaskId: candidate.parentTaskId,
        fleetSessionId: candidate.fleetSessionId,
        agentRole: 'critic',
        candidateId: candidate.candidateId,
        worktreeMode: 'mock',
        turnState: 'done',
        output: JSON.stringify(criticRun),
        evidencePack,
        auditTraceId: `${candidate.fleetSessionId}:${candidate.candidateId}:critic:${run.runIndex}`,
        policyDecision: 'allow'
      })
    );
    return criticRun;
  }

  private toBlindCriticScores(arena: ArenaSession): readonly BlindCriticScore[] {
    return arena.candidateScores
      .map((score): BlindCriticScore => {
        const runs = arena.criticRuns.filter((run) => run.candidateId === score.candidateId);
        const firstRun = runs[0];
        if (firstRun === undefined) {
          throw new Error(`Arena critic run missing for candidate ${score.candidateId}`);
        }
        const evidencePack = mergeEvidencePacks(
          `${arena.taskId}:${score.candidateId}:critic`,
          'W12 Arena mock scoring',
          runs.map((run) => run.evidencePack)
        );
        return {
          fleetSessionId: arena.fleetSessionId,
          parentTaskId: arena.parentTaskId,
          candidateId: score.candidateId,
          score: toPercentScore(score.overallScore),
          verdict: firstRun.verdict,
          dimensions: score.dimensions,
          hardGateFindings: score.hardGateFindings,
          hardGatePassed: score.hardGatePassed,
          consistencyDelta: score.consistency.delta,
          consistencyPassed: score.consistency.passed,
          criticRunIds: score.criticRunIds,
          strengths: score.consistency.passed
            ? ['consistency check passed', 'acceptance criteria referenced']
            : ['acceptance criteria referenced'],
          risks: score.consistency.passed ? [] : ['consistency delta exceeded threshold'],
          blindInput: firstRun.blindInput,
          evidencePack
        };
      })
      .sort(
        (left, right) =>
          Number(right.hardGatePassed) - Number(left.hardGatePassed) ||
          Number(right.consistencyPassed) - Number(left.consistencyPassed) ||
          right.score - left.score ||
          left.candidateId.localeCompare(right.candidateId)
      );
  }

  private async saveArenaSession(
    arena: ArenaSession,
    candidates: readonly FleetCandidate[]
  ): Promise<void> {
    this.policyGate.evaluate({
      toolName: 'arenaStoreWrite',
      declaredTools: ['arenaStoreWrite'],
      toolDescriptor: {
        name: 'arenaStoreWrite',
        level: 'L2',
        risk: 'write'
      },
      policyLevel: 'L2'
    });
    const store = this.arenaStore ?? new SqliteArenaStore();
    try {
      await store.saveArenaSession({
        arena,
        candidates
      });
    } finally {
      if (this.arenaStore === undefined) store.close?.();
    }
  }

  private async buildReviewerDraft(
    plan: FleetPlan,
    candidates: readonly FleetCandidate[],
    criticScores: readonly BlindCriticScore[],
    arena: ArenaSession,
    intent: string
  ): Promise<ReviewerDraft> {
    const selectedScore =
      criticScores.find((score) => score.candidateId === arena.winner.candidateId) ??
      criticScores[0];
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
        source_ref: `arena://${plan.fleetSessionId}/winner/${selectedCandidateId}/reviewer-draft`,
        content: 'Reviewer draft includes only the Arena winner; losers remain archived.',
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
        `Arena scorer: ${arena.scorerMode}/${arena.realScorer}`,
        `Candidate count: ${arena.candidateCount}`,
        `Winner score: ${formatDimensions(arena.winner.dimensions)}`,
        `Consistency delta: ${arena.winner.consistencyDelta}`,
        `Loser archive: ${arena.archivePath}`,
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

  private maxArenaFanout(): number {
    return this.budgetLimit.maxFleetFanout ?? DEFAULT_GATES_CONFIG.maxFleetFanout;
  }

  private async buildBlockedSession(input: {
    readonly input: FleetCoordinatorInput;
    readonly parentTaskId: string;
    readonly fleetSessionId: string;
    readonly plan: FleetPlan;
    readonly candidates: readonly FleetCandidate[];
    readonly arena?: ArenaSession;
    readonly summary: string;
    readonly blockedReason: string;
    readonly completedSteps: readonly string[];
    readonly auditTraceId: string;
  }): Promise<FleetSession> {
    const evidencePack = mergeEvidencePacks(input.input.taskId, input.input.intent, [
      input.plan.evidencePack,
      ...input.candidates.map((candidate) => candidate.evidencePack),
      ...(input.arena !== undefined ? [input.arena.evidencePack] : [])
    ]);
    await this.validateAndAudit(
      buildAgentResult({
        taskId: input.input.taskId,
        parentTaskId: input.parentTaskId,
        fleetSessionId: input.fleetSessionId,
        agentRole: 'critic',
        worktreeMode: 'mock',
        turnState: 'blocked',
        output: JSON.stringify({
          summary: input.summary,
          blocked_reason: input.blockedReason,
          completed_steps: input.completedSteps
        }),
        evidencePack,
        auditTraceId: input.auditTraceId,
        policyDecision: 'deny'
      })
    );
    return {
      schemaVersion: W10_FLEET_SESSION_SCHEMA,
      fleetSessionId: input.fleetSessionId,
      parentTaskId: input.parentTaskId,
      taskId: input.input.taskId,
      turnState: 'blocked',
      worktreeMode: 'mock',
      realFanout: 'real_disabled',
      realMergeRequest: 'real_disabled',
      plan: input.plan,
      candidates: input.candidates,
      criticScores: input.arena !== undefined ? this.toBlindCriticScores(input.arena) : [],
      ...(input.arena !== undefined ? { arena: input.arena } : {}),
      evidencePack,
      auditTraceId: input.auditTraceId,
      blockedPartialResult: {
        summary: input.summary,
        completedSteps: input.completedSteps,
        blockedReason: input.blockedReason
      }
    };
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

function toBlindCriticInput(candidate: FleetCandidate): {
  readonly blindInput: BlindCriticInput;
  readonly sanitizationReport: ArenaSanitizationReport;
} {
  const source = [
    candidate.anonymousDiff,
    candidate.selfTest.command,
    candidate.selfTest.summary,
    ...candidate.acceptance
  ].join('\n');
  const sanitizedDiff = sanitizeBlindDiff(candidate.anonymousDiff);
  const sanitizedSelfTest = {
    command: sanitizeBlindText(candidate.selfTest.command),
    passed: candidate.selfTest.passed,
    summary: sanitizeBlindText(candidate.selfTest.summary)
  };
  const sanitizedAcceptance = candidate.acceptance.map(sanitizeBlindText);
  const blindInput: BlindCriticInput = {
    anonymousDiff: sanitizedDiff,
    selfTest: {
      command: sanitizedSelfTest.command,
      passed: sanitizedSelfTest.passed,
      summary: sanitizedSelfTest.summary
    },
    acceptance: sanitizedAcceptance,
    rubric: W12_ARENA_ALLOWED_RUBRIC
  };
  return {
    blindInput,
    sanitizationReport: buildSanitizationReport(source, JSON.stringify(blindInput))
  };
}

function sanitizeBlindDiff(value: string): string {
  return sanitizeBlindText(value)
    .replace(/\b(?:a|b)\/[^\s]+/g, '[redacted_path]')
    .replace(/^diff --(?:git|mock)\s+.+$/gim, 'diff --blind [redacted_path]')
    .replace(/^---\s+.+$/gim, '--- [redacted_path]')
    .replace(/^\+\+\+\s+.+$/gim, '+++ [redacted_path]');
}

function sanitizeBlindText(value: string): string {
  return value
    .replace(/\bproducer_agent\s*[:=]\s*[^\s,;]+/gi, '[redacted_identity]')
    .replace(/\bworktree[-_/]?[a-z0-9][a-z0-9._/-]*/gi, '[redacted_identity]')
    .replace(/\bcandidate[-_\s]?\d+\b/gi, 'candidate-[redacted]')
    .replace(/\bproducer[-_ ]?agent\b/gi, '[redacted_identity]')
    .replace(
      /\b(?:token|api[-_ ]?key|secret|authorization)\s*[:=]\s*[^\s,;]+/gi,
      '[redacted_sensitive]'
    )
    .replace(
      /\b(?:10|172\.(?:1[6-9]|2\d|3[01])|192\.168)\.\d{1,3}\.\d{1,3}\b/g,
      '[redacted_sensitive]'
    )
    .replace(
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
      '[redacted_sensitive]'
    )
    .replace(/\b(?:病案|收费|CA签名|CA signature)\b/gi, '[redacted_sensitive]')
    .replace(/(?:[\w.-]+\/)+[\w.-]+(?:\.[A-Za-z0-9]+)?/g, '[redacted_path]');
}

function selectWinner(scores: readonly ArenaCandidateScore[]): ArenaCandidateScore {
  const selected = scores
    .filter((score) => score.hardGatePassed && score.consistency.passed)
    .sort(
      (left, right) =>
        right.overallScore - left.overallScore || left.candidateId.localeCompare(right.candidateId)
    )[0];
  if (selected === undefined) {
    const fallback = scores[0];
    if (fallback !== undefined) return fallback;
    throw new Error('Arena winner cannot be selected without candidate scores');
  }
  return selected;
}

function buildSanitizationReport(original: string, sanitized: string): ArenaSanitizationReport {
  return {
    identityLeakDetected: containsIdentityLeak(original),
    sensitiveLeakDetected: containsSensitiveLeak(original),
    pathLeakDetected: containsPathLeak(original),
    redactionCount: countRedactions(sanitized),
    blockedTerms: blockedTerms(original)
  };
}

function containsIdentityLeak(value: string): boolean {
  return /producer_agent|producer[-_ ]?agent|worktree[-_/]?[a-z0-9]/i.test(value);
}

function containsSensitiveLeak(value: string): boolean {
  return (
    /\b(?:token|api[-_ ]?key|secret|authorization)\b/i.test(value) ||
    /\b(?:10|172\.(?:1[6-9]|2\d|3[01])|192\.168)\.\d{1,3}\.\d{1,3}\b/.test(value) ||
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(value) ||
    /\b(?:病案|收费|CA签名|CA signature)\b/i.test(value)
  );
}

function containsPathLeak(value: string): boolean {
  return /(?:[\w.-]+\/)+[\w.-]+(?:\.[A-Za-z0-9]+)?/.test(value);
}

function countRedactions(value: string): number {
  return (value.match(/\[redacted_[a-z]+\]/g) ?? []).length;
}

function blockedTerms(value: string): readonly string[] {
  const terms: string[] = [];
  if (containsIdentityLeak(value)) terms.push('identity');
  if (containsSensitiveLeak(value)) terms.push('sensitive');
  if (containsPathLeak(value)) terms.push('path');
  return terms;
}

function findRequiredCandidate(
  candidates: readonly FleetCandidate[],
  candidateId: string
): FleetCandidate {
  const candidate = candidates.find((item) => item.candidateId === candidateId);
  if (candidate === undefined) {
    throw new Error(`Fleet candidate not found: ${candidateId}`);
  }
  return candidate;
}

function formatDimensions(dimensions: ArenaCandidateScore['dimensions']): string {
  return [
    `correctness=${dimensions.correctness}`,
    `style=${dimensions.style}`,
    `testCoverage=${dimensions.testCoverage}`,
    `diffMinimality=${dimensions.diffMinimality}`
  ].join(', ');
}

function buildAgentResult(input: {
  readonly taskId: string;
  readonly parentTaskId: string;
  readonly fleetSessionId: string;
  readonly agentRole: AgentRole;
  readonly candidateId?: string;
  readonly worktreeMode: Extract<FleetWorktreeMode, 'mock' | 'real_disabled'>;
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
