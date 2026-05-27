import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { JiraEvidencePackV2 } from '../jira/evidence.js';
import {
  buildRequirementGateV0,
  type RequirementGateResultV0,
  type RequirementGateRuntimeFlagsV0
} from './gate.js';
import {
  buildRequirementProfileSpecV0,
  type RequirementProfileKind,
  type RequirementProfileSpecResultV0
} from './profiles.js';
import { routeIssueProfile, type IssueTypeRouterResult } from './router.js';

export type RequirementEvalLight = 'green' | 'yellow' | 'red';

export interface RequirementEvalExpected {
  readonly profile: RequirementProfileKind;
  readonly investigationLight: RequirementEvalLight;
  readonly implementationLight: RequirementEvalLight;
  readonly keyGaps: readonly string[];
  readonly requiredSourceRefs: readonly string[];
  readonly unsupportedReason?: string;
}

export interface RequirementEvalReview {
  readonly reviewer: string;
  readonly reviewedAt: string;
  readonly reviewSourceRef: string;
  readonly adjustmentReason: string;
}

export type RequirementEvalMetadataSource =
  | 'notion-v2-50-review'
  | 'local-fixture'
  | 'manual-replay';

export interface RequirementEvalMetadata {
  readonly source: RequirementEvalMetadataSource;
  readonly highRiskMedicalDomain?: boolean;
  readonly attemptedJiraWrite?: boolean;
}

export interface RequirementEvalSample {
  readonly sampleId: string;
  readonly issueKey: string;
  readonly evidencePack: JiraEvidencePackV2;
  readonly expected: RequirementEvalExpected;
  readonly review: RequirementEvalReview;
  readonly metadata: RequirementEvalMetadata;
}

export interface RequirementEvalDataset {
  readonly schemaVersion: 'requirements-analysis-eval-v0-samples@1';
  readonly samples: readonly RequirementEvalSample[];
}

export interface RequirementEvalFailure {
  readonly sampleId: string;
  readonly issueKey: string;
  readonly category:
    | 'routerTop1'
    | 'investigationGate'
    | 'implementationGate'
    | 'keyGaps'
    | 'sourceRefCoverage';
  readonly expected: unknown;
  readonly actual: unknown;
  readonly missingSourceRefs: readonly string[];
  readonly missingGaps: readonly string[];
  readonly reason: string;
}

export interface RequirementEvalSampleSummary {
  readonly sampleId: string;
  readonly issueKey: string;
  readonly expectedProfile: RequirementProfileKind;
  readonly actualProfile: RequirementProfileKind;
  readonly expectedInvestigationLight: RequirementEvalLight;
  readonly actualInvestigationLight: RequirementEvalLight;
  readonly expectedImplementationLight: RequirementEvalLight;
  readonly actualImplementationLight: RequirementEvalLight;
  readonly routerTop1Pass: boolean;
  readonly investigationGatePass: boolean;
  readonly implementationGatePass: boolean;
  readonly keyGapsPass: boolean;
  readonly sourceRefCoveragePass: boolean;
  readonly profileFieldCompleteness: number | null;
  readonly profileFieldCompletenessSupported: boolean;
  readonly failureReasons: readonly string[];
  readonly missingSourceRefs: readonly string[];
  readonly missingGaps: readonly string[];
}

export interface RequirementEvalReport {
  readonly schemaVersion: 'requirements-analysis-eval-v0-report@1';
  readonly generatedAt: string;
  readonly status: 'PASS' | 'FAIL' | 'NOT_READY';
  readonly dataset: {
    readonly sampleCount: number;
    readonly requiredSampleCount: 50;
    readonly realReviewedSampleCount: number;
    readonly missingReviewMetadataCount: number;
  };
  readonly metrics: {
    readonly routerTop1Accuracy: number;
    readonly investigationGateAccuracy: number;
    readonly implementationGateAccuracy: number;
    readonly sourceRefCoverage: number;
    readonly profileFieldCompletenessAverage: number;
    readonly redRecall: number;
    readonly yellowFalsePositiveRate: number;
    readonly unsupportedProfileSampleCount: number;
  };
  readonly notReadyReasons: readonly string[];
  readonly failures: readonly RequirementEvalFailure[];
  readonly samples: readonly RequirementEvalSampleSummary[];
}

export interface RunRequirementEvalInput {
  readonly datasetPath?: string;
  readonly outputJsonPath?: string;
  readonly outputMarkdownPath?: string;
}

const DEFAULT_DATASET_PATH = join('fixtures', 'requirements', 'requirements-eval-v0-samples.json');
const DEFAULT_OUTPUT_JSON_PATH = join('eval', 'requirements-analysis-v0-report.json');
const DEFAULT_OUTPUT_MD_PATH = join('eval', 'requirements-analysis-v0-report.md');

