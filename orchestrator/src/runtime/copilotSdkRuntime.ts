import { AuditLogger } from '../audit/index.js';
import type { AgentResult, AgentRuntime, AgentTask, ToolCallHook, TurnEndHook } from './types.js';
import { CopilotSdkAdapter } from './adapters/copilotSdkAdapter.js';
import type { RuntimeAdapter } from './adapters/types.js';
import {
  buildContext,
  buildResult,
  createTraceId,
  resolveReasoningEffort
} from './adapters/shared.js';

export interface CopilotSdkRuntimeOptions {
  readonly adapter?: RuntimeAdapter;
  readonly auditLogger?: AuditLogger;
}

export class CopilotSdkRuntime implements AgentRuntime {
  private readonly turnEndHooks: TurnEndHook[] = [];
  private readonly toolCallHooks: ToolCallHook[] = [];
  private readonly adapter: RuntimeAdapter;
  private readonly auditLogger: AuditLogger | undefined;

  constructor(options: CopilotSdkRuntimeOptions = {}) {
    this.adapter = options.adapter ?? new CopilotSdkAdapter();
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
    const auditTraceId = createTraceId(task.taskId, 'copilot-sdk');
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

  spawn(_count: number): Promise<readonly AgentResult[]> {
    throw new Error('CopilotSdkRuntime.spawn is gated by BudgetGate and not implemented in W2.');
  }

  onTurnEnd(hook: TurnEndHook): void {
    this.turnEndHooks.push(hook);
  }

  onToolCall(hook: ToolCallHook): void {
    this.toolCallHooks.push(hook);
  }

  resumeSession(_sessionId: string): Promise<AgentResult> {
    throw new Error('CopilotSdkRuntime.resumeSession is not implemented in W2.');
  }
}
