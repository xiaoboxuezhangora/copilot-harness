import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  evaluateIssueTypeRouter,
  routeIssueProfile,
  type IssueProfile,
  type IssueTypeRouterEvalSample
} from './router.js';
import type { JiraEvidencePackV2 } from '../jira/evidence.js';

interface RouterFixtureDataset {
  readonly schemaVersion: string;
  readonly samples: readonly RouterFixtureSample[];
}

interface RouterFixtureSample {
  readonly id: string;
  readonly expectedProfile: IssueProfile;
  readonly evidencePack: JiraEvidencePackV2;
}

describe('issue-type-router v0', () => {
  it('routes six profile fixtures and keeps matched sourceRef traceable', () => {
    const dataset = loadFixtureDataset();

    for (const sample of dataset.samples) {
      const result = routeIssueProfile(sample.evidencePack);

      expect(result.profile).toBe(sample.expectedProfile);
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);

      for (const signal of result.matchedSignals) {
        expect(sample.evidencePack.sourceRefs).toContain(signal.sourceRef);
      }

      expect([...new Set(result.sourceRefs)]).toEqual(result.sourceRefs);
      for (const sourceRef of result.sourceRefs) {
        expect(sample.evidencePack.sourceRefs).toContain(sourceRef);
      }
    }
  });

  it('falls back to General with low confidence when evidence is insufficient', () => {
    const result = routeIssueProfile(buildSparseEvidencePack());

    expect(result.profile).toBe('General');
    expect(result.confidence).toBeLessThanOrEqual(0.4);
    expect(result.fallbackReason).toBe('insufficient_evidence');
  });

  it('falls back to General when candidate signals are not traceable by sourceRef', () => {
    const result = routeIssueProfile(buildNoTraceableSignalPack());

    expect(result.profile).toBe('General');
    expect(result.confidence).toBeLessThanOrEqual(0.4);
    expect(result.fallbackReason).toBe('no_traceable_signal_source_ref');
    expect(result.matchedSignals).toEqual([]);
    expect(result.sourceRefs).toEqual([]);
  });

  it('reduces confidence and marks ambiguity when profile scores are close', () => {
    const result = routeIssueProfile(buildAmbiguousEvidencePack());

    expect(result.profile).toBe('General');
    expect(result.confidence).toBeLessThanOrEqual(0.4);
    expect(result.fallbackReason).toBe('ambiguous_profile_scores');
    expect(result.rationale).toContain('歧义');
  });

  it('evaluates fixture samples with top-1 accuracy and sourceRef coverage', () => {
    const dataset = loadFixtureDataset();
    const evalSamples: readonly IssueTypeRouterEvalSample[] = dataset.samples.map((sample) => ({
      id: sample.id,
      expectedProfile: sample.expectedProfile,
      evidencePack: sample.evidencePack
    }));

    const result = evaluateIssueTypeRouter(evalSamples);

    expect(result.sampleCount).toBe(dataset.samples.length);
    expect(result.top1Accuracy).toBe(1);
    expect(result.sourceRefCoverage).toBe(1);
    expect(result.failures).toEqual([]);
  });
});

function loadFixtureDataset(): RouterFixtureDataset {
  const fixturePath = new URL('../../fixtures/requirements/issue-type-router-v0-samples.json', import.meta.url);
  const parsed: unknown = JSON.parse(readFileSync(fixturePath, 'utf8'));
  if (!isFixtureDataset(parsed)) {
    throw new Error('Invalid router fixture dataset');
  }

  return parsed;
}

function isFixtureDataset(value: unknown): value is RouterFixtureDataset {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value.schemaVersion !== 'string' || !Array.isArray(value.samples)) {
    return false;
  }

  return value.samples.every((sample) => {
    if (!isRecord(sample)) {
      return false;
    }

    return (
      typeof sample.id === 'string' &&
      isIssueProfile(sample.expectedProfile) &&
      isJiraEvidencePack(sample.evidencePack)
    );
  });
}

