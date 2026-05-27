import { describe, expect, it } from 'vitest';

import { toAuditTurnRecord, toAuditTurnRecordV1 } from './index.js';
import type { AgentResult } from '../runtime/index.js';

describe('audit logger', () => {
  it('writes budget, policy, and prompt version fields when present', () => {
    const record = toAuditTurnRecord(sampleResult());

    expect(record.policyDecision).toBe('allow');
    expect(record.promptVersion).toBe('jira-analysis-prompt@0.1');
    expect(record.fleetSessionId).toBe('fleet-task-1');
    expect(record.parentTaskId).toBe('parent-task-1');
    expect(record.agentRole).toBe('implementer');
    expect(record.candidateId).toBe('candidate-1');
    expect(record.worktreeMode).toBe('mock');
    expect(record.budgetUsage).toEqual({
      fanout: 1,
      fleetFanout: 3,
      toolCalls: 2,
      inputTokens: 10,
      outputTokens: 20,
      premiumRequests: 0
    });
  });

  it('maps audit record fields to snake_case export schema', () => {
    const record = toAuditTurnRecord(sampleResult());
    const exported = toAuditTurnRecordV1(record);

    expect(exported.task_id).toBe('task-1');
    expect(exported.fleet_session_id).toBe('fleet-task-1');
    expect(exported.parent_task_id).toBe('parent-task-1');
    expect(exported.agent_role).toBe('implementer');
    expect(exported.candidate_id).toBe('candidate-1');
    expect(exported.worktree_mode).toBe('mock');
    expect(exported.turn_state).toBe('done');
    expect(exported.trace_id).toBe('trace-1');
    expect(exported.prompt_version).toBe('jira-analysis-prompt@0.1');
  });

  it('redacts secret and PII fields from audit export schema', () => {
    const credentialPreview = [
      'alice@example.com',
      ['Authorization', 'Bearer', 'top-secret-token'].join(' '),
      `${['patient', 'id'].join('_')}: P12345`
    ].join(' ');
    const record = toAuditTurnRecord({
      ...sampleResult(),
      toolCalls: [
        {
          toolName: 'getIssue',
          decision: 'allow',
          timestampIso: '2026-05-15T00:00:00.000Z',
          argsPreview: credentialPreview
        }
      ]
    });
    const exported = toAuditTurnRecordV1(record);
    const serialized = JSON.stringify(exported);

    expect(serialized).not.toContain('alice@example.com');
    expect(serialized).not.toContain('top-secret-token');
    expect(serialized).not.toContain('P12345');
    expect(serialized).toContain('[redacted-email]');
    expect(serialized).toContain('[redacted-credential]');
  });

  it('adds harness routing, Jira, and model audit attributes', () => {
    const record = toAuditTurnRecord({
      ...sampleResult(),
      model: 'gpt-4.1',
      routeDecision: {
        providerId: 'copilot',
        model: 'gpt-4.1',
        runtime: 'copilot_sdk',
        matchedRuleId: 'jira_ops_frontend_review',
        routeReason: '高优先级前端复核使用更强 Copilot 模型',
        routeSource: 'jira_model_routes',
        fallbackChain: [
          {
            providerId: 'copilot',
            model: 'gpt-5-mini',
            runtime: 'copilot_sdk'
          }
        ],
        estimatedCostCny: 0,
        snapshotVersion: 'local-test',
        auditAttrs: {
          'harness.jira.project_key': 'OPS',
          'harness.jira.issue_type': 'Bug'
        }
      }
    });

    expect(record.otelAttributes).toMatchObject({
      'gen_ai.request.model': 'gpt-4.1',
      'harness.routing.rule_id': 'jira_ops_frontend_review',
      'harness.routing.source': 'jira_model_routes',
      'harness.routing.reason': '高优先级前端复核使用更强 Copilot 模型',
      'harness.model.id': 'copilot/gpt-4.1',
      'harness.model.is_default': false,
      'harness.provider.id': 'copilot',
      'harness.runtime.adapter': 'contract_stub',
      'harness.budget.cost_cny': 0,
      'harness.config.snapshot_version': 'local-test',
      'harness.jira.project_key': 'OPS',
      'harness.jira.issue_type': 'Bug'
    });
  });
});

function sampleResult(): AgentResult {
  return {
    taskId: 'task-1',
    fleetSessionId: 'fleet-task-1',
    parentTaskId: 'parent-task-1',
    agentRole: 'implementer',
    candidateId: 'candidate-1',
    worktreeMode: 'mock',
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
      fleetFanout: 3,
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
