import type {
  AgentCapabilityFlags,
  ReasoningEffort,
  RuntimeIdentity,
  RuntimeModel,
  ToolCallRecord
} from '../types.js';

export interface RuntimeAdapterProbe {
  readonly runtime: RuntimeIdentity;
  readonly capabilities: AgentCapabilityFlags;
  readonly detectedVersion?: string;
  readonly rawSummary: string;
}

export interface RuntimeAdapterRequest {
  readonly taskId: string;
  readonly prompt: string;
  readonly taskDescription?: string;
  readonly model: RuntimeModel;
  readonly reasoningEffort: ReasoningEffort;
  readonly timeoutMs?: number;
}

export interface RuntimeAdapterResponse {
  readonly output: string;
  readonly toolCalls: readonly ToolCallRecord[];
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly sessionId?: string;
  readonly capabilityNotes: readonly string[];
}

export interface RuntimeAdapter {
  probe(): Promise<RuntimeAdapterProbe>;
  execute(request: RuntimeAdapterRequest): Promise<RuntimeAdapterResponse>;
}
