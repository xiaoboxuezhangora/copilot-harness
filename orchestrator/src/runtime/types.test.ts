import { describe, expect, it } from 'vitest';

import { DEFAULT_MODEL, DEFAULT_RUN_OPTIONS } from './types.js';
import type { AgentResult, AgentTask, EvidencePack, ToolCallDecision } from './types.js';

describe('runtime contract', () => {
  it('keeps W2-A model and reasoning defaults explicit', () => {
    expect(DEFAULT_MODEL).toBe('gpt-5-mini');
    expect(DEFAULT_RUN_OPTIONS.reasoningEffort).toBe('medium');
  });

  it('represents the minimal EvidencePack shape', () => {
    const pack: EvidencePack = {
      taskId: 'task-1',
      intent: 'define runtime contract',
      evidences: [
        {
          source_ref: 'W2-A',
          content: 'Contract-only stage',
          tool: 'repo'
        }
      ],
      assumptions: [
        {
          statement: 'No live Jira or Copilot SDK calls in W2-A',
          confidence: 0.9
        }
      ],
      confidence: 0.8
    };

    expect(pack.evidences[0]?.source_ref).toBe('W2-A');
    expect(pack.assumptions).toHaveLength(1);
  });

  it('requires AgentResult audit, runtime, model, reasoning, and capability fields', () => {
    const task: AgentTask = {
      taskId: 'task-2',
      prompt: 'hello',
      intent: 'contract test',
      turnState: 'continue_current',
      budgetLimit: {
        maxFanout: 1
      },
      promptVersion: 'jira-analysis-prompt@0.1'
    };
    const decision: ToolCallDecision = 'allow';
    const result: AgentResult = {
      taskId: task.taskId,
      turnState: 'done',
      output: 'ok',
      evidencePack: {
        taskId: task.taskId,
        intent: task.intent,
        evidences: [],
        assumptions: [],
        confidence: 1
      },
      auditTraceId: 'trace-1',
      model: 'gpt-5-mini',
      runtime: {
        name: 'contract_stub'
      },
      reasoningEffort: 'medium',
      promptVersion: 'jira-analysis-prompt@0.1',
      policyDecision: 'allow',
      budgetUsage: {
        fanout: 1,
        toolCalls: 0,
        inputTokens: 0,
        outputTokens: 0,
        premiumRequests: 0
      },
      capabilities: {
        canSpawn: false,
        canUseTools: false,
        canResume: false,
        canReadMemory: false,
        canWriteMemory: false,
        canUseMcp: false,
        supportsSessions: false,
        supportsHooks: false,
        supportsReasoningEffort: true,
        supportsHeadless: false,
        externalExecution: false,
        capabilitySupported: false,
        unsupportedReasons: ['contract test']
      },
      toolCalls: [
        {
          toolName: 'noop',
          decision,
          timestampIso: '2026-04-27T00:00:00.000Z'
        }
      ]
    };

    expect(result.auditTraceId).toBe('trace-1');
    expect(result.capabilities.canUseMcp).toBe(false);
  });
});
