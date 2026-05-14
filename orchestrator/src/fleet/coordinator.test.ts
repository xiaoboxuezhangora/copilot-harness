import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AuditLogger } from '../audit/index.js';
import {
  FleetCoordinator,
  LlmShadowArenaScorer,
  MockArenaScorer,
  SqliteArenaStore,
  type ArenaMockScoreInput,
  type ArenaMockScoreResult,
  type ArenaScoreDimensions,
  type ArenaScorer
} from './index.js';
import { buildW10FleetSmokeReport } from './smoke.js';
import type { MockFleetCandidateDraft } from './index.js';

const baseInput = {
  taskId: 'fleet-e2e',
  parentTaskId: 'parent-task',
  prompt: 'Implement W10 deterministic mock fleet control plane.',
  intent: 'W10 fleet mock loop',
  allowedFiles: [
    'orchestrator/src/fleet/types.ts',
    'orchestrator/src/fleet/coordinator.ts',
    'orchestrator/src/gates/index.ts'
  ],
  acceptance: [
    'planner emits bounded atomic steps',
    'implementer emits anonymous mock diff',
    'reviewer emits draft artifact only'
  ],
  fanout: 3
};

describe('FleetCoordinator', () => {
  it('runs fanout=3 deterministic mock E2E through reviewer draft', async () => {
    await withFleetCoordinator(async (coordinator, auditPath) => {
      const session = await coordinator.run(baseInput);
      const auditLog = await readFile(auditPath, 'utf8');
      const auditLines = auditLog
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as unknown);

      expect(session.turnState).toBe('done');
      expect(session.realFanout).toBe('real_disabled');
      expect(session.plan?.steps).toHaveLength(3);
      expect(session.candidates).toHaveLength(3);
      expect(session.criticScores).toHaveLength(3);
      expect(session.arena).toMatchObject({
        candidateCount: 3,
        scorerMode: 'mock',
        realScorer: '未接入'
      });
      expect(session.arena?.criticRuns).toHaveLength(6);
      expect(session.arena?.criticRuns[0]).toMatchObject({
        rubricVersion: 'w12-arena-rubric@1',
        judgePromptVersion: 'w12-blind-critic-json@1',
        hardGatePassed: true
      });
      expect(session.arena?.criticRuns[0]?.graderInputHash).toMatch(/^[a-f0-9]{64}$/);
      expect(session.arena?.winner.consistencyPassed).toBe(true);
      expect(session.arena?.winner.hardGatePassed).toBe(true);
      expect(session.reviewerDraft).toMatchObject({
        isDraft: true,
        pushed: false,
        mergeRequestCreated: false,
        worktreeMode: 'real_disabled'
      });
      expect(auditLog).toContain('"agentRole":"planner"');
      expect(auditLog).toContain('"agentRole":"implementer"');
      expect(auditLog).toContain('"agentRole":"critic"');
      expect(auditLog).toContain('"agentRole":"reviewer"');
      expect(auditLines).toHaveLength(11);
    });
  });

  it('runs fanout=5 under BudgetGate cap', async () => {
    await withFleetCoordinator(async (coordinator) => {
      const session = await coordinator.run({
        ...baseInput,
        fanout: 5
      });

      expect(session.turnState).toBe('done');
      expect(session.candidates).toHaveLength(5);
      expect(session.arena?.candidateCount).toBe(5);
      expect(session.arena?.criticRuns).toHaveLength(10);
    });
  });

  it('blocks fanout below three before mock implementers start', async () => {
    await withFleetCoordinator(async (coordinator, auditPath) => {
      const session = await coordinator.run({
        ...baseInput,
        fanout: 2
      });
      const auditLog = await readFile(auditPath, 'utf8');

      expect(session.turnState).toBe('blocked');
      expect(session.candidates).toHaveLength(0);
      expect(session.blockedPartialResult?.blockedReason).toContain('below W12 Arena minimum');
      expect(session.evidencePack.evidences[0]?.source_ref).toContain('fanout-policy');
      expect(auditLog).toContain('"policyDecision":"deny"');
    });
  });

  it('blocks actual candidate count outside the W12 three-to-five range', async () => {
    const shortDrafts: readonly MockFleetCandidateDraft[] = [
      {
        stepId: 'step-1',
        filesTouched: ['orchestrator/src/fleet/types.ts'],
        anonymousDiff:
          'diff --mock a/orchestrator/src/fleet/types.ts b/orchestrator/src/fleet/types.ts',
        selfTest: {
          command: 'mock-self-test 1',
          passed: true,
          summary: 'passed'
        }
      },
      {
        stepId: 'step-2',
        filesTouched: ['orchestrator/src/fleet/coordinator.ts'],
        anonymousDiff:
          'diff --mock a/orchestrator/src/fleet/coordinator.ts b/orchestrator/src/fleet/coordinator.ts',
        selfTest: {
          command: 'mock-self-test 2',
          passed: true,
          summary: 'passed'
        }
      }
    ];
    await withFleetCoordinator(
      async (coordinator) => {
        const session = await coordinator.run(baseInput);

        expect(session.turnState).toBe('blocked');
        expect(session.candidates).toHaveLength(2);
        expect(session.blockedPartialResult?.blockedReason).toContain('candidate_count=2');
      },
      {
        candidateFactory: () => shortDrafts
      }
    );
  });

  it('returns blocked partial result when fleet fanout exceeds five', async () => {
    await withFleetCoordinator(async (coordinator, auditPath) => {
      const session = await coordinator.run({
        ...baseInput,
        fanout: 6
      });
      const auditLog = await readFile(auditPath, 'utf8');

      expect(session.turnState).toBe('blocked');
      expect(session.candidates).toHaveLength(0);
      expect(session.blockedPartialResult?.summary).toContain('BudgetGate denied');
      expect(session.evidencePack.evidences[0]?.content).toContain('maxFleetFanout');
      expect(auditLog).toContain('"agentRole":"planner"');
    });
  });

  it('blocks implementer candidate files outside step.files_touched', async () => {
    const outOfScopeDrafts = ((): readonly MockFleetCandidateDraft[] => [
      {
        stepId: 'step-1',
        filesTouched: ['orchestrator/src/runtime/types.ts'],
        anonymousDiff: 'diff --mock out-of-scope',
        selfTest: {
          command: 'mock-self-test',
          passed: true,
          summary: 'would pass if scope allowed'
        }
      }
    ])();
    await withFleetCoordinator(
      async (coordinator) => {
        const session = await coordinator.run(baseInput);

        expect(session.turnState).toBe('blocked');
        expect(session.candidates[0]).toMatchObject({
          turnState: 'blocked',
          policyDecision: 'deny'
        });
        expect(session.candidates[0]?.blockedReason).toContain('outside step.files_touched');
        expect(session.reviewerDraft).toBeUndefined();
      },
      {
        candidateFactory: () => outOfScopeDrafts
      }
    );
  });

  it('keeps critic blind input free of producer_agent, worktree id, and file identity', async () => {
    const identityLeakDrafts = ((): readonly MockFleetCandidateDraft[] => [
      {
        stepId: 'step-1',
        filesTouched: ['orchestrator/src/fleet/types.ts'],
        anonymousDiff: [
          'diff --mock a/orchestrator/src/fleet/candidate-7.ts b/worktree-alpha/candidate-7.ts',
          '+ producer_agent=implementer-a touched worktree-alpha/candidate-7.ts'
        ].join('\n'),
        selfTest: {
          command: 'mock-self-test worktree-alpha',
          passed: true,
          summary: 'producer_agent=implementer-a passed for candidate-7.ts'
        }
      },
      {
        stepId: 'step-2',
        filesTouched: ['orchestrator/src/fleet/coordinator.ts'],
        anonymousDiff:
          'diff --mock a/orchestrator/src/fleet/coordinator.ts b/orchestrator/src/fleet/coordinator.ts',
        selfTest: {
          command: 'mock-self-test 2',
          passed: true,
          summary: 'passed'
        }
      },
      {
        stepId: 'step-3',
        filesTouched: ['orchestrator/src/gates/index.ts'],
        anonymousDiff:
          'diff --mock a/orchestrator/src/gates/index.ts b/orchestrator/src/gates/index.ts',
        selfTest: {
          command: 'mock-self-test 3',
          passed: true,
          summary: 'passed'
        }
      }
    ])();

    await withFleetCoordinator(
      async (coordinator) => {
        const session = await coordinator.run(baseInput);
        const criticInput = JSON.stringify(session.criticScores.map((score) => score.blindInput));

        expect(criticInput).not.toContain('producer_agent');
        expect(criticInput).not.toContain('worktree-alpha');
        expect(criticInput).not.toContain('candidate-7.ts');
        expect(criticInput).not.toContain('orchestrator/src/fleet');
        expect(criticInput).not.toContain('implementer-a');
        expect(criticInput).toContain('anonymousDiff');
        expect(criticInput).toContain('selfTest');
        expect(criticInput).toContain('acceptance');
        expect(criticInput).toContain('rubric');
        expect(session.arena?.candidateScores[0]?.hardGatePassed).toBe(false);
        expect(session.arena?.candidateScores[0]?.hardGateFindings[0]?.code).toBe('identity_leak');
      },
      {
        candidateFactory: () => identityLeakDrafts
      }
    );
  });

  it('blocks automatic winner selection when all eligible candidates fail hard gates', async () => {
    const failingDrafts = baseInput.allowedFiles.map(
      (file, index): MockFleetCandidateDraft => ({
        stepId: `step-${index + 1}`,
        filesTouched: [file],
        anonymousDiff: `diff --mock a/${file} b/${file}\n+ candidate with failing self-test`,
        selfTest: {
          command: `mock-self-test ${index + 1}`,
          passed: false,
          summary: 'failed'
        }
      })
    );
    await withFleetCoordinator(
      async (coordinator) => {
        const session = await coordinator.run(baseInput);

        expect(session.turnState).toBe('blocked');
        expect(session.reviewerDraft).toBeUndefined();
        expect(session.arena?.candidateScores.every((score) => !score.hardGatePassed)).toBe(true);
        expect(session.blockedPartialResult?.summary).toContain('hard gate blocked');
      },
      {
        candidateFactory: () => failingDrafts
      }
    );
  });

  it('blocks automatic winner selection when double-run dimension delta exceeds threshold', async () => {
    await withFleetCoordinator(
      async (coordinator) => {
        const session = await coordinator.run(baseInput);

        expect(session.turnState).toBe('blocked');
        expect(session.reviewerDraft).toBeUndefined();
        expect(session.arena?.candidateScores.every((score) => !score.consistency.passed)).toBe(
          true
        );
        expect(session.arena?.candidateScores[0]?.consistency.delta).toBeGreaterThan(0.5);
      },
      {
        arenaScorer: new UnstableArenaScorer()
      }
    );
  });

  it('records llm_shadow critic runs without changing the mock winner', async () => {
    await withFleetCoordinator(
      async (coordinator) => {
        const session = await coordinator.run(baseInput);

        expect(session.turnState).toBe('done');
        expect(session.arena?.scorerMode).toBe('mock');
        expect(session.arena?.shadowCriticRuns).toHaveLength(6);
        expect(
          session.arena?.shadowCriticRuns?.every((run) => run.scorerMode === 'llm_shadow')
        ).toBe(true);
        expect(session.reviewerDraft?.selectedCandidateId).toBe(session.arena?.winner.candidateId);
      },
      {
        shadowArenaScorer: new LlmShadowArenaScorer()
      }
    );
  });

  it('puts only the winner into final Evidence Pack and archives losers', async () => {
    await withFleetCoordinator(async (coordinator) => {
      const session = await coordinator.run(baseInput);
      const criticInput = JSON.stringify(session.criticScores.map((score) => score.blindInput));
      const winner = session.arena?.winner.candidateId;
      const loser = session.candidates.find((candidate) => candidate.candidateId !== winner);
      const sourceRefs = session.evidencePack.evidences.map((evidence) => evidence.source_ref);

      expect(winner).toBe(session.reviewerDraft?.selectedCandidateId);
      expect(sourceRefs.some((sourceRef) => sourceRef.includes(`/winner/${winner}`))).toBe(true);
      expect(JSON.stringify(session.evidencePack)).not.toContain(loser?.candidateId);
      expect(session.arena?.archivePath).toContain(session.fleetSessionId);
      const archiveJson = await readFile(`${session.arena?.archivePath}/session.json`, 'utf8');
      expect(archiveJson).toContain('"status": "pending_review"');
      expect(archiveJson).toContain('"archiveStatus": "loser"');
      expect(criticInput).toContain('anonymousDiff');
    });
  });

  it('allows scorer injection while keeping mock mode as the default scorer contract', async () => {
    const scorer = new CountingArenaScorer();
    await withFleetCoordinator(
      async (coordinator) => {
        const session = await coordinator.run(baseInput);

        expect(scorer.calls).toBe(3);
        expect(session.arena?.scorerMode).toBe('mock');
        expect(session.arena?.realScorer).toBe('未接入');
      },
      {
        arenaScorer: scorer
      }
    );
  });

  it('reviewer only produces a draft artifact and leaves real MR disabled', async () => {
    await withFleetCoordinator(async (coordinator) => {
      const session = await coordinator.run(baseInput);

      expect(session.reviewerDraft).toMatchObject({
        isDraft: true,
        pushed: false,
        mergeRequestCreated: false,
        policyDecision: 'escalate',
        approvalRequired: 'L2',
        worktreeMode: 'real_disabled'
      });
      expect(session.reviewerDraft?.body).toContain('Real GitLab MR creation: real_disabled');
      expect(session.reviewerDraft?.body).toContain('Arena scorer: mock/未接入');
      expect(session.reviewerDraft?.body).toContain('Loser archive:');
      expect(session.realMergeRequest).toBe('real_disabled');
    });
  });

  it('builds a passing W10 smoke report from fleet session and audit roles', async () => {
    await withFleetCoordinator(async (coordinator, auditPath) => {
      const session = await coordinator.run(baseInput);
      const report = buildW10FleetSmokeReport({
        generatedAt: '2026-05-11T00:00:00.000Z',
        session,
        auditLogPath: auditPath,
        taskStatePath: '/tmp/w10-fleet-smoke.json',
        snapshotPath: '/tmp/snapshot.json',
        mirroredSnapshotPath: '/tmp/apps/showcase/snapshot.json',
        auditRecords: [
          { fleetSessionId: session.fleetSessionId, agentRole: 'planner' },
          { fleetSessionId: session.fleetSessionId, agentRole: 'implementer' },
          { fleetSessionId: session.fleetSessionId, agentRole: 'critic' },
          { fleetSessionId: session.fleetSessionId, agentRole: 'reviewer' }
        ]
      });

      expect(report.status).toBe('pass');
      expect(report.candidate_count).toBe(3);
      expect(report.critic_score_count).toBe(3);
      expect(report.real_fanout).toBe('real_disabled');
      expect(report.real_merge_request).toBe('real_disabled');
      expect(report.reviewer_draft).toEqual({
        pushed: false,
        merge_request_created: false
      });
      expect(report.checks.every((check) => check.passed)).toBe(true);
    });
  });
});

