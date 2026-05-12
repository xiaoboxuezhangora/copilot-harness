import { constants } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import type { HarvesterCandidate } from './harvester.js';
import {
  assertMemoryPutInputAllowed,
  buildMemoryPutInput,
  loadPendingReviewFiles,
  normalizeCorrectionKey,
  parsePendingMarkdown,
  reviewPendingFile,
  runReviewCli,
  sortPendingReviewFiles,
  type AutomemoryAuditEvent,
  type ConflictCheckAuditEvent,
  type ConflictDecisionAuditEvent,
  type PendingReviewFile,
  type ReviewAuditEvent
} from './reviewCli.js';
import { generateW8ReviewMetrics } from './reviewMetrics.js';
import { SqliteMemoryStore } from '../memory/index.js';

describe('automemory review pending parser', () => {
  it('parses W7 pending accepted candidates without including raw gate-blocked candidates', () => {
    const accepted = [
      candidate('decision', 'attachments_show_metadata_only', 0.9, 0.7),
      candidate('knowledge', 'attachment_metadata_fields', 0.85, 0.6)
    ];
    const raw = [...accepted, candidate('alias', 'attachment_preview_block', 0.6, 0.4)];

    const pending = parsePendingMarkdown(renderPendingMarkdown(accepted, raw), {
      filePath: '/tmp/case-4.md',
      fileMtimeMs: 40
    });

    expect(pending.metadata.taskId).toBe('case-4');
    expect(pending.metadata.auditTraceId).toBe('trace-case-4');
    expect(pending.candidates.map((item) => item.key)).toEqual([
      'attachments_show_metadata_only',
      'attachment_metadata_fields'
    ]);
  });

  it('sorts by confidence desc, novelty desc, then file mtime asc', () => {
    const sorted = sortPendingReviewFiles([
      pendingFile('older-low-novelty.md', candidate('decision', 'a', 0.9, 0.5), 10),
      pendingFile('newer-low-novelty.md', candidate('decision', 'b', 0.9, 0.5), 20),
      pendingFile('high-novelty.md', candidate('decision', 'c', 0.9, 0.7), 30),
      pendingFile('highest-confidence.md', candidate('decision', 'd', 0.95, 0.1), 40)
    ]);

    expect(sorted.map((item) => item.relativePath)).toEqual([
      'highest-confidence.md',
      'high-novelty.md',
      'older-low-novelty.md',
      'newer-low-novelty.md'
    ]);
  });
});

