import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { JiraEvidencePackV2 } from '../jira/evidence.js';
import {
  evaluateRequirementEvalDataset,
  loadRequirementEvalDataset,
  runRequirementEval,
  type RequirementEvalDataset,
  type RequirementEvalExpected,
  type RequirementEvalSample
} from './eval.js';

describe('requirements eval v0', () => {
  it('loader rejects malformed fixture', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'requirements-eval-malformed-'));
    const fixturePath = join(dir, 'bad.json');
    await writeFile(
      fixturePath,
      JSON.stringify({
        schemaVersion: 'requirements-analysis-eval-v0-samples@1',
        samples: [
          {
            sampleId: 1,
            issueKey: 'OPS-BAD'
          }
        ]
      }),
      'utf8'
    );

    await expect(loadRequirementEvalDataset(fixturePath)).rejects.toThrow(
      /Invalid requirements eval fixture/
    );
  });

  it('rejects fixture when issue misses required summary/sourceRef fields', async () => {
    const sample = buildSample('malformed-issue-01', buildVisualGreenEvidence('OPS-2001'), {
      profile: 'Visual',
      investigationLight: 'green',
      implementationLight: 'green',
      keyGaps: [],
      requiredSourceRefs: ['jira.issue:OPS-2001']
    });
    const fixture = deepCloneUnknown(buildDataset([sample]));
    const sampleRecord = getSampleRecord(fixture);
    const evidencePack = getRecord(sampleRecord.evidencePack);
    const issue = getRecord(evidencePack.issue);
    delete issue.summary;
    delete issue.sourceRef;

    await expectFixtureRejected(fixture);
  });

  it('rejects fixture when comment misses body/sourceRef', async () => {
    const sample = buildSample('malformed-comment-01', buildVisualGreenEvidence('OPS-2002'), {
      profile: 'Visual',
      investigationLight: 'green',
      implementationLight: 'green',
      keyGaps: [],
      requiredSourceRefs: ['jira.issue:OPS-2002']
    });
    const fixture = deepCloneUnknown(buildDataset([sample]));
    const sampleRecord = getSampleRecord(fixture);
    const evidencePack = getRecord(sampleRecord.evidencePack);
    const comments = getArray(evidencePack.comments);
    const firstComment = getRecord(comments[0]);
    delete firstComment.body;
    delete firstComment.sourceRef;

    await expectFixtureRejected(fixture);
  });

  it('rejects fixture when attachment sourceRef is missing or not covered by sourceRefs', async () => {
    const sampleMissing = buildSample('malformed-attachment-missing-01', buildVisualGreenEvidence('OPS-2003'), {
      profile: 'Visual',
      investigationLight: 'green',
      implementationLight: 'green',
      keyGaps: [],
      requiredSourceRefs: ['jira.issue:OPS-2003']
    });
    const fixtureMissing = deepCloneUnknown(buildDataset([sampleMissing]));
    const sampleRecordMissing = getSampleRecord(fixtureMissing);
    const evidencePackMissing = getRecord(sampleRecordMissing.evidencePack);
    const attachmentsMissing = getArray(evidencePackMissing.attachments);
    const firstAttachmentMissing = getRecord(attachmentsMissing[0]);
    delete firstAttachmentMissing.sourceRef;

    await expectFixtureRejected(fixtureMissing);

    const sampleUncovered = buildSample('malformed-attachment-uncovered-01', buildVisualGreenEvidence('OPS-2004'), {
      profile: 'Visual',
      investigationLight: 'green',
      implementationLight: 'green',
      keyGaps: [],
      requiredSourceRefs: ['jira.issue:OPS-2004']
    });
    const fixtureUncovered = deepCloneUnknown(buildDataset([sampleUncovered]));
    const sampleRecordUncovered = getSampleRecord(fixtureUncovered);
    const evidencePackUncovered = getRecord(sampleRecordUncovered.evidencePack);
    const attachmentsUncovered = getArray(evidencePackUncovered.attachments);
    const firstAttachmentUncovered = getRecord(attachmentsUncovered[0]);
    firstAttachmentUncovered.sourceRef = 'jira.attachment:OPS-2004:att-untracked';

    await expectFixtureRejected(fixtureUncovered);
  });

  it('rejects fixture when sample.issueKey mismatches evidencePack.issue.key', async () => {
    const sample = buildSample('malformed-issue-key-01', buildVisualGreenEvidence('OPS-2005'), {
      profile: 'Visual',
      investigationLight: 'green',
      implementationLight: 'green',
      keyGaps: [],
      requiredSourceRefs: ['jira.issue:OPS-2005']
    });
    const fixture = deepCloneUnknown(buildDataset([sample]));
    const sampleRecord = getSampleRecord(fixture);
    sampleRecord.issueKey = 'OPS-OTHER';

    await expectFixtureRejected(fixture);
  });

  it('replays local fixture and writes JSON/Markdown reports', async () => {
    const fixturePath = fileURLToPath(
      new URL('../../fixtures/requirements/requirements-eval-v0-samples.json', import.meta.url)
    );
    const dir = await mkdtemp(join(tmpdir(), 'requirements-eval-replay-'));
    const outputJsonPath = join(dir, 'report.json');
    const outputMarkdownPath = join(dir, 'report.md');

    const report = await runRequirementEval({
      datasetPath: fixturePath,
      outputJsonPath,
      outputMarkdownPath
    });

    expect(report.schemaVersion).toBe('requirements-analysis-eval-v0-report@1');
    expect(report.dataset.sampleCount).toBeGreaterThan(0);
    expect(report.samples).toHaveLength(report.dataset.sampleCount);

    const storedJson = JSON.parse(await readFile(outputJsonPath, 'utf8')) as {
      readonly schemaVersion: string;
      readonly status: string;
    };
    const storedMarkdown = await readFile(outputMarkdownPath, 'utf8');

    expect(storedJson.schemaVersion).toBe('requirements-analysis-eval-v0-report@1');
    expect(storedJson.status).toBe(report.status);
    expect(storedMarkdown).toContain('# Requirements Analysis Eval v0 Report');
  });

  it('marks status as NOT_READY when sample count is below 50', () => {
    const dataset = buildDataset([
      buildSample('sample-small-01', buildVisualGreenEvidence('OPS-1001'), {
        profile: 'Visual',
        investigationLight: 'green',
        implementationLight: 'green',
        keyGaps: [],
        requiredSourceRefs: ['jira.issue:OPS-1001']
      })
    ]);

    const report = evaluateRequirementEvalDataset(dataset);

    expect(report.status).toBe('NOT_READY');
    expect(report.notReadyReasons.some((reason) => reason.includes('sampleCount=1'))).toBe(true);
  });

  it('lists router/gate/sourceRef/keyGaps failures', () => {
    const routerFailSample = buildSample(
      'router-fail-01',
      buildBillingEvidence('OPS-1002'),
      {
        profile: 'AccessControl',
        investigationLight: 'yellow',
        implementationLight: 'red',
        keyGaps: ['acceptanceAssertions', 'profileSupport'],
        requiredSourceRefs: ['jira.issue:OPS-1002']
      }
    );

    const gateFailSample = buildSample(
      'gate-fail-01',
      buildVisualGapEvidence('OPS-1003'),
      {
        profile: 'Visual',
        investigationLight: 'green',
        implementationLight: 'green',
        keyGaps: ['expectedBehavior', 'baselineEvidence', 'viewport', 'acceptanceAssertions'],
        requiredSourceRefs: ['jira.issue:OPS-1003']
      }
    );

    const sourceRefFailSample = buildSample(
      'source-ref-fail-01',
      buildWorkflowGreenEvidence('OPS-1004'),
      {
        profile: 'Workflow',
        investigationLight: 'green',
        implementationLight: 'green',
        keyGaps: [],
        requiredSourceRefs: ['jira.comment:OPS-1004:c-missing-required']
      }
    );

    const keyGapsFailSample = buildSample(
      'key-gaps-fail-01',
      buildVisualGapEvidence('OPS-1005'),
      {
        profile: 'Visual',
        investigationLight: 'yellow',
        implementationLight: 'red',
        keyGaps: ['expectedBehavior', 'baselineEvidence', 'viewport', 'acceptanceAssertions', 'never-happen-gap'],
        requiredSourceRefs: ['jira.issue:OPS-1005']
      }
    );

    const report = evaluateRequirementEvalDataset(
      buildDataset([
        routerFailSample,
        gateFailSample,
        sourceRefFailSample,
        keyGapsFailSample
      ])
    );

    const categories = new Set(report.failures.map((failure) => failure.category));

    expect(categories.has('routerTop1')).toBe(true);
    expect(categories.has('investigationGate')).toBe(true);
    expect(categories.has('implementationGate')).toBe(true);
    expect(categories.has('sourceRefCoverage')).toBe(true);
    expect(categories.has('keyGaps')).toBe(true);
  });

  it('detects missing requiredSourceRefs in sourceRefCoverage', () => {
    const sample = buildSample('source-ref-check-01', buildVisualGreenEvidence('OPS-1006'), {
      profile: 'Visual',
      investigationLight: 'green',
      implementationLight: 'green',
      keyGaps: [],
      requiredSourceRefs: ['jira.comment:OPS-1006:c-not-exists']
    });

    const report = evaluateRequirementEvalDataset(buildDataset([sample]));
    const summary = report.samples[0];
    if (summary === undefined) {
      throw new Error('Missing sample summary');
    }

    expect(summary.sourceRefCoveragePass).toBe(false);
    expect(summary.missingSourceRefs).toContain('jira.comment:OPS-1006:c-not-exists');
  });

  it('counts missing reviewer/reviewedAt/adjustmentReason into NOT_READY reason', () => {
    const sample = buildSample('review-missing-01', buildVisualGreenEvidence('OPS-1007'), {
      profile: 'Visual',
      investigationLight: 'green',
      implementationLight: 'green',
      keyGaps: [],
      requiredSourceRefs: ['jira.issue:OPS-1007']
    });

    const dataset: RequirementEvalDataset = {
      schemaVersion: 'requirements-analysis-eval-v0-samples@1',
      samples: [
        {
          ...sample,
          review: {
            reviewer: '',
            reviewedAt: '',
            reviewSourceRef: 'notion.page:review-missing-01',
            adjustmentReason: ''
          }
        }
      ]
    };

    const report = evaluateRequirementEvalDataset(dataset);

    expect(report.dataset.missingReviewMetadataCount).toBe(1);
    expect(report.status).toBe('NOT_READY');
    expect(
      report.notReadyReasons.some((reason) => reason.includes('missingReviewMetadataCount=1'))
    ).toBe(true);
  });
});