async function withFleetCoordinator(
  callback: (coordinator: FleetCoordinator, auditPath: string, arenaPath: string) => Promise<void>,
  options: Omit<ConstructorParameters<typeof FleetCoordinator>[0], 'auditLogger'> = {}
): Promise<void> {
  const tempDir = await mkdtemp(join(tmpdir(), 'fleet-audit-'));
  const arenaArchiveRoot = options.arenaArchiveRoot ?? join(tempDir, 'arena-archive');
  const ownedArenaStore =
    options.arenaStore === undefined
      ? new SqliteArenaStore({ sqlitePath: join(tempDir, 'arena.sqlite') })
      : undefined;
  try {
    const auditPath = join(tempDir, 'audit.log');
    const arenaPath = join(tempDir, 'arena.sqlite');
    const coordinator = new FleetCoordinator({
      ...options,
      auditLogger: new AuditLogger(auditPath),
      arenaArchiveRoot,
      ...(ownedArenaStore !== undefined ? { arenaStore: ownedArenaStore } : {})
    });
    await callback(coordinator, auditPath, arenaPath);
  } finally {
    ownedArenaStore?.close();
    await rm(tempDir, {
      force: true,
      recursive: true
    });
  }
}

class CountingArenaScorer implements ArenaScorer {
  private readonly delegate = new MockArenaScorer();
  calls = 0;

  scoreCandidate(input: ArenaMockScoreInput): ArenaMockScoreResult {
    this.calls += 1;
    return this.delegate.scoreCandidate(input);
  }
}

class UnstableArenaScorer implements ArenaScorer {
  private readonly delegate = new MockArenaScorer();

  scoreCandidate(input: ArenaMockScoreInput): ArenaMockScoreResult {
    const result = this.delegate.scoreCandidate(input);
    const firstRun = result.runs[0];
    const secondRun = result.runs[1];
    if (firstRun === undefined || secondRun === undefined) return result;
    const unstableDimensions: ArenaScoreDimensions = {
      ...secondRun.dimensions,
      style: Math.max(0, secondRun.dimensions.style - 1)
    };
    return {
      runs: [
        firstRun,
        {
          ...secondRun,
          dimensions: unstableDimensions
        }
      ],
      candidateScore: {
        ...result.candidateScore,
        consistency: {
          ...result.candidateScore.consistency,
          delta: 1,
          passed: false
        }
      }
    };
  }
}