describe('automemory review decisions', () => {
  it('accepts and writes decisions, knowledge_index, and aliases before archiving', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'automemory-review-'));
    const pendingDir = join(tempDir, '.memory', 'pending');
    const archiveDir = join(tempDir, '.memory', 'archive');
    const auditLogPath = join(tempDir, 'reports', 'audit.log');
    const sqlitePath = join(tempDir, 'reports', 'memory.sqlite');
    const pendingPath = join(pendingDir, 'b-harvester', 'accepted.md');
    const store = new SqliteMemoryStore({ sqlitePath });

    try {
      const candidates = [
        candidate('decision', 'standardize-archive-status-label', 0.9, 0.7),
        candidate('knowledge', 'attachment_metadata_fields', 0.85, 0.6),
        candidate('alias', 'archive_status_label', 0.8, 0.5)
      ];
      await writePendingFile(pendingPath, candidates);
      const pending = (await loadPendingReviewFiles(pendingDir))[0]!;

      const result = await reviewPendingFile({
        pending,
        pendingDir,
        archiveDir,
        auditLogPath,
        memoryStore: store,
        decision: 'accept',
        reviewer: 'human-reviewer',
        reviewedAt: new Date('2026-05-08T10:00:00.000Z')
      });

      expect(result.memoryWriteOk).toBe(true);
      expect(result.archivePath).toContain(join('2026-05-08', 'accepted', 'b-harvester'));
      await expect(pathExists(pendingPath)).resolves.toBe(false);
      await expect(pathExists(result.archivePath!)).resolves.toBe(true);

      await expect(
        store.get({
          namespace: 'decisions',
          key: 'standardize-archive-status-label'
        })
      ).resolves.toMatchObject({
        namespace: 'decisions',
        producerAgent: 'investigator'
      });
      await expect(
        store.get({
          namespace: 'knowledge_index',
          key: 'attachment_metadata_fields'
        })
      ).resolves.toMatchObject({
        namespace: 'knowledge_index',
        triggerDescription: 'rationale:attachment_metadata_fields'
      });
      await expect(
        store.get({
          namespace: 'aliases',
          key: 'archive_status_label'
        })
      ).resolves.toMatchObject({
        namespace: 'aliases',
        producerAgent: 'investigator'
      });

      const auditEvents = await readAuditEvents(auditLogPath);
      const reviewEvents = auditEvents.filter(isReviewAuditEvent);
      const conflictChecks = auditEvents.filter(isConflictCheckAuditEvent);
      expect(reviewEvents).toHaveLength(3);
      expect(conflictChecks).toHaveLength(3);
      expect(reviewEvents.every((event) => event.event_name === 'automemory.review_decision')).toBe(
        true
      );
      expect(reviewEvents.map((event) => event.memory_namespace)).toEqual([
        'decisions',
        'knowledge_index',
        'aliases'
      ]);
      expect(reviewEvents.every((event) => event.memory_write_ok)).toBe(true);
      expect(conflictChecks.every((event) => event.decision === 'no_conflict')).toBe(true);
    } finally {
      store.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('rejects alias memory input when manualEntry=true is missing', () => {
    const aliasCandidate = candidate('alias', 'btmis', 0.8, 0.7);
    const putInput = buildMemoryPutInput(aliasCandidate, {
      reviewedAt: new Date('2026-05-08T10:00:00.000Z'),
      aliasManualEntry: false
    });

    expect(() => assertMemoryPutInputAllowed(aliasCandidate, putInput)).toThrow('manualEntry=true');
  });

  it('standardizes correction keys for decisions namespace', () => {
    expect(normalizeCorrectionKey('wrong.assumption')).toBe('correction.wrong.assumption');
    expect(normalizeCorrectionKey('correction.existing')).toBe('correction.existing');
  });

  it('audits reject archive and skip without moving pending', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'automemory-review-audit-'));
    const pendingDir = join(tempDir, '.memory', 'pending');
    const archiveDir = join(tempDir, '.memory', 'archive');
    const auditLogPath = join(tempDir, 'reports', 'audit.log');
    const sqlitePath = join(tempDir, 'reports', 'memory.sqlite');
    const rejectPath = join(pendingDir, 'reject.md');
    const skipPath = join(pendingDir, 'skip.md');
    const store = new SqliteMemoryStore({ sqlitePath });

    try {
      await writePendingFile(rejectPath, [candidate('decision', 'reject-me', 0.9, 0.7)]);
      await writePendingFile(skipPath, [candidate('knowledge', 'skip-me', 0.9, 0.7)]);
      const pendingFiles = await loadPendingReviewFiles(pendingDir);
      const rejectPending = pendingFiles.find((item) => item.relativePath === 'reject.md')!;
      const skipPending = pendingFiles.find((item) => item.relativePath === 'skip.md')!;

      const rejected = await reviewPendingFile({
        pending: rejectPending,
        pendingDir,
        archiveDir,
        auditLogPath,
        memoryStore: store,
        decision: 'reject',
        reviewer: 'human-reviewer',
        reviewedAt: new Date('2026-05-08T11:00:00.000Z')
      });
      const skipped = await reviewPendingFile({
        pending: skipPending,
        pendingDir,
        archiveDir,
        auditLogPath,
        memoryStore: store,
        decision: 'skip',
        reviewer: 'human-reviewer',
        reviewedAt: new Date('2026-05-08T11:01:00.000Z')
      });

      expect(rejected.archivePath).toContain(join('2026-05-08', 'rejected', 'reject.md'));
      expect(skipped.archivePath).toBeNull();
      await expect(pathExists(rejectPath)).resolves.toBe(false);
      await expect(pathExists(skipPath)).resolves.toBe(true);

      const auditEvents = await readAuditEvents(auditLogPath);
      const reviewEvents = auditEvents.filter(isReviewAuditEvent);
      expect(reviewEvents.map((event) => event.decision)).toEqual(['reject', 'skip']);
      expect(reviewEvents[0]?.archive_path).toBe(rejected.archivePath);
      expect(reviewEvents[1]?.archive_path).toBeNull();
      expect(reviewEvents.every((event) => event.memory_write_ok === false)).toBe(true);
    } finally {
      store.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('does not write or archive redline values', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'automemory-review-redline-'));
    const pendingDir = join(tempDir, '.memory', 'pending');
    const archiveDir = join(tempDir, '.memory', 'archive');
    const auditLogPath = join(tempDir, 'reports', 'audit.log');
    const sqlitePath = join(tempDir, 'reports', 'memory.sqlite');
    const pendingPath = join(pendingDir, 'redline.md');
    const store = new SqliteMemoryStore({ sqlitePath });

    try {
      await writePendingFile(pendingPath, [
        {
          ...candidate('knowledge', 'forbidden-secret', 0.95, 0.8),
          value: 'Authorization: Bearer top-secret-token'
        }
      ]);
      const pending = (await loadPendingReviewFiles(pendingDir))[0]!;

      const result = await reviewPendingFile({
        pending,
        pendingDir,
        archiveDir,
        auditLogPath,
        memoryStore: store,
        decision: 'accept',
        reviewer: 'human-reviewer',
        reviewedAt: new Date('2026-05-08T12:00:00.000Z')
      });

      expect(result.memoryWriteOk).toBe(false);
      expect(result.archivePath).toBeNull();
      await expect(pathExists(pendingPath)).resolves.toBe(true);
      await expect(
        store.search({
          query: 'forbidden-secret',
          limit: 10
        })
      ).resolves.toHaveLength(0);

      const auditEvents = await readAuditEvents(auditLogPath);
      const reviewEvents = auditEvents.filter(isReviewAuditEvent);
      expect(reviewEvents).toHaveLength(1);
      expect(reviewEvents[0]?.memory_write_ok).toBe(false);
      expect(reviewEvents[0]?.reason).toBe('redline_violation:authorization_bearer');
    } finally {
      store.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('blocks conflicting accept until compare decision is recorded', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'automemory-review-conflict-block-'));
    const pendingDir = join(tempDir, '.memory', 'pending');
    const archiveDir = join(tempDir, '.memory', 'archive');
    const auditLogPath = join(tempDir, 'reports', 'audit.log');
    const sqlitePath = join(tempDir, 'reports', 'memory.sqlite');
    const pendingPath = join(pendingDir, 'conflict.md');
    const store = new SqliteMemoryStore({ sqlitePath });

    try {
      await store.put({
        namespace: 'decisions',
        key: 'archive.status.existing',
        value: 'Archive status labels must stay consistent across review screens.',
        sourceRef: 'manual://review/2026-05-09/001',
        producerAgent: 'human-reviewer',
        confidence: 0.9
      });
      await writePendingFile(pendingPath, [
        {
          ...candidate('decision', 'archive.status.new', 0.92, 0.8),
          value: 'Archive status labels must stay consistent across review screens.'
        }
      ]);
      const pending = (await loadPendingReviewFiles(pendingDir))[0]!;

      const result = await reviewPendingFile({
        pending,
        pendingDir,
        archiveDir,
        auditLogPath,
        memoryStore: store,
        decision: 'accept',
        reviewer: 'human-reviewer',
        reviewedAt: new Date('2026-05-09T10:00:00.000Z')
      });

      expect(result.memoryWriteOk).toBe(false);
      expect(result.archivePath).toBeNull();
      expect(result.candidateResults[0]?.reason).toBe('memory_conflict_unresolved');
      await expect(pathExists(pendingPath)).resolves.toBe(true);
      await expect(
        store.get({
          namespace: 'decisions',
          key: 'archive.status.new'
        })
      ).resolves.toBeNull();

      const auditEvents = await readAuditEvents(auditLogPath);
      const conflictChecks = auditEvents.filter(isConflictCheckAuditEvent);
      expect(conflictChecks[0]?.conflict_count).toBe(1);
      expect(conflictChecks[0]?.decision).toBe('compare_required');
      expect(conflictChecks[0]?.embedding_backend).toBe('fallback_lexical');
    } finally {
      store.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('records compare add_new decision before writing conflicting memory', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'automemory-review-conflict-add-'));
    const pendingDir = join(tempDir, '.memory', 'pending');
    const archiveDir = join(tempDir, '.memory', 'archive');
    const auditLogPath = join(tempDir, 'reports', 'audit.log');
    const sqlitePath = join(tempDir, 'reports', 'memory.sqlite');
    const pendingPath = join(pendingDir, 'conflict.md');
    const store = new SqliteMemoryStore({ sqlitePath });

    try {
      await store.put({
        namespace: 'decisions',
        key: 'archive.status.existing',
        value: 'Archive status labels must stay consistent across review screens.',
        sourceRef: 'manual://review/2026-05-09/001',
        producerAgent: 'human-reviewer',
        confidence: 0.9
      });
      await writePendingFile(pendingPath, [
        {
          ...candidate('decision', 'archive.status.new', 0.92, 0.8),
          value: 'Archive status labels must stay consistent across review screens.'
        }
      ]);
      const pending = (await loadPendingReviewFiles(pendingDir))[0]!;

      const result = await reviewPendingFile({
        pending,
        pendingDir,
        archiveDir,
        auditLogPath,
        memoryStore: store,
        decision: 'accept',
        reviewer: 'human-reviewer',
        reviewedAt: new Date('2026-05-09T10:05:00.000Z'),
        conflictResolutions: [
          {
            candidateIndex: 0,
            decision: 'add_new',
            reviewerReason: 'Candidate captures a narrower review-screen rule.'
          }
        ]
      });

      expect(result.memoryWriteOk).toBe(true);
      expect(result.archivePath).toContain(join('2026-05-09', 'accepted', 'conflict.md'));
      await expect(pathExists(pendingPath)).resolves.toBe(false);
      await expect(
        store.get({
          namespace: 'decisions',
          key: 'archive.status.new'
        })
      ).resolves.toMatchObject({
        namespace: 'decisions',
        producerAgent: 'investigator'
      });

      const auditEvents = await readAuditEvents(auditLogPath);
      const conflictDecisions = auditEvents.filter(isConflictDecisionAuditEvent);
      expect(conflictDecisions[0]?.decision).toBe('add_new');
      expect(conflictDecisions[0]?.reviewer_reason).toBe(
        'Candidate captures a narrower review-screen rule.'
      );
      expect(conflictDecisions[0]?.memory_write_ok).toBe(true);
    } finally {
      store.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('prints compare output in the interactive conflict flow', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'automemory-review-conflict-cli-'));
    const pendingDir = join(tempDir, '.memory', 'pending');
    const archiveDir = join(tempDir, '.memory', 'archive');
    const sqlitePath = join(tempDir, 'reports', 'memory.sqlite');
    const pendingPath = join(pendingDir, 'conflict.md');
    const store = new SqliteMemoryStore({ sqlitePath });
    const stdin = new PassThrough();
    const answers = ['a\n', 'c\n', 'a\n', 'Candidate captures a narrower rule.\n'];
    const output = new StringWritable((chunk) => {
      if (!chunk.includes('>')) {
        return;
      }

      const answer = answers.shift();
      if (answer === undefined) {
        return;
      }

      setImmediate(() => {
        stdin.write(answer);
        if (answers.length === 0) {
          stdin.end();
        }
      });
    });

    try {
      await store.put({
        namespace: 'decisions',
        key: 'archive.status.existing',
        value: 'Archive status labels must stay consistent across review screens.',
        sourceRef: 'manual://review/2026-05-09/001',
        producerAgent: 'human-reviewer',
        confidence: 0.9
      });
      store.close();
      await writePendingFile(pendingPath, [
        {
          ...candidate('decision', 'archive.status.new', 0.92, 0.8),
          value: 'Archive status labels must stay consistent across review screens.'
        }
      ]);

      const run = runReviewCli(
        [
          '--pending-dir',
          pendingDir,
          '--archive-dir',
          archiveDir,
          '--sqlite-path',
          sqlitePath,
          '--reviewer',
          'human-reviewer'
        ],
        {
          stdin,
          stdout: output,
          stderr: output
        }
      );
      const exitCode = await run;

      expect(exitCode).toBe(0);
      expect(output.value).toContain('[c]ompare');
      expect(output.value).toContain('candidate_source_ref: jira://CASE-204');
      expect(output.value).toContain('existing decisions archive.status.existing');
      expect(output.value).toContain('conflict_decision candidate=1 decision=add_new');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('generates W8 review metrics from review audit events', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'automemory-review-metrics-'));
    const auditLogPath = join(tempDir, 'reports', 'audit.log');
    try {
      await mkdir(dirname(auditLogPath), { recursive: true });
      await writeFile(
        auditLogPath,
        [
          JSON.stringify(reviewEvent('accept', '2026-05-08T10:00:00.000Z')),
          JSON.stringify(reviewEvent('edit', '2026-05-08T10:03:00.000Z')),
          JSON.stringify(reviewEvent('reject', '2026-05-08T10:09:00.000Z')),
          JSON.stringify(reviewEvent('skip', '2026-05-08T10:10:00.000Z'))
        ].join('\n'),
        'utf8'
      );

      const metrics = await generateW8ReviewMetrics({
        auditLogPath,
        outputPath: join(tempDir, 'eval', 'w8-review-metrics.json')
      });

      expect(metrics).toMatchObject({
        reviewed_count: 3,
        accepted_count: 1,
        edit_accepted_count: 1,
        rejected_count: 1,
        skipped_count: 1,
        review_time_minutes: 10
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

function candidate(
  kind: HarvesterCandidate['kind'],
  key: string,
  confidence: number,
  novelty: number
): HarvesterCandidate {
  return {
    kind,
    key,
    value: `value:${key}`,
    source_ref: 'jira://CASE-204',
    producer_agent: 'investigator',
    confidence,
    novelty,
    rationale: `rationale:${key}`
  };
}

function pendingFile(
  relativePath: string,
  pendingCandidate: HarvesterCandidate,
  fileMtimeMs: number
): PendingReviewFile {
  return {
    filePath: join('/tmp', relativePath),
    relativePath,
    fileMtimeMs,
    metadata: {
      generatedAt: '2026-05-08T00:00:00.000Z',
      taskId: relativePath,
      auditTraceId: `trace-${relativePath}`,
      extra: {}
    },
    candidates: [pendingCandidate]
  };
}

async function writePendingFile(
  filePath: string,
  candidates: readonly HarvesterCandidate[]
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, renderPendingMarkdown(candidates, candidates), 'utf8');
}

function renderPendingMarkdown(
  acceptedCandidates: readonly HarvesterCandidate[],
  rawCandidates: readonly HarvesterCandidate[]
): string {
  const lines = [
    '# Auto-Memory Pending Candidates',
    '',
    '- generated_at: 2026-05-08T00:00:23.000Z',
    '- task_id: case-4',
    '- audit_trace_id: trace-case-4',
    '- turn_state: done',
    '- runtime: copilot_sdk',
    '- model: gpt-5-mini',
    '- harvester_prompt_version: harvester.v1',
    '- candidate_total: 3',
    '- gate_blocked_count: 1',
    '- redline_blocked_count: 0',
    `- pending_written_count: ${acceptedCandidates.length}`,
    '',
    '## Accepted Candidates'
  ];

  acceptedCandidates.forEach((pendingCandidate, index) => {
    lines.push(
      '',
      `### ${index + 1}. ${pendingCandidate.kind} :: ${pendingCandidate.key}`,
      `- source_ref: ${pendingCandidate.source_ref}`,
      `- producer_agent: ${pendingCandidate.producer_agent}`,
      `- confidence: ${pendingCandidate.confidence}`,
      `- novelty: ${pendingCandidate.novelty}`,
      `- rationale: ${pendingCandidate.rationale}`,
      '',
      '```json',
      JSON.stringify(pendingCandidate, null, 2),
      '```'
    );
  });

  lines.push(
    '',
    '## Harvester Raw Output',
    '',
    '```json',
    JSON.stringify(
      {
        turn_state: 'done',
        candidates: rawCandidates,
        skipped_by_redline: [],
        thinking: ''
      },
      null,
      2
    ),
    '```',
    ''
  );

  return lines.join('\n');
}

async function readAuditEvents(auditLogPath: string): Promise<readonly AutomemoryAuditEvent[]> {
  const raw = await readFile(auditLogPath, 'utf8');
  return raw
    .trim()
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as AutomemoryAuditEvent);
}

function isReviewAuditEvent(event: AutomemoryAuditEvent): event is ReviewAuditEvent {
  return event.event_name === 'automemory.review_decision';
}

function isConflictCheckAuditEvent(event: AutomemoryAuditEvent): event is ConflictCheckAuditEvent {
  return event.event_name === 'automemory.conflict_check';
}

function isConflictDecisionAuditEvent(
  event: AutomemoryAuditEvent
): event is ConflictDecisionAuditEvent {
  return event.event_name === 'automemory.conflict_decision';
}

function reviewEvent(decision: ReviewAuditEvent['decision'], reviewedAt: string): ReviewAuditEvent {
  return {
    timestamp: reviewedAt,
    event_name: 'automemory.review_decision',
    task_id: `task-${decision}`,
    audit_trace_id: `trace-${decision}`,
    pending_path: `${decision}.md`,
    candidate_key: `${decision}.key`,
    candidate_kind: decision === 'edit' ? 'knowledge' : 'decision',
    source_ref: `jira://${decision.toUpperCase()}-1`,
    decision,
    reviewer: 'human-reviewer',
    reviewed_at: reviewedAt,
    edited: decision === 'edit',
    edited_fields: decision === 'edit' ? ['value'] : [],
    archive_path: decision === 'skip' ? null : `.memory/archive/${decision}.md`,
    memory_namespace: decision === 'edit' ? 'knowledge_index' : 'decisions',
    memory_key: `${decision}.key`,
    memory_write_ok: decision === 'accept' || decision === 'edit',
    reason: decision
  };
}

class StringWritable extends Writable {
  private chunks = '';

  constructor(private readonly onChunk?: (chunk: string) => void) {
    super();
  }

  get value(): string {
    return this.chunks;
  }

  override _write(
    chunk: Buffer | string,
    _encoding: Parameters<Writable['_write']>[1],
    callback: (error?: Error | null) => void
  ): void {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    this.chunks += text;
    this.onChunk?.(text);
    callback();
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
