import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { AgentResult } from '../runtime/index.js';
import type { AuditTurnRecord } from './types.js';

export type { AuditTurnRecord } from './types.js';

export interface ToolCallAuditEvent {
  readonly traceId: string;
  readonly spanId: string;
  readonly toolName: string;
  readonly timestampIso: string;
  readonly attributes: Readonly<Record<string, string | number | boolean>>;
}

export interface AuditLogWriter {
  writeJsonl(_event: ToolCallAuditEvent): Promise<void>;
}

export interface OTelExporter {
  export(_event: ToolCallAuditEvent): Promise<void>;
}

export class AuditLogger {
  constructor(private readonly filePath: string) {}

  async logTurn(result: AgentResult): Promise<AuditTurnRecord> {
    const record = toAuditTurnRecord(result);
    await mkdir(dirname(this.filePath), {
      recursive: true
    });
    await appendFile(this.filePath, `${JSON.stringify(record)}\n`, 'utf8');
    return record;
  }
}

export function toAuditTurnRecord(result: AgentResult): AuditTurnRecord {
  const inputTokens = result.tokenUsage?.inputTokens ?? 0;
  const outputTokens = result.tokenUsage?.outputTokens ?? 0;

  return {
    timestamp: new Date().toISOString(),
    taskId: result.taskId,
    turnState: result.turnState,
    model: result.model,
    runtime: result.runtime,
    toolCalls: result.toolCalls,
    traceId: result.auditTraceId,
    reasoningEffort: result.reasoningEffort,
    ...(result.policyDecision !== undefined ? { policyDecision: result.policyDecision } : {}),
    ...(result.budgetUsage !== undefined ? { budgetUsage: result.budgetUsage } : {}),
    promptVersion: result.promptVersion,
    capabilities: result.capabilities,
    otelAttributes: {
      'gen_ai.system': result.runtime.name,
      'gen_ai.request.model': result.model,
      'gen_ai.usage.input_tokens': inputTokens,
      'gen_ai.usage.output_tokens': outputTokens,
      'gen_ai.request.reasoning_effort': result.reasoningEffort
    }
  };
}
