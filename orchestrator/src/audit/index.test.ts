import { describe, expect, it } from 'vitest';

import { toAuditTurnRecord } from './index.js';
import type { AgentResult } from '../runtime/index.js';

describe('audit logger', () => {
  it('writes budget, policy, and prompt version fields when present', () => {
    const record = toAuditTurnRecord(sampleResult());

    expect(record.policyDecision).toBe('allow');
    expect(record.promptVersion).toBe('jira-analysis-prompt@0.1');
    expect(record.budgetUsage).toEqual({
      fanout: 1,
      toolCalls: 2,
      inputTokens: 10,
      outputTokens: 20,
      premiumRequests: 0
    });
  });
});

function sampleResult(): AgentResult {
  return {
    taskId: 'task-1',
    turnState: 'done',
    output: 'ok',
    evidencePack: {
      taskId: 'task-1',
      intent: 'test',
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
      toolCalls: 2,
      inputTokens: 10,
      outputTokens: 20,
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
      unsupportedReasons: []
    },
    toolCalls: []
  };
}
