import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { constants } from 'node:fs';
import { spawn } from 'node:child_process';

import {
  DEFAULT_MODEL,
  DEFAULT_MODEL_REF,
  DEFAULT_RUN_OPTIONS,
  type AgentCapabilityFlags,
  type AgentResult,
  type AgentTask,
  ModelRoutingGateError,
  type ReasoningEffort,
  type RuntimeAdapterName,
  type RuntimeIdentity,
  type RuntimeModelRoutingGate,
  type RuntimeModelRouteDecision,
  type ToolCallRecord,
  type TurnContext
} from '../types.js';
import type { RuntimeAdapterProbe, RuntimeAdapterResponse } from './types.js';

export const BASE_UNSUPPORTED_CAPABILITIES: AgentCapabilityFlags = {
  canSpawn: false,
  canUseTools: false,
  canResume: false,
  canReadMemory: false,
  canWriteMemory: false,
  canUseMcp: false,
  supportsSessions: false,
  supportsHooks: false,
  supportsReasoningEffort: false,
  supportsHeadless: false,
  externalExecution: false,
  capabilitySupported: false,
  unsupportedReasons: []
};

export interface CommandResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export function resolveReasoningEffort(task: AgentTask): ReasoningEffort {
  return task.runOptions?.reasoningEffort ?? DEFAULT_RUN_OPTIONS.reasoningEffort;
}

export function isDefaultModelRef(modelRef: {
  readonly providerId: string;
  readonly model: string;
}): boolean {
  return modelRef.providerId === DEFAULT_MODEL_REF.providerId && modelRef.model === DEFAULT_MODEL;
}

export function resolveModelRouteDecision(
  task: AgentTask,
  runtimeName: RuntimeAdapterName,
  modelRoutingGate?: RuntimeModelRoutingGate
): RuntimeModelRouteDecision {
  const decision = task.routeDecision ?? routeDecisionFromRunOptions(task, runtimeName);
  assertModelRouteDecisionAllowed(decision);
  if (modelRoutingGate !== undefined) {
    return modelRoutingGate.validate({
      decision,
      runtimeName
    });
  }
  assertDefaultOnlyWithoutModelCatalog(decision);
  return decision;
}

export function assertModelRouteDecisionAllowed(decision: RuntimeModelRouteDecision): void {
  if (!isDefaultModelRef(decision)) {
    if (decision.matchedRuleId === undefined || decision.matchedRuleId.trim().length === 0) {
      throw new ModelRoutingGateError({
        schema_version: 'model-routing-gate-error@1',
        policy_decision: 'deny',
        gate: 'ModelRoutingGate',
        provider_id: decision.providerId,
        model: decision.model,
        reason: 'non-default model route is missing matchedRuleId'
      });
    }
    if (decision.routeReason === undefined || decision.routeReason.trim().length === 0) {
      throw new ModelRoutingGateError({
        schema_version: 'model-routing-gate-error@1',
        policy_decision: 'deny',
        gate: 'ModelRoutingGate',
        provider_id: decision.providerId,
        model: decision.model,
        reason: 'non-default model route is missing routeReason'
      });
    }
  }
}

function assertDefaultOnlyWithoutModelCatalog(decision: RuntimeModelRouteDecision): void {
  if (isDefaultModelRef(decision)) return;
  throw new ModelRoutingGateError({
    schema_version: 'model-routing-gate-error@1',
    policy_decision: 'deny',
    gate: 'ModelRoutingGate',
    provider_id: decision.providerId,
    model: decision.model,
    reason: 'non-default model requires a configured ModelRoutingGate'
  });
}

function routeDecisionFromRunOptions(
  task: AgentTask,
  runtimeName: RuntimeAdapterName
): RuntimeModelRouteDecision {
  const optionModelRef = task.runOptions?.modelRef;
  if (optionModelRef !== undefined) {
    return {
      ...optionModelRef,
      routeSource: 'run_options'
    };
  }

  if (task.runOptions?.model !== undefined) {
    return {
      providerId: DEFAULT_MODEL_REF.providerId,
      model: task.runOptions.model,
      runtime: runtimeName,
      routeSource: 'run_options'
    };
  }

  return {
    providerId: DEFAULT_MODEL_REF.providerId,
    model: DEFAULT_MODEL,
    runtime: runtimeName,
    matchedRuleId: 'defaults.default_route',
    routeReason: 'DEFAULT_MODEL fallback',
    routeSource: 'default_route',
    fallbackChain: []
  };
}

