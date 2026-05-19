import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

import type { BudgetUsage, EvidencePack, TurnState } from '../runtime/index.js';

export type PolicyLevel = 'L0' | 'L1' | 'L2' | 'L3';

export interface GateDecision {
  readonly allowed: boolean;
  readonly reason: string;
}

export interface BudgetLimitConfig {
  readonly maxFanout: number;
  readonly maxFleetFanout?: number;
  readonly maxToolCalls: number;
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
  readonly maxPremiumRequests: number;
}

export type BudgetLimitKey = keyof BudgetLimitConfig;

export interface BudgetGateInput {
  readonly taskId: string;
  readonly usage: BudgetUsage;
  readonly budgetLimit: BudgetLimitConfig;
  readonly fleetFanout?: number;
  readonly traceId?: string;
}

export interface BudgetExceededErrorInput {
  readonly message: string;
  readonly taskId: string;
  readonly policyDecision: 'deny' | 'escalate';
  readonly budgetUsage: BudgetUsage;
  readonly budgetLimit: BudgetLimitConfig;
  readonly fleetFanout?: number;
  readonly exceededBudget: BudgetLimitKey;
  readonly recoveryHint: string;
  readonly traceId?: string;
}

export class BudgetExceededError extends Error {
  readonly taskId: string;
  readonly policyDecision: 'deny' | 'escalate';
  readonly budgetUsage: BudgetUsage;
  readonly budgetLimit: BudgetLimitConfig;
  readonly fleetFanout: number | undefined;
  readonly exceededBudget: BudgetLimitKey;
  readonly recoveryHint: string;
  readonly traceId: string | undefined;

  constructor(input: BudgetExceededErrorInput) {
    super(input.message);
    this.name = 'BudgetExceededError';
    this.taskId = input.taskId;
    this.policyDecision = input.policyDecision;
    this.budgetUsage = input.budgetUsage;
    this.budgetLimit = input.budgetLimit;
    this.fleetFanout = input.fleetFanout;
    this.exceededBudget = input.exceededBudget;
    this.recoveryHint = input.recoveryHint;
    this.traceId = input.traceId;
  }
}

export interface BudgetPartialResultV1 {
  readonly summary: string;
  readonly completed_steps: readonly string[];
  readonly blocked_reason: string;
}

export interface BudgetOverrunPartialResultV1 {
  readonly schema_version: 'phase-1c-w9-budget-overrun-partial-result@1';
  readonly task_id: string;
  readonly turn_state: 'blocked';
  readonly policy_decision: 'deny';
  readonly exceeded_budget: BudgetLimitKey;
  readonly exceeded_budget_limit: number;
  readonly exceeded_budget_actual: number;
  readonly fleet_fanout?: number;
  readonly budget_usage: BudgetUsage;
  readonly budget_limit: BudgetLimitConfig;
  readonly partial_result: BudgetPartialResultV1;
  readonly audit_trace_id: string;
  readonly recovery_hint: string;
}

export interface BudgetGateResult extends GateDecision {
  readonly budgetUsage?: BudgetUsage;
  readonly taskId?: string;
  readonly traceId?: string;
}

export interface BudgetGate {
  evaluate(_input: BudgetGateInput): BudgetGateResult;
}

export type ToolRiskLevel = 'read' | 'write' | 'high_risk';

export interface PolicyToolDescriptor {
  readonly name: string;
  readonly level: PolicyLevel;
  readonly risk: ToolRiskLevel;
}

export interface PolicyGateInput {
  readonly toolName: string;
  readonly declaredTools?: readonly string[];
  readonly toolDescriptor?: PolicyToolDescriptor;
  readonly policyLevel?: PolicyLevel;
  readonly highRiskDomain?: boolean;
}

export interface PolicyGateResult extends GateDecision {
  readonly decision: 'allow' | 'deny' | 'escalate';
}

export interface PolicyGate {
  evaluate(_input: PolicyGateInput): PolicyGateResult;
}

export interface ValidationIssue {
  readonly field: string;
  readonly message: string;
}

export interface ValidatorInput {
  readonly turnState: TurnState;
  readonly evidencePack: EvidencePack;
  readonly output: string;
}

export interface ValidatorResult extends GateDecision {
  readonly issues: readonly ValidationIssue[];
}

export interface Validator {
  validate(_input: ValidatorInput): ValidatorResult;
}

export interface GatesConfig {
  readonly maxFanout: number;
  readonly maxFleetFanout: number;
  readonly maxToolCalls: number;
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
  readonly maxPremiumRequests: number;
}

