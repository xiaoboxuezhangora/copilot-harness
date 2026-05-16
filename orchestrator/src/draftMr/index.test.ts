import { describe, expect, it } from 'vitest';

import type { ResolverPacketV1 } from '../resolver/index.js';
import {
  composeDraftMrBundle,
  guardExternalWriteAttempt,
  resolveBranchKind,
  validateDraftMrPacketV1,
  type ExternalWriteOperation
} from './index.js';

const BASE_RESOLVER_PACKET: ResolverPacketV1 = {
  schema_version: 'resolver_packet.v1',
  intent: {
    issue_key: 'OPS-101',
    summary: 'Add approval reminder',
    kind: 'feature',
    source_refs: ['jira:OPS-101']
  },
  constraints: ['shadow_only', 'branch_kind=fix'],
  repo_hints: [
    {
      project: 'ops/app',
      module: 'src/modules/approval',
      confidence: 0.86,
      locator: 'historical_evidence',
      source_refs: ['gitlab:ops/app#file:src/modules/approval/reminder.service.ts@abc123#L1-L20'],
      retrieval_query: null
    }
  ],
  risk_level: 'L1',
  missing_info: [],
  next_action: 'shadow_ready',
  source_refs: [
    'jira:OPS-101',
    'gitlab:ops/app#file:src/modules/approval/reminder.service.ts@abc123#L1-L20'
  ]
};

describe('draft MR composer shadow', () => {
  it('generates a schema-valid draft MR packet from a resolver packet', () => {
    const bundle = composeDraftMrBundle(BASE_RESOLVER_PACKET, {
      traceRef: 'w15:test:OPS-101',
      patchPath: '/tmp/OPS-101.patch',
      reviewChecklistPath: '/tmp/OPS-101.md'
    });

    expect(bundle.packet.branch_name).toMatch(/^fix\/ops-101-/u);
    expect(bundle.packet.pr_body).toContain('Source refs');
    expect(bundle.packet.pr_body).toContain('Risk level: L1');
    expect(bundle.packet.pr_body).toContain(BASE_RESOLVER_PACKET.source_refs[1]);
    expect(bundle.packet.diff_bundle.files_changed).toContain(
      'src/modules/approval/reminder.service.ts'
    );
    expect(bundle.packet.write_guard.git_push).toBe('blocked');
    expect(bundle.patchText).toContain('diff --git');
    expect(bundle.reviewChecklistText).toContain('Confirm no Git push');
    expect(validateDraftMrPacketV1(bundle.packet)).toEqual([]);
  });

  it('honors branch naming constraints from the work item packet', () => {
    expect(resolveBranchKind(BASE_RESOLVER_PACKET)).toBe('fix');
    expect(
      resolveBranchKind({
        ...BASE_RESOLVER_PACKET,
        constraints: ['type:docs']
      })
    ).toBe('docs');
  });

  it('marks uncertainty when repository evidence is missing', () => {
    const bundle = composeDraftMrBundle(
      {
        ...BASE_RESOLVER_PACKET,
        repo_hints: [
          {
            project: 'unknown',
            module: 'unknown',
            confidence: 0.2,
            locator: 'retrieval_hint',
            source_refs: [],
            retrieval_query: 'approval reminder'
          }
        ],
        risk_level: 'L0',
        missing_info: ['请提供可验证的 gitlab: 或 local: source_ref 是什么？'],
        next_action: 'need_more_context',
        source_refs: ['jira:OPS-102']
      },
      {
        traceRef: 'w15:test:OPS-102',
        patchPath: '/tmp/OPS-102.patch',
        reviewChecklistPath: '/tmp/OPS-102.md'
      }
    );

    expect(bundle.packet.diff_bundle.uncertainty).toContain(
      'No gitlab: or local: repository source_ref is attached.'
    );
    expect(bundle.packet.pr_body).toContain('No gitlab: or local: repository source_ref');
    expect(bundle.packet.commit_plan.strategy).toBe('await_human_before_commit');
  });

  it('blocks every external write operation', () => {
    const operations: readonly ExternalWriteOperation[] = [
      'git_push',
      'merge_request_create',
      'merge_request_update',
      'merge_request_merge',
      'jira_write'
    ];

    const results = operations.map((operation) =>
      guardExternalWriteAttempt({
        operation,
        traceRef: 'w15:test:guard',
        sourceRefs: BASE_RESOLVER_PACKET.source_refs
      })
    );

    expect(results.every((result) => result.allowed === false && result.status === 'blocked')).toBe(
      true
    );
    expect(results.every((result) => result.warning.includes('external writes'))).toBe(true);
  });

  it('requires source refs and risk level in PR body validation', () => {
    const bundle = composeDraftMrBundle(BASE_RESOLVER_PACKET, {
      traceRef: 'w15:test:invalid',
      patchPath: '/tmp/invalid.patch',
      reviewChecklistPath: '/tmp/invalid.md'
    });

    const issues = validateDraftMrPacketV1({
      ...bundle.packet,
      pr_body: 'missing required sections'
    });

    expect(issues.some((issue) => issue.field === 'pr_body')).toBe(true);
  });
});