const REQUIRED_SAMPLE_COUNT = 50;

export async function runRequirementEval(input?: RunRequirementEvalInput): Promise<RequirementEvalReport> {
  const datasetPath = input?.datasetPath ?? DEFAULT_DATASET_PATH;
  const outputJsonPath = input?.outputJsonPath ?? DEFAULT_OUTPUT_JSON_PATH;
  const outputMarkdownPath = input?.outputMarkdownPath ?? DEFAULT_OUTPUT_MD_PATH;

  const dataset = await loadRequirementEvalDataset(datasetPath);
  const report = evaluateRequirementEvalDataset(dataset);

  await mkdir(dirname(outputJsonPath), { recursive: true });
  await mkdir(dirname(outputMarkdownPath), { recursive: true });
  await writeFile(outputJsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(outputMarkdownPath, renderRequirementEvalMarkdown(report), 'utf8');

  return report;
}

export async function loadRequirementEvalDataset(path: string): Promise<RequirementEvalDataset> {
  const raw = await readFile(path, 'utf8');
  const parsed: unknown = JSON.parse(raw);

  if (!isRequirementEvalDataset(parsed)) {
    throw new Error(`Invalid requirements eval fixture: ${path}`);
  }

  return parsed;
}

export function evaluateRequirementEvalDataset(dataset: RequirementEvalDataset): RequirementEvalReport {
  const sampleSummaries: RequirementEvalSampleSummary[] = [];
  const failures: RequirementEvalFailure[] = [];

  let routerTop1Passed = 0;
  let investigationPassed = 0;
  let implementationPassed = 0;
  let sourceRefCoveragePassed = 0;

  let supportedCompletenessTotal = 0;
  let supportedCompletenessCount = 0;
  let unsupportedProfileSampleCount = 0;

  let redPositiveTotal = 0;
  let redPositiveHit = 0;

  let yellowNegativeTotal = 0;
  let yellowFalsePositiveCount = 0;

  let realReviewedSampleCount = 0;
  let missingReviewMetadataCount = 0;

  for (const sample of dataset.samples) {
    const runtimeFlags: RequirementGateRuntimeFlagsV0 = {
      ...(sample.metadata.highRiskMedicalDomain === true ? { highRiskMedicalDomain: true } : {}),
      ...(sample.metadata.attemptedJiraWrite === true ? { attemptedJiraWrite: true } : {})
    };

    const routerResult = routeIssueProfile(sample.evidencePack);
    const profileSpecResult = buildRequirementProfileSpecV0({
      evidencePack: sample.evidencePack,
      routerResult
    });
    const gateResult = buildRequirementGateV0({
      evidencePack: sample.evidencePack,
      profileSpecResult,
      routerResult,
      runtimeFlags
    });

    if (sample.metadata.source === 'notion-v2-50-review') {
      realReviewedSampleCount += 1;
    }

    if (!hasCompleteReviewMetadata(sample.review)) {
      missingReviewMetadataCount += 1;
    }

    const sampleResult = evaluateSample(sample, routerResult, profileSpecResult, gateResult);
    sampleSummaries.push(sampleResult);

    if (sampleResult.routerTop1Pass) {
      routerTop1Passed += 1;
    }
    if (sampleResult.investigationGatePass) {
      investigationPassed += 1;
    }
    if (sampleResult.implementationGatePass) {
      implementationPassed += 1;
    }
    if (sampleResult.sourceRefCoveragePass) {
      sourceRefCoveragePassed += 1;
    }

    if (sampleResult.profileFieldCompletenessSupported && sampleResult.profileFieldCompleteness !== null) {
      supportedCompletenessTotal += sampleResult.profileFieldCompleteness;
      supportedCompletenessCount += 1;
    }

    if (!sampleResult.profileFieldCompletenessSupported) {
      unsupportedProfileSampleCount += 1;
    }

    if (sample.expected.implementationLight === 'red') {
      redPositiveTotal += 1;
      if (sampleResult.actualImplementationLight === 'red') {
        redPositiveHit += 1;
      }
    }

    if (sample.expected.implementationLight !== 'yellow') {
      yellowNegativeTotal += 1;
      if (sampleResult.actualImplementationLight === 'yellow') {
        yellowFalsePositiveCount += 1;
      }
    }

    failures.push(...buildFailures(sample, sampleResult));
  }

  const sampleCount = dataset.samples.length;
  const notReadyReasons = buildNotReadyReasons({
    sampleCount,
    realReviewedSampleCount,
    missingReviewMetadataCount
  });

  const status: RequirementEvalReport['status'] =
    notReadyReasons.length > 0 ? 'NOT_READY' : failures.length > 0 ? 'FAIL' : 'PASS';

  return {
    schemaVersion: 'requirements-analysis-eval-v0-report@1',
    generatedAt: new Date().toISOString(),
    status,
    dataset: {
      sampleCount,
      requiredSampleCount: REQUIRED_SAMPLE_COUNT,
      realReviewedSampleCount,
      missingReviewMetadataCount
    },
    metrics: {
      routerTop1Accuracy: roundRatio(routerTop1Passed, sampleCount),
      investigationGateAccuracy: roundRatio(investigationPassed, sampleCount),
      implementationGateAccuracy: roundRatio(implementationPassed, sampleCount),
      sourceRefCoverage: roundRatio(sourceRefCoveragePassed, sampleCount),
      profileFieldCompletenessAverage: roundRatio(supportedCompletenessTotal, supportedCompletenessCount),
      redRecall: roundRatio(redPositiveHit, redPositiveTotal),
      yellowFalsePositiveRate: roundRatio(yellowFalsePositiveCount, yellowNegativeTotal),
      unsupportedProfileSampleCount
    },
    notReadyReasons,
    failures,
    samples: sampleSummaries
  };
}

function evaluateSample(
  sample: RequirementEvalSample,
  routerResult: IssueTypeRouterResult,
  profileSpecResult: RequirementProfileSpecResultV0,
  gateResult: RequirementGateResultV0
): RequirementEvalSampleSummary {
  const actualKeyGaps = dedupeStrings(gateResult.gaps.map((gap) => gap.field));
  const missingGaps = sample.expected.keyGaps.filter((gap) => !actualKeyGaps.includes(gap));

  const sourceRefUniverse = new Set<string>([
    ...sample.evidencePack.sourceRefs,
    ...gateResult.sourceRefs
  ]);
  const missingSourceRefs = sample.expected.requiredSourceRefs.filter(
    (sourceRef) => !sourceRefUniverse.has(sourceRef)
  );

  const routerTop1Pass = routerResult.profile === sample.expected.profile;
  const investigationGatePass = gateResult.investigationReady.light === sample.expected.investigationLight;
  const implementationGatePass = gateResult.implementationReady.light === sample.expected.implementationLight;
  const keyGapsPass = missingGaps.length === 0;
  const sourceRefCoveragePass = missingSourceRefs.length === 0;

  const completeness = computeProfileFieldCompleteness(sample.expected.profile, profileSpecResult);

  const failureReasons: string[] = [];
  if (!routerTop1Pass) {
    failureReasons.push(
      `routerTop1 mismatch: expected=${sample.expected.profile}, actual=${routerResult.profile}`
    );
  }
  if (!investigationGatePass) {
    failureReasons.push(
      `investigationLight mismatch: expected=${sample.expected.investigationLight}, actual=${gateResult.investigationReady.light}`
    );
  }
  if (!implementationGatePass) {
    failureReasons.push(
      `implementationLight mismatch: expected=${sample.expected.implementationLight}, actual=${gateResult.implementationReady.light}`
    );
  }
  if (!keyGapsPass) {
    failureReasons.push(`missing keyGaps: ${missingGaps.join(', ')}`);
  }
  if (!sourceRefCoveragePass) {
    failureReasons.push(`missing requiredSourceRefs: ${missingSourceRefs.join(', ')}`);
  }

  return {
    sampleId: sample.sampleId,
    issueKey: sample.issueKey,
    expectedProfile: sample.expected.profile,
    actualProfile: routerResult.profile,
    expectedInvestigationLight: sample.expected.investigationLight,
    actualInvestigationLight: gateResult.investigationReady.light,
    expectedImplementationLight: sample.expected.implementationLight,
    actualImplementationLight: gateResult.implementationReady.light,
    routerTop1Pass,
    investigationGatePass,
    implementationGatePass,
    keyGapsPass,
    sourceRefCoveragePass,
    profileFieldCompleteness: completeness.value,
    profileFieldCompletenessSupported: completeness.supported,
    failureReasons,
    missingSourceRefs,
    missingGaps
  };
}

function computeProfileFieldCompleteness(
  expectedProfile: RequirementProfileKind,
  profileSpecResult: RequirementProfileSpecResultV0
): {
  readonly value: number | null;
  readonly supported: boolean;
} {
  if (
    expectedProfile !== 'Visual' &&
    expectedProfile !== 'Integration' &&
    expectedProfile !== 'Workflow'
  ) {
    return {
      value: null,
      supported: false
    };
  }

  const requiredFields = getRequiredSpecFieldsByProfile(expectedProfile);
  const filledCount = requiredFields.filter((field) => hasRequiredFieldEvidence(profileSpecResult, field)).length;

  return {
    value: roundRatio(filledCount, requiredFields.length),
    supported: true
  };
}

function getRequiredSpecFieldsByProfile(
  profile: Extract<RequirementProfileKind, 'Visual' | 'Integration' | 'Workflow'>
): readonly string[] {
  if (profile === 'Visual') {
    return [
      'pageOrComponent',
      'actualBehavior',
      'expectedBehavior',
      'visualEvidence',
      'baselineEvidence',
      'viewport',
      'acceptanceAssertions'
    ];
  }

  if (profile === 'Integration') {
    return [
      'upstreamSystem',
      'downstreamSystem',
      'apiContract',
      'fieldMapping',
      'acceptanceAssertions'
    ];
  }

  return ['roles', 'triggerConditions', 'processSteps', 'acceptanceAssertions'];
}

function hasRequiredFieldEvidence(
  profileSpecResult: RequirementProfileSpecResultV0,
  field: string
): boolean {
  const spec = profileSpecResult.spec;

  if (spec.kind === 'VisualDefectSpecV0') {
    return hasArrayEntriesForField(spec, field);
  }

  if (spec.kind === 'IntegrationSpecV0') {
    return hasArrayEntriesForField(spec, field);
  }

  if (spec.kind === 'WorkflowRequirementSpecV0') {
    return hasArrayEntriesForField(spec, field);
  }

  return false;
}

function hasArrayEntriesForField(record: unknown, field: string): boolean {
  if (!isRecord(record)) {
    return false;
  }

  const value = record[field];
  return Array.isArray(value) && value.length > 0;
}

function buildFailures(
  sample: RequirementEvalSample,
  sampleResult: RequirementEvalSampleSummary
): readonly RequirementEvalFailure[] {
  const failures: RequirementEvalFailure[] = [];

  if (!sampleResult.routerTop1Pass) {
    failures.push({
      sampleId: sample.sampleId,
      issueKey: sample.issueKey,
      category: 'routerTop1',
      expected: sample.expected.profile,
      actual: sampleResult.actualProfile,
      missingSourceRefs: [],
      missingGaps: [],
      reason: 'router top-1 profile 与人工复核不一致。'
    });
  }

  if (!sampleResult.investigationGatePass) {
    failures.push({
      sampleId: sample.sampleId,
      issueKey: sample.issueKey,
      category: 'investigationGate',
      expected: sample.expected.investigationLight,
      actual: sampleResult.actualInvestigationLight,
      missingSourceRefs: [],
      missingGaps: [],
      reason: 'investigation gate light 与人工复核不一致。'
    });
  }

  if (!sampleResult.implementationGatePass) {
    failures.push({
      sampleId: sample.sampleId,
      issueKey: sample.issueKey,
      category: 'implementationGate',
      expected: sample.expected.implementationLight,
      actual: sampleResult.actualImplementationLight,
      missingSourceRefs: [],
      missingGaps: [],
      reason: 'implementation gate light 与人工复核不一致。'
    });
  }

  if (!sampleResult.keyGapsPass) {
    failures.push({
      sampleId: sample.sampleId,
      issueKey: sample.issueKey,
      category: 'keyGaps',
      expected: sample.expected.keyGaps,
      actual: 'missing_key_gaps',
      missingSourceRefs: [],
      missingGaps: sampleResult.missingGaps,
      reason: '关键缺口字段未覆盖。'
    });
  }

  if (!sampleResult.sourceRefCoveragePass) {
    failures.push({
      sampleId: sample.sampleId,
      issueKey: sample.issueKey,
      category: 'sourceRefCoverage',
      expected: sample.expected.requiredSourceRefs,
      actual: 'missing_required_source_refs',
      missingSourceRefs: sampleResult.missingSourceRefs,
      missingGaps: [],
      reason: 'requiredSourceRefs 未被 evidencePack.sourceRefs 或最终 gate.result.sourceRefs 覆盖。'
    });
  }

  return failures;
}

function buildNotReadyReasons(input: {
  readonly sampleCount: number;
  readonly realReviewedSampleCount: number;
  readonly missingReviewMetadataCount: number;
}): readonly string[] {
  const reasons: string[] = [];

  if (input.sampleCount < REQUIRED_SAMPLE_COUNT) {
    reasons.push(
      `sampleCount=${input.sampleCount} < requiredSampleCount=${REQUIRED_SAMPLE_COUNT}`
    );
  }

  if (input.realReviewedSampleCount < REQUIRED_SAMPLE_COUNT) {
    reasons.push(
      `realReviewedSampleCount=${input.realReviewedSampleCount} < requiredSampleCount=${REQUIRED_SAMPLE_COUNT}`
    );
  }

  if (input.missingReviewMetadataCount > 0) {
    reasons.push(`missingReviewMetadataCount=${input.missingReviewMetadataCount} > 0`);
  }

  return reasons;
}

function hasCompleteReviewMetadata(review: RequirementEvalReview): boolean {
  return (
    review.reviewer.trim().length > 0 &&
    review.reviewedAt.trim().length > 0 &&
    review.reviewSourceRef.trim().length > 0 &&
    review.adjustmentReason.trim().length > 0
  );
}

function roundRatio(numerator: number, denominator: number): number {
  if (denominator <= 0) {
    return 0;
  }

  return Number((numerator / denominator).toFixed(4));
}

function dedupeStrings(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = value.trim();
    if (normalized.length === 0 || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

export function renderRequirementEvalMarkdown(report: RequirementEvalReport): string {
  const lines: string[] = [];

  lines.push('# Requirements Analysis Eval v0 Report');
  lines.push('');
  lines.push(`- schemaVersion: \`${report.schemaVersion}\``);
  lines.push(`- generatedAt: \`${report.generatedAt}\``);
  lines.push(`- status: \`${report.status}\``);
  lines.push('');

  lines.push('## Dataset');
  lines.push('');
  lines.push(`- sampleCount: ${report.dataset.sampleCount}`);
  lines.push(`- requiredSampleCount: ${report.dataset.requiredSampleCount}`);
  lines.push(`- realReviewedSampleCount: ${report.dataset.realReviewedSampleCount}`);
  lines.push(`- missingReviewMetadataCount: ${report.dataset.missingReviewMetadataCount}`);
  lines.push('');

  if (report.notReadyReasons.length > 0) {
    lines.push('## Not Ready Reasons');
    lines.push('');
    for (const reason of report.notReadyReasons) {
      lines.push(`- ${reason}`);
    }
    lines.push('');
  }

  lines.push('## Metrics');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('| --- | ---: |');
  lines.push(`| routerTop1Accuracy | ${report.metrics.routerTop1Accuracy} |`);
  lines.push(`| investigationGateAccuracy | ${report.metrics.investigationGateAccuracy} |`);
  lines.push(`| implementationGateAccuracy | ${report.metrics.implementationGateAccuracy} |`);
  lines.push(`| sourceRefCoverage | ${report.metrics.sourceRefCoverage} |`);
  lines.push(
    `| profileFieldCompletenessAverage | ${report.metrics.profileFieldCompletenessAverage} |`
  );
  lines.push(`| redRecall | ${report.metrics.redRecall} |`);
  lines.push(`| yellowFalsePositiveRate | ${report.metrics.yellowFalsePositiveRate} |`);
  lines.push(`| unsupportedProfileSampleCount | ${report.metrics.unsupportedProfileSampleCount} |`);
  lines.push('');

  lines.push('## Failures');
  lines.push('');
  if (report.failures.length === 0) {
    lines.push('- none');
  } else {
    for (const failure of report.failures) {
      lines.push(
        `- [${failure.category}] ${failure.sampleId} (${failure.issueKey}): ${failure.reason}`
      );
      if (failure.missingSourceRefs.length > 0) {
        lines.push(`  - missingSourceRefs: ${failure.missingSourceRefs.join(', ')}`);
      }
      if (failure.missingGaps.length > 0) {
        lines.push(`  - missingGaps: ${failure.missingGaps.join(', ')}`);
      }
    }
  }
  lines.push('');

  lines.push('## Samples');
  lines.push('');
  lines.push(
    '| sampleId | issueKey | routerTop1Pass | investigationGatePass | implementationGatePass | keyGapsPass | sourceRefCoveragePass | profileFieldCompleteness |'
  );
  lines.push('| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const sample of report.samples) {
    lines.push(
      `| ${sample.sampleId} | ${sample.issueKey} | ${sample.routerTop1Pass} | ${sample.investigationGatePass} | ${sample.implementationGatePass} | ${sample.keyGapsPass} | ${sample.sourceRefCoveragePass} | ${sample.profileFieldCompleteness ?? 'n/a'} |`
    );
  }

  lines.push('');
  return `${lines.join('\n')}\n`;
}

export function isRequirementEvalDataset(value: unknown): value is RequirementEvalDataset {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.schemaVersion === 'requirements-analysis-eval-v0-samples@1' &&
    Array.isArray(value.samples) &&
    value.samples.every((sample) => isRequirementEvalSample(sample))
  );
}

function isRequirementEvalSample(value: unknown): value is RequirementEvalSample {
  if (!isRecord(value)) {
    return false;
  }

  if (
    typeof value.sampleId !== 'string' ||
    typeof value.issueKey !== 'string' ||
    !isJiraEvidencePackV2(value.evidencePack) ||
    !isRequirementEvalExpected(value.expected) ||
    !isRequirementEvalReview(value.review) ||
    !isRequirementEvalMetadata(value.metadata)
  ) {
    return false;
  }

  return (
    value.issueKey === value.evidencePack.issue.key
  );
}

function isRequirementEvalExpected(value: unknown): value is RequirementEvalExpected {
  if (!isRecord(value)) {
    return false;
  }

  const unsupportedReasonOk =
    value.unsupportedReason === undefined || typeof value.unsupportedReason === 'string';

  return (
    isRequirementProfileKind(value.profile) &&
    isRequirementEvalLight(value.investigationLight) &&
    isRequirementEvalLight(value.implementationLight) &&
    isStringArray(value.keyGaps) &&
    isStringArray(value.requiredSourceRefs) &&
    unsupportedReasonOk
  );
}

function isRequirementEvalReview(value: unknown): value is RequirementEvalReview {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.reviewer === 'string' &&
    typeof value.reviewedAt === 'string' &&
    typeof value.reviewSourceRef === 'string' &&
    typeof value.adjustmentReason === 'string'
  );
}

function isRequirementEvalMetadata(value: unknown): value is RequirementEvalMetadata {
  if (!isRecord(value)) {
    return false;
  }

  const sourceValid =
    value.source === 'notion-v2-50-review' ||
    value.source === 'local-fixture' ||
    value.source === 'manual-replay';

  const highRiskValid =
    value.highRiskMedicalDomain === undefined || typeof value.highRiskMedicalDomain === 'boolean';
  const attemptedJiraWriteValid =
    value.attemptedJiraWrite === undefined || typeof value.attemptedJiraWrite === 'boolean';

  return sourceValid && highRiskValid && attemptedJiraWriteValid;
}

function isRequirementProfileKind(value: unknown): value is RequirementProfileKind {
  return (
    value === 'Visual' ||
    value === 'Integration' ||
    value === 'Workflow' ||
    value === 'Billing' ||
    value === 'AccessControl' ||
    value === 'General'
  );
}

function isRequirementEvalLight(value: unknown): value is RequirementEvalLight {
  return value === 'green' || value === 'yellow' || value === 'red';
}

function isJiraEvidencePackV2(value: unknown): value is JiraEvidencePackV2 {
  if (!isRecord(value)) {
    return false;
  }

  if (value.schemaVersion !== 'JiraEvidencePackV2') {
    return false;
  }

  if (!isJiraEvidenceIssueV2(value.issue)) {
    return false;
  }

  if (!Array.isArray(value.fields) || !value.fields.every((field) => isJiraEvidenceFieldV2(field))) {
    return false;
  }

  if (
    !Array.isArray(value.fieldValues) ||
    !value.fieldValues.every((fieldValue) => isJiraEvidenceFieldValueV2(fieldValue))
  ) {
    return false;
  }

  if (!Array.isArray(value.comments) || !value.comments.every((comment) => isJiraEvidenceCommentV2(comment))) {
    return false;
  }

  if (
    !Array.isArray(value.attachments) ||
    !value.attachments.every((attachment) => isJiraEvidenceAttachmentV2(attachment))
  ) {
    return false;
  }

  if (
    !Array.isArray(value.mediaEvidence) ||
    !value.mediaEvidence.every((media) => isJiraMediaEvidenceV2(media))
  ) {
    return false;
  }

  if (value.projectMetadata !== null && !isJiraProjectMetadataV2(value.projectMetadata)) {
    return false;
  }

  if (
    !Array.isArray(value.relations) ||
    !value.relations.every((relation) => isJiraIssueRelationV2(relation))
  ) {
    return false;
  }

  if (
    !Array.isArray(value.transitions) ||
    !value.transitions.every((transition) => isJiraTransitionEvidenceV2(transition))
  ) {
    return false;
  }

  if (!isStringArray(value.sourceRefs) || typeof value.generatedAt !== 'string') {
    return false;
  }

  return hasEvidenceSourceRefCoverage({
    issue: value.issue,
    fields: value.fields,
    fieldValues: value.fieldValues,
    comments: value.comments,
    attachments: value.attachments,
    mediaEvidence: value.mediaEvidence,
    projectMetadata: value.projectMetadata,
    relations: value.relations,
    transitions: value.transitions,
    sourceRefs: value.sourceRefs
  });
}

function isJiraEvidenceIssueV2(value: unknown): value is JiraEvidencePackV2['issue'] {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.key === 'string' &&
    typeof value.summary === 'string' &&
    typeof value.description === 'string' &&
    typeof value.issueType === 'string' &&
    typeof value.status === 'string' &&
    typeof value.priority === 'string' &&
    typeof value.assignee === 'string' &&
    isStringArray(value.labels) &&
    typeof value.projectKey === 'string' &&
    typeof value.projectName === 'string' &&
    typeof value.created === 'string' &&
    typeof value.updated === 'string' &&
    typeof value.dueDate === 'string' &&
    typeof value.sourceRef === 'string'
  );
}

