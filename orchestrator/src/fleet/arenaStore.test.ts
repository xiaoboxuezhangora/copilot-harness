import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { describe, expect, it } from 'vitest';

import {
  ARENA_CONSISTENCY_THRESHOLD,
  ARENA_REAL_SCORER_STATUS,
  ARENA_SCORER_MODE,
  scoreArenaMockCandidate
} from './arenaScorer.js';
import type { EvidencePack } from '../runtime/index.js';
import { SqliteArenaStore } from './arenaStore.js';
import { W12_ARENA_SESSION_SCHEMA } from './types.js';
import type { ArenaCandidateScore, ArenaCriticRun, ArenaSession, FleetCandidate } from './index.js';

describe('SqliteArenaStore', () => {
  it('persists arena tables and exports pending weekly winner-vs-loser samples', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'arena-store-'));
    const sqlitePath = join(tempDir, 'arena.sqlite');
    const outputPath = join(tempDir, 'eval-seed.json');
    const store = new SqliteArenaStore({
      sqlitePath,
      now: () => new Date('2026-05-14T08:00:00.000Z')
    });

    try {
      for (let index = 0; index < 10; index += 1) {
        const session = buildArenaFixture(`fleet-arena-${index + 1}`, tempDir);
        await store.saveArenaSession({
          arena: session.arena,
          candidates: session.candidates
        });
      }

      const db = new DatabaseSync(sqlitePath);
      try {
        expect(readCount(db, 'arena_sessions')).toBe(10);
        expect(readCount(db, 'arena_candidates')).toBe(30);
        expect(readCount(db, 'arena_critic_runs')).toBe(60);
        expect(readCount(db, 'arena_winners')).toBe(10);
      } finally {
        db.close();
      }

      const artifact = await store.exportWeeklyEvalSeedArtifact({
        weekKey: '2026-W20',
        minSamples: 20,
        outputPath
      });
      const exported = JSON.parse(await readFile(outputPath, 'utf8')) as unknown;

      expect(artifact.status).toBe('pending_review');
      expect(artifact.autoMerge).toBe(false);
      expect(artifact.sampleCount).toBeGreaterThanOrEqual(20);
      expect(artifact.samples[0]?.sourceRef).toContain('winner-vs-loser');
      expect(artifact.samples[0]?.winnerCandidateId).not.toBe(
        artifact.samples[0]?.loserCandidateId
      );
      expect(JSON.stringify(exported)).toContain('"pending_review"');
      expect(
        await readFile(join(tempDir, 'archive', 'fleet-arena-1', 'session.json'), 'utf8')
      ).toContain('"archiveStatus": "loser"');
    } finally {
      store.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

function buildArenaFixture(
  sessionId: string,
  tempDir: string
): {
  readonly arena: ArenaSession;
  readonly candidates: readonly FleetCandidate[];
} {
  const candidates: readonly FleetCandidate[] = [1, 2, 3].map((index) =>
    buildCandidate(sessionId, `candidate-${index}`, index)
  );
  const scored = candidates.map((candidate) =>
    scoreArenaMockCandidate({
      fleetSessionId: sessionId,
      parentTaskId: 'parent-arena',
      candidateId: candidate.candidateId,
      blindInput: {
        anonymousDiff: candidate.anonymousDiff,
        selfTest: candidate.selfTest,
        acceptance: candidate.acceptance
      }
    })
  );
  const candidateScores = scored.map((result) => result.candidateScore);
  const criticRuns: ArenaCriticRun[] = scored.flatMap((result) =>
    result.runs.map((run) => ({
      ...run,
      evidencePack: evidencePack(`${run.runId}:critic`, `arena://${run.runId}`)
    }))
  );
  const winnerScore = selectWinner(candidateScores);
  const arena: ArenaSession = {
    schemaVersion: W12_ARENA_SESSION_SCHEMA,
    fleetSessionId: sessionId,
    parentTaskId: 'parent-arena',
    taskId: `${sessionId}-task`,
    scorerMode: ARENA_SCORER_MODE,
    realScorer: ARENA_REAL_SCORER_STATUS,
    candidateCount: candidates.length,
    consistencyThreshold: ARENA_CONSISTENCY_THRESHOLD,
    criticRuns,
    candidateScores,
    winner: {
      candidateId: winnerScore.candidateId,
      dimensions: winnerScore.dimensions,
      overallScore: winnerScore.overallScore,
      hardGateFindings: winnerScore.hardGateFindings,
      hardGatePassed: winnerScore.hardGatePassed,
      consistencyDelta: winnerScore.consistency.delta,
      consistencyPassed: winnerScore.consistency.passed,
      criticRunIds: winnerScore.criticRunIds
    },
    archivePath: join(tempDir, 'archive', sessionId),
    evidencePack: evidencePack(`${sessionId}:arena`, `arena://${sessionId}/winner`)
  };
  return {
    arena,
    candidates
  };
}

function buildCandidate(sessionId: string, candidateId: string, index: number): FleetCandidate {
  return {
    fleetSessionId: sessionId,
    parentTaskId: 'parent-arena',
    candidateId,
    stepId: `step-${index}`,
    filesTouched: [`mock-${index}.ts`],
    anonymousDiff: `diff --blind [redacted_path]\n+ mock change ${index}`,
    selfTest: {
      command: `mock-self-test ${index}`,
      passed: index !== 3,
      summary: index === 3 ? 'failed expected branch' : 'passed'
    },
    acceptance: ['winner-vs-loser exportable'],
    turnState: 'done',
    policyDecision: 'allow',
    evidencePack: evidencePack(`${sessionId}:${candidateId}`, `arena://${sessionId}/${candidateId}`)
  };
}

function selectWinner(scores: readonly ArenaCandidateScore[]): ArenaCandidateScore {
  const selected = [...scores].sort(
    (left, right) =>
      Number(right.consistency.passed) - Number(left.consistency.passed) ||
      right.overallScore - left.overallScore ||
      left.candidateId.localeCompare(right.candidateId)
  )[0];
  if (selected === undefined) throw new Error('missing winner score');
  return selected;
}

function evidencePack(taskId: string, sourceRef: string): EvidencePack {
  return {
    taskId,
    intent: 'arena store test',
    evidences: [
      {
        source_ref: sourceRef,
        content: 'test evidence'
      }
    ],
    assumptions: [],
    confidence: 1
  };
}

function readCount(db: DatabaseSync, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get();
  if (typeof row !== 'object' || row === null || Array.isArray(row)) {
    throw new Error(`invalid count row for ${table}`);
  }
  const count = (row as Record<string, unknown>).count;
  if (typeof count !== 'number') {
    throw new Error(`invalid count value for ${table}`);
  }
  return count;
}
