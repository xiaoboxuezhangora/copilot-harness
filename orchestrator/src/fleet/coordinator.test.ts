import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AuditLogger } from '../audit/index.js';
import { FleetCoordinator } from './index.js';
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
      expect(auditLines).toHaveLength(8);
    });
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

  it('keeps critic blind input free of producer_agent', async () => {
    await withFleetCoordinator(async (coordinator) => {
      const session = await coordinator.run(baseInput);
      const criticInput = JSON.stringify(session.criticScores.map((score) => score.blindInput));

      expect(criticInput).not.toContain('producer_agent');
      expect(criticInput).toContain('anonymousDiff');
      expect(criticInput).toContain('selfTest');
      expect(criticInput).toContain('acceptance');
    });
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
  callback: (coordinator: FleetCoordinator, auditPath: string) => Promise<void>,
  options: Omit<ConstructorParameters<typeof FleetCoordinator>[0], 'auditLogger'> = {}
): Promise<void> {
  const tempDir = await mkdtemp(join(tmpdir(), 'fleet-audit-'));
  try {
    const auditPath = join(tempDir, 'audit.log');
    const coordinator = new FleetCoordinator({
      ...options,
      auditLogger: new AuditLogger(auditPath)
    });
    await callback(coordinator, auditPath);
  } finally {
    await rm(tempDir, {
      force: true,
      recursive: true
    });
  }
}
