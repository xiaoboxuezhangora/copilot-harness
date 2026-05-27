import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import { DEFAULT_MODEL, DEFAULT_MODEL_REF } from '../runtime/index.js';
import type {
  AgentResult,
  ModelRef,
  RuntimeAuditAttributeValue,
  RuntimeModelRouteDecision
} from '../runtime/index.js';
import { redactAuditExport } from '../security/index.js';
import type { AuditTurnRecord, AuditTurnRecordV1 } from './types.js';

export type { AuditTurnRecord } from './types.js';
export type { AuditTurnRecordV1 } from './types.js';

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
    const redactedRecord = redactAuditExport(record).value;
    await mkdir(dirname(this.filePath), {
      recursive: true
    });
    await appendFile(this.filePath, `${JSON.stringify(redactedRecord)}\n`, 'utf8');
    return record;
  }
}

export function toAuditTurnRecord(result: AgentResult): AuditTurnRecord {
  const inputTokens = result.tokenUsage?.inputTokens ?? 0;
  const outputTokens = result.tokenUsage?.outputTokens ?? 0;
  const routingAttributes = buildRoutingAuditAttributes(result);

  return {
    timestamp: new Date().toISOString(),
    taskId: result.taskId,
    ...(result.fleetSessionId !== undefined ? { fleetSessionId: result.fleetSessionId } : {}),
    ...(result.parentTaskId !== undefined ? { parentTaskId: result.parentTaskId } : {}),
    ...(result.agentRole !== undefined ? { agentRole: result.agentRole } : {}),
    ...(result.candidateId !== undefined ? { candidateId: result.candidateId } : {}),
    ...(result.worktreeMode !== undefined ? { worktreeMode: result.worktreeMode } : {}),
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
      'gen_ai.request.reasoning_effort': result.reasoningEffort,
      ...routingAttributes,
      ...(result.auditAttributes ?? {})
    }
  };
}

function buildRoutingAuditAttributes(
  result: AgentResult
): Readonly<Record<string, RuntimeAuditAttributeValue>> {
  const decision = result.routeDecision;
  const providerId = decision?.providerId ?? DEFAULT_MODEL_REF.providerId;
  const routeSource = decision?.routeSource ?? 'default_route';
  const isDefault =
    providerId === DEFAULT_MODEL_REF.providerId && result.model === DEFAULT_MODEL;
  const attrs: Record<string, RuntimeAuditAttributeValue> = {
    'harness.routing.source': routeSource,
    'harness.model.id': `${providerId}/${result.model}`,
    'harness.model.is_default': isDefault,
    'harness.model.name': result.model,
    'harness.provider.id': providerId,
    'harness.runtime.adapter': result.runtime.name
  };

  addDecisionAttributes(attrs, decision);
  return attrs;
}

function addDecisionAttributes(
  attrs: Record<string, RuntimeAuditAttributeValue>,
  decision: RuntimeModelRouteDecision | undefined
): void {
  if (decision === undefined) return;

  if (decision.matchedRuleId !== undefined) {
    attrs['harness.routing.rule_id'] = decision.matchedRuleId;
  }
  if (decision.routeReason !== undefined) {
    attrs['harness.routing.reason'] = decision.routeReason;
  }
  if (decision.estimatedCostCny !== undefined) {
    attrs['harness.budget.cost_cny'] = decision.estimatedCostCny;
  }
  if (decision.snapshotVersion !== undefined) {
    attrs['harness.config.snapshot_version'] = decision.snapshotVersion;
  }
  if (decision.fallbackChain !== undefined) {
    attrs['harness.routing.fallback_chain'] = formatFallbackChain(decision.fallbackChain);
  }
  if (decision.auditAttrs !== undefined) {
    Object.assign(attrs, decision.auditAttrs);
  }
}

function formatFallbackChain(chain: readonly ModelRef[]): string {
  return chain.map((item) => `${item.providerId}/${item.model}`).join(' -> ');
}

export function toAuditTurnRecordV1(record: AuditTurnRecord): AuditTurnRecordV1 {
  return redactAuditExport({
    timestamp: record.timestamp,
    task_id: record.taskId,
    ...(record.fleetSessionId !== undefined ? { fleet_session_id: record.fleetSessionId } : {}),
    ...(record.parentTaskId !== undefined ? { parent_task_id: record.parentTaskId } : {}),
    ...(record.agentRole !== undefined ? { agent_role: record.agentRole } : {}),
    ...(record.candidateId !== undefined ? { candidate_id: record.candidateId } : {}),
    ...(record.worktreeMode !== undefined ? { worktree_mode: record.worktreeMode } : {}),
    turn_state: record.turnState,
    model: record.model,
    runtime: record.runtime,
    tool_calls: record.toolCalls,
    trace_id: record.traceId,
    reasoning_effort: record.reasoningEffort,
    ...(record.policyDecision !== undefined ? { policy_decision: record.policyDecision } : {}),
    ...(record.budgetUsage !== undefined ? { budget_usage: record.budgetUsage } : {}),
    prompt_version: record.promptVersion,
    capabilities: record.capabilities,
    otel_attributes: record.otelAttributes
  }).value;
}
