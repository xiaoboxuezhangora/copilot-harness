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
  readonly fleetSessionId?: string;
  readonly parentTaskId?: string;
  readonly agentRole?: string;
  readonly candidateId?: string;
  readonly worktreeMode?: 'mock' | 'real_disabled';
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

export interface AuditTurnRecordV1 {
  readonly timestamp: string;
  readonly task_id: string;
  readonly fleet_session_id?: string;
  readonly parent_task_id?: string;
  readonly agent_role?: string;
  readonly candidate_id?: string;
  readonly worktree_mode?: 'mock' | 'real_disabled';
  readonly turn_state: TurnState;
  readonly model: RuntimeModel;
  readonly runtime: RuntimeIdentity;
  readonly tool_calls: readonly ToolCallRecord[];
  readonly trace_id: string;
  readonly reasoning_effort: ReasoningEffort;
  readonly policy_decision?: 'deny' | 'allow' | 'escalate';
  readonly budget_usage?: BudgetUsage;
  readonly prompt_version: string;
  readonly capabilities: AgentCapabilityFlags;
  readonly otel_attributes: Readonly<Record<string, string | number | boolean>>;
}
