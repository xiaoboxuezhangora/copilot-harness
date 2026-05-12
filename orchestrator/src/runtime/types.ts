export type TurnState = 'done' | 'continue_current' | 'await_human' | 'blocked' | 'handoff_needed';

export type RuntimeModel = 'gpt-5-mini';

export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';

export type Verbosity = 'low' | 'medium' | 'high';

export type ToolCallDecision = 'allow' | 'deny' | 'escalate';

export const DEFAULT_MODEL: RuntimeModel = 'gpt-5-mini';

export const DEFAULT_RUN_OPTIONS = {
  reasoningEffort: 'medium'
} as const satisfies Pick<Required<RunOptions>, 'reasoningEffort'>;

export interface RunOptions {
  /**
   * Defaults to "medium" when omitted. R9 keeps the model fixed separately
   * through DEFAULT_MODEL, so this option only controls runtime reasoning depth.
   */
  readonly reasoningEffort?: ReasoningEffort;
  readonly verbosity?: Verbosity;
}

export interface BudgetLimit {
  readonly maxFanout: number;
  readonly maxToolCalls?: number;
  readonly maxInputTokens?: number;
  readonly maxOutputTokens?: number;
  readonly timeoutMs?: number;
}

export interface BudgetUsage {
  readonly fanout: number;
  readonly fleetFanout?: number;
  readonly toolCalls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly premiumRequests: number;
}

export interface AgentTask {
  readonly taskId: string;
  readonly prompt: string;
  readonly intent: string;
  readonly turnState: TurnState;
  readonly budgetLimit: BudgetLimit;
  readonly promptVersion: string;
  readonly runOptions?: RunOptions;
}

export interface Evidence {
  readonly source_ref: string;
  readonly content: string;
  readonly tool?: string;
}

export interface EvidenceAssumption {
  readonly statement: string;
  readonly confidence: number;
}

export interface EvidencePack {
  readonly taskId: string;
  readonly intent: string;
  readonly evidences: readonly Evidence[];
  readonly assumptions: readonly EvidenceAssumption[];
  /**
   * Confidence is represented as a 0..1 score by convention. The runtime
   * validator will enforce range checks when implementation starts.
   */
  readonly confidence: number;
}

export interface EvidencePackV1 {
  readonly task_id: string;
  readonly intent: string;
  readonly evidences: readonly Evidence[];
  readonly assumptions: readonly EvidenceAssumption[];
  readonly confidence: number;
}

export function toEvidencePackV1(pack: EvidencePack): EvidencePackV1 {
  return {
    task_id: pack.taskId,
    intent: pack.intent,
    evidences: pack.evidences,
    assumptions: pack.assumptions,
    confidence: pack.confidence
  };
}

export function fromEvidencePackV1(pack: EvidencePackV1): EvidencePack {
  return {
    taskId: pack.task_id,
    intent: pack.intent,
    evidences: pack.evidences,
    assumptions: pack.assumptions,
    confidence: pack.confidence
  };
}

export interface RuntimeIdentity {
  readonly name: 'copilot_sdk' | 'copilot_cli' | 'contract_stub';
  readonly version?: string;
}

export type RuntimeUnsupportedCapability = 'spawn' | 'resumeSession';

export type RuntimeGateSemantic = 'AgentRuntimeV1' | 'BudgetGate' | 'ReleaseGate';

export interface RuntimeUnsupportedCapabilityV1 {
  readonly schema_version: 'phase-1c-w9-runtime-unsupported-capability@1';
  readonly capability: RuntimeUnsupportedCapability;
  readonly runtime: RuntimeIdentity;
  readonly reason: string;
  readonly recovery_hint: string;
  readonly policy_decision: 'deny';
  readonly gate: RuntimeGateSemantic;
  readonly requested_count?: number;
  readonly session_id?: string;
  readonly audit_trace_id?: string;
}

export interface RuntimeUnsupportedCapabilityInput {
  readonly capability: RuntimeUnsupportedCapability;
  readonly runtime: RuntimeIdentity;
  readonly reason: string;
  readonly recoveryHint: string;
  readonly gate: RuntimeGateSemantic;
  readonly requestedCount?: number;
  readonly sessionId?: string;
  readonly auditTraceId?: string;
}

