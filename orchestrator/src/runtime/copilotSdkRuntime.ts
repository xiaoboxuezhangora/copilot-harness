import { AuditLogger } from '../audit/index.js';
import type {
  AgentResult,
  AgentRuntime,
  AgentTask,
  RuntimeModelRoutingGate,
  ToolCallHook,
  TurnEndHook
} from './types.js';
import { createRuntimeUnsupportedCapabilityError } from './types.js';
import { CopilotSdkAdapter } from './adapters/copilotSdkAdapter.js';
import type { RuntimeAdapter } from './adapters/types.js';
import {
  buildContext,
  buildResult,
  createTraceId,
  resolveModelRouteDecision,
  resolveReasoningEffort
} from './adapters/shared.js';

export interface CopilotSdkRuntimeOptions {
  readonly adapter?: RuntimeAdapter;
  readonly auditLogger?: AuditLogger;
  readonly modelRoutingGate?: RuntimeModelRoutingGate;
}

export class CopilotSdkRuntime implements AgentRuntime {
  private readonly turnEndHooks: TurnEndHook[] = [];
  private readonly toolCallHooks: ToolCallHook[] = [];
  private readonly adapter: RuntimeAdapter;
  private readonly auditLogger: AuditLogger | undefined;
  private readonly modelRoutingGate: RuntimeModelRoutingGate | undefined;

  constructor(options: CopilotSdkRuntimeOptions = {}) {
    this.adapter = options.adapter ?? new CopilotSdkAdapter();
    this.auditLogger = options.auditLogger;
    this.modelRoutingGate = options.modelRoutingGate;
  }

  async run(task: AgentTask): Promise<AgentResult> {
    const reasoningEffort = resolveReasoningEffort(task);
    const adapterProbe = await this.adapter.probe();
    const routeDecision = resolveModelRouteDecision(
      task,
      adapterProbe.runtime.name,
      this.modelRoutingGate
    );
    const adapterResponse = await this.adapter.execute({
      taskId: task.taskId,
      prompt: task.prompt,
      taskDescription: `${task.intent}\n${task.prompt}`,
      model: routeDecision.model,
      reasoningEffort,
      ...(task.budgetLimit.timeoutMs !== undefined ? { timeoutMs: task.budgetLimit.timeoutMs } : {})
    });
    const auditTraceId = createTraceId(task.taskId, 'copilot-sdk');
    const result = buildResult({
      task,
      runtime: adapterProbe.runtime,
      reasoningEffort,
      auditTraceId,
      routeDecision,
      adapterProbe,
      adapterResponse
    });
    const context = buildContext(
      task,
      adapterProbe.runtime,
      reasoningEffort,
      auditTraceId,
      result.toolCalls,
      routeDecision
    );

    if (this.auditLogger !== undefined) {
      await this.auditLogger.logTurn(result);
    }

    for (const hook of this.turnEndHooks) {
      await hook(result, context);
    }

    return result;
  }

  spawn(count: number): Promise<readonly AgentResult[]> {
    return Promise.reject(
      createRuntimeUnsupportedCapabilityError({
        capability: 'spawn',
        runtime: {
          name: 'copilot_sdk'
        },
        reason: 'W9 AgentRuntimeV1 keeps real fanout disabled until BudgetGate and W8 evidence pass.',
        recoveryHint:
          'Run a single gpt-5-mini turn or return a blocked partial result; any fanout enablement requires ADR approval.',
        gate: 'BudgetGate',
        requestedCount: count
      })
    );
  }

  onTurnEnd(hook: TurnEndHook): void {
    this.turnEndHooks.push(hook);
  }

  onToolCall(hook: ToolCallHook): void {
    this.toolCallHooks.push(hook);
  }

  resumeSession(sessionId: string): Promise<AgentResult> {
    return Promise.reject(
      createRuntimeUnsupportedCapabilityError({
        capability: 'resumeSession',
        runtime: {
          name: 'copilot_sdk'
        },
        reason: 'W9 AgentRuntimeV1 has no audited SDK resume adapter contract yet.',
        recoveryHint:
          'Start a new gpt-5-mini turn with explicit evidence context; resume semantics must be added through ADR.',
        gate: 'AgentRuntimeV1',
        sessionId
      })
    );
  }
}
