import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { JiraEvidencePackV2 } from '../jira/evidence.js';
import {
  buildRequirementProfileSpecV0,
  type BuildRequirementProfileSpecInput,
  type RequirementProfileGapV0,
  type RequirementProfileSpecResultV0
} from './profiles.js';
import type { IssueProfile, IssueTypeRouterResult } from './router.js';

interface ProfileFixtureDataset {
  readonly schemaVersion: string;
  readonly samples: readonly ProfileFixtureSample[];
}

interface ProfileFixtureSample {
  readonly id: string;
  readonly expectedProfile: IssueProfile;
  readonly evidencePack: JiraEvidencePackV2;
}

describe('requirement-profile-spec v0', () => {
  it('builds VisualDefectSpecV0 with screenshot evidence and complete traceability', () => {
    const sample = findSample('visual-spec-ready-01');
    const result = buildRequirementProfileSpecV0({ evidencePack: sample.evidencePack });

    expect(result.profile).toBe('Visual');
    expect(result.status).toBe('spec_ready');
    expect(result.spec.kind).toBe('VisualDefectSpecV0');

    if (result.spec.kind !== 'VisualDefectSpecV0') {
      throw new Error('Unexpected spec kind');
    }

    expect(result.spec.visualEvidence.length).toBeGreaterThan(0);
    expect(result.spec.viewport.length).toBeGreaterThan(0);
    expect(result.spec.baselineEvidence.length).toBeGreaterThan(0);
    expect(result.spec.acceptanceAssertions.length).toBeGreaterThan(0);
    expect(result.gaps).toEqual([]);

    assertTraceable(result, sample.evidencePack);
  });

  it('keeps Visual profile as gap_blocked when baseline or viewport evidence is missing', () => {
    const sample = findSample('visual-gap-01');
    const result = buildRequirementProfileSpecV0({ evidencePack: sample.evidencePack });

    expect(result.profile).toBe('Visual');
    expect(result.status).toBe('gap_blocked');
    expect(result.spec.kind).toBe('VisualDefectSpecV0');

    const fields = result.gaps.map((gap) => gap.field);
    expect(fields).toContain('baselineEvidence');
    expect(fields).toContain('viewport');

    if (result.spec.kind !== 'VisualDefectSpecV0') {
      throw new Error('Unexpected spec kind');
    }

    expect(result.spec.visualEvidence.length).toBeGreaterThan(0);
    assertTraceable(result, sample.evidencePack);
  });

  it('builds IntegrationSpecV0 and blocks when upstream/downstream or contract details are incomplete', () => {
    const sample = findSample('integration-gap-01');
    const result = buildRequirementProfileSpecV0({ evidencePack: sample.evidencePack });

    expect(result.profile).toBe('Integration');
    expect(result.status).toBe('gap_blocked');
    expect(result.spec.kind).toBe('IntegrationSpecV0');

    if (result.spec.kind !== 'IntegrationSpecV0') {
      throw new Error('Unexpected spec kind');
    }

    expect(result.spec.apiContract.length).toBeGreaterThan(0);
    expect(result.spec.fieldMapping.length).toBeGreaterThan(0);
    expect(result.spec.failureHandling.length).toBeGreaterThan(0);

    const fields = result.gaps.map((gap) => gap.field);
    expect(fields).toContain('downstreamSystem');
    assertTraceable(result, sample.evidencePack);
  });

  it('builds IntegrationSpecV0 as spec_ready and includes acceptance assertion sourceRef in result.sourceRefs', () => {
    const sample = findSample('integration-spec-ready-01');
    const assertionSourceRef = 'jira.comment:OPS-408:c-408-1';
    const result = buildRequirementProfileSpecV0({ evidencePack: sample.evidencePack });

    expect(result.profile).toBe('Integration');
    expect(result.status).toBe('spec_ready');
    expect(result.spec.kind).toBe('IntegrationSpecV0');

    if (result.spec.kind !== 'IntegrationSpecV0') {
      throw new Error('Unexpected spec kind');
    }

    expect(result.spec.upstreamSystem.length).toBeGreaterThan(0);
    expect(result.spec.downstreamSystem.length).toBeGreaterThan(0);
    expect(result.spec.apiContract.length).toBeGreaterThan(0);
    expect(result.spec.fieldMapping.length).toBeGreaterThan(0);
    expect(result.spec.acceptanceAssertions.length).toBeGreaterThan(0);
    expect(result.spec.acceptanceAssertions.map((item) => item.sourceRef)).toContain(assertionSourceRef);
    expect(result.sourceRefs).toContain(assertionSourceRef);
    expect(result.gaps).toEqual([]);
    assertTraceable(result, sample.evidencePack);
  });

  it('builds WorkflowRequirementSpecV0 with role/trigger/steps/rules signals', () => {
    const sample = findSample('workflow-spec-ready-01');
    const result = buildRequirementProfileSpecV0({ evidencePack: sample.evidencePack });

    expect(result.profile).toBe('Workflow');
    expect(result.status).toBe('spec_ready');
    expect(result.spec.kind).toBe('WorkflowRequirementSpecV0');

    if (result.spec.kind !== 'WorkflowRequirementSpecV0') {
      throw new Error('Unexpected spec kind');
    }

    expect(result.spec.roles.length).toBeGreaterThan(0);
    expect(result.spec.triggerConditions.length).toBeGreaterThan(0);
    expect(result.spec.processSteps.length).toBeGreaterThan(0);
    expect(result.spec.businessRules.length).toBeGreaterThan(0);
    expect(result.spec.acceptanceAssertions.length).toBeGreaterThan(0);
    assertTraceable(result, sample.evidencePack);
  });

  it('creates Workflow gaps when routerResult forces Workflow but evidence lacks mandatory fields', () => {
    const sparseWorkflowEvidence = buildSparseWorkflowEvidencePack();
    const routerResult: IssueTypeRouterResult = {
      profile: 'Workflow',
      confidence: 0.91,
      matchedSignals: [
        {
          kind: 'summary_keyword',
          profile: 'Workflow',
          value: '流程',
          weight: 1.2,
          sourceRef: sparseWorkflowEvidence.issue.sourceRef
        }
      ],
      sourceRefs: [sparseWorkflowEvidence.issue.sourceRef],
      rationale: 'workflow keyword',
      fallbackReason: null
    };

    const result = buildRequirementProfileSpecV0({
      evidencePack: sparseWorkflowEvidence,
      routerResult
    });

    expect(result.profile).toBe('Workflow');
    expect(result.status).toBe('gap_blocked');
    expect(result.spec.kind).toBe('WorkflowRequirementSpecV0');
    expect(result.gaps.map((gap) => gap.field)).toEqual(
      expect.arrayContaining([
        'roles',
        'triggerConditions',
        'processSteps',
        'businessRules',
        'exceptionPaths',
        'auditTrail',
        'acceptanceAssertions'
      ])
    );

    assertTraceable(result, sparseWorkflowEvidence);
  });

  it('returns unsupported_profile for Billing/AccessControl/General instead of forcing three supported specs', () => {
    const billingSample = findSample('billing-unsupported-01');
    const billingResult = buildRequirementProfileSpecV0({ evidencePack: billingSample.evidencePack });
    expect(billingResult.profile).toBe('Billing');
    expect(billingResult.status).toBe('unsupported_profile');
    expect(billingResult.spec.kind).toBe('UnsupportedProfileSpecV0');

    const generalResult = buildRequirementProfileSpecV0({ evidencePack: buildSparseGeneralEvidencePack() });
    expect(generalResult.profile).toBe('General');
    expect(generalResult.status).toBe('unsupported_profile');
    expect(generalResult.spec.kind).toBe('UnsupportedProfileSpecV0');

    assertTraceable(billingResult, billingSample.evidencePack);
    assertTraceable(generalResult, buildSparseGeneralEvidencePack());
  });

  it('deduplicates result.sourceRefs and keeps all trace refs inside evidencePack.sourceRefs', () => {
    const fixture = loadFixtureDataset();

    for (const sample of fixture.samples) {
      const input: BuildRequirementProfileSpecInput = { evidencePack: sample.evidencePack };
      const result = buildRequirementProfileSpecV0(input);

      assertTraceable(result, sample.evidencePack);
      expect(result.sourceRefs).toEqual([...new Set(result.sourceRefs)]);
    }
  });
});

