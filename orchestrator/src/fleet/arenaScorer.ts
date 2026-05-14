import type {
  ArenaCandidateScore,
  ArenaConsistency,
  ArenaCriticRun,
  ArenaRealScorerStatus,
  ArenaScoreDimensions,
  ArenaScorerMode,
  BlindCriticInput,
  CriticVerdict
} from './types.js';

export const ARENA_CONSISTENCY_THRESHOLD = 0.5;
export const ARENA_SCORER_MODE: ArenaScorerMode = 'mock';
export const ARENA_REAL_SCORER_STATUS: ArenaRealScorerStatus = '未接入';

export interface ArenaMockScoreInput {
  readonly fleetSessionId: string;
  readonly parentTaskId: string;
  readonly candidateId: string;
  readonly blindInput: BlindCriticInput;
}

export interface ArenaMockScoreResult {
  readonly runs: readonly Omit<ArenaCriticRun, 'evidencePack'>[];
  readonly candidateScore: ArenaCandidateScore;
}

export interface ArenaScorer {
  scoreCandidate(_input: ArenaMockScoreInput): ArenaMockScoreResult;
}

export class MockArenaScorer implements ArenaScorer {
  scoreCandidate(input: ArenaMockScoreInput): ArenaMockScoreResult {
    return scoreArenaMockCandidate(input);
  }
}

export function scoreArenaMockCandidate(input: ArenaMockScoreInput): ArenaMockScoreResult {
  const firstRun = buildRun(input, 1);
  const secondRun = buildRun(input, 2);
  const consistency = buildConsistency(input.candidateId, firstRun, secondRun);
  const dimensions = averageDimensions(firstRun.dimensions, secondRun.dimensions);
  const candidateScore: ArenaCandidateScore = {
    candidateId: input.candidateId,
    dimensions,
    overallScore: round2(scoreOverall(dimensions)),
    consistency,
    criticRunIds: [firstRun.runId, secondRun.runId]
  };

  return {
    runs: [firstRun, secondRun],
    candidateScore
  };
}

export function toPercentScore(overallScore: number): number {
  return round2(clampScore(overallScore) * 20);
}

export function verdictForOverallScore(overallScore: number): CriticVerdict {
  if (overallScore >= 4.25) return 'accept';
  if (overallScore >= 3.25) return 'revise';
  return 'reject';
}

function buildRun(
  input: ArenaMockScoreInput,
  runIndex: 1 | 2
): Omit<ArenaCriticRun, 'evidencePack'> {
  const dimensions = scoreDimensions(input.blindInput, runIndex);
  const overallScore = round2(scoreOverall(dimensions));
  return {
    runId: `${input.fleetSessionId}:${input.candidateId}:critic-${runIndex}`,
    fleetSessionId: input.fleetSessionId,
    parentTaskId: input.parentTaskId,
    candidateId: input.candidateId,
    runIndex,
    scorerMode: ARENA_SCORER_MODE,
    realScorer: ARENA_REAL_SCORER_STATUS,
    dimensions,
    overallScore,
    verdict: verdictForOverallScore(overallScore),
    blindInput: input.blindInput
  };
}

function scoreDimensions(input: BlindCriticInput, runIndex: 1 | 2): ArenaScoreDimensions {
  const diffLineCount = input.anonymousDiff
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0).length;
  const acceptanceCount = input.acceptance.length;
  const rerunJitter = runIndex === 2 ? 0.1 : 0;
  const hasDiff = input.anonymousDiff.trim().length > 0;

  return {
    correctness: clampScore((input.selfTest.passed ? 4.3 : 2.1) + Math.min(acceptanceCount, 2) * 0.2),
    style: clampScore((hasDiff ? 4.0 : 2.0) + rerunJitter),
    testCoverage: clampScore((input.selfTest.passed ? 4.1 : 1.7) + Math.min(acceptanceCount, 3) * 0.15),
    diffMinimality: clampScore(diffLineCount <= 6 ? 4.5 : diffLineCount <= 14 ? 3.7 : 2.8)
  };
}

function buildConsistency(
  candidateId: string,
  firstRun: Omit<ArenaCriticRun, 'evidencePack'>,
  secondRun: Omit<ArenaCriticRun, 'evidencePack'>
): ArenaConsistency {
  const delta = maxDimensionDelta(firstRun.dimensions, secondRun.dimensions);
  return {
    candidateId,
    firstRunId: firstRun.runId,
    secondRunId: secondRun.runId,
    delta,
    threshold: ARENA_CONSISTENCY_THRESHOLD,
    passed: delta <= ARENA_CONSISTENCY_THRESHOLD
  };
}

function averageDimensions(
  left: ArenaScoreDimensions,
  right: ArenaScoreDimensions
): ArenaScoreDimensions {
  return {
    correctness: round2((left.correctness + right.correctness) / 2),
    style: round2((left.style + right.style) / 2),
    testCoverage: round2((left.testCoverage + right.testCoverage) / 2),
    diffMinimality: round2((left.diffMinimality + right.diffMinimality) / 2)
  };
}

function maxDimensionDelta(left: ArenaScoreDimensions, right: ArenaScoreDimensions): number {
  return round2(
    Math.max(
      Math.abs(left.correctness - right.correctness),
      Math.abs(left.style - right.style),
      Math.abs(left.testCoverage - right.testCoverage),
      Math.abs(left.diffMinimality - right.diffMinimality)
    )
  );
}

function scoreOverall(dimensions: ArenaScoreDimensions): number {
  return (
    dimensions.correctness +
    dimensions.style +
    dimensions.testCoverage +
    dimensions.diffMinimality
  ) / 4;
}

function clampScore(value: number): number {
  return round2(Math.min(Math.max(value, 0), 5));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
