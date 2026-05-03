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

export interface RuntimeIdentity {
  readonly name: 'copilot_sdk' | 'copilot_cli' | 'contract_stub';
  readonly version?: string;
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
  readonly turnState: TurnState;
  readonly output: string;
  readonly evidencePack: EvidencePack;
  readonly auditTraceId: string;
  readonly model: RuntimeModel;
  readonly runtime: RuntimeIdentity;
  readonly reasoningEffort: ReasoningEffort;
  readonly promptVersion: string;
  readonly policyDecision?: 'deny' | 'allow' | 'escalate';
  readonly budgetUsage?: {
    readonly fanout: number;
    readonly toolCalls: number;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly premiumRequests: number;
  };
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
