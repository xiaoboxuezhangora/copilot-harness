import type {
  AgentCapabilityFlags,
  BudgetUsage,
  ReasoningEffort,
  RuntimeIdentity,
  RuntimeModel,
  ToolCallRecord,
  TurnState
} from '../runtime/index.js';

export interface AuditTurnRecord {
  readonly timestamp: string;
  readonly taskId: string;
  readonly turnState: TurnState;
  readonly model: RuntimeModel;
  readonly runtime: RuntimeIdentity;
  readonly toolCalls: readonly ToolCallRecord[];
  readonly traceId: string;
  readonly reasoningEffort: ReasoningEffort;
  readonly policyDecision?: 'deny' | 'allow' | 'escalate';
  readonly budgetUsage?: BudgetUsage;
  readonly promptVersion: string;
  readonly capabilities: AgentCapabilityFlags;
  readonly otelAttributes: Readonly<Record<string, string | number | boolean>>;
}