function buildDataset(samples: readonly RequirementEvalSample[]): RequirementEvalDataset {
  return {
    schemaVersion: 'requirements-analysis-eval-v0-samples@1',
    samples
  };
}

function buildSample(
  sampleId: string,
  evidencePack: JiraEvidencePackV2,
  expected: RequirementEvalExpected
): RequirementEvalSample {
  return {
    sampleId,
    issueKey: evidencePack.issue.key,
    evidencePack,
    expected,
    review: {
      reviewer: 'tester',
      reviewedAt: '2026-05-19T00:00:00.000Z',
      reviewSourceRef: `notion.page:${sampleId}`,
      adjustmentReason: 'test fixture'
    },
    metadata: {
      source: 'local-fixture'
    }
  };
}

function buildVisualGreenEvidence(issueKey: string): JiraEvidencePackV2 {
  return {
    schemaVersion: 'JiraEvidencePackV2',
    issue: {
      key: issueKey,
      summary: '登录页按钮样式错位（1920x1080）',
      description: '预期按钮颜色与 baseline 设计稿一致，不应错位。',
      issueType: 'Bug',
      status: 'To Do',
      priority: 'High',
      assignee: '',
      labels: ['frontend'],
      projectKey: 'OPS',
      projectName: 'Operations',
      created: '2026-05-19T00:00:00.000Z',
      updated: '2026-05-19T00:00:00.000Z',
      dueDate: '',
      sourceRef: `jira.issue:${issueKey}`
    },
    fields: [],
    fieldValues: [],
    comments: [
      {
        id: `c-${issueKey}-1`,
        body: '应当与 Figma 设计稿一致。',
        author: 'qa',
        created: '2026-05-19T00:00:00.000Z',
        updated: '2026-05-19T00:00:00.000Z',
        sourceRef: `jira.comment:${issueKey}:c-${issueKey}-1`
      }
    ],
    attachments: [
      {
        id: `att-${issueKey}-1`,
        filename: 'screenshot-login-page.png',
        mimeType: 'image/png',
        size: 12888,
        sourceRef: `jira.attachment:${issueKey}:att-${issueKey}-1`,
        securityDigest: null
      }
    ],
    mediaEvidence: [],
    projectMetadata: null,
    relations: [],
    transitions: [],
    sourceRefs: [
      `jira.issue:${issueKey}`,
      `jira.comment:${issueKey}:c-${issueKey}-1`,
      `jira.attachment:${issueKey}:att-${issueKey}-1`
    ],
    generatedAt: '2026-05-19T00:00:00.000Z'
  };
}

