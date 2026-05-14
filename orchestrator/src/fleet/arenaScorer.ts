import { createHash } from 'node:crypto';

import type {
  ArenaAllowedRubric,
  ArenaCandidateScore,
  ArenaConsistency,
  ArenaCriticRun,
  ArenaHardGateFinding,
  ArenaRealScorerStatus,
  ArenaSanitizationReport,
  ArenaScoreDimensions,
  ArenaScoreWeights,
  ArenaScorerMode,
  BlindCriticInput,
  CriticVerdict
} from './types.js';

export const ARENA_CONSISTENCY_THRESHOLD = 0.5;
export const ARENA_SCORER_MODE: ArenaScorerMode = 'mock';
export const ARENA_REAL_SCORER_STATUS: ArenaRealScorerStatus = '未接入';
export const W12_ARENA_RUBRIC_VERSION = 'w12-arena-rubric@1';
export const W12_ARENA_JUDGE_PROMPT_VERSION = 'w12-blind-critic-json@1';
export const W12_ARENA_SCORE_WEIGHTS: ArenaScoreWeights = {
  correctness: 0.4,
  testCoverage: 0.25,
  diffMinimality: 0.2,
  style: 0.15
};
export const W12_ARENA_ALLOWED_RUBRIC: ArenaAllowedRubric = {
  rubricVersion: W12_ARENA_RUBRIC_VERSION,
  dimensions: ['correctness', 'style', 'testCoverage', 'diffMinimality'],
  weights: W12_ARENA_SCORE_WEIGHTS,
  hardGates: [
    'schema_invalid',
    'self_test_failed',
    'scope_violation',
    'identity_leak',
    'sensitive_leak'
  ]
};

export interface ArenaMockScoreInput {
  readonly fleetSessionId: string;
  readonly parentTaskId: string;
  readonly candidateId: string;
  readonly blindInput: BlindCriticInput;
  readonly sanitizationReport?: ArenaSanitizationReport;
  readonly scorerMode?: ArenaScorerMode;
  readonly realScorer?: ArenaRealScorerStatus;
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

export class LlmShadowArenaScorer implements ArenaScorer {
  scoreCandidate(input: ArenaMockScoreInput): ArenaMockScoreResult {
    return scoreArenaMockCandidate({
      ...input,
      scorerMode: 'llm_shadow',
      realScorer: 'gpt-5-mini-shadow'
    });
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
    hardGateFindings: mergeHardGateFindings(firstRun, secondRun),
    hardGatePassed: firstRun.hardGatePassed && secondRun.hardGatePassed,
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
  const sanitizationReport =
    input.sanitizationReport ?? buildSanitizationReport(JSON.stringify(input.blindInput));
  const hardGateFindings = buildHardGateFindings(input.blindInput, sanitizationReport);
  const scorerMode = input.scorerMode ?? ARENA_SCORER_MODE;
  const realScorer = input.realScorer ?? ARENA_REAL_SCORER_STATUS;
  return {
    runId: `${input.fleetSessionId}:${input.candidateId}:${scorerMode}:critic-${runIndex}`,
    fleetSessionId: input.fleetSessionId,
    parentTaskId: input.parentTaskId,
    candidateId: input.candidateId,
    runIndex,
    scorerMode,
    realScorer,
    rubricVersion: W12_ARENA_RUBRIC_VERSION,
    judgePromptVersion: W12_ARENA_JUDGE_PROMPT_VERSION,
    sanitizationReport,
    graderInputHash: hashGraderInput(input.blindInput),
    hardGateFindings,
    hardGatePassed: hardGateFindings.length === 0,
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
    correctness: clampScore(
      (input.selfTest.passed ? 4.3 : 2.1) + Math.min(acceptanceCount, 2) * 0.2
    ),
    style: clampScore((hasDiff ? 4.0 : 2.0) + rerunJitter),
    testCoverage: clampScore(
      (input.selfTest.passed ? 4.1 : 1.7) + Math.min(acceptanceCount, 3) * 0.15
    ),
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
    dimensions.correctness * W12_ARENA_SCORE_WEIGHTS.correctness +
    dimensions.testCoverage * W12_ARENA_SCORE_WEIGHTS.testCoverage +
    dimensions.diffMinimality * W12_ARENA_SCORE_WEIGHTS.diffMinimality +
    dimensions.style * W12_ARENA_SCORE_WEIGHTS.style
  );
}

function buildHardGateFindings(
  input: BlindCriticInput,
  report: ArenaSanitizationReport
): readonly ArenaHardGateFinding[] {
  const findings: ArenaHardGateFinding[] = [];
  if (!isValidBlindInput(input)) {
    findings.push({
      code: 'schema_invalid',
      message: 'critic blind input failed W12 JSON shape validation',
      blocking: true
    });
  }
  if (!input.selfTest.passed) {
    findings.push({
      code: 'self_test_failed',
      message: 'candidate self-test did not pass',
      blocking: true
    });
  }
  if (report.identityLeakDetected) {
    findings.push({
      code: 'identity_leak',
      message: 'critic input sanitizer detected implementer or worktree identity',
      blocking: true
    });
  }
  if (report.sensitiveLeakDetected) {
    findings.push({
      code: 'sensitive_leak',
      message: 'critic input sanitizer detected sensitive data',
      blocking: true
    });
  }
  return findings;
}

function isValidBlindInput(input: BlindCriticInput): boolean {
  return (
    typeof input.anonymousDiff === 'string' &&
    typeof input.selfTest.command === 'string' &&
    typeof input.selfTest.passed === 'boolean' &&
    typeof input.selfTest.summary === 'string' &&
    input.acceptance.every((item) => typeof item === 'string')
  );
}

function mergeHardGateFindings(
  firstRun: Omit<ArenaCriticRun, 'evidencePack'>,
  secondRun: Omit<ArenaCriticRun, 'evidencePack'>
): readonly ArenaHardGateFinding[] {
  const byCode = new Map<string, ArenaHardGateFinding>();
  for (const finding of [...firstRun.hardGateFindings, ...secondRun.hardGateFindings]) {
    byCode.set(finding.code, finding);
  }
  return [...byCode.values()];
}

function buildSanitizationReport(value: string): ArenaSanitizationReport {
  return {
    identityLeakDetected: containsIdentityLeak(value),
    sensitiveLeakDetected: containsSensitiveLeak(value),
    pathLeakDetected: containsPathLeak(value),
    redactionCount: countRedactions(value),
    blockedTerms: []
  };
}

export function hashGraderInput(input: BlindCriticInput): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function containsIdentityLeak(value: string): boolean {
  return /producer_agent|producer[-_ ]?agent|worktree[-_/]?[a-z0-9]/i.test(value);
}

function containsSensitiveLeak(value: string): boolean {
  return (
    /\b(?:token|api[-_ ]?key|secret|authorization)\b/i.test(value) ||
    /\b(?:10|172\.(?:1[6-9]|2\d|3[01])|192\.168)\.\d{1,3}\.\d{1,3}\b/.test(value) ||
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(value) ||
    /\b(?:病案|收费|CA签名|CA signature)\b/i.test(value)
  );
}

function containsPathLeak(value: string): boolean {
  return /(?:[\w.-]+\/)+[\w.-]+(?:\.[A-Za-z0-9]+)?/.test(value);
}

function countRedactions(value: string): number {
  return (value.match(/\[redacted_[a-z]+\]/g) ?? []).length;
}

function clampScore(value: number): number {
  return round2(Math.min(Math.max(value, 0), 5));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
