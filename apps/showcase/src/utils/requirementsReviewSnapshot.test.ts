import { describe, expect, it } from 'vitest';

import requirementsReviewSnapshot from '../generated/requirements-review-snapshot.json';
import type { RequirementsReviewSnapshotV1 } from '../types';

const snapshot = requirementsReviewSnapshot as RequirementsReviewSnapshotV1;
const canonicalJiraSourceRefPattern =
  /^jira\.(issue|comment|attachment|field|field-value|media):[^:\s]+(?::[^:\s]+)?$/;
const canonicalReqGateAxes = new Set(['Goal', 'Evidence', 'Scope', 'Testability', 'Profile', 'Policy']);
const canonicalHardRules = new Set([
  'REQ-HARD-001-NO-JIRA-WRITE',
  'REQ-HARD-002-VISUAL-MEDIA-ATTACHMENT-BACKING',
  'REQ-HARD-003-HIGH-RISK-MEDICAL-MANUAL-REVIEW',
  'REQ-HARD-004-PROFILE-SPEC-SOURCE-REF-MISMATCH',
]);

function aggregateLightFromAxes(lights: Array<'green' | 'yellow' | 'red'>): 'green' | 'yellow' | 'red' {
  if (lights.includes('red')) return 'red';
  if (lights.includes('yellow')) return 'yellow';
  return 'green';
}

function collectSourceRefs(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectSourceRefs(item));
  }
  if (value !== null && typeof value === 'object') {
    const refs: string[] = [];
    for (const [key, nested] of Object.entries(value)) {
      if (key === 'sourceRef' && typeof nested === 'string') {
        refs.push(nested);
        continue;
      }
      if ((key === 'sourceRefs' || key === 'highlights') && Array.isArray(nested)) {
        refs.push(...nested.filter((item): item is string => typeof item === 'string'));
        continue;
      }
      refs.push(...collectSourceRefs(nested));
    }
    return refs;
  }
  return [];
}

describe('requirements review snapshot fixture', () => {
  it('contains all 3 required spec kinds', () => {
    const profileTypes = new Set(snapshot.samples.map((sample) => sample.profileSpecResult.spec.kind));
    expect(profileTypes.has('VisualDefectSpecV0')).toBe(true);
    expect(profileTypes.has('IntegrationSpecV0')).toBe(true);
    expect(profileTypes.has('WorkflowRequirementSpecV0')).toBe(true);
  });

  it('visual sample includes attachment sourceRef', () => {
    const visualSample = snapshot.samples.find(
      (sample) => sample.profileSpecResult.spec.kind === 'VisualDefectSpecV0',
    );
    expect(visualSample).toBeTruthy();
    expect(visualSample?.profileSpecResult.spec.kind).toBe('VisualDefectSpecV0');

    if (visualSample?.profileSpecResult.spec.kind !== 'VisualDefectSpecV0') {
      return;
    }

    const attachmentEvidence = visualSample.profileSpecResult.spec.visualEvidence.filter(
      (item) => item.evidenceType === 'attachment',
    );

    expect(attachmentEvidence.length).toBeGreaterThan(0);
    expect(
      attachmentEvidence.some((item) => /^jira\.attachment:[^:]+:[^:]+$/.test(item.sourceRef)),
    ).toBe(true);
  });

  it('reqgate shows both investigationReady and implementationReady verdicts', () => {
    for (const sample of snapshot.samples) {
      expect(sample.reqGateResult.investigationReady.reason.length).toBeGreaterThan(0);
      expect(sample.reqGateResult.implementationReady.reason.length).toBeGreaterThan(0);
      expect(['green', 'yellow', 'red']).toContain(sample.reqGateResult.investigationReady.light);
      expect(['green', 'yellow', 'red']).toContain(sample.reqGateResult.implementationReady.light);
    }
  });

  it('router.profile follows W2 IssueProfile semantics (not SpecV0 names)', () => {
    for (const sample of snapshot.samples) {
      expect(sample.router.profile.endsWith('SpecV0')).toBe(false);
      expect(
        ['Visual', 'Integration', 'Workflow', 'Billing', 'AccessControl', 'General'].includes(
          sample.router.profile,
        ),
      ).toBe(true);
    }
  });

  it('reqgate axis names stay in W4 canonical axis set', () => {
    for (const sample of snapshot.samples) {
      const allAxes = [
        ...sample.reqGateResult.investigationReady.axisResults,
        ...sample.reqGateResult.implementationReady.axisResults,
      ].map((item) => item.axis);
      expect(allAxes.length).toBeGreaterThan(0);
      for (const axis of allAxes) {
        expect(canonicalReqGateAxes.has(axis)).toBe(true);
      }
    }
  });

  it('reqgate layer light equals W4 axis aggregation result', () => {
    for (const sample of snapshot.samples) {
      const investigationLights = sample.reqGateResult.investigationReady.axisResults.map(
        (item) => item.light,
      );
      const implementationLights = sample.reqGateResult.implementationReady.axisResults.map(
        (item) => item.light,
      );
      expect(sample.reqGateResult.investigationReady.light).toBe(
        aggregateLightFromAxes(investigationLights),
      );
      expect(sample.reqGateResult.implementationReady.light).toBe(
        aggregateLightFromAxes(implementationLights),
      );
    }
  });

  it('hardBlocks and ruleEvaluations only use W4 canonical hard rule ids', () => {
    for (const sample of snapshot.samples) {
      for (const hardBlock of sample.reqGateResult.hardBlocks) {
        expect(canonicalHardRules.has(hardBlock.ruleId)).toBe(true);
      }
      for (const ruleEvaluation of sample.reqGateResult.auditPayload.ruleEvaluations) {
        expect(canonicalHardRules.has(ruleEvaluation.ruleId)).toBe(true);
      }
    }
  });

  it('does not include legacy jira:/reqgate: sourceRef prefixes', () => {
    const refs = collectSourceRefs(snapshot.samples);
    expect(refs.length).toBeGreaterThan(0);
    expect(refs.some((ref) => /^jira:/.test(ref))).toBe(false);
    expect(refs.some((ref) => /^reqgate:/.test(ref))).toBe(false);
  });

  it('reqgate auditPayload sourceRefs only contain canonical jira.* refs', () => {
    for (const sample of snapshot.samples) {
      const sourceRefs = sample.reqGateResult.auditPayload.sourceRefs;
      expect(sourceRefs.length).toBeGreaterThan(0);
      for (const sourceRef of sourceRefs) {
        expect(sourceRef.startsWith('jira.')).toBe(true);
        expect(canonicalJiraSourceRefPattern.test(sourceRef)).toBe(true);
      }
    }
  });
});