function loadFixtureDataset(): ProfileFixtureDataset {
  const fixturePath = new URL('../../fixtures/requirements/profile-spec-v0-samples.json', import.meta.url);
  const parsed: unknown = JSON.parse(readFileSync(fixturePath, 'utf8'));
  if (!isFixtureDataset(parsed)) {
    throw new Error('Invalid profile fixture dataset');
  }

  return parsed;
}

function findSample(id: string): ProfileFixtureSample {
  const dataset = loadFixtureDataset();
  const sample = dataset.samples.find((item) => item.id === id);
  if (sample === undefined) {
    throw new Error(`Missing fixture sample: ${id}`);
  }

  return sample;
}

function assertTraceable(result: RequirementProfileSpecResultV0, evidencePack: JiraEvidencePackV2): void {
  const evidenceRefs = new Set(evidencePack.sourceRefs);
  const traceRefs = [...collectSpecRefs(result), ...result.gaps.flatMap((gap) => gap.sourceRefs)];

  for (const sourceRef of traceRefs) {
    expect(evidenceRefs.has(sourceRef)).toBe(true);
  }

  for (const gap of result.gaps) {
    assertGap(gap, evidenceRefs);
  }

  for (const sourceRef of result.sourceRefs) {
    expect(evidenceRefs.has(sourceRef)).toBe(true);
  }

  const deduped = [...new Set(traceRefs)].sort();
  expect([...result.sourceRefs].sort()).toEqual([...new Set(result.sourceRefs)].sort());
  expect([...result.sourceRefs].sort()).toEqual(deduped);
}

