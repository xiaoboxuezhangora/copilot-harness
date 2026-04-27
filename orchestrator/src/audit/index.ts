export interface ToolCallAuditEvent {
  readonly traceId: string;
  readonly spanId: string;
  readonly toolName: string;
  readonly timestampIso: string;
  readonly attributes: Readonly<Record<string, string | number | boolean>>;
  // OTel GenAI semantic conventions keys should include:
  // gen_ai.system, gen_ai.request.model, gen_ai.usage.input_tokens
}

export interface AuditLogWriter {
  writeJsonl(_event: ToolCallAuditEvent): Promise<void>;
}

export interface OTelExporter {
  export(_event: ToolCallAuditEvent): Promise<void>;
}