export const DEFAULT_GATES_CONFIG: GatesConfig = {
  maxFanout: 4,
  maxFleetFanout: 5,
  maxToolCalls: 8,
  maxInputTokens: 10_000,
  maxOutputTokens: 4_000,
  maxPremiumRequests: 1
};

const ALLOWED_TURN_STATES: readonly TurnState[] = [
  'done',
  'continue_current',
  'await_human',
  'blocked',
  'handoff_needed'
];

const ALLOWED_READ_ONLY_TOOLS = new Set([
  'getIssue',
  'searchIssues',
  'getComments',
  'getServerInfo',
  'getAttachmentMeta',
  'getFields',
  'getIssueDetails',
  'getIssueAttachment',
  'getIssueAttachmentContent',
  'getProjectMetadata',
  'getIssueRelations',
  'getTransitions',
  'searchCode',
  'readFile',
  'listRepositoryTree',
  'listMergeRequests',
  'listCommits',
  'getDiff',
  'listPipelines'
]);

export class DefaultBudgetGate implements BudgetGate {
  evaluate(input: BudgetGateInput): BudgetGateResult {
    const { budgetLimit, usage, taskId, traceId, fleetFanout } = input;
    const exceedReason = firstExceededBudgetReason(budgetLimit, usage, fleetFanout);
    if (exceedReason !== undefined) {
      throw new BudgetExceededError({
        message: `Budget exceeded for ${taskId}: ${exceedReason}`,
        taskId,
        policyDecision: 'deny',
        budgetUsage: usage,
        budgetLimit,
        ...(fleetFanout !== undefined ? { fleetFanout } : {}),
        exceededBudget: exceedReason,
        recoveryHint: recoveryHintForBudget(exceedReason),
        ...(traceId !== undefined ? { traceId } : {})
      });
    }

    return {
      allowed: true,
      reason: 'Budget within configured limits',
      budgetUsage: usage,
      taskId,
      ...(traceId !== undefined ? { traceId } : {})
    };
  }
}

export class DefaultPolicyGate implements PolicyGate {
  evaluate(input: PolicyGateInput): PolicyGateResult {
    const declaredTools = input.declaredTools ?? [];
    if (declaredTools.length === 0 || !declaredTools.includes(input.toolName)) {
      return {
        allowed: false,
        decision: 'deny',
        reason: `Tool ${input.toolName} is not declared`
      };
    }

    if (input.highRiskDomain === true) {
      return {
        allowed: false,
        decision: 'escalate',
        reason: `Tool ${input.toolName} touches a high-risk domain`
      };
    }

    const descriptor = input.toolDescriptor;
    const policyLevel = input.policyLevel ?? descriptor?.level ?? 'L0';
    if (!ALLOWED_READ_ONLY_TOOLS.has(input.toolName)) {
      return {
        allowed: false,
        decision: policyLevel === 'L2' || policyLevel === 'L3' ? 'escalate' : 'deny',
        reason: `Tool ${input.toolName} is outside the read-only tool allowlist`
      };
    }

    if (descriptor?.risk === 'write' || policyLevel === 'L2' || policyLevel === 'L3') {
      return {
        allowed: false,
        decision: 'escalate',
        reason: `Tool ${input.toolName} requires higher approval`
      };
    }

    return {
      allowed: true,
      decision: 'allow',
      reason: `Tool ${input.toolName} allowed`
    };
  }
}

export class DefaultValidator implements Validator {
  validate(input: ValidatorInput): ValidatorResult {
    const issues: ValidationIssue[] = [];
    if (!ALLOWED_TURN_STATES.includes(input.turnState)) {
      issues.push({
        field: 'turnState',
        message: `Invalid turn_state: ${input.turnState}`
      });
    }

    const shapeIssues = validateEvidencePackShape(input.evidencePack);
    if (shapeIssues.length > 0) {
      issues.push(...shapeIssues);
      return {
        allowed: false,
        reason: issues[0]?.message ?? 'Validation failed',
        issues
      };
    }

    issues.push(...validateEvidencePack(input.evidencePack));

    if (!hasSourceReferencedEvidence(input.evidencePack)) {
      issues.push({
        field: 'evidencePack.evidences',
        message: 'EvidencePack must include at least one evidence with source_ref'
      });
    }

    if (input.evidencePack.evidences.length === 0 && input.output.trim().length > 0) {
      issues.push({
        field: 'evidencePack.evidences',
        message: 'Unattributed output must remain in assumptions, not evidences'
      });
    }

    return {
      allowed: issues.length === 0,
      reason:
        issues.length === 0 ? 'Validation passed' : (issues[0]?.message ?? 'Validation failed'),
      issues
    };
  }
}

