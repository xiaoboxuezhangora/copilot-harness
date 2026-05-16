import { describe, expect, it } from 'vitest';

import {
  buildMissingInfoQuestions,
  buildResolverPacketV1,
  classifyResolverRisk,
  locateRepoHints,
  validateResolverPacketV1,
  type ResolverInput
} from './index.js';

const BASE_INPUT: ResolverInput = {
  jira: {
    issueKey: 'OPS-101',
    summary: 'Add approval reminder',
    description: 'Need a reminder when approval is pending. Verify pending age threshold.',
    labels: ['workflow', 'notification'],
    sourceRef: 'jira:OPS-101'
  },
  evidenceRefs: ['gitlab:ops/app#file:src/modules/approval/reminder.service.ts@abc123#L12-L28'],
  historicalRepoHints: [
    {
      project: 'ops/app',
      module: 'src/modules/approval',
      confidence: 0.88,
      sourceRefs: ['gitlab:ops/app#file:src/modules/approval/reminder.service.ts@abc123#L12-L28']
    }
  ]
};

describe('resolver_packet v1', () => {
  it('builds a schema-valid shadow-ready packet from existing evidence refs', () => {
    const packet = buildResolverPacketV1(BASE_INPUT);

    expect(packet.next_action).toBe('shadow_ready');
    expect(packet.repo_hints[0]).toMatchObject({
      project: 'ops/app',
      module: 'src/modules/approval',
      locator: 'historical_evidence'
    });
    expect(
      validateResolverPacketV1(packet, {
        allowedSourceRefs: [
          'jira:OPS-101',
          'gitlab:ops/app#file:src/modules/approval/reminder.service.ts@abc123#L12-L28'
        ]
      })
    ).toEqual([]);
  });

  it('returns need_more_context and retrieval hints without repository evidence', () => {
    const packet = buildResolverPacketV1({
      jira: {
        issueKey: 'OPS-102',
        summary: 'Fix broken page',
        description: 'User reports a broken page.',
        labels: ['bug'],
        sourceRef: 'jira:OPS-102'
      },
      evidenceRefs: []
    });

    expect(packet.next_action).toBe('need_more_context');
    expect(packet.repo_hints[0]).toMatchObject({
      project: 'unknown',
      module: 'unknown',
      locator: 'retrieval_hint',
      source_refs: []
    });
    expect(packet.missing_info.every((question) => /[?？]$/u.test(question))).toBe(true);
  });

  it('forces high-risk domains to await_human', () => {
    const packet = buildResolverPacketV1({
      ...BASE_INPUT,
      jira: {
        ...BASE_INPUT.jira,
        summary: '输血平台 token rotation strategy high risk',
        description: '涉及输血闭环凭证 token rotation，需人工审批。',
        labels: ['blood-transfusion']
      }
    });

    expect(packet.risk_level).toBe('L3');
    expect(packet.next_action).toBe('await_human');
  });

  it('prioritizes historical repo hints over parsed source_ref fallback', () => {
    const hints = locateRepoHints(BASE_INPUT);

    expect(hints[0]?.locator).toBe('historical_evidence');
    expect(hints[0]?.module).toBe('src/modules/approval');
  });

  it('does not allow fabricated source refs in validation', () => {
    const packet = buildResolverPacketV1(BASE_INPUT);
    const issues = validateResolverPacketV1(
      {
        ...packet,
        source_refs: [...packet.source_refs, 'gitlab:fake/project#file:fake.ts@deadbeef#L1-L2']
      },
      {
        allowedSourceRefs: packet.source_refs
      }
    );

    expect(
      issues.some((issue) => issue.message.includes('source_ref must come from resolver input'))
    ).toBe(true);
  });

  it('questioner returns questions only', () => {
    const questions = buildMissingInfoQuestions({
      jira: {
        issueKey: 'OPS-103',
        summary: '',
        description: '',
        labels: [],
        sourceRef: 'jira:OPS-103'
      },
      evidenceRefs: []
    });

    expect(questions.length).toBeGreaterThan(0);
    expect(questions.every((question) => /[?？]$/u.test(question))).toBe(true);
  });

  it('classifies controlled surfaces below L3 unless high-risk terms are present', () => {
    const risk = classifyResolverRisk({
      ...BASE_INPUT,
      jira: {
        ...BASE_INPUT.jira,
        summary: 'Update scheduler integration retry policy',
        description: 'Touches cron scheduler and external integration retry behavior.'
      }
    });

    expect(risk.riskLevel).toBe('L2');
    expect(risk.highRiskDomain).toBe(false);
  });
});
