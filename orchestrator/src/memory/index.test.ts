import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  SqliteMemoryStore,
  findMemoryRedlineViolations,
  fromMemorySchemaSnapshotV1,
  isMemoryContentAllowed,
  toMemorySchemaSnapshotV1
} from './index.js';
import type { MemorySchemaV1 } from './index.js';

describe('memory contract v1', () => {
  it('maps MemorySchemaV1 camelCase to snake_case snapshot and back', () => {
    const schema: MemorySchemaV1 = {
      decisions: [
        {
          key: 'blood-transfusion.double-check.required',
          value: 'Double-check gate must remain explicit.',
          sourceRef: 'skills/.github/skills/blood-transfusion/SKILL.md',
          producerAgent: 'investigator',
          ts: '2026-05-07T00:00:00.000Z',
          confidence: 0.9,
          ttlSeconds: 86_400,
          expiresAt: '2026-05-08T00:00:00.000Z'
        }
      ],
      knowledgeIndex: [
        {
          key: 'angular.table.width-source',
          value: 'Header/body width should come from one column config.',
          triggerDescription: 'when table header/body width is desynced',
          sourceRef: 'skills/.github/skills/angular-delivery/SKILL.md',
          ts: '2026-05-07T00:00:00.000Z'
        }
      ]
    };

    const snapshot = toMemorySchemaSnapshotV1(schema);
    expect(snapshot.decisions[0]?.source_ref).toBe(
      'skills/.github/skills/blood-transfusion/SKILL.md'
    );
    expect(snapshot.knowledge_index[0]?.trigger_description).toBe(
      'when table header/body width is desynced'
    );
    expect(fromMemorySchemaSnapshotV1(snapshot)).toEqual(schema);
  });

  it('flags Authorization/Bearer and patient identifier as redline violations', () => {
    const violations = findMemoryRedlineViolations(
      'Authorization: Bearer abc.def.ghi patientNo=123456'
    );
    const ids = violations.map((item) => item.id);
    expect(ids).toContain('authorization_bearer');
    expect(ids).toContain('patient_identifier');
  });

  it('accepts sanitized memory content', () => {
    expect(
      isMemoryContentAllowed(
        'Use skill-level key only: blood-transfusion.double-check.required, no patient fields.'
      )
    ).toBe(true);
  });

  it('supports aliases namespace with manualEntry gate', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'memory-aliases-'));
    const sqlitePath = join(tempDir, 'memory.sqlite');
    const store = new SqliteMemoryStore({ sqlitePath });

    try {
      await expect(
        store.put({
          namespace: 'aliases',
          key: 'btmis',
          value: 'blood-transfusion-management-system',
          sourceRef: 'manual://review/2026-05-07/001',
          producerAgent: 'human-reviewer'
        })
      ).rejects.toThrow('manualEntry=true is required for aliases namespace');

      await store.put({
        namespace: 'aliases',
        key: 'btmis',
        value: 'blood-transfusion-management-system',
        sourceRef: 'manual://review/2026-05-07/001',
        producerAgent: 'human-reviewer',
        manualEntry: true
      });

      const record = await store.get({
        namespace: 'aliases',
        key: 'btmis'
      });

      expect(record?.namespace).toBe('aliases');
      expect(record?.producerAgent).toBe('human-reviewer');
    } finally {
      store.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('finds same-namespace conflicts with fallback lexical similarity', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'memory-conflict-'));
    const sqlitePath = join(tempDir, 'memory.sqlite');
    const store = new SqliteMemoryStore({ sqlitePath });

    try {
      await store.put({
        namespace: 'decisions',
        key: 'archive.status.standard',
        value: 'Archive status labels must stay consistent across review screens.',
        sourceRef: 'manual://review/2026-05-09/001',
        producerAgent: 'human-reviewer',
        confidence: 0.9
      });

      const result = await store.findSimilarMemoryRecords({
        namespace: 'decisions',
        key: 'archive.status.standard',
        value: 'Archive status labels must stay consistent across review screens.',
        sourceRef: 'jira:CASE-1',
        producerAgent: 'investigator',
        threshold: 0.85,
        embeddingProvider: 'deterministic_test'
      });

      expect(result.embedding_backend).toBe('fallback_lexical');
      expect(result.embedding_provider).toBe('deterministic_test');
      expect(result.warnings).toContain('embedding_backend=fallback_lexical');
      expect(result.candidate_embedding.dimensions).toBeGreaterThan(0);
      expect(result.candidates[0]?.key).toBe('archive.status.standard');
      expect(result.candidates[0]?.similarity).toBeGreaterThanOrEqual(0.85);
    } finally {
      store.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('builds hot index with top N, redline exclusion, and hit telemetry', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'memory-hot-index-'));
    const sqlitePath = join(tempDir, 'memory.sqlite');
    const store = new SqliteMemoryStore({
      sqlitePath,
      now: () => new Date('2026-05-09T12:00:00.000Z')
    });

    try {
      await store.put({
        namespace: 'decisions',
        key: 'hot-1',
        value: 'High priority memory for review prompt.',
        sourceRef: 'gitlab:ops/app#file:src/hot.ts@abc#L1-L2',
        producerAgent: 'human-reviewer',
        confidence: 0.95,
        ts: '2026-05-09T00:00:00.000Z'
      });
      await store.put({
        namespace: 'decisions',
        key: 'expired',
        value: 'Expired memory should not enter hot index.',
        sourceRef: 'manual://expired',
        producerAgent: 'human-reviewer',
        confidence: 0.99,
        ts: '2026-01-01T00:00:00.000Z',
        expiresAt: '2026-01-02T00:00:00.000Z'
      });
      await store.put({
        namespace: 'knowledge_index',
        key: 'redline',
        value: 'Authorization: Bearer top-secret-token',
        sourceRef: 'manual://redline',
        triggerDescription: 'redline',
        ts: '2026-05-09T00:00:00.000Z'
      });

      await store.search({
        namespace: 'decisions',
        query: 'High priority',
        limit: 5
      });
      await store.hotIndex({ limit: 1 });
      const result = await store.hotIndex({ limit: 1 });

      expect(result.records).toHaveLength(1);
      expect(result.records[0]?.key).toBe('hot-1');
      expect(result.records[0]?.summary).toBe('High priority memory for review prompt.');
      expect(result.records[0]?.hit_count).toBe(1);
      expect(result.records[0]?.last_hit_at).toBe('2026-05-09T12:00:00.000Z');
      expect(result.records[0]?.last_injected_at).toBe('2026-05-09T12:00:00.000Z');
      expect(result.warnings.some((warning) => warning.includes('redline'))).toBe(true);
      expect(result.records.map((record) => record.key)).not.toContain('expired');
    } finally {
      store.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
