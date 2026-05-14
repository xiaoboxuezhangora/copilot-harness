import { describe, expect, it } from 'vitest';

import {
  ARENA_REAL_SCORER_STATUS,
  ARENA_SCORER_MODE,
  scoreArenaMockCandidate,
  toPercentScore
} from './arenaScorer.js';

describe('Arena mock scorer', () => {
  it('scores four dimensions in 0-5 range and passes stable rerun consistency', () => {
    const result = scoreArenaMockCandidate({
      fleetSessionId: 'fleet-arena-scorer',
      parentTaskId: 'parent-arena',
      candidateId: 'candidate-1',
      blindInput: {
        anonymousDiff: 'diff --blind [redacted_path]\n+ deterministic change',
        selfTest: {
          command: 'mock-self-test',
          passed: true,
          summary: 'passed'
        },
        acceptance: ['meets behavior', 'keeps reviewer draft only']
      }
    });

    expect(result.runs).toHaveLength(2);
    expect(result.runs.every((run) => run.scorerMode === ARENA_SCORER_MODE)).toBe(true);
    expect(result.runs.every((run) => run.realScorer === ARENA_REAL_SCORER_STATUS)).toBe(true);
    expect(result.candidateScore.consistency.passed).toBe(true);
    expect(result.candidateScore.consistency.delta).toBeLessThanOrEqual(0.5);
    expect(toPercentScore(result.candidateScore.overallScore)).toBeGreaterThan(0);

    for (const score of Object.values(result.candidateScore.dimensions)) {
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(5);
    }
  });
});