function isJiraEvidenceFieldV2(value: unknown): value is JiraEvidencePackV2['fields'][number] {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.custom === 'boolean' &&
    isStringArray(value.clauseNames) &&
    typeof value.schemaType === 'string' &&
    typeof value.schemaSystem === 'string' &&
    typeof value.sourceRef === 'string'
  );
}

function isJiraEvidenceFieldValueV2(value: unknown): value is JiraEvidencePackV2['fieldValues'][number] {
  if (!isRecord(value)) {
    return false;
  }

  if (!isJiraEvidenceFieldValueKeyV2(value.fieldKey)) {
    return false;
  }

  if (!isJiraEvidenceFieldValueKindV2(value.valueKind)) {
    return false;
  }

  if (typeof value.sourceRef !== 'string') {
    return false;
  }

  if (value.valueKind === 'string') {
    return typeof value.valueString === 'string';
  }

  if (value.valueKind === 'string_list') {
    return isStringArray(value.valueStrings);
  }

  return isJiraEvidenceTimeTrackingValueV2(value.valueTimeTracking);
}

function isJiraEvidenceFieldValueKeyV2(value: unknown): value is JiraEvidencePackV2['fieldValues'][number]['fieldKey'] {
  return (
    value === 'affectedVersions' ||
    value === 'fixVersions' ||
    value === 'targetVersion' ||
    value === 'productModule' ||
    value === 'defectCategory' ||
    value === 'issueCategory' ||
    value === 'projectSource' ||
    value === 'coreRecovery' ||
    value === 'requirementReleased' ||
    value === 'timeTracking'
  );
}