function collectSpecRefs(result: RequirementProfileSpecResultV0): readonly string[] {
  const spec = result.spec;

  if (spec.kind === 'UnsupportedProfileSpecV0') {
    return spec.sourceRefs;
  }

  if (spec.kind === 'VisualDefectSpecV0') {
    return [
      ...spec.pageOrComponent.map((item) => item.sourceRef),
      ...spec.actualBehavior.map((item) => item.sourceRef),
      ...spec.expectedBehavior.map((item) => item.sourceRef),
      ...spec.visualEvidence.map((item) => item.sourceRef),
      ...spec.baselineEvidence.map((item) => item.sourceRef),
      ...spec.viewport.map((item) => item.sourceRef),
      ...spec.acceptanceAssertions.map((item) => item.sourceRef)
    ];
  }

  if (spec.kind === 'IntegrationSpecV0') {
    return [
      ...spec.upstreamSystem.map((item) => item.sourceRef),
      ...spec.downstreamSystem.map((item) => item.sourceRef),
      ...spec.apiContract.map((item) => item.sourceRef),
      ...spec.fieldMapping.map((item) => item.sourceRef),
      ...spec.authBoundary.map((item) => item.sourceRef),
      ...spec.failureHandling.map((item) => item.sourceRef),
      ...spec.testFixtures.map((item) => item.sourceRef),
      ...spec.acceptanceAssertions.map((item) => item.sourceRef)
    ];
  }

  return [
    ...spec.roles.map((item) => item.sourceRef),
    ...spec.triggerConditions.map((item) => item.sourceRef),
    ...spec.processSteps.map((item) => item.sourceRef),
    ...spec.businessRules.map((item) => item.sourceRef),
    ...spec.exceptionPaths.map((item) => item.sourceRef),
    ...spec.auditTrail.map((item) => item.sourceRef),
    ...spec.acceptanceAssertions.map((item) => item.sourceRef)
  ];
}

function assertGap(gap: RequirementProfileGapV0, evidenceRefs: ReadonlySet<string>): void {
  for (const sourceRef of gap.sourceRefs) {
    expect(evidenceRefs.has(sourceRef)).toBe(true);
  }

  expect(gap.field.length).toBeGreaterThan(0);
  expect(gap.reason.length).toBeGreaterThan(0);
  expect(gap.clarificationQuestion.length).toBeGreaterThan(0);
}

function isFixtureDataset(value: unknown): value is ProfileFixtureDataset {
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

  return (
    value.schemaVersion === 'JiraEvidencePackV2' &&
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

function buildSparseWorkflowEvidencePack(): JiraEvidencePackV2 {
  return {
    schemaVersion: 'JiraEvidencePackV2',
    issue: {
      key: 'OPS-406',
      summary: '改进建议',
      description: '当前方案需要优化。',
      issueType: 'Task',
      status: 'To Do',
      priority: 'Low',
      assignee: '',
      labels: ['workflow'],
      projectKey: 'OPS',
      projectName: 'Operations',
      created: '',
      updated: '',
      dueDate: '',
      sourceRef: 'jira.issue:OPS-406'
    },
    fields: [],
    fieldValues: [],
    comments: [],
    attachments: [],
    mediaEvidence: [],
    projectMetadata: null,
    relations: [],
    transitions: [],
    sourceRefs: ['jira.issue:OPS-406'],
    generatedAt: '2026-05-19T00:00:00.000Z'
  };
}

function buildSparseGeneralEvidencePack(): JiraEvidencePackV2 {
  return {
    schemaVersion: 'JiraEvidencePackV2',
    issue: {
      key: 'OPS-407',
      summary: '优化文案描述',
      description: '补充提示文案，不涉及特定业务。',
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
      sourceRef: 'jira.issue:OPS-407'
    },
    fields: [],
    fieldValues: [],
    comments: [],
    attachments: [],
    mediaEvidence: [],
    projectMetadata: null,
    relations: [],
    transitions: [],
    sourceRefs: ['jira.issue:OPS-407'],
    generatedAt: '2026-05-19T00:00:00.000Z'
  };
}