export class RuntimeCapabilityUnsupportedError extends Error {
  readonly details: RuntimeUnsupportedCapabilityV1;

  constructor(details: RuntimeUnsupportedCapabilityV1) {
    super(`${details.runtime.name}.${details.capability} denied: ${details.reason}`);
    this.name = 'RuntimeCapabilityUnsupportedError';
    this.details = details;
  }
}

export function createRuntimeUnsupportedCapabilityError(
  input: RuntimeUnsupportedCapabilityInput
): RuntimeCapabilityUnsupportedError {
  return new RuntimeCapabilityUnsupportedError({
    schema_version: 'phase-1c-w9-runtime-unsupported-capability@1',
    capability: input.capability,
    runtime: input.runtime,
    reason: input.reason,
    recovery_hint: input.recoveryHint,
    policy_decision: 'deny',
    gate: input.gate,
    ...(input.requestedCount !== undefined ? { requested_count: input.requestedCount } : {}),
    ...(input.sessionId !== undefined ? { session_id: input.sessionId } : {}),
    ...(input.auditTraceId !== undefined ? { audit_trace_id: input.auditTraceId } : {})
  });
}

export function isRuntimeCapabilityUnsupportedError(
  error: unknown
): error is RuntimeCapabilityUnsupportedError {
  return error instanceof RuntimeCapabilityUnsupportedError;
}

export interface AgentCapabilityFlags {
  readonly canSpawn: boolean;
  readonly canUseTools: boolean;
  readonly canResume: boolean;
  readonly canReadMemory: boolean;
  readonly canWriteMemory: boolean;
  readonly canUseMcp: boolean;
  readonly supportsSessions: boolean;
  readonly supportsHooks: boolean;
  readonly supportsReasoningEffort: boolean;
  readonly supportsHeadless: boolean;
  readonly externalExecution: boolean;
  readonly capabilitySupported: boolean;
  readonly unsupportedReasons: readonly string[];
}

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface ToolCallRecord {
  readonly toolName: string;
  readonly decision: ToolCallDecision;
  readonly timestampIso: string;
  readonly argsPreview?: string;
}

export interface TurnContext {
  readonly taskId: string;
  readonly sessionId?: string;
  readonly model: RuntimeModel;
  readonly runtime: RuntimeIdentity;
  readonly runOptions: Required<Pick<RunOptions, 'reasoningEffort'>> &
    Omit<RunOptions, 'reasoningEffort'>;
  readonly turnState: TurnState;
  readonly auditTraceId?: string;
  readonly toolCalls: readonly ToolCallRecord[];
}

export interface AgentResult {
  readonly taskId: string;
  readonly fleetSessionId?: string;
  readonly parentTaskId?: string;
  readonly agentRole?: string;
  readonly candidateId?: string;
  readonly worktreeMode?: 'mock' | 'real_disabled';
  readonly turnState: TurnState;
  readonly output: string;
  readonly evidencePack: EvidencePack;
  readonly auditTraceId: string;
  readonly model: RuntimeModel;
  readonly runtime: RuntimeIdentity;
  readonly reasoningEffort: ReasoningEffort;
  readonly promptVersion: string;
  readonly policyDecision?: 'deny' | 'allow' | 'escalate';
  readonly budgetUsage?: BudgetUsage;
  readonly capabilities: AgentCapabilityFlags;
  readonly toolCalls: readonly ToolCallRecord[];
  readonly tokenUsage?: TokenUsage;
}

export type TurnEndHook = (result: AgentResult, context: TurnContext) => Promise<void>;

export type ToolCallHook = (
  toolName: string,
  args: unknown,
  context: TurnContext
) => Promise<ToolCallDecision>;

export interface AgentRuntime {
  run(task: AgentTask): Promise<AgentResult>;
  spawn(count: number): Promise<readonly AgentResult[]>;
  onTurnEnd(hook: TurnEndHook): void;
  onToolCall(hook: ToolCallHook): void;
  resumeSession(sessionId: string): Promise<AgentResult>;
}
