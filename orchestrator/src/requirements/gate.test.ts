import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { JiraEvidencePackV2 } from '../jira/evidence.js';
import {
  buildRequirementGateV0,
  type RequirementGateResultV0
} from './gate.js';
import { buildRequirementProfileSpecV0 } from './profiles.js';
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

describe('requirement gate v0', () => {
  it('returns green investigation_ready and implementation_ready for complete Visual profile', () => {
    const sample = findSample('visual-spec-ready-01');
    const result = buildRequirementGateV0({ evidencePack: sample.evidencePack });

    expect(result.profile).toBe('Visual');
    expect(result.investigationReady.light).toBe('green');
    expect(result.implementationReady.light).toBe('green');
    expect(result.hardBlocks).toEqual([]);

    assertTraceableAndDeduped(result, sample.evidencePack);
  });

  it('blocks Visual profile when jira.media evidence is not attachment-backed', () => {
    const sample = findSample('visual-spec-ready-01');
    const evidencePack = withUnbackedVisualMedia(sample.evidencePack);

    const result = buildRequirementGateV0({ evidencePack });

    expect(result.profile).toBe('Visual');
    expect(result.investigationReady.light).toBe('red');
    expect(result.implementationReady.light).toBe('red');
    expect(result.hardBlocks.map((block) => block.ruleId)).toContain(
      'REQ-HARD-002-VISUAL-MEDIA-ATTACHMENT-BACKING'
    );
    expect(result.gaps.some((gap) => gap.field === 'visualEvidence.attachmentBacked')).toBe(true);

    assertTraceableAndDeduped(result, evidencePack);
  });

  it('returns green lights for complete Integration profile', () => {
    const sample = findSample('integration-spec-ready-01');
    const result = buildRequirementGateV0({ evidencePack: sample.evidencePack });

    expect(result.profile).toBe('Integration');
    expect(result.investigationReady.light).toBe('green');
    expect(result.implementationReady.light).toBe('green');
    expect(result.hardBlocks).toEqual([]);

    assertTraceableAndDeduped(result, sample.evidencePack);
  });

  it('keeps external profileSpecResult green path when sourceRefs fully match evidencePack', () => {
    const sample = findSample('integration-spec-ready-01');
    const profileSpecResult = buildRequirementProfileSpecV0({ evidencePack: sample.evidencePack });

    const result = buildRequirementGateV0({
      evidencePack: sample.evidencePack,
      profileSpecResult
    });

    expect(result.investigationReady.light).toBe('green');
    expect(result.implementationReady.light).toBe('green');
    expect(findAxis(result.implementationReady, 'Profile').light).toBe('green');
    expect(result.gaps.map((gap) => gap.field)).not.toContain('profileSpecSourceRefs');
    expect(
      result.auditPayload.ruleEvaluations.find(
        (rule) => rule.ruleId === 'REQ-HARD-004-PROFILE-SPEC-SOURCE-REF-MISMATCH'
      )?.passed
    ).toBe(true);

    assertTraceableAndDeduped(result, sample.evidencePack);
  });

  it('blocks implementation green when external profileSpecResult sourceRefs mismatch evidencePack', () => {
    const sample = findSample('visual-spec-ready-01');
    const baselineSpecResult = buildRequirementProfileSpecV0({ evidencePack: sample.evidencePack });
    const mismatchedProfileSpecResult = withMismatchedProfileSpecSourceRefs(baselineSpecResult);

    const result = buildRequirementGateV0({
      evidencePack: sample.evidencePack,
      profileSpecResult: mismatchedProfileSpecResult
    });

    expect(result.implementationReady.light).not.toBe('green');
    expect(findAxis(result.implementationReady, 'Profile').light).toBe('red');
    expect(result.gaps.map((gap) => gap.field)).toContain('profileSpecSourceRefs');
    expect(
      result.auditPayload.ruleEvaluations.find(
        (rule) => rule.ruleId === 'REQ-HARD-004-PROFILE-SPEC-SOURCE-REF-MISMATCH'
      )?.passed
    ).toBe(false);

    const illegalPrefix = 'jira.fake:';
    expect(result.sourceRefs.some((sourceRef) => sourceRef.startsWith(illegalPrefix))).toBe(false);
    expect(result.auditPayload.sourceRefs.some((sourceRef) => sourceRef.startsWith(illegalPrefix))).toBe(
      false
    );
    expect(
      result.gaps.some((gap) => gap.sourceRefs.some((sourceRef) => sourceRef.startsWith(illegalPrefix)))
    ).toBe(false);
    expect(
      result.hardBlocks.some((block) => block.sourceRefs.some((sourceRef) => sourceRef.startsWith(illegalPrefix)))
    ).toBe(false);

    assertTraceableAndDeduped(result, sample.evidencePack);
  });

  it('keeps Integration implementation_ready non-green when fieldMapping/assertions are missing', () => {
    const sample = findSample('integration-spec-ready-01');
    const evidencePack = removeIntegrationMappingAndAssertions(sample.evidencePack);

    const result = buildRequirementGateV0({ evidencePack });

    expect(result.profile).toBe('Integration');
    expect(result.implementationReady.light).not.toBe('green');
    expect(result.gaps.map((gap) => gap.field)).toContain('fieldMapping');
    expect(result.gaps.map((gap) => gap.field)).toContain('acceptanceAssertions');

    assertTraceableAndDeduped(result, evidencePack);
  });

  it('returns green lights for complete Workflow profile', () => {
    const sample = findSample('workflow-spec-ready-01');
    const result = buildRequirementGateV0({ evidencePack: sample.evidencePack });

    expect(result.profile).toBe('Workflow');
    expect(result.investigationReady.light).toBe('green');
    expect(result.implementationReady.light).toBe('green');

    assertTraceableAndDeduped(result, sample.evidencePack);
  });

  it('keeps Workflow implementation_ready non-green when role/trigger/steps/assertions are missing', () => {
    const evidencePack = buildSparseWorkflowEvidencePack();
    const routerResult: IssueTypeRouterResult = {
      profile: 'Workflow',
      confidence: 0.92,
      matchedSignals: [
        {
          kind: 'summary_keyword',
          profile: 'Workflow',
          value: '流程',
          weight: 1.2,
          sourceRef: evidencePack.issue.sourceRef
        }
      ],
      sourceRefs: [evidencePack.issue.sourceRef],
      rationale: 'workflow keyword',
      fallbackReason: null
    };

    const profileSpecResult = buildRequirementProfileSpecV0({ evidencePack, routerResult });
    const result = buildRequirementGateV0({
      evidencePack,
      profileSpecResult,
      routerResult
    });

    expect(result.profile).toBe('Workflow');
    expect(result.implementationReady.light).not.toBe('green');
    expect(result.gaps.map((gap) => gap.field)).toEqual(
      expect.arrayContaining(['roles', 'triggerConditions', 'processSteps', 'acceptanceAssertions'])
    );

    assertTraceableAndDeduped(result, evidencePack);
  });

  it('does not force Billing/General profile to green', () => {
    const billingSample = findSample('billing-unsupported-01');
    const billingResult = buildRequirementGateV0({ evidencePack: billingSample.evidencePack });

    expect(billingResult.profile).toBe('Billing');
    expect(billingResult.investigationReady.light).not.toBe('green');
    expect(billingResult.implementationReady.light).not.toBe('green');
    expect(billingResult.gaps.map((gap) => gap.field)).toContain('profileSupport');

    const generalEvidencePack = buildSparseGeneralEvidencePack();
    const generalResult = buildRequirementGateV0({ evidencePack: generalEvidencePack });

    expect(generalResult.profile).toBe('General');
    expect(generalResult.investigationReady.light).not.toBe('green');
    expect(generalResult.implementationReady.light).not.toBe('green');
    expect(generalResult.gaps.map((gap) => gap.field)).toContain('profileSupport');

    assertTraceableAndDeduped(billingResult, billingSample.evidencePack);
    assertTraceableAndDeduped(generalResult, generalEvidencePack);
  });

  it('adds hard block when attemptedJiraWrite=true', () => {
    const sample = findSample('visual-spec-ready-01');
    const result = buildRequirementGateV0({
      evidencePack: sample.evidencePack,
      runtimeFlags: {
        attemptedJiraWrite: true
      }
    });

    expect(result.hardBlocks.map((block) => block.ruleId)).toContain('REQ-HARD-001-NO-JIRA-WRITE');
    expect(result.investigationReady.light).toBe('red');
    expect(result.implementationReady.light).toBe('red');
    expect(result.gaps.map((gap) => gap.field)).toContain('attemptedJiraWrite');

    assertTraceableAndDeduped(result, sample.evidencePack);
  });

  it('keeps implementation_ready non-green when highRiskMedicalDomain=true', () => {
    const sample = findSample('integration-spec-ready-01');
    const result = buildRequirementGateV0({
      evidencePack: sample.evidencePack,
      runtimeFlags: {
        highRiskMedicalDomain: true
      }
    });

    expect(result.investigationReady.light).toBe('yellow');
    expect(result.implementationReady.light).not.toBe('green');
    expect(result.hardBlocks.map((block) => block.ruleId)).toContain(
      'REQ-HARD-003-HIGH-RISK-MEDICAL-MANUAL-REVIEW'
    );
    expect(result.gaps.map((gap) => gap.field)).toContain('highRiskMedicalDomain');

    assertTraceableAndDeduped(result, sample.evidencePack);
  });

  it('keeps every gap/sourceRefs/auditPayload sourceRef traceable and deduplicated', () => {
    const sample = findSample('visual-spec-ready-01');
    const evidencePack = withUnbackedVisualMedia(sample.evidencePack);
    const result = buildRequirementGateV0({
      evidencePack,
      runtimeFlags: {
        highRiskMedicalDomain: true,
        attemptedJiraWrite: true
      }
    });

    assertTraceableAndDeduped(result, evidencePack);
    expect(result.auditPayload.sourceRefs).toEqual([...new Set(result.auditPayload.sourceRefs)]);
    expect(result.gaps.every((gap) => gap.sourceRefs.length > 0)).toBe(true);
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

function withUnbackedVisualMedia(evidencePack: JiraEvidencePackV2): JiraEvidencePackV2 {
  const mediaSourceRef = `jira.media:${evidencePack.issue.key}:att-missing`;

  return {
    ...evidencePack,
    mediaEvidence: [
      ...evidencePack.mediaEvidence,
      {
        attachmentId: 'att-missing',
        filename: 'ui-regression.png',
        mimeType: 'image/png',
        byteLength: 1024,
        truncated: false,
        sourceRef: mediaSourceRef
      }
    ],
    sourceRefs: [...new Set([...evidencePack.sourceRefs, mediaSourceRef])]
  };
}

function removeIntegrationMappingAndAssertions(evidencePack: JiraEvidencePackV2): JiraEvidencePackV2 {
  const issue = {
    ...evidencePack.issue,
    summary: '上游 CRM webhook 与下游 HIS 同步需求',
    description: '上游 CRM webhook API 推送报文到下游 HIS，token 签名失败后触发重试。'
  };

  const comment = {
    id: 'c-override-1',
    body: '接口字段待确认。',
    author: 'qa',
    created: '2026-05-19T00:00:00.000Z',
    updated: '2026-05-19T00:00:00.000Z',
    sourceRef: `jira.comment:${evidencePack.issue.key}:c-override-1`
  } as const;

  return {
    ...evidencePack,
    issue,
    comments: [comment],
    sourceRefs: [...new Set([issue.sourceRef, comment.sourceRef, ...evidencePack.sourceRefs])]
  };
}

function withMismatchedProfileSpecSourceRefs(
  profileSpecResult: ReturnType<typeof buildRequirementProfileSpecV0>
): ReturnType<typeof buildRequirementProfileSpecV0> {
  const fakeRef = 'jira.fake:external-profile-spec';
  const remapTraceableItems = <T extends { sourceRef: string }>(items: readonly T[]): readonly T[] =>
    items.map((item) => ({ ...item, sourceRef: fakeRef }));

  const spec = profileSpecResult.spec;
  if (spec.kind === 'VisualDefectSpecV0') {
    return {
      ...profileSpecResult,
      sourceRefs: [fakeRef],
      gaps: profileSpecResult.gaps.map((gap) => ({ ...gap, sourceRefs: [fakeRef] })),
      spec: {
        ...spec,
        pageOrComponent: remapTraceableItems(spec.pageOrComponent),
        actualBehavior: remapTraceableItems(spec.actualBehavior),
        expectedBehavior: remapTraceableItems(spec.expectedBehavior),
        visualEvidence: remapTraceableItems(spec.visualEvidence),
        baselineEvidence: remapTraceableItems(spec.baselineEvidence),
        viewport: remapTraceableItems(spec.viewport),
        acceptanceAssertions: remapTraceableItems(spec.acceptanceAssertions)
      }
    };
  }

  if (spec.kind === 'IntegrationSpecV0') {
    return {
      ...profileSpecResult,
      sourceRefs: [fakeRef],
      gaps: profileSpecResult.gaps.map((gap) => ({ ...gap, sourceRefs: [fakeRef] })),
      spec: {
        ...spec,
        upstreamSystem: remapTraceableItems(spec.upstreamSystem),
        downstreamSystem: remapTraceableItems(spec.downstreamSystem),
        apiContract: remapTraceableItems(spec.apiContract),
        fieldMapping: remapTraceableItems(spec.fieldMapping),
        authBoundary: remapTraceableItems(spec.authBoundary),
        failureHandling: remapTraceableItems(spec.failureHandling),
        testFixtures: remapTraceableItems(spec.testFixtures),
        acceptanceAssertions: remapTraceableItems(spec.acceptanceAssertions)
      }
    };
  }

  if (spec.kind === 'WorkflowRequirementSpecV0') {
    return {
      ...profileSpecResult,
      sourceRefs: [fakeRef],
      gaps: profileSpecResult.gaps.map((gap) => ({ ...gap, sourceRefs: [fakeRef] })),
      spec: {
        ...spec,
        roles: remapTraceableItems(spec.roles),
        triggerConditions: remapTraceableItems(spec.triggerConditions),
        processSteps: remapTraceableItems(spec.processSteps),
        businessRules: remapTraceableItems(spec.businessRules),
        exceptionPaths: remapTraceableItems(spec.exceptionPaths),
        auditTrail: remapTraceableItems(spec.auditTrail),
        acceptanceAssertions: remapTraceableItems(spec.acceptanceAssertions)
      }
    };
  }

  return {
    ...profileSpecResult,
    sourceRefs: [fakeRef],
    gaps: profileSpecResult.gaps.map((gap) => ({ ...gap, sourceRefs: [fakeRef] })),
    spec: {
      ...spec,
      sourceRefs: [fakeRef]
    }
  };
}

function findAxis(
  layer: RequirementGateResultV0['investigationReady'] | RequirementGateResultV0['implementationReady'],
  axis: RequirementGateResultV0['implementationReady']['axisResults'][number]['axis']
): RequirementGateResultV0['implementationReady']['axisResults'][number] {
  const result = layer.axisResults.find((item) => item.axis === axis);
  if (result === undefined) {
    throw new Error(`Missing axis ${axis}`);
  }

  return result;
}

function buildSparseWorkflowEvidencePack(): JiraEvidencePackV2 {
  return {
    schemaVersion: 'JiraEvidencePackV2',
    issue: {
      key: 'OPS-406',
      summary: '二审卡住问题',
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
      summary: '文案优化',
      description: '补充提示文案，不涉及具体系统流程。',
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

function assertTraceableAndDeduped(result: RequirementGateResultV0, evidencePack: JiraEvidencePackV2): void {
  const evidenceRefs = new Set(evidencePack.sourceRefs);

  for (const sourceRef of result.sourceRefs) {
    expect(evidenceRefs.has(sourceRef)).toBe(true);
  }
  expect(result.sourceRefs).toEqual([...new Set(result.sourceRefs)]);

  for (const sourceRef of result.investigationReady.sourceRefs) {
    expect(evidenceRefs.has(sourceRef)).toBe(true);
  }
  for (const sourceRef of result.implementationReady.sourceRefs) {
    expect(evidenceRefs.has(sourceRef)).toBe(true);
  }

  for (const axis of result.investigationReady.axisResults) {
    expect(axis.sourceRefs).toEqual([...new Set(axis.sourceRefs)]);
    for (const sourceRef of axis.sourceRefs) {
      expect(evidenceRefs.has(sourceRef)).toBe(true);
    }
  }

  for (const axis of result.implementationReady.axisResults) {
    expect(axis.sourceRefs).toEqual([...new Set(axis.sourceRefs)]);
    for (const sourceRef of axis.sourceRefs) {
      expect(evidenceRefs.has(sourceRef)).toBe(true);
    }
  }

  for (const gap of result.gaps) {
    expect(gap.sourceRefs).toEqual([...new Set(gap.sourceRefs)]);
    for (const sourceRef of gap.sourceRefs) {
      expect(evidenceRefs.has(sourceRef)).toBe(true);
    }
  }

  for (const hardBlock of result.hardBlocks) {
    expect(hardBlock.sourceRefs).toEqual([...new Set(hardBlock.sourceRefs)]);
    for (const sourceRef of hardBlock.sourceRefs) {
      expect(evidenceRefs.has(sourceRef)).toBe(true);
    }
  }

  for (const sourceRef of result.auditPayload.sourceRefs) {
    expect(evidenceRefs.has(sourceRef)).toBe(true);
  }

  for (const rule of result.auditPayload.ruleEvaluations) {
    expect(rule.sourceRefs).toEqual([...new Set(rule.sourceRefs)]);
    for (const sourceRef of rule.sourceRefs) {
      expect(evidenceRefs.has(sourceRef)).toBe(true);
    }
  }
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
