import { describe, expect, it } from 'vitest';

import {
  buildW8EvalReport,
  evaluateW8Sample,
  toW8EvalReportJson,
  upgradeLegacyDatasetToW8,
  type W8AcceptanceProfile,
  type W8EvalDataset,
  type W8EvalLoadResult,
  type W8EvalSample
} from './w8Eval.js';

const evidenceRef = 'gitlab:ops/app#file:src/modules/approval/reminder.service.ts@abc123#L12-L28';

describe('W8 eval', () => {
  it('maps legacy W6 samples into W8 schema without pretending GitLab evidence exists', () => {
    const dataset = upgradeLegacyDatasetToW8({
      promptVersion: 'w6-eval-skill-routing@0.1',
      samples: [
        {
          task_id: 'ad-01',
          ground_truth_conclusion: 'ready for implementation planning',
          source_ref: 'skills/angular-delivery/SKILL.md',
          high_risk: false
        }
      ]
    });

    expect(dataset.samples[0]).toMatchObject({
      taskId: 'ad-01',
      evalInputRef: 'legacy:eval/jira-eval-50.json#ad-01',
      sourceRef: 'jira:LEGACY-001',
      groundTruthRepo: 'unknown',
      gitlabEvidenceRefs: [],
      expectedNextAction: 'need_more_context'
    });
  });

  it('scores Repo Hit@1 only when the first repo hint has source_ref evidence', () => {
    const sample = buildJointSample({
      taskId: 'joint-01',
      sourceRefsOnFirstHint: [evidenceRef],
      projectOnFirstHint: 'ops/app'
    });

    const result = evaluateW8Sample(sample);

    expect(result.realJointSample).toBe(true);
    expect(result.repoHitAt1Eligible).toBe(true);
    expect(result.repoHitAt1).toBe(true);
    expect(result.planExecutability).toBe(2);
  });

  it('does not award Repo Hit@1 when repo_hints have no evidence source_ref', () => {
    const sample = buildJointSample({
      taskId: 'joint-02',
      sourceRefsOnFirstHint: [],
      projectOnFirstHint: 'ops/app'
    });

    const result = evaluateW8Sample(sample);

    expect(result.realJointSample).toBe(true);
    expect(result.repoHitAt1Eligible).toBe(false);
    expect(result.repoHitAt1).toBeNull();
    expect(result.reason).toBe('repo_hint_without_source_ref_but_drafted_plan');
  });

  it('treats missing GitLab evidence as a coverage gap when next_action asks for more context', () => {
    const sample: W8EvalSample = {
      taskId: 'gap-01',
      evalInputRef: 'jira-live:OPS-202',
      jiraKey: 'OPS-202',
      sourceRef: 'jira:OPS-202',
      groundTruthRepo: 'ops/app',
      groundTruthModules: ['src/modules/approval'],
      gitlabEvidenceRefs: [],
      expectedNextAction: 'need_more_context',
      reviewDecision: 'not_reviewed',
      highRisk: false,
      predicted: {
        gitlabEvidenceRefs: [],
        repoHints: [],
        plan: {
          summary: 'Need repository evidence before planning.',
          steps: [],
          files: [],
          risks: ['No source_ref evidence is attached.'],
          testHints: []
        },
        nextAction: 'need_more_context'
      }
    };

    const result = evaluateW8Sample(sample);

    expect(result.reason).toBe('coverage_gap_missing_gitlab_evidence');
    expect(result.missingRefs).toEqual(['gitlab']);
    expect(result.predictedNextAction).toBe('need_more_context');
  });

  it('builds W8 report metrics and snake_case JSON output', () => {
    const dataset: W8EvalDataset = {
      schemaVersion: 'phase-1b-w8-eval@1',
      samples: [
        buildJointSample({
          taskId: 'joint-01',
          sourceRefsOnFirstHint: [evidenceRef],
          projectOnFirstHint: 'ops/app'
        }),
        buildJointSample({
          taskId: 'joint-02',
          sourceRefsOnFirstHint: [evidenceRef],
          projectOnFirstHint: 'ops/miss'
        })
      ]
    };
    const loadResult: W8EvalLoadResult = {
      dataset,
      datasetSource: 'fixture:w8',
      loadedFromLegacyFallback: false
    };

    const report = buildW8EvalReport(loadResult);
    const json = toW8EvalReportJson(report);

    expect(report.metrics.repoHitAt1).toBe(0.5);
    expect(report.metrics.sourceRefCoverage).toBe(1);
    expect(report.metrics.acceptRate).toBe(1);
    expect(report.metrics.planExecutabilityAverage).toBe(2);
    expect(json.metrics.repo_hit_at_1).toBe(0.5);
    expect(json.joint_sample_source_ref_proof).toHaveLength(2);
  });

  it('uses review metrics file data for accept rate and review time', () => {
    const dataset: W8EvalDataset = {
      schemaVersion: 'phase-1b-w8-eval@1',
      samples: [
        buildJointSample({
          taskId: 'joint-01',
          sourceRefsOnFirstHint: [evidenceRef],
          projectOnFirstHint: 'ops/app'
        }),
        buildJointSample({
          taskId: 'joint-02',
          sourceRefsOnFirstHint: [evidenceRef],
          projectOnFirstHint: 'ops/app'
        })
      ]
    };
    const report = buildW8EvalReport(
      {
        dataset,
        datasetSource: 'fixture:w8',
        loadedFromLegacyFallback: false
      },
      {
        schemaVersion: 'phase-1b-w8-review-metrics@1',
        source: 'reports/audit.log',
        reviewedCount: 2,
        acceptedCount: 1,
        editAcceptedCount: 1,
        rejectedCount: 0,
        majorEditCount: 0,
        skippedCount: 0,
        reviewTimeMinutes: 8.25
      }
    );

    expect(report.metrics.acceptRate).toBe(1);
    expect(report.metrics.acceptRateNumerator).toBe(2);
    expect(report.metrics.acceptRateDenominator).toBe(2);
    expect(report.metrics.reviewTimeMinutes).toBe(8.25);
  });

  it('honors a temporary reduced acceptance profile without review-time metrics', () => {
    const dataset: W8EvalDataset = {
      schemaVersion: 'phase-1b-w8-eval@1',
      samples: [
        buildJointSample({
          taskId: 'joint-01',
          sourceRefsOnFirstHint: [evidenceRef],
          projectOnFirstHint: 'ops/app'
        }),
        buildJointSample({
          taskId: 'joint-02',
          sourceRefsOnFirstHint: [evidenceRef],
          projectOnFirstHint: 'ops/app'
        })
      ]
    };
    const temporaryProfile: W8AcceptanceProfile = {
      schemaVersion: 'phase-1b-w8-acceptance-profile@1',
      name: 'fixture-reduced-profile',
      temporary: true,
      reason: 'Fixture proves the current Jira-limited closure gate is configurable.',
      datasetPath: 'fixture:w8',
      requiredSampleCount: 2,
      requiredRealJointSampleCount: 2,
      acceptRateTarget: 0.4,
      requireReviewMetrics: false,
      reviewTimeTargetMinutes: 10,
      finalTarget: {
        requiredSampleCount: 50,
        requiredRealJointSampleCount: 20
      }
    };

    const report = withW8Environment(() =>
      buildW8EvalReport(
        {
          dataset,
          datasetSource: 'fixture:w8',
          loadedFromLegacyFallback: false
        },
        null,
        temporaryProfile
      )
    );

    expect(report.status).toBe('PASS');
    expect(report.metrics.reviewTimeMinutes).toBeNull();
    expect(report.notReadyReasons).toEqual([]);
    expect(toW8EvalReportJson(report).acceptance_profile).toMatchObject({
      name: 'fixture-reduced-profile',
      temporary: true,
      required_sample_count: 2
    });
  });
});