export async function loadGatesConfig(configPath: string): Promise<GatesConfig> {
  const raw = await readFile(configPath, 'utf8');
  const parsed = parseSimpleYaml(raw);
  return {
    maxFanout: parsed.maxFanout ?? DEFAULT_GATES_CONFIG.maxFanout,
    maxFleetFanout: parsed.maxFleetFanout ?? DEFAULT_GATES_CONFIG.maxFleetFanout,
    maxToolCalls: parsed.maxToolCalls ?? DEFAULT_GATES_CONFIG.maxToolCalls,
    maxInputTokens: parsed.maxInputTokens ?? DEFAULT_GATES_CONFIG.maxInputTokens,
    maxOutputTokens: parsed.maxOutputTokens ?? DEFAULT_GATES_CONFIG.maxOutputTokens,
    maxPremiumRequests: parsed.maxPremiumRequests ?? DEFAULT_GATES_CONFIG.maxPremiumRequests
  };
}

export function toBudgetExceededAuditRecord(
  error: BudgetExceededError,
  traceId: string
): Readonly<{
  taskId: string;
  policyDecision: 'deny' | 'escalate';
  budgetUsage: BudgetUsage;
  exceededBudget: BudgetLimitKey;
  fleetFanout?: number;
  recoveryHint: string;
  traceId: string;
}> {
  return {
    taskId: error.taskId,
    policyDecision: error.policyDecision,
    budgetUsage: error.budgetUsage,
    exceededBudget: error.exceededBudget,
    ...(error.fleetFanout !== undefined ? { fleetFanout: error.fleetFanout } : {}),
    recoveryHint: error.recoveryHint,
    traceId
  };
}

export function toBudgetOverrunPartialResultV1(
  error: BudgetExceededError,
  partialResult: BudgetPartialResultV1 = {
    summary: 'BudgetGate denied execution before additional work could start.',
    completed_steps: ['budget_gate_evaluated'],
    blocked_reason: error.message
  }
): BudgetOverrunPartialResultV1 {
  return {
    schema_version: 'phase-1c-w9-budget-overrun-partial-result@1',
    task_id: error.taskId,
    turn_state: 'blocked',
    policy_decision: 'deny',
    exceeded_budget: error.exceededBudget,
    exceeded_budget_limit: budgetLimitValue(error.exceededBudget, error.budgetLimit),
    exceeded_budget_actual: budgetUsageValue(
      error.exceededBudget,
      error.budgetUsage,
      error.fleetFanout
    ),
    ...(error.fleetFanout !== undefined ? { fleet_fanout: error.fleetFanout } : {}),
    budget_usage: error.budgetUsage,
    budget_limit: error.budgetLimit,
    partial_result: partialResult,
    audit_trace_id: error.traceId ?? `${error.taskId}-budget-overrun`,
    recovery_hint: error.recoveryHint
  };
}

export function isGatesConfigFile(path: string): boolean {
  return basename(path) === 'gates.yaml' || basename(path) === 'gates.yml';
}

function firstExceededBudgetReason(
  budgetLimit: BudgetLimitConfig,
  usage: BudgetUsage,
  fleetFanout: number | undefined
): BudgetLimitKey | undefined {
  if (fleetFanout !== undefined && fleetFanout > maxFleetFanoutLimit(budgetLimit)) {
    return 'maxFleetFanout';
  }
  if (usage.fanout > budgetLimit.maxFanout) return 'maxFanout';
  if (usage.toolCalls > budgetLimit.maxToolCalls) return 'maxToolCalls';
  if (usage.inputTokens > budgetLimit.maxInputTokens) return 'maxInputTokens';
  if (usage.outputTokens > budgetLimit.maxOutputTokens) return 'maxOutputTokens';
  if (usage.premiumRequests > budgetLimit.maxPremiumRequests) return 'maxPremiumRequests';
  return undefined;
}

function recoveryHintForBudget(exceededBudget: BudgetLimitKey): string {
  switch (exceededBudget) {
    case 'maxFanout':
      return 'Reduce fanout to one gpt-5-mini turn or wait for ADR-approved fanout enablement.';
    case 'maxFleetFanout':
      return 'Reduce /fleet mock fanout to five or fewer candidates; real fanout remains disabled.';
    case 'maxToolCalls':
      return 'Stop additional tool calls and return a blocked partial result with existing evidence.';
    case 'maxInputTokens':
      return 'Trim context with hot_index summaries and lazy-load details only after approval.';
    case 'maxOutputTokens':
      return 'Return a shorter partial result and ask for a follow-up turn if more detail is needed.';
    case 'maxPremiumRequests':
      return 'Keep the default gpt-5-mini path and do not spend additional premium requests.';
  }
}