function isIssueProfile(value: unknown): value is IssueProfile {
  return (
    value === 'Visual' ||
    value === 'Integration' ||
    value === 'Workflow' ||
    value === 'Billing' ||
    value === 'AccessControl' ||
    value === 'General'
  );
}

function isJiraEvidencePack(value: unknown): value is JiraEvidencePackV2 {
  if (!isRecord(value)) {
    return false;
  }

  if (value.schemaVersion !== 'JiraEvidencePackV2') {
    return false;
  }

  return (
    isRecord(value.issue) &&
    Array.isArray(value.fields) &&
    Array.isArray(value.fieldValues) &&
    Array.isArray(value.comments) &&
    Array.isArray(value.attachments) &&
    Array.isArray(value.mediaEvidence) &&
    Array.isArray(value.relations) &&
    Array.isArray(value.transitions) &&
    Array.isArray(value.sourceRefs) &&
    typeof value.generatedAt === 'string'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function buildSparseEvidencePack(): JiraEvidencePackV2 {
  return {
    schemaVersion: 'JiraEvidencePackV2',
    issue: {
      key: 'OPS-301',
      summary: '整理说明文档',
      description: '补充文案，不涉及特定业务。',
      issueType: 'Task',
      status: 'To Do',
      priority: 'Low',
      assignee: '',
      labels: ['docs'],
      projectKey: 'OPS',
      projectName: 'Operations',
      created: '',
      updated: '',
      dueDate: '',
      sourceRef: 'jira.issue:OPS-301'
    },
    fields: [],
    fieldValues: [],
    comments: [],
    attachments: [],
    mediaEvidence: [],
    projectMetadata: null,
    relations: [],
    transitions: [],
    sourceRefs: ['jira.issue:OPS-301'],
    generatedAt: '2026-05-19T00:00:00.000Z'
  };
}

function buildNoTraceableSignalPack(): JiraEvidencePackV2 {
  return {
    schemaVersion: 'JiraEvidencePackV2',
    issue: {
      key: 'OPS-302',
      summary: '页面空白且按钮错位',
      description: '视觉回归。',
      issueType: 'Bug',
      status: 'To Do',
      priority: 'High',
      assignee: '',
      labels: ['frontend'],
      projectKey: 'OPS',
      projectName: 'Operations',
      created: '',
      updated: '',
      dueDate: '',
      sourceRef: 'jira.issue:OPS-302'
    },
    fields: [],
    fieldValues: [],
    comments: [],
    attachments: [
      {
        id: 'att-302',
        filename: 'screenshot.png',
        mimeType: 'image/png',
        size: 100,
        sourceRef: 'jira.attachment:OPS-302:att-302',
        securityDigest: null
      }
    ],
    mediaEvidence: [],
    projectMetadata: null,
    relations: [],
    transitions: [],
    sourceRefs: [],
    generatedAt: '2026-05-19T00:00:00.000Z'
  };
}

function buildAmbiguousEvidencePack(): JiraEvidencePackV2 {
  return {
    schemaVersion: 'JiraEvidencePackV2',
    issue: {
      key: 'OPS-303',
      summary: '支付认证冲突',
      description: '',
      issueType: 'Task',
      status: 'To Do',
      priority: 'High',
      assignee: '',
      labels: [],
      projectKey: 'OPS',
      projectName: 'Operations',
      created: '',
      updated: '',
      dueDate: '',
      sourceRef: 'jira.issue:OPS-303'
    },
    fields: [],
    fieldValues: [
      {
        fieldKey: 'defectCategory',
        valueKind: 'string',
        valueString: 'billing auth',
        sourceRef: 'jira.field-value:OPS-303:defectCategory'
      }
    ],
    comments: [],
    attachments: [],
    mediaEvidence: [],
    projectMetadata: null,
    relations: [],
    transitions: [],
    sourceRefs: [
      'jira.issue:OPS-303',
      'jira.field-value:OPS-303:defectCategory'
    ],
    generatedAt: '2026-05-19T00:00:00.000Z'
  };
}