function isJiraEvidenceFieldValueKindV2(value: unknown): value is JiraEvidencePackV2['fieldValues'][number]['valueKind'] {
  return value === 'string' || value === 'string_list' || value === 'time_tracking';
}

function isJiraEvidenceTimeTrackingValueV2(value: unknown): value is NonNullable<JiraEvidencePackV2['fieldValues'][number]['valueTimeTracking']> {
  if (!isRecord(value)) {
    return false;
  }

  const originalValid =
    value.originalEstimateSeconds === undefined || typeof value.originalEstimateSeconds === 'number';
  const remainingValid =
    value.remainingEstimateSeconds === undefined || typeof value.remainingEstimateSeconds === 'number';
  const spentValid =
    value.timeSpentSeconds === undefined || typeof value.timeSpentSeconds === 'number';
  const hasAtLeastOneValue =
    value.originalEstimateSeconds !== undefined ||
    value.remainingEstimateSeconds !== undefined ||
    value.timeSpentSeconds !== undefined;

  return originalValid && remainingValid && spentValid && hasAtLeastOneValue;
}

function isJiraEvidenceCommentV2(value: unknown): value is JiraEvidencePackV2['comments'][number] {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === 'string' &&
    typeof value.body === 'string' &&
    typeof value.author === 'string' &&
    typeof value.created === 'string' &&
    typeof value.updated === 'string' &&
    typeof value.sourceRef === 'string'
  );
}