function buildJointSample(input: {
  readonly taskId: string;
  readonly sourceRefsOnFirstHint: readonly string[];
  readonly projectOnFirstHint: string;
}): W8EvalSample {
  return {
    taskId: input.taskId,
    evalInputRef: `jira-live:${input.taskId}`,
    jiraKey: 'OPS-201',
    sourceRef: 'jira:OPS-201',
    groundTruthRepo: 'ops/app',
    groundTruthModules: ['src/modules/approval'],
    gitlabEvidenceRefs: [evidenceRef],
    expectedNextAction: 'draft_plan',
    reviewDecision: 'accept',
    highRisk: false,
    predicted: {
      gitlabEvidenceRefs: [evidenceRef],
      repoHints: [
        {
          project: input.projectOnFirstHint,
          module: 'src/modules/approval',
          confidence: 0.91,
          sourceRefs: input.sourceRefsOnFirstHint
        }
      ],
      plan: {
        summary: 'Implement approval reminder changes.',
        steps: ['Update reminder service', 'Add scheduling guard'],
        files: ['src/modules/approval/reminder.service.ts'],
        risks: ['Duplicate notifications if scheduling guard regresses.'],
        testHints: ['Unit test threshold and idempotency.']
      },
      nextAction: 'draft_plan'
    }
  };
}

function withW8Environment<T>(callback: () => T): T {
  const previous = {
    GITLAB_BASE_URL: process.env.GITLAB_BASE_URL,
    GITLAB_TOKEN: process.env.GITLAB_TOKEN,
    JIRA_BASE_URL: process.env.JIRA_BASE_URL,
    JIRA_TOKEN: process.env.JIRA_TOKEN
  };
  process.env.GITLAB_BASE_URL = 'https://gitlab.example.test';
  process.env.GITLAB_TOKEN = 'test-token';
  process.env.JIRA_BASE_URL = 'https://jira.example.test';
  process.env.JIRA_TOKEN = 'test-token';

  try {
    return callback();
  } finally {
    restoreEnv('GITLAB_BASE_URL', previous.GITLAB_BASE_URL);
    restoreEnv('GITLAB_TOKEN', previous.GITLAB_TOKEN);
    restoreEnv('JIRA_BASE_URL', previous.JIRA_BASE_URL);
    restoreEnv('JIRA_TOKEN', previous.JIRA_TOKEN);
  }
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}