function buildVisualGapEvidence(issueKey: string): JiraEvidencePackV2 {
  return {
    schemaVersion: 'JiraEvidencePackV2',
    issue: {
      key: issueKey,
      summary: '页面样式异常',
      description: '按钮错位，缺少基线和 viewport 说明。',
      issueType: 'Bug',
      status: 'To Do',
      priority: 'High',
      assignee: '',
      labels: ['ui'],
      projectKey: 'OPS',
      projectName: 'Operations',
      created: '2026-05-19T00:00:00.000Z',
      updated: '2026-05-19T00:00:00.000Z',
      dueDate: '',
      sourceRef: `jira.issue:${issueKey}`
    },
    fields: [],
    fieldValues: [],
    comments: [],
    attachments: [
      {
        id: `att-${issueKey}-1`,
        filename: 'screenshot-ui-bug.png',
        mimeType: 'image/png',
        size: 7122,
        sourceRef: `jira.attachment:${issueKey}:att-${issueKey}-1`,
        securityDigest: null
      }
    ],
    mediaEvidence: [],
    projectMetadata: null,
    relations: [],
    transitions: [],
    sourceRefs: [`jira.issue:${issueKey}`, `jira.attachment:${issueKey}:att-${issueKey}-1`],
    generatedAt: '2026-05-19T00:00:00.000Z'
  };
}