function budgetLimitValue(key: BudgetLimitKey, limit: BudgetLimitConfig): number {
  if (key === 'maxFleetFanout') return maxFleetFanoutLimit(limit);
  return limit[key];
}

function budgetUsageValue(
  key: BudgetLimitKey,
  usage: BudgetUsage,
  fleetFanout: number | undefined
): number {
  switch (key) {
    case 'maxFleetFanout':
      return fleetFanout ?? usage.fleetFanout ?? usage.fanout;
    case 'maxFanout':
      return usage.fanout;
    case 'maxToolCalls':
      return usage.toolCalls;
    case 'maxInputTokens':
      return usage.inputTokens;
    case 'maxOutputTokens':
      return usage.outputTokens;
    case 'maxPremiumRequests':
      return usage.premiumRequests;
  }
}

function maxFleetFanoutLimit(limit: BudgetLimitConfig): number {
  return Math.min(limit.maxFleetFanout ?? DEFAULT_GATES_CONFIG.maxFleetFanout, 5);
}

function validateEvidencePack(evidencePack: EvidencePack): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (evidencePack.confidence < 0 || evidencePack.confidence > 1) {
    issues.push({
      field: 'evidencePack.confidence',
      message: 'confidence must be between 0 and 1'
    });
  }

  for (const evidence of evidencePack.evidences) {
    if (evidence.source_ref.trim().length === 0) {
      issues.push({
        field: 'evidencePack.evidences.source_ref',
        message: 'Evidence source_ref must not be blank'
      });
    }
  }

  for (const assumption of evidencePack.assumptions) {
    if (assumption.confidence < 0 || assumption.confidence > 1) {
      issues.push({
        field: 'evidencePack.assumptions.confidence',
        message: 'Assumption confidence must be between 0 and 1'
      });
    }
    if (assumption.statement.trim().length === 0) {
      issues.push({
        field: 'evidencePack.assumptions.statement',
        message: 'Assumption statement must not be blank'
      });
    }
  }

  return issues;
}

function hasSourceReferencedEvidence(evidencePack: EvidencePack): boolean {
  return evidencePack.evidences.some((evidence) => evidence.source_ref.trim().length > 0);
}

function validateEvidencePackShape(value: EvidencePack): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (typeof value.taskId !== 'string' || value.taskId.length === 0) {
    issues.push({ field: 'evidencePack.taskId', message: 'taskId must be a non-empty string' });
  }
  if (typeof value.intent !== 'string' || value.intent.length === 0) {
    issues.push({ field: 'evidencePack.intent', message: 'intent must be a non-empty string' });
  }
  if (!Array.isArray(value.evidences)) {
    issues.push({ field: 'evidencePack.evidences', message: 'evidences must be an array' });
  } else {
    for (const evidence of value.evidences) {
      if (typeof evidence.source_ref !== 'string') {
        issues.push({
          field: 'evidencePack.evidences.source_ref',
          message: 'Evidence source_ref must be a string'
        });
      }
      if (typeof evidence.content !== 'string') {
        issues.push({
          field: 'evidencePack.evidences.content',
          message: 'Evidence content must be a string'
        });
      }
    }
  }
  if (!Array.isArray(value.assumptions)) {
    issues.push({ field: 'evidencePack.assumptions', message: 'assumptions must be an array' });
  } else {
    for (const assumption of value.assumptions) {
      if (!isEvidenceAssumptionShape(assumption)) {
        issues.push({
          field: 'evidencePack.assumptions',
          message: 'Assumptions must contain statement and confidence'
        });
      }
    }
  }
  if (typeof value.confidence !== 'number') {
    issues.push({ field: 'evidencePack.confidence', message: 'confidence must be a number' });
  }
  return issues;
}

function isEvidenceAssumptionShape(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.statement === 'string' && typeof record.confidence === 'number';
}

function parseSimpleYaml(raw: string): Partial<GatesConfig> {
  const result: Record<string, number> = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
    const [key, value] = trimmed.split(':').map((part) => part.trim());
    if (key === undefined || value === undefined) continue;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) continue;
    if (
      key === 'maxFanout' ||
      key === 'maxFleetFanout' ||
      key === 'max_fleet_fanout' ||
      key === 'maxToolCalls' ||
      key === 'maxInputTokens' ||
      key === 'maxOutputTokens' ||
      key === 'maxPremiumRequests'
    ) {
      const normalizedKey = key === 'max_fleet_fanout' ? 'maxFleetFanout' : key;
      result[normalizedKey] = parsed;
    }
  }
  return result;
}
