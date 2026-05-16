import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { ResolverPacketV1 } from '../resolver/index.js';
import { PLAYBOOK_DEFINITIONS, evaluatePlaybookRun, validatePlaybookDefinition } from './index.js';
import { runW17PlaybookShadow } from './replay.js';

const BASE_RESOLVER_PACKET: ResolverPacketV1 = {
  schema_version: 'resolver_packet.v1',
  intent: {
    issue_key: 'OPS-201',
    summary: 'Fix regression in approval banner',
    kind: 'bugfix',
    source_refs: ['jira:OPS-201']
  },
  constraints: ['shadow_only', 'no_external_write'],
  repo_hints: [
    {
      project: 'ops/app',
      module: 'src/approval/banner.ts',
      confidence: 0.9,
      locator: 'source_ref',
      source_refs: ['gitlab:ops/app#file:src/approval/banner.ts@abc123#L1-L20'],
      retrieval_query: null
    }
  ],
  risk_level: 'L0',
  missing_info: [],
  next_action: 'shadow_ready',
  source_refs: ['jira:OPS-201', 'gitlab:ops/app#file:src/approval/banner.ts@abc123#L1-L20']
};

describe('W17 playbook productization', () => {
  it('defines three schema-valid playbooks with source_ref and approval gates', () => {
    expect(PLAYBOOK_DEFINITIONS.map((playbook) => playbook.id)).toEqual([
      'bugfix_fastlane',
      'refactor_guarded',
      'regression_recovery'
    ]);

    PLAYBOOK_DEFINITIONS.forEach((playbook) => {
      expect(validatePlaybookDefinition(playbook)).toEqual([]);
      expect(playbook.source_ref_rules.minimum_repo_evidence_refs).toBeGreaterThanOrEqual(1);
      expect(playbook.source_ref_rules.fabrication_guard).toBe('validate_against_resolver_packet');
      expect(playbook.approval_thresholds.L3).toBe('security_review');
      expect(playbook.input_contract.forbidden_actions).toContain('git_push');
    });
  });

  it('classifies successful and missing-evidence playbook runs without external writes', () => {
    const playbook = PLAYBOOK_DEFINITIONS[0];
    expect(playbook).toBeDefined();
    if (playbook === undefined) {
      throw new Error('bugfix playbook missing');
    }

    const success = evaluatePlaybookRun({
      playbook,
      resolverPacket: BASE_RESOLVER_PACKET,
      draftMrPacket: {
        trace_ref: 'w15:test:OPS-201',
        source_refs: BASE_RESOLVER_PACKET.source_refs
      },
      traceRef: 'w17:test:bugfix:OPS-201'
    });

    expect(success.status).toBe('shadow_success');
    expect(success.external_writes).toEqual({
      git_push: false,
      merge_request_created: false,
      jira_write: false
    });

    const missingEvidence = evaluatePlaybookRun({
      playbook,
      resolverPacket: {
        ...BASE_RESOLVER_PACKET,
        source_refs: ['jira:OPS-202'],
        next_action: 'need_more_context',
        missing_info: ['请提供可验证的 gitlab: 或 local: source_ref 是什么？']
      },
      traceRef: 'w17:test:bugfix:OPS-202'
    });

    expect(missingEvidence.status).toBe('blocked_missing_evidence');
    expect(missingEvidence.failure_reason).toBe('missing_source_ref');
  });

  it('generates one-week shadow reports with at least five samples per playbook', async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), 'w17-playbook-'));
    const reportsDir = join(outputRoot, 'reports');
    const stateDir = join(outputRoot, 'state');

    const result = await runW17PlaybookShadow({
      repoRoot: resolveRepoRootForTest(),
      reportsDir,
      stateDir,
      generatedAt: '2026-05-15T00:00:00.000Z'
    });

    expect(result.report.status).toBe('PASS');
    expect(result.report.playbook_count).toBe(3);
    expect(result.report.total_run_count).toBeGreaterThanOrEqual(15);
    expect(result.report.playbooks.every((playbook) => playbook.sample_count >= 5)).toBe(true);
    expect(result.report.metrics.classification_pass_rate).toBe(1);
    expect(result.report.metrics.unsafe_auto_success_count).toBe(0);
    expect(result.reviewQueue.blocked_item_count).toBeGreaterThan(0);
    expect(result.report.external_writes).toEqual({
      git_push: false,
      merge_request_created: false,
      jira_write: false,
      auto_merge: false
    });

    const reportMarkdown = await readFile(result.artifactPaths.weekly_report_md, 'utf8');
    expect(reportMarkdown).toContain('W17 Playbook Shadow Weekly Report');
    expect(reportMarkdown).toContain('Bugfix Fastlane');
    expect(reportMarkdown).toContain('engineering_closure_status: complete');
  });
});

function resolveRepoRootForTest(): string {
  return basename(process.cwd()) === 'orchestrator' ? resolve(process.cwd(), '..') : process.cwd();
}