function isJiraEvidenceAttachmentV2(value: unknown): value is JiraEvidencePackV2['attachments'][number] {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === 'string' &&
    typeof value.filename === 'string' &&
    typeof value.mimeType === 'string' &&
    (typeof value.size === 'number' || value.size === null) &&
    typeof value.sourceRef === 'string' &&
    (typeof value.securityDigest === 'string' || value.securityDigest === null)
  );
}

function isJiraMediaEvidenceV2(value: unknown): value is JiraEvidencePackV2['mediaEvidence'][number] {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.attachmentId === 'string' &&
    typeof value.filename === 'string' &&
    typeof value.mimeType === 'string' &&
    typeof value.byteLength === 'number' &&
    typeof value.truncated === 'boolean' &&
    typeof value.sourceRef === 'string'
  );
}

function isJiraProjectMetadataV2(value: unknown): value is NonNullable<JiraEvidencePackV2['projectMetadata']> {
  if (!isRecord(value)) {
    return false;
  }

  if (
    typeof value.projectKey !== 'string' ||
    typeof value.projectName !== 'string' ||
    typeof value.sourceRef !== 'string'
  ) {
    return false;
  }

  if (!Array.isArray(value.components) || !value.components.every((item) => isJiraProjectComponentV2(item))) {
    return false;
  }

  if (!Array.isArray(value.versions) || !value.versions.every((item) => isJiraProjectVersionV2(item))) {
    return false;
  }

  return Array.isArray(value.statuses) && value.statuses.every((item) => isJiraProjectStatusV2(item));
}

