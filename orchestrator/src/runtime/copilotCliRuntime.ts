import { AuditLogger } from '../audit/index.js';
import type { AgentResult, AgentRuntime, AgentTask, ToolCallHook, TurnEndHook } from './types.js';
import { createRuntimeUnsupportedCapabilityError } from './types.js';
import { CopilotCliAdapter } from './adapters/copilotCliAdapter.js';
import type { RuntimeAdapter } from './adapters/types.js';
import {
  buildContext,
  buildResult,
  createTraceId,
  resolveReasoningEffort
} from './adapters/shared.js';

export interface CopilotCliRuntimeOptions {
  readonly adapter?: RuntimeAdapter;
  readonly auditLogger?: AuditLogger;
}

export class CopilotCliRuntime implements AgentRuntime {
  private readonly turnEndHooks: TurnEndHook[] = [];
  private readonly toolCallHooks: ToolCallHook[] = [];
  private readonly adapter: RuntimeAdapter;
  private readonly auditLogger: AuditLogger | undefined;

  constructor(options: CopilotCliRuntimeOptions = {}) {
    this.adapter = options.adapter ?? new CopilotCliAdapter();
    this.auditLogger = options.auditLogger;
  }

  async run(task: AgentTask): Promise<AgentResult> {
    const reasoningEffort = resolveReasoningEffort(task);
    const adapterProbe = await this.adapter.probe();
    const adapterResponse = await this.adapter.execute({
      taskId: task.taskId,
      prompt: task.prompt,
      model: 'gpt-5-mini',
      reasoningEffort,
      ...(task.budgetLimit.timeoutMs !== undefined ? { timeoutMs: task.budgetLimit.timeoutMs } : {})
    });
    const auditTraceId = createTraceId(task.taskId, 'copilot-cli');
    const result = buildResult({
      task,
      runtime: adapterProbe.runtime,
      reasoningEffort,
      auditTraceId,
      adapterProbe,
      adapterResponse
    });
    const context = buildContext(
      task,
      adapterProbe.runtime,
      reasoningEffort,
      auditTraceId,
      result.toolCalls
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
          name: 'copilot_cli'
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
          name: 'copilot_cli'
        },
        reason: 'W9 AgentRuntimeV1 has no audited CLI resume adapter contract yet.',
        recoveryHint:
          'Start a new gpt-5-mini turn with explicit evidence context; resume semantics must be added through ADR.',
        gate: 'AgentRuntimeV1',
        sessionId
      })
    );
  }
}