export function createTraceId(taskId: string, runtimeName: string): string {
  return `${runtimeName}-${taskId}-${Date.now().toString(36)}`;
}

export function buildContext(
  task: AgentTask,
  runtime: RuntimeIdentity,
  reasoningEffort: ReasoningEffort,
  auditTraceId: string,
  toolCalls: readonly ToolCallRecord[],
  routeDecision: RuntimeModelRouteDecision
): TurnContext {
  return {
    taskId: task.taskId,
    model: routeDecision.model,
    runtime,
    runOptions: {
      reasoningEffort,
      ...(task.runOptions?.verbosity !== undefined ? { verbosity: task.runOptions.verbosity } : {})
    },
    turnState: task.turnState,
    auditTraceId,
    toolCalls
  };
}

export function buildResult(input: {
  readonly task: AgentTask;
  readonly runtime: RuntimeIdentity;
  readonly reasoningEffort: ReasoningEffort;
  readonly auditTraceId: string;
  readonly routeDecision: RuntimeModelRouteDecision;
  readonly adapterProbe: RuntimeAdapterProbe;
  readonly adapterResponse: RuntimeAdapterResponse;
}): AgentResult {
  const tokenUsage = {
    inputTokens: input.adapterResponse.inputTokens ?? estimateTokens(input.task.prompt),
    outputTokens: input.adapterResponse.outputTokens ?? estimateTokens(input.adapterResponse.output)
  };

  return {
    taskId: input.task.taskId,
    turnState: 'done',
    output: input.adapterResponse.output,
    evidencePack: {
      taskId: input.task.taskId,
      intent: input.task.intent,
      evidences: [
        {
          source_ref: input.runtime.name,
          content: input.adapterResponse.output,
          tool: 'runtime-adapter'
        }
      ],
      assumptions: input.adapterResponse.capabilityNotes.map((note) => ({
        statement: note,
        confidence: 0.3
      })),
      confidence: input.adapterProbe.capabilities.capabilitySupported ? 0.8 : 0.6
    },
    auditTraceId: input.auditTraceId,
    model: input.routeDecision.model,
    runtime: input.runtime,
    routeDecision: input.routeDecision,
    reasoningEffort: input.reasoningEffort,
    promptVersion: input.task.promptVersion,
    policyDecision: aggregatePolicyDecision(input.adapterResponse.toolCalls),
    budgetUsage: {
      fanout: 1,
      toolCalls: input.adapterResponse.toolCalls.length,
      inputTokens: tokenUsage.inputTokens,
      outputTokens: tokenUsage.outputTokens,
      premiumRequests: 0
    },
    capabilities: input.adapterProbe.capabilities,
    toolCalls: input.adapterResponse.toolCalls,
    tokenUsage
  };
}

function aggregatePolicyDecision(
  toolCalls: readonly ToolCallRecord[]
): 'allow' | 'deny' | 'escalate' {
  if (toolCalls.some((toolCall) => toolCall.decision === 'escalate')) return 'escalate';
  if (toolCalls.some((toolCall) => toolCall.decision === 'deny')) return 'deny';
  return 'allow';
}

export function mergeUnsupportedReasons(
  base: readonly string[],
  extra: readonly string[]
): readonly string[] {
  return [...new Set([...base, ...extra])];
}

export async function pathExists(pathname: string): Promise<boolean> {
  try {
    await access(pathname, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function withTemporaryHome<T>(operation: (home: string) => Promise<T>): Promise<T> {
  const home = await mkdtemp(join(tmpdir(), 'copilot-harness-'));

  try {
    await writeFile(join(home, '.keep'), '');
    return await operation(home);
  } finally {
    await rm(home, {
      force: true,
      recursive: true
    });
  }
}

export function runCommand(
  command: string,
  args: readonly string[],
  options: {
    readonly cwd?: string;
    readonly env?: Readonly<Record<string, string | undefined>>;
    readonly timeoutMs: number;
  }
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: {
        ...process.env,
        ...options.env
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
    }, options.timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (exitCode) => {
      clearTimeout(timeout);
      resolve({
        exitCode,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8')
      });
    });
  });
}

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}
