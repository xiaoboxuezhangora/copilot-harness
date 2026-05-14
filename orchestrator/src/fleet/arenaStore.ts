import { mkdirSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type {
  ArenaArchiveArtifact,
  ArenaCandidateScore,
  ArenaCriticRun,
  ArenaEvalSeedArtifact,
  ArenaEvalSeedSample,
  ArenaEvalSeedCandidateSnapshot,
  ArenaSession,
  FleetCandidate
} from './types.js';
import { W12_ARENA_ARCHIVE_SCHEMA, W12_ARENA_EVAL_SEED_SCHEMA } from './types.js';
import { W12_ARENA_SCORE_WEIGHTS } from './arenaScorer.js';

export const DEFAULT_ARENA_SQLITE_PATH = 'reports/arena.sqlite';
export const DEFAULT_ARENA_ARCHIVE_PATH = 'reports/arena/archive';

export interface ArenaStore {
  saveArenaSession(_input: ArenaStoreSaveInput): Promise<void>;
  exportWeeklyEvalSeedArtifact(_input?: ArenaEvalSeedExportInput): Promise<ArenaEvalSeedArtifact>;
  close?(): void;
}

export interface ArenaStoreSaveInput {
  readonly arena: ArenaSession;
  readonly candidates: readonly FleetCandidate[];
}

export interface ArenaEvalSeedExportInput {
  readonly weekKey?: string;
  readonly minSamples?: number;
  readonly generatedAt?: string;
  readonly outputPath?: string;
}

interface EvalSeedRow {
  readonly session_id: string;
  readonly winner_candidate_id: string;
  readonly loser_candidate_id: string;
  readonly winner_scores_json: string;
  readonly loser_scores_json: string;
  readonly winner_consistency_delta: number;
  readonly loser_consistency_delta: number;
  readonly archive_path: string;
}

export class SqliteArenaStore implements ArenaStore {
  private readonly db: DatabaseSync;
  private readonly now: () => Date;
  readonly sqlitePath: string;

  constructor(options: { readonly sqlitePath?: string; readonly now?: () => Date } = {}) {
    this.sqlitePath = resolve(options.sqlitePath ?? DEFAULT_ARENA_SQLITE_PATH);
    mkdirSync(dirname(this.sqlitePath), { recursive: true });
    this.db = new DatabaseSync(this.sqlitePath);
    this.now = options.now ?? (() => new Date());
    this.initialize();
  }

  close(): void {
    this.db.close();
  }

  async saveArenaSession(input: ArenaStoreSaveInput): Promise<void> {
    const createdAt = this.now().toISOString();
    const candidateScores = new Map(
      input.arena.candidateScores.map((score) => [score.candidateId, score])
    );

    this.db
      .prepare(
        `
        INSERT INTO arena_sessions (
          session_id, parent_task_id, task_id, schema_version, mode, real_scorer,
          candidate_count, consistency_threshold, archive_path, evidence_pack_json, created_at
        ) VALUES (
          :session_id, :parent_task_id, :task_id, :schema_version, :mode, :real_scorer,
          :candidate_count, :consistency_threshold, :archive_path, :evidence_pack_json, :created_at
        )
        ON CONFLICT(session_id) DO UPDATE SET
          parent_task_id = excluded.parent_task_id,
          task_id = excluded.task_id,
          schema_version = excluded.schema_version,
          mode = excluded.mode,
          real_scorer = excluded.real_scorer,
          candidate_count = excluded.candidate_count,
          consistency_threshold = excluded.consistency_threshold,
          archive_path = excluded.archive_path,
          evidence_pack_json = excluded.evidence_pack_json,
          created_at = excluded.created_at
        `
      )
      .run({
        session_id: input.arena.fleetSessionId,
        parent_task_id: input.arena.parentTaskId,
        task_id: input.arena.taskId,
        schema_version: input.arena.schemaVersion,
        mode: input.arena.scorerMode,
        real_scorer: input.arena.realScorer,
        candidate_count: input.arena.candidateCount,
        consistency_threshold: input.arena.consistencyThreshold,
        archive_path: input.arena.archivePath,
        evidence_pack_json: JSON.stringify(input.arena.evidencePack),
        created_at: createdAt
      });

    for (let index = 0; index < input.candidates.length; index += 1) {
      const candidate = input.candidates[index];
      if (candidate === undefined) continue;
      const score = candidateScores.get(candidate.candidateId);
      if (score === undefined) {
        throw new Error(`Arena score missing for candidate ${candidate.candidateId}`);
      }
      const archiveStatus =
        candidate.candidateId === input.arena.winner.candidateId ? 'winner' : 'loser';
      this.upsertCandidate({
        arena: input.arena,
        candidate,
        score,
        ordinal: index + 1,
        archiveStatus,
        createdAt
      });
    }

    for (const run of allCriticRuns(input.arena)) {
      this.db
        .prepare(
          `
          INSERT INTO arena_critic_runs (
            run_id, session_id, candidate_id, run_index, scorer_mode, real_scorer,
            rubric_version, judge_prompt_version, grader_input_hash,
            sanitization_report_json, hard_gate_findings_json, hard_gate_passed,
            blind_input_json, scores_json, overall_score, source_ref, evidence_pack_json, created_at
          ) VALUES (
            :run_id, :session_id, :candidate_id, :run_index, :scorer_mode, :real_scorer,
            :rubric_version, :judge_prompt_version, :grader_input_hash,
            :sanitization_report_json, :hard_gate_findings_json, :hard_gate_passed,
            :blind_input_json, :scores_json, :overall_score, :source_ref, :evidence_pack_json, :created_at
          )
          ON CONFLICT(run_id) DO UPDATE SET
            session_id = excluded.session_id,
            candidate_id = excluded.candidate_id,
            run_index = excluded.run_index,
            scorer_mode = excluded.scorer_mode,
            real_scorer = excluded.real_scorer,
            rubric_version = excluded.rubric_version,
            judge_prompt_version = excluded.judge_prompt_version,
            grader_input_hash = excluded.grader_input_hash,
            sanitization_report_json = excluded.sanitization_report_json,
            hard_gate_findings_json = excluded.hard_gate_findings_json,
            hard_gate_passed = excluded.hard_gate_passed,
            blind_input_json = excluded.blind_input_json,
            scores_json = excluded.scores_json,
            overall_score = excluded.overall_score,
            source_ref = excluded.source_ref,
            evidence_pack_json = excluded.evidence_pack_json,
            created_at = excluded.created_at
          `
        )
        .run({
          run_id: run.runId,
          session_id: run.fleetSessionId,
          candidate_id: run.candidateId,
          run_index: run.runIndex,
          scorer_mode: run.scorerMode,
          real_scorer: run.realScorer,
          rubric_version: run.rubricVersion,
          judge_prompt_version: run.judgePromptVersion,
          grader_input_hash: run.graderInputHash,
          sanitization_report_json: JSON.stringify(run.sanitizationReport),
          hard_gate_findings_json: JSON.stringify(run.hardGateFindings),
          hard_gate_passed: run.hardGatePassed ? 1 : 0,
          blind_input_json: JSON.stringify(run.blindInput),
          scores_json: JSON.stringify(run.dimensions),
          overall_score: run.overallScore,
          source_ref: run.evidencePack.evidences[0]?.source_ref ?? `arena://${run.runId}`,
          evidence_pack_json: JSON.stringify(run.evidencePack),
          created_at: createdAt
        });
    }

    this.db
      .prepare(
        `
        INSERT INTO arena_winners (
          session_id, winner_candidate_id, scores_json, overall_score,
          consistency_delta, reviewer_artifact_id, created_at
        ) VALUES (
          :session_id, :winner_candidate_id, :scores_json, :overall_score,
          :consistency_delta, :reviewer_artifact_id, :created_at
        )
        ON CONFLICT(session_id) DO UPDATE SET
          winner_candidate_id = excluded.winner_candidate_id,
          scores_json = excluded.scores_json,
          overall_score = excluded.overall_score,
          consistency_delta = excluded.consistency_delta,
          reviewer_artifact_id = excluded.reviewer_artifact_id,
          created_at = excluded.created_at
        `
      )
      .run({
        session_id: input.arena.fleetSessionId,
        winner_candidate_id: input.arena.winner.candidateId,
        scores_json: JSON.stringify(input.arena.winner.dimensions),
        overall_score: input.arena.winner.overallScore,
        consistency_delta: input.arena.winner.consistencyDelta,
        reviewer_artifact_id: `${input.arena.fleetSessionId}-draft-mr`,
        created_at: createdAt
      });

    await this.writeArchiveArtifact(input, createdAt);
  }

  async exportWeeklyEvalSeedArtifact(
    input: ArenaEvalSeedExportInput = {}
  ): Promise<ArenaEvalSeedArtifact> {
    const generatedAt = input.generatedAt ?? this.now().toISOString();
    const weekKey = input.weekKey ?? toWeekKey(new Date(generatedAt));
    const minSamples = input.minSamples ?? 20;
    const rows = this.db
      .prepare(
        `
        SELECT
          winners.session_id,
          winners.winner_candidate_id,
          losers.candidate_id AS loser_candidate_id,
          winners.scores_json AS winner_scores_json,
          losers.scores_json AS loser_scores_json,
          winners.consistency_delta AS winner_consistency_delta,
          losers.consistency_delta AS loser_consistency_delta,
          sessions.archive_path
        FROM arena_winners winners
        JOIN arena_sessions sessions
          ON sessions.session_id = winners.session_id
        JOIN arena_candidates losers
          ON losers.session_id = winners.session_id
          AND losers.archive_status = 'loser'
        ORDER BY sessions.created_at DESC, winners.session_id ASC, losers.candidate_id ASC
        LIMIT :limit
        `
      )
      .all({ limit: minSamples });
    const samples = rows.map((row) => toEvalSeedSample(readEvalSeedRow(row), weekKey));

    if (samples.length < minSamples) {
      throw new Error(
        `Arena eval seed export requires at least ${minSamples} samples; found ${samples.length}`
      );
    }

    for (const sample of samples) {
      this.db
        .prepare(
          `
          INSERT INTO eval_seed_records (
            seed_id, session_id, winner_candidate_id, loser_candidate_id,
            week_key, sample_json, source_ref, status, generated_at
          ) VALUES (
            :seed_id, :session_id, :winner_candidate_id, :loser_candidate_id,
            :week_key, :sample_json, :source_ref, :status, :generated_at
          )
          ON CONFLICT(seed_id) DO UPDATE SET
            sample_json = excluded.sample_json,
            source_ref = excluded.source_ref,
            status = excluded.status,
            generated_at = excluded.generated_at
          `
        )
        .run({
          seed_id: sample.seedId,
          session_id: sample.sessionId,
          winner_candidate_id: sample.winnerCandidateId,
          loser_candidate_id: sample.loserCandidateId,
          week_key: sample.weekKey,
          sample_json: JSON.stringify(sample),
          source_ref: sample.sourceRef,
          status: sample.status,
          generated_at: generatedAt
        });
    }

    const artifact: ArenaEvalSeedArtifact = {
      schemaVersion: W12_ARENA_EVAL_SEED_SCHEMA,
      generatedAt,
      weekKey,
      status: 'pending_review',
      autoMerge: false,
      minSamples,
      sampleCount: samples.length,
      samples
    };
    const outputPath =
      input.outputPath ?? join('reports', 'arena', 'eval-seeds', `${weekKey}.pending.json`);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
    return artifact;
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS arena_sessions (
        session_id TEXT PRIMARY KEY,
        parent_task_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        schema_version TEXT NOT NULL,
        mode TEXT NOT NULL,
        real_scorer TEXT NOT NULL,
        candidate_count INTEGER NOT NULL,
        consistency_threshold REAL NOT NULL,
        archive_path TEXT NOT NULL,
        evidence_pack_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS arena_candidates (
        session_id TEXT NOT NULL,
        candidate_id TEXT NOT NULL,
        ordinal INTEGER NOT NULL,
        step_id TEXT NOT NULL,
        self_test_passed INTEGER NOT NULL,
          scores_json TEXT NOT NULL,
          overall_score REAL NOT NULL,
          hard_gate_findings_json TEXT NOT NULL DEFAULT '[]',
          hard_gate_passed INTEGER NOT NULL DEFAULT 1,
          consistency_delta REAL NOT NULL,
          consistency_passed INTEGER NOT NULL,
        archive_status TEXT NOT NULL,
        candidate_json TEXT NOT NULL,
        evidence_pack_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (session_id, candidate_id)
      );

      CREATE TABLE IF NOT EXISTS arena_critic_runs (
        run_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        candidate_id TEXT NOT NULL,
        run_index INTEGER NOT NULL,
          scorer_mode TEXT NOT NULL,
          real_scorer TEXT NOT NULL,
          rubric_version TEXT NOT NULL DEFAULT '',
          judge_prompt_version TEXT NOT NULL DEFAULT '',
          grader_input_hash TEXT NOT NULL DEFAULT '',
          sanitization_report_json TEXT NOT NULL DEFAULT '{}',
          hard_gate_findings_json TEXT NOT NULL DEFAULT '[]',
          hard_gate_passed INTEGER NOT NULL DEFAULT 1,
          blind_input_json TEXT NOT NULL,
        scores_json TEXT NOT NULL,
        overall_score REAL NOT NULL,
        source_ref TEXT NOT NULL,
        evidence_pack_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS arena_winners (
        session_id TEXT PRIMARY KEY,
        winner_candidate_id TEXT NOT NULL,
        scores_json TEXT NOT NULL,
        overall_score REAL NOT NULL,
        consistency_delta REAL NOT NULL,
        reviewer_artifact_id TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS eval_seed_records (
        seed_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        winner_candidate_id TEXT NOT NULL,
        loser_candidate_id TEXT NOT NULL,
        week_key TEXT NOT NULL,
        sample_json TEXT NOT NULL,
        source_ref TEXT NOT NULL,
        status TEXT NOT NULL,
        generated_at TEXT NOT NULL
      );
    `);
    this.ensureColumn('arena_candidates', 'hard_gate_findings_json', "TEXT NOT NULL DEFAULT '[]'");
    this.ensureColumn('arena_candidates', 'hard_gate_passed', 'INTEGER NOT NULL DEFAULT 1');
    this.ensureColumn('arena_critic_runs', 'rubric_version', "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn('arena_critic_runs', 'judge_prompt_version', "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn('arena_critic_runs', 'grader_input_hash', "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn(
      'arena_critic_runs',
      'sanitization_report_json',
      "TEXT NOT NULL DEFAULT '{}'"
    );
    this.ensureColumn('arena_critic_runs', 'hard_gate_findings_json', "TEXT NOT NULL DEFAULT '[]'");
    this.ensureColumn('arena_critic_runs', 'hard_gate_passed', 'INTEGER NOT NULL DEFAULT 1');
  }

  private ensureColumn(tableName: string, columnName: string, definition: string): void {
    const columns = this.db.prepare(`PRAGMA table_info(${tableName})`).all();
    const hasColumn = columns.some((column) => {
      const record = asRecord(column);
      return record?.name === columnName;
    });
    if (!hasColumn) {
      this.db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
    }
  }

  private upsertCandidate(input: {
    readonly arena: ArenaSession;
    readonly candidate: FleetCandidate;
    readonly score: ArenaCandidateScore;
    readonly ordinal: number;
    readonly archiveStatus: 'winner' | 'loser';
    readonly createdAt: string;
  }): void {
    this.db
      .prepare(
        `
        INSERT INTO arena_candidates (
          session_id, candidate_id, ordinal, step_id, self_test_passed,
          scores_json, overall_score, hard_gate_findings_json, hard_gate_passed,
          consistency_delta, consistency_passed,
          archive_status, candidate_json, evidence_pack_json, created_at
        ) VALUES (
          :session_id, :candidate_id, :ordinal, :step_id, :self_test_passed,
          :scores_json, :overall_score, :hard_gate_findings_json, :hard_gate_passed,
          :consistency_delta, :consistency_passed,
          :archive_status, :candidate_json, :evidence_pack_json, :created_at
        )
        ON CONFLICT(session_id, candidate_id) DO UPDATE SET
          ordinal = excluded.ordinal,
          step_id = excluded.step_id,
          self_test_passed = excluded.self_test_passed,
          scores_json = excluded.scores_json,
          overall_score = excluded.overall_score,
          hard_gate_findings_json = excluded.hard_gate_findings_json,
          hard_gate_passed = excluded.hard_gate_passed,
          consistency_delta = excluded.consistency_delta,
          consistency_passed = excluded.consistency_passed,
          archive_status = excluded.archive_status,
          candidate_json = excluded.candidate_json,
          evidence_pack_json = excluded.evidence_pack_json,
          created_at = excluded.created_at
        `
      )
      .run({
        session_id: input.arena.fleetSessionId,
        candidate_id: input.candidate.candidateId,
        ordinal: input.ordinal,
        step_id: input.candidate.stepId,
        self_test_passed: input.candidate.selfTest.passed ? 1 : 0,
        scores_json: JSON.stringify(input.score.dimensions),
        overall_score: input.score.overallScore,
        hard_gate_findings_json: JSON.stringify(input.score.hardGateFindings),
        hard_gate_passed: input.score.hardGatePassed ? 1 : 0,
        consistency_delta: input.score.consistency.delta,
        consistency_passed: input.score.consistency.passed ? 1 : 0,
        archive_status: input.archiveStatus,
        candidate_json: JSON.stringify(input.candidate),
        evidence_pack_json: JSON.stringify(input.candidate.evidencePack),
        created_at: input.createdAt
      });
  }

  private async writeArchiveArtifact(
    input: ArenaStoreSaveInput,
    generatedAt: string
  ): Promise<void> {
    const scoreByCandidate = new Map(
      input.arena.candidateScores.map((score) => [score.candidateId, score])
    );
    const artifact: ArenaArchiveArtifact = {
      schemaVersion: W12_ARENA_ARCHIVE_SCHEMA,
      generatedAt,
      status: 'pending_review',
      autoMerge: false,
      fleetSessionId: input.arena.fleetSessionId,
      archivePath: input.arena.archivePath,
      winner: input.arena.winner,
      candidates: input.candidates.map((candidate) => {
        const score = scoreByCandidate.get(candidate.candidateId);
        if (score === undefined) {
          throw new Error(`Arena archive score missing for candidate ${candidate.candidateId}`);
        }
        return {
          candidateId: candidate.candidateId,
          archiveStatus:
            candidate.candidateId === input.arena.winner.candidateId ? 'winner' : 'loser',
          dimensions: score.dimensions,
          overallScore: score.overallScore,
          hardGateFindings: score.hardGateFindings,
          hardGatePassed: score.hardGatePassed,
          consistencyDelta: score.consistency.delta,
          evidenceSourceRefs: candidate.evidencePack.evidences.map(
            (evidence) => evidence.source_ref
          )
        };
      })
    };
    const archiveFilePath = join(input.arena.archivePath, 'session.json');
    await mkdir(dirname(archiveFilePath), { recursive: true });
    await writeFile(archiveFilePath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  }
}

function readEvalSeedRow(row: unknown): EvalSeedRow {
  const record = asRecord(row);
  if (record === undefined) throw new Error('Invalid arena eval seed row');
  return {
    session_id: requiredString(record.session_id, 'session_id'),
    winner_candidate_id: requiredString(record.winner_candidate_id, 'winner_candidate_id'),
    loser_candidate_id: requiredString(record.loser_candidate_id, 'loser_candidate_id'),
    winner_scores_json: requiredString(record.winner_scores_json, 'winner_scores_json'),
    loser_scores_json: requiredString(record.loser_scores_json, 'loser_scores_json'),
    winner_consistency_delta: requiredNumber(
      record.winner_consistency_delta,
      'winner_consistency_delta'
    ),
    loser_consistency_delta: requiredNumber(
      record.loser_consistency_delta,
      'loser_consistency_delta'
    ),
    archive_path: requiredString(record.archive_path, 'archive_path')
  };
}

function toEvalSeedSample(row: EvalSeedRow, weekKey: string): ArenaEvalSeedSample {
  const winner = readCandidateSnapshot(
    row.winner_candidate_id,
    row.winner_scores_json,
    row.winner_consistency_delta
  );
  const loser = readCandidateSnapshot(
    row.loser_candidate_id,
    row.loser_scores_json,
    row.loser_consistency_delta
  );
  const seedId = `${weekKey}:${row.session_id}:${row.winner_candidate_id}:vs:${row.loser_candidate_id}`;
  return {
    seedId,
    sessionId: row.session_id,
    winnerCandidateId: row.winner_candidate_id,
    loserCandidateId: row.loser_candidate_id,
    weekKey,
    sourceRef: `arena://${row.session_id}/winner-vs-loser/${row.loser_candidate_id}`,
    status: 'pending_review',
    archivePath: row.archive_path,
    winner,
    loser
  };
}

function readCandidateSnapshot(
  candidateId: string,
  scoresJson: string,
  consistencyDelta: number
): ArenaEvalSeedCandidateSnapshot {
  const dimensions = readScoreDimensions(scoresJson);
  const overallScore =
    dimensions.correctness * W12_ARENA_SCORE_WEIGHTS.correctness +
    dimensions.testCoverage * W12_ARENA_SCORE_WEIGHTS.testCoverage +
    dimensions.diffMinimality * W12_ARENA_SCORE_WEIGHTS.diffMinimality +
    dimensions.style * W12_ARENA_SCORE_WEIGHTS.style;
  return {
    candidateId,
    dimensions,
    overallScore: round2(overallScore),
    hardGatePassed: true,
    consistencyDelta
  };
}

function readScoreDimensions(value: string): ArenaEvalSeedCandidateSnapshot['dimensions'] {
  const parsed = JSON.parse(value) as unknown;
  const record = asRecord(parsed);
  if (record === undefined) throw new Error('Invalid arena score dimensions');
  return {
    correctness: requiredNumber(record.correctness, 'correctness'),
    style: requiredNumber(record.style, 'style'),
    testCoverage: requiredNumber(record.testCoverage, 'testCoverage'),
    diffMinimality: requiredNumber(record.diffMinimality, 'diffMinimality')
  };
}

function toWeekKey(date: Date): string {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = start.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  start.setUTCDate(start.getUTCDate() + diff);
  return start.toISOString().slice(0, 10);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Invalid arena row field: ${field}`);
  }
  return value;
}

function requiredNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid arena row field: ${field}`);
  }
  return value;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function allCriticRuns(arena: ArenaSession): readonly ArenaCriticRun[] {
  return [...arena.criticRuns, ...(arena.shadowCriticRuns ?? [])];
}