function isJiraProjectComponentV2(value: unknown): value is NonNullable<JiraEvidencePackV2['projectMetadata']>['components'][number] {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.description === 'string'
  );
}

function isJiraProjectVersionV2(value: unknown): value is NonNullable<JiraEvidencePackV2['projectMetadata']>['versions'][number] {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    (typeof value.released === 'boolean' || value.released === null) &&
    (typeof value.archived === 'boolean' || value.archived === null) &&
    typeof value.releaseDate === 'string'
  );
}

function isJiraProjectStatusV2(value: unknown): value is NonNullable<JiraEvidencePackV2['projectMetadata']>['statuses'][number] {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value.id !== 'string' || typeof value.name !== 'string') {
    return false;
  }

  return Array.isArray(value.issueTypes) && value.issueTypes.every((item) => isJiraIssueTypeStatusV2(item));
}

function isJiraIssueTypeStatusV2(value: unknown): value is NonNullable<JiraEvidencePackV2['projectMetadata']>['statuses'][number]['issueTypes'][number] {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value.id !== 'string' || typeof value.name !== 'string') {
    return false;
  }

  return Array.isArray(value.statuses) && value.statuses.every((item) => isJiraIssueStatusV2(item));
}

function isJiraIssueStatusV2(value: unknown): value is NonNullable<JiraEvidencePackV2['projectMetadata']>['statuses'][number]['issueTypes'][number]['statuses'][number] {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.statusCategory === 'string'
  );
}

