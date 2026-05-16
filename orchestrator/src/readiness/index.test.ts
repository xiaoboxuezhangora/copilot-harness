import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildReadinessPack, validateReadinessPack } from './index.js';
import { runW18ReadinessPack } from './replay.js';

describe('W18 go-live readiness pack', () => {
  it('keeps go-live at NO-GO while RB-1 and RB-2 are open', () => {
    const pack = buildReadinessPack('2026-05-16T00:00:00.000Z');

    expect(pack.decision).toBe('NO-GO');
    expect(pack.engineering_closure_status).toBe('complete');
    expect(pack.release_status).toBe('blocked_by_rb_1_rb_2');
    expect(pack.rb_1_status).toBe('open');
    expect(pack.rb_2_status).toBe('open');
    expect(pack.blockers).toEqual(['RB-1', 'RB-2']);
    expect(pack.go_no_go_template.management_review_status).toBe('pending_rb_closure');
    expect(pack.freeze_policy).toEqual({
      real_cutover_executed: false,
      single_write_enabled: false,
      git_push: false,
      merge_request_api: false,
      jira_write: false,
      auto_merge: false
    });
    expect(validateReadinessPack(pack)).toEqual([]);
  });

  it('defines quantified closure gates for runner and dual-write blockers', () => {
    const pack = buildReadinessPack('2026-05-16T00:00:00.000Z');
    const rb1 = pack.runbooks.find((runbook) => runbook.blocker_id === 'RB-1');
    const rb2 = pack.runbooks.find((runbook) => runbook.blocker_id === 'RB-2');

    expect(rb1?.estimated_total_minutes).toBe(110);
    expect(rb1?.closure_gates.map((gate) => gate.id)).toContain('live_pipeline_success_count');
    expect(rb1?.closure_gates.map((gate) => gate.id)).toContain('manual_retry_count');
    expect(rb2?.estimated_total_minutes).toBe(120);
    expect(rb2?.closure_gates.map((gate) => gate.id)).toContain('dual_write_window_hours');
    expect(rb2?.closure_gates.map((gate) => gate.id)).toContain('consecutive_zero_drift_days');
    expect(
      pack.runbooks.every((runbook) =>
        runbook.closure_gates.every((gate) => Number.isFinite(gate.target))
      )
    ).toBe(true);
  });

  it('archives readiness docs, tabletop record, and task state without enabling writes', async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), 'w18-readiness-'));
    const reportsDir = join(outputRoot, 'reports');
    const stateDir = join(outputRoot, 'state');

    const result = await runW18ReadinessPack({
      repoRoot: resolveRepoRootForTest(),
      reportsDir,
      stateDir,
      generatedAt: '2026-05-16T00:00:00.000Z'
    });

    expect(result.validationIssues).toEqual([]);
    expect(result.pack.tabletop.issues.length).toBeGreaterThanOrEqual(4);
    expect(result.pack.cutover_checklist.sections.map((section) => section.id)).toEqual([
      'pre_checks',
      'cutover_steps',
      'rollback',
      'oncall_comms'
    ]);

    const report = await readFile(result.artifactPaths.readiness_report_md, 'utf8');
    const goNoGo = await readFile(result.artifactPaths.go_no_go_template_md, 'utf8');
    const audit = await readFile(result.artifactPaths.audit_jsonl, 'utf8');

    expect(report).toContain('decision: NO-GO');
    expect(report).toContain('engineering_closure_status: complete');
    expect(report).toContain('release_status: blocked_by_rb_1_rb_2');
    expect(goNoGo).toContain('No real write can be enabled while decision=NO-GO.');
    expect(audit).toContain('"event_name":"readiness.decision"');
    expect(audit).toContain('"real_cutover_executed":false');
  });
});

function resolveRepoRootForTest(): string {
  return basename(process.cwd()) === 'orchestrator' ? resolve(process.cwd(), '..') : process.cwd();
}
