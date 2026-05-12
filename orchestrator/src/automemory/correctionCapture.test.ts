import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runCorrectionCapture } from './correctionCapture.js';

describe('W11 correction capture', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'w11-correction-capture-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('writes redacted correction pending markdown from GitLab discussion fixtures', async () => {
    const fixturePath = join(tempDir, 'discussions.json');
    await writeFile(
      fixturePath,
      JSON.stringify(
        {
          discussions: [
            {
              id: 'discussion-1',
              notes: [
                {
                  id: 10,
                  body: [
                    'Please remove the plaintext token and keep the policy check deterministic.',
                    '',
                    '```suggestion',
                    'const header = "Authorization: Bearer glpat-12345678901234567890";',
                    '```'
                  ].join('\n'),
                  system: false,
                  resolvable: true,
                  author: {
                    name: 'Alice Reviewer',
                    username: 'alice.reviewer'
                  },
                  position: {
                    new_path: 'orchestrator/src/ci/policyCheck.ts',
                    new_line: 42
                  },
                  suggestions: [
                    {
                      from_content: 'const header = "old";',
                      to_content:
                        'const header = "Authorization: Bearer glpat-12345678901234567890";'
                    }
                  ]
                }
              ]
            }
          ]
        },
        null,
        2
      ),
      'utf8'
    );

    const report = await runCorrectionCapture({
      repoRoot: tempDir,
      fixturePath,
      outputDir: '.memory/pending',
      reportPath: 'reports/correction.json',
      auditLogPath: 'reports/audit.log',
      projectId: 'group/project',
      mrIid: '17',
      now: () => new Date('2026-05-12T01:02:03.000Z')
    });

    expect(report.status).toBe('captured');
    expect(report.pending_written_count).toBe(1);
    expect(report.skipped_redline_count).toBe(0);

    const pendingFiles = await readdir(join(tempDir, '.memory', 'pending'));
    expect(pendingFiles[0]).toBe('correction-17-20260512T010203Z.md');
    const pendingContent = await readFile(
      join(tempDir, '.memory', 'pending', pendingFiles[0]!),
      'utf8'
    );

    expect(pendingContent).toContain('"before_diff"');
    expect(pendingContent).toContain('"after_diff"');
    expect(pendingContent).toContain('"reviewer_reason"');
    expect(pendingContent).toContain('"skill_hint"');
    expect(pendingContent).toContain('"source_ref"');
    expect(pendingContent).toContain('"redaction_status": "redacted"');
    expect(pendingContent).toContain('[REDACTED:authorization_bearer]');
    expect(pendingContent).not.toContain('glpat-12345678901234567890');
    expect(pendingContent).not.toContain('alice.reviewer');
    expect(pendingContent).not.toContain('Alice Reviewer');
  });

  it('falls back deterministically when MR environment is absent', async () => {
    const report = await runCorrectionCapture({
      repoRoot: tempDir,
      reportPath: 'reports/correction.json',
      auditLogPath: 'reports/audit.log',
      env: {},
      now: () => new Date('2026-05-12T02:00:00.000Z')
    });

    expect(report.status).toBe('skipped_missing_env');
    expect(report.source).toBe('missing_env');
    expect(report.pending_written_count).toBe(0);

    const reportContent = await readFile(join(tempDir, 'reports', 'correction.json'), 'utf8');
    expect(reportContent).toContain('"skipped_missing_env"');

    const auditContent = await readFile(join(tempDir, 'reports', 'audit.log'), 'utf8');
    expect(auditContent).toContain('"automemory.correction_capture"');
  });
});