function isJiraIssueRelationV2(value: unknown): value is JiraEvidencePackV2['relations'][number] {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isJiraRelationTypeV2(value.relationType) &&
    typeof value.relationKey === 'string' &&
    typeof value.summary === 'string' &&
    typeof value.status === 'string' &&
    isJiraRelationDirectionV2(value.direction) &&
    typeof value.linkType === 'string' &&
    typeof value.relationship === 'string' &&
    typeof value.url === 'string' &&
    typeof value.sourceRef === 'string'
  );
}

function isJiraRelationTypeV2(value: unknown): value is JiraEvidencePackV2['relations'][number]['relationType'] {
  return value === 'parent' || value === 'subtask' || value === 'issueLink' || value === 'remoteLink';
}

function isJiraRelationDirectionV2(value: unknown): value is JiraEvidencePackV2['relations'][number]['direction'] {
  return value === 'inward' || value === 'outward' || value === 'none';
}

function isJiraTransitionEvidenceV2(value: unknown): value is JiraEvidencePackV2['transitions'][number] {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.to === 'string' &&
    typeof value.sourceRef === 'string'
  );
}

function hasEvidenceSourceRefCoverage(input: {
  readonly issue: JiraEvidencePackV2['issue'];
  readonly fields: JiraEvidencePackV2['fields'];
  readonly fieldValues: JiraEvidencePackV2['fieldValues'];
  readonly comments: JiraEvidencePackV2['comments'];
  readonly attachments: JiraEvidencePackV2['attachments'];
  readonly mediaEvidence: JiraEvidencePackV2['mediaEvidence'];
  readonly projectMetadata: JiraEvidencePackV2['projectMetadata'];
  readonly relations: JiraEvidencePackV2['relations'];
  readonly transitions: JiraEvidencePackV2['transitions'];
  readonly sourceRefs: JiraEvidencePackV2['sourceRefs'];
}): boolean {
  const sourceRefSet = new Set(input.sourceRefs);
  if (!sourceRefSet.has(input.issue.sourceRef)) {
    return false;
  }

  const checkRefs = (items: readonly { readonly sourceRef: string }[]): boolean =>
    items.every((item) => sourceRefSet.has(item.sourceRef));

  if (!checkRefs(input.fields)) {
    return false;
  }
  if (!checkRefs(input.fieldValues)) {
    return false;
  }
  if (!checkRefs(input.comments)) {
    return false;
  }
  if (!checkRefs(input.attachments)) {
    return false;
  }
  if (!checkRefs(input.mediaEvidence)) {
    return false;
  }
  if (input.projectMetadata !== null && !sourceRefSet.has(input.projectMetadata.sourceRef)) {
    return false;
  }
  if (!checkRefs(input.relations)) {
    return false;
  }
  if (!checkRefs(input.transitions)) {
    return false;
  }

  return true;
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

const isDirectRun =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  const report = await runRequirementEval();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