function buildWorkflowGreenEvidence(issueKey: string): JiraEvidencePackV2 {
  return {
    schemaVersion: 'JiraEvidencePackV2',
    issue: {
      key: issueKey,
      summary: '审批流程在提交后触发',
      description: '申请人提交后触发审批流程，审批人应当在 1 小时内处理，步骤需留痕。',
      issueType: 'Task',
      status: 'To Do',
      priority: 'Medium',
      assignee: '',
      labels: ['workflow'],
      projectKey: 'OPS',
      projectName: 'Operations',
      created: '2026-05-19T00:00:00.000Z',
      updated: '2026-05-19T00:00:00.000Z',
      dueDate: '',
      sourceRef: `jira.issue:${issueKey}`
    },
    fields: [],
    fieldValues: [],
    comments: [
      {
        id: `c-${issueKey}-1`,
        body: '角色包括申请人、审批人；流程步骤要记录审计日志。',
        author: 'ops',
        created: '2026-05-19T00:00:00.000Z',
        updated: '2026-05-19T00:00:00.000Z',
        sourceRef: `jira.comment:${issueKey}:c-${issueKey}-1`
      }
    ],
    attachments: [],
    mediaEvidence: [],
    projectMetadata: null,
    relations: [],
    transitions: [],
    sourceRefs: [`jira.issue:${issueKey}`, `jira.comment:${issueKey}:c-${issueKey}-1`],
    generatedAt: '2026-05-19T00:00:00.000Z'
  };
}

function buildBillingEvidence(issueKey: string): JiraEvidencePackV2 {
  return {
    schemaVersion: 'JiraEvidencePackV2',
    issue: {
      key: issueKey,
      summary: '计费金额对不上，需核对发票与退款规则',
      description: 'billing 规则需要补充，当前仅有问题描述。',
      issueType: 'Task',
      status: 'To Do',
      priority: 'High',
      assignee: '',
      labels: ['billing'],
      projectKey: 'OPS',
      projectName: 'Operations',
      created: '2026-05-19T00:00:00.000Z',
      updated: '2026-05-19T00:00:00.000Z',
      dueDate: '',
      sourceRef: `jira.issue:${issueKey}`
    },
    fields: [],
    fieldValues: [],
    comments: [],
    attachments: [],
    mediaEvidence: [],
    projectMetadata: null,
    relations: [],
    transitions: [],
    sourceRefs: [`jira.issue:${issueKey}`],
    generatedAt: '2026-05-19T00:00:00.000Z'
  };
}

async function expectFixtureRejected(fixture: unknown): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'requirements-eval-malformed-nested-'));
  const fixturePath = join(dir, 'fixture.json');
  await writeFile(fixturePath, JSON.stringify(fixture), 'utf8');
  await expect(loadRequirementEvalDataset(fixturePath)).rejects.toThrow(
    /Invalid requirements eval fixture/
  );
}

function deepCloneUnknown(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

function getSampleRecord(fixture: unknown): Record<string, unknown> {
  const dataset = getRecord(fixture);
  const samples = getArray(dataset.samples);
  return getRecord(samples[0]);
}

function getArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error('Expected array');
  }

  return value;
}

function getRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error('Expected record');
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
