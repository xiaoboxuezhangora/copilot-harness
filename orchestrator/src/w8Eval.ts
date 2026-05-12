import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export type W8NextAction = 'draft_plan' | 'ask_human' | 'need_more_context';

export type W8ReviewDecision =
  | 'accept'
  | 'edit_accept'
  | 'major_edit'
  | 'reject'
  | 'skip'
  | 'not_reviewed';

export interface W8EvalDataset {
  readonly schemaVersion: string;
  readonly samples: readonly W8EvalSample[];
}

export interface W8EvalSample {
  readonly taskId: string;
  readonly evalInputRef: string;
  readonly jiraKey: string;
  readonly sourceRef: string;
  readonly groundTruthRepo: string;
  readonly groundTruthModules: readonly string[];
  readonly gitlabEvidenceRefs: readonly string[];
  readonly expectedNextAction: W8NextAction;
  readonly reviewDecision: W8ReviewDecision;
  readonly highRisk: boolean;
  readonly predicted?: W8Prediction | undefined;
}

export interface W8Prediction {
  readonly gitlabEvidenceRefs: readonly string[];
  readonly repoHints: readonly W8RepoHint[];
  readonly plan: W8PredictedPlan;
  readonly nextAction: W8NextAction;
}

export interface W8RepoHint {
  readonly project: string;
  readonly module: string;
  readonly confidence: number;
  readonly sourceRefs: readonly string[];
}

export interface W8PredictedPlan {
  readonly summary: string;
  readonly steps: readonly string[];
  readonly files: readonly string[];
  readonly risks: readonly string[];
  readonly testHints: readonly string[];
}

export interface W8EvalLoadResult {
  readonly dataset: W8EvalDataset;
  readonly datasetSource: string;
  readonly loadedFromLegacyFallback: boolean;
}

export interface W8AcceptanceProfile {
  readonly schemaVersion: string;
  readonly name: string;
  readonly temporary: boolean;
  readonly reason: string;
  readonly datasetPath?: string | undefined;
  readonly requiredSampleCount: number;
  readonly requiredRealJointSampleCount: number;
  readonly acceptRateTarget: number;
  readonly requireReviewMetrics: boolean;
  readonly reviewTimeTargetMinutes: number;
  readonly finalTarget: {
    readonly requiredSampleCount: number;
    readonly requiredRealJointSampleCount: number;
  };
}

export interface W8ReviewMetrics {
  readonly schemaVersion: string;
  readonly source: string;
  readonly reviewedCount: number;
  readonly acceptedCount: number;
  readonly editAcceptedCount: number;
  readonly rejectedCount: number;
  readonly majorEditCount: number;
  readonly skippedCount: number;
  readonly reviewTimeMinutes: number;
}

export interface W8EvalReport {
  readonly schemaVersion: string;
  readonly generatedAt: string;
  readonly status: 'PASS' | 'FAIL' | 'NOT_READY';
  readonly datasetSource: string;
  readonly loadedFromLegacyFallback: boolean;
  readonly acceptanceProfile: W8AcceptanceProfile;
  readonly environment: W8EnvironmentSummary;
  readonly summary: W8EvalSummary;
  readonly metrics: W8EvalMetrics;
  readonly notReadyReasons: readonly string[];
  readonly failureSamples: readonly W8FailureSample[];
  readonly coverageGapSamples: readonly W8FailureSample[];
  readonly jointSampleSourceRefProof: readonly W8SourceRefProof[];
  readonly samples: readonly W8SampleResult[];
  readonly w9RegressionChecklist: readonly string[];
}

export interface W8EnvironmentSummary {
  readonly gitlabConfigPresent: boolean;
  readonly jiraConfigPresent: boolean;
}

export interface W8EvalSummary {
  readonly sampleCount: number;
  readonly requiredSampleCount: number;
  readonly realJointSampleCount: number;
  readonly requiredRealJointSampleCount: number;
  readonly highRiskSampleCount: number;
}

export interface W8EvalMetrics {
  readonly repoHitAt1: number | null;
  readonly repoHitAt1Numerator: number;
  readonly repoHitAt1Denominator: number;
  readonly planExecutabilityAverage: number;
  readonly planExecutabilityDistribution: Readonly<Record<'0' | '1' | '2', number>>;
  readonly correctionRate: number;
  readonly correctionRateNumerator: number;
  readonly correctionRateDenominator: number;
  readonly sourceRefCoverage: number;
  readonly sourceRefCoverageNumerator: number;
  readonly sourceRefCoverageDenominator: number;
  readonly acceptRate: number | null;
  readonly acceptRateNumerator: number;
  readonly acceptRateDenominator: number;
  readonly reviewTimeMinutes: number | null;
  readonly reviewTimeTargetMinutes: number;
  readonly planExecutabilityTargetDescription: string;
}

export interface W8SampleResult {
  readonly taskId: string;
  readonly jiraKey: string;
  readonly expectedNextAction: W8NextAction;
  readonly predictedNextAction: W8NextAction;
  readonly reviewDecision: W8ReviewDecision;
  readonly highRisk: boolean;
  readonly realJointSample: boolean;
  readonly sourceRefCoverageOk: boolean;
  readonly repoHitAt1: boolean | null;
  readonly repoHitAt1Eligible: boolean;
  readonly planExecutability: 0 | 1 | 2;
  readonly missingRefs: readonly string[];
  readonly reason: string | null;
}

export interface W8FailureSample {
  readonly taskId: string;
  readonly reason: string;
  readonly missingRefs: readonly string[];
  readonly nextAction: W8NextAction;
}

export interface W8SourceRefProof {
  readonly taskId: string;
  readonly jiraRef: string;
  readonly gitlabEvidenceRefs: readonly string[];
  readonly groundTruthRepo: string;
  readonly groundTruthModules: readonly string[];
}

interface W8EvalDatasetJson {
  readonly schema_version: string;
  readonly samples: readonly W8EvalSampleJson[];
}

interface W8EvalSampleJson {
  readonly task_id: string;
  readonly eval_input_ref: string;
  readonly jira_key: string;
  readonly source_ref: string;
  readonly ground_truth_repo: string;
  readonly ground_truth_modules: readonly string[];
  readonly gitlab_evidence_refs: readonly string[];
  readonly expected_next_action: W8NextAction;
  readonly review_decision: W8ReviewDecision;
  readonly high_risk: boolean;
  readonly predicted?: W8PredictionJson | undefined;
}

interface W8PredictionJson {
  readonly gitlab_evidence_refs: readonly string[];
  readonly repo_hints: readonly W8RepoHintJson[];
  readonly plan: W8PredictedPlanJson;
  readonly next_action: W8NextAction;
}

interface W8RepoHintJson {
  readonly project: string;
  readonly module: string;
  readonly confidence: number;
  readonly source_refs: readonly string[];
}

interface W8PredictedPlanJson {
  readonly summary: string;
  readonly steps: readonly string[];
  readonly files: readonly string[];
  readonly risks: readonly string[];
  readonly test_hints: readonly string[];
}

interface LegacyEvalDatasetJson {
  readonly promptVersion: string;
  readonly samples: readonly LegacyEvalSampleJson[];
}

interface LegacyEvalSampleJson {
  readonly task_id: string;
  readonly ground_truth_conclusion: string;
  readonly source_ref: string;
  readonly high_risk: boolean;
}

interface W8EvalReportJson {
  readonly schema_version: string;
  readonly generated_at: string;
  readonly status: W8EvalReport['status'];
  readonly dataset_source: string;
  readonly loaded_from_legacy_fallback: boolean;
  readonly acceptance_profile: W8AcceptanceProfileJson;
  readonly environment: {
    readonly gitlab_config_present: boolean;
    readonly jira_config_present: boolean;
  };
  readonly summary: {
    readonly sample_count: number;
    readonly required_sample_count: number;
    readonly real_joint_sample_count: number;
    readonly required_real_joint_sample_count: number;
    readonly high_risk_sample_count: number;
  };
  readonly metrics: {
    readonly repo_hit_at_1: number | null;
    readonly repo_hit_at_1_numerator: number;
    readonly repo_hit_at_1_denominator: number;
    readonly plan_executability_average: number;
    readonly plan_executability_distribution: Readonly<Record<'0' | '1' | '2', number>>;
    readonly correction_rate: number;
    readonly correction_rate_numerator: number;
    readonly correction_rate_denominator: number;
    readonly source_ref_coverage: number;
    readonly source_ref_coverage_numerator: number;
    readonly source_ref_coverage_denominator: number;
    readonly accept_rate: number | null;
    readonly accept_rate_numerator: number;
    readonly accept_rate_denominator: number;
    readonly review_time_minutes: number | null;
    readonly review_time_target_minutes: number;
    readonly plan_executability_target_description: string;
  };
  readonly not_ready_reasons: readonly string[];
  readonly failure_samples: readonly W8FailureSampleJson[];
  readonly coverage_gap_samples: readonly W8FailureSampleJson[];
  readonly joint_sample_source_ref_proof: readonly W8SourceRefProofJson[];
  readonly samples: readonly W8SampleResultJson[];
  readonly w9_regression_checklist: readonly string[];
}

interface W8AcceptanceProfileJson {
  readonly schema_version: string;
  readonly name: string;
  readonly temporary: boolean;
  readonly reason: string;
  readonly dataset_path?: string | undefined;
  readonly required_sample_count: number;
  readonly required_real_joint_sample_count: number;
  readonly accept_rate_target: number;
  readonly require_review_metrics: boolean;
  readonly review_time_target_minutes: number;
  readonly final_target: {
    readonly required_sample_count: number;
    readonly required_real_joint_sample_count: number;
  };
}

interface W8SampleResultJson {
  readonly task_id: string;
  readonly jira_key: string;
  readonly expected_next_action: W8NextAction;
  readonly predicted_next_action: W8NextAction;
  readonly review_decision: W8ReviewDecision;
  readonly high_risk: boolean;
  readonly real_joint_sample: boolean;
  readonly source_ref_coverage_ok: boolean;
  readonly repo_hit_at_1: boolean | null;
  readonly repo_hit_at_1_eligible: boolean;
  readonly plan_executability: 0 | 1 | 2;
  readonly missing_refs: readonly string[];
  readonly reason: string | null;
}

interface W8FailureSampleJson {
  readonly task_id: string;
  readonly reason: string;
  readonly missing_refs: readonly string[];
  readonly next_action: W8NextAction;
}

interface W8SourceRefProofJson {
  readonly task_id: string;
  readonly jira_ref: string;
  readonly gitlab_evidence_refs: readonly string[];
  readonly ground_truth_repo: string;
  readonly ground_truth_modules: readonly string[];
}

interface W8ReviewMetricsJson {
  readonly schema_version: string;
  readonly source: string;
  readonly reviewed_count: number;
  readonly accepted_count: number;
  readonly edit_accepted_count: number;
  readonly rejected_count: number;
  readonly major_edit_count: number;
  readonly skipped_count: number;
  readonly review_time_minutes: number;
}

const W8_SCHEMA_VERSION = 'phase-1b-w8-eval@1';
const W8_REVIEW_METRICS_SCHEMA_VERSION = 'phase-1b-w8-review-metrics@1';
const W8_ACCEPTANCE_PROFILE_SCHEMA_VERSION = 'phase-1b-w8-acceptance-profile@1';
const DEFAULT_W8_DATASET_PATH = join('eval', 'w8-jira-gitlab-eval-50.json');
const DEFAULT_LEGACY_DATASET_PATH = join('eval', 'jira-eval-50.json');
const DEFAULT_REVIEW_METRICS_PATH = join('eval', 'w8-review-metrics.json');
const DEFAULT_ACCEPTANCE_PROFILE_PATH = join('eval', 'w8-acceptance-profile.json');
const DEFAULT_OUTPUT_JSON_PATH = join('eval', 'w8-report.json');
const DEFAULT_OUTPUT_MD_PATH = join('eval', 'w8-report.md');
const REQUIRED_SAMPLE_COUNT = 50;
const REQUIRED_REAL_JOINT_SAMPLE_COUNT = 20;
const ACCEPT_RATE_TARGET = 0.4;
const REVIEW_TIME_TARGET_MINUTES = 10;
const DEFAULT_ACCEPTANCE_PROFILE: W8AcceptanceProfile = {
  schemaVersion: W8_ACCEPTANCE_PROFILE_SCHEMA_VERSION,
  name: 'w8-final-target',
  temporary: false,
  reason: 'Final W8 acceptance target.',
  requiredSampleCount: REQUIRED_SAMPLE_COUNT,
  requiredRealJointSampleCount: REQUIRED_REAL_JOINT_SAMPLE_COUNT,
  acceptRateTarget: ACCEPT_RATE_TARGET,
  requireReviewMetrics: true,
  reviewTimeTargetMinutes: REVIEW_TIME_TARGET_MINUTES,
  finalTarget: {
    requiredSampleCount: REQUIRED_SAMPLE_COUNT,
    requiredRealJointSampleCount: REQUIRED_REAL_JOINT_SAMPLE_COUNT
  }
};

export async function runW8EvalCli(): Promise<void> {
  const acceptanceProfile = await loadW8AcceptanceProfile(DEFAULT_ACCEPTANCE_PROFILE_PATH);
  const loadResult = await loadW8EvalDataset({
    w8DatasetPath: acceptanceProfile.datasetPath ?? DEFAULT_W8_DATASET_PATH,
    legacyDatasetPath: DEFAULT_LEGACY_DATASET_PATH
  });
  const reviewMetrics = await loadW8ReviewMetrics(DEFAULT_REVIEW_METRICS_PATH);
  const report = buildW8EvalReport(loadResult, reviewMetrics, acceptanceProfile);
  const reportJson = toW8EvalReportJson(report);

  await mkdir(dirname(DEFAULT_OUTPUT_JSON_PATH), { recursive: true });
  await writeFile(DEFAULT_OUTPUT_JSON_PATH, `${JSON.stringify(reportJson, null, 2)}\n`, 'utf8');
  await writeFile(DEFAULT_OUTPUT_MD_PATH, renderW8EvalMarkdown(report), 'utf8');

  process.stdout.write(`${JSON.stringify(reportJson, null, 2)}\n`);
  process.stdout.write(`${renderW8EvalMarkdown(report)}\n`);
}

export async function loadW8ReviewMetrics(path: string): Promise<W8ReviewMetrics | null> {
  if (!(await pathExists(path))) {
    return null;
  }

  const raw = await readFile(path, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  return w8ReviewMetricsFromJson(parseW8ReviewMetricsJson(parsed));
}

export async function loadW8AcceptanceProfile(path: string): Promise<W8AcceptanceProfile> {
  if (!(await pathExists(path))) {
    return DEFAULT_ACCEPTANCE_PROFILE;
  }

  const raw = await readFile(path, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  return w8AcceptanceProfileFromJson(parseW8AcceptanceProfileJson(parsed));
}

export async function loadW8EvalDataset(paths: {
  readonly w8DatasetPath: string;
  readonly legacyDatasetPath: string;
}): Promise<W8EvalLoadResult> {
  if (await pathExists(paths.w8DatasetPath)) {
    const raw = await readFile(paths.w8DatasetPath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    const jsonDataset = parseW8EvalDatasetJson(parsed);
    return {
      dataset: w8DatasetFromJson(jsonDataset),
      datasetSource: paths.w8DatasetPath,
      loadedFromLegacyFallback: false
    };
  }

  const raw = await readFile(paths.legacyDatasetPath, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  const legacyDataset = parseLegacyEvalDatasetJson(parsed);
  return {
    dataset: upgradeLegacyDatasetToW8(legacyDataset),
    datasetSource: `${paths.legacyDatasetPath} (legacy fallback; not W8 acceptance data)`,
    loadedFromLegacyFallback: true
  };
}

export function upgradeLegacyDatasetToW8(dataset: LegacyEvalDatasetJson): W8EvalDataset {
  return {
    schemaVersion: W8_SCHEMA_VERSION,
    samples: dataset.samples.map((sample, index) => {
      const jiraKey = `LEGACY-${String(index + 1).padStart(3, '0')}`;
      return {
        taskId: sample.task_id,
        evalInputRef: `legacy:${DEFAULT_LEGACY_DATASET_PATH}#${sample.task_id}`,
        jiraKey,
        sourceRef: `jira:${jiraKey}`,
        groundTruthRepo: 'unknown',
        groundTruthModules: [],
        gitlabEvidenceRefs: [],
        expectedNextAction: expectedNextActionFromLegacyConclusion(sample.ground_truth_conclusion),
        reviewDecision: 'not_reviewed',
        highRisk: sample.high_risk,
        predicted: buildNoEvidencePrediction(
          'No W8 Jira + GitLab evidence is present in the legacy W6 eval dataset.'
        )
      };
    })
  };
}

export function buildW8EvalReport(
  loadResult: W8EvalLoadResult,
  reviewMetrics: W8ReviewMetrics | null = null,
  acceptanceProfile: W8AcceptanceProfile = DEFAULT_ACCEPTANCE_PROFILE
): W8EvalReport {
  const sampleResults = loadResult.dataset.samples.map((sample) => evaluateW8Sample(sample));
  const realJointSampleResults = sampleResults.filter((result) => result.realJointSample);
  const repoHitEligibleResults = sampleResults.filter((result) => result.repoHitAt1Eligible);
  const repoHitNumerator = repoHitEligibleResults.filter(
    (result) => result.repoHitAt1 === true
  ).length;
  const sourceCoverageNumerator = realJointSampleResults.filter(
    (result) => result.sourceRefCoverageOk
  ).length;
  const correctionNumerator = loadResult.dataset.samples.filter((sample) =>
    isCorrectionDecision(sample.reviewDecision)
  ).length;
  const datasetReviewedSamples = loadResult.dataset.samples.filter((sample) =>
    isReviewedDecision(sample.reviewDecision)
  );
  const datasetAcceptNumerator = datasetReviewedSamples.filter((sample) =>
    isAcceptDecision(sample.reviewDecision)
  ).length;
  const acceptNumerator =
    reviewMetrics === null
      ? datasetAcceptNumerator
      : reviewMetrics.acceptedCount + reviewMetrics.editAcceptedCount;
  const acceptDenominator =
    reviewMetrics === null ? datasetReviewedSamples.length : reviewMetrics.reviewedCount;
  const planDistribution = buildPlanDistribution(sampleResults);
  const metrics: W8EvalMetrics = {
    repoHitAt1:
      repoHitEligibleResults.length === 0
        ? null
        : roundRatio(repoHitNumerator, repoHitEligibleResults.length),
    repoHitAt1Numerator: repoHitNumerator,
    repoHitAt1Denominator: repoHitEligibleResults.length,
    planExecutabilityAverage: roundDecimal(
      sampleResults.reduce((sum, result) => sum + result.planExecutability, 0) /
        Math.max(sampleResults.length, 1),
      4
    ),
    planExecutabilityDistribution: planDistribution,
    correctionRate: roundRatio(correctionNumerator, loadResult.dataset.samples.length),
    correctionRateNumerator: correctionNumerator,
    correctionRateDenominator: loadResult.dataset.samples.length,
    sourceRefCoverage:
      realJointSampleResults.length === 0
        ? 0
        : roundRatio(sourceCoverageNumerator, realJointSampleResults.length),
    sourceRefCoverageNumerator: sourceCoverageNumerator,
    sourceRefCoverageDenominator: realJointSampleResults.length,
    acceptRate: acceptDenominator === 0 ? null : roundRatio(acceptNumerator, acceptDenominator),
    acceptRateNumerator: acceptNumerator,
    acceptRateDenominator: acceptDenominator,
    reviewTimeMinutes: reviewMetrics?.reviewTimeMinutes ?? null,
    reviewTimeTargetMinutes: acceptanceProfile.reviewTimeTargetMinutes,
    planExecutabilityTargetDescription:
      '0/1/2 score; 2 means steps, files, risks, and tests are all present and directly actionable.'
  };
  const environment = buildEnvironmentSummary();
  const notReadyReasons = buildNotReadyReasons(
    loadResult,
    loadResult.dataset.samples,
    realJointSampleResults.length,
    metrics,
    environment,
    acceptanceProfile
  );
  const failures = sampleResults
    .filter((result) => result.reason !== null)
    .map((result) => ({
      taskId: result.taskId,
      reason: result.reason ?? 'unknown',
      missingRefs: result.missingRefs,
      nextAction: result.predictedNextAction
    }));
  const coverageGaps = failures.filter((failure) => failure.missingRefs.length > 0);

  return {
    schemaVersion: loadResult.dataset.schemaVersion,
    generatedAt: new Date().toISOString(),
    status: notReadyReasons.length === 0 ? 'PASS' : 'NOT_READY',
    datasetSource: loadResult.datasetSource,
    loadedFromLegacyFallback: loadResult.loadedFromLegacyFallback,
    acceptanceProfile,
    environment,
    summary: {
      sampleCount: loadResult.dataset.samples.length,
      requiredSampleCount: acceptanceProfile.requiredSampleCount,
      realJointSampleCount: realJointSampleResults.length,
      requiredRealJointSampleCount: acceptanceProfile.requiredRealJointSampleCount,
      highRiskSampleCount: loadResult.dataset.samples.filter((sample) => sample.highRisk).length
    },
    metrics,
    notReadyReasons,
    failureSamples: failures,
    coverageGapSamples: coverageGaps,
    jointSampleSourceRefProof: realJointSampleResults.map((result) => {
      const sample = findSample(loadResult.dataset.samples, result.taskId);
      return {
        taskId: sample.taskId,
        jiraRef: sample.sourceRef,
        gitlabEvidenceRefs: sample.gitlabEvidenceRefs,
        groundTruthRepo: sample.groundTruthRepo,
        groundTruthModules: sample.groundTruthModules
      };
    }),
    samples: sampleResults,
    w9RegressionChecklist: [
      `Raise W8 acceptance profile back to ${acceptanceProfile.finalTarget.requiredSampleCount} samples and ${acceptanceProfile.finalTarget.requiredRealJointSampleCount} real joint samples.`,
      'Run Code Retrieval MCP against the read-only GitLab environment and attach evidence refs to each joint sample.',
      'Run one Review CLI approval pass for the final 50-sample target and record accept_rate plus review_time_minutes.',
      'Re-run eval:w8 and inspect coverage_gap_samples before W9 regression.'
    ]
  };
}

export function evaluateW8Sample(sample: W8EvalSample): W8SampleResult {
  const prediction =
    sample.predicted ??
    buildNoEvidencePrediction('No prediction was attached to this W8 eval sample.');
  const hasJiraRef = sample.sourceRef === `jira:${sample.jiraKey}`;
  const gitlabEvidenceRefs = sample.gitlabEvidenceRefs.filter((ref) => isGitLabSourceRef(ref));
  const codeEvidenceRefs = sample.gitlabEvidenceRefs.filter((ref) => isCodeEvidenceRef(ref));
  const sourceRefCoverageOk = hasJiraRef && gitlabEvidenceRefs.length > 0;
  const realJointSample =
    sourceRefCoverageOk &&
    !isMockLikeEvalInputRef(sample.evalInputRef) &&
    sample.groundTruthRepo.trim().length > 0 &&
    sample.groundTruthRepo !== 'unknown';
  const repoHint = prediction.repoHints[0];
  const repoHintHasEvidence =
    repoHint !== undefined && repoHint.sourceRefs.some((ref) => isCodeEvidenceRef(ref));
  const repoHitAt1Eligible = realJointSample && repoHintHasEvidence;
  const repoHitAt1 =
    repoHitAt1Eligible && repoHint !== undefined
      ? repoHint.project === sample.groundTruthRepo
      : null;
  const missingRefs = buildMissingRefs(hasJiraRef, gitlabEvidenceRefs.length > 0);
  const reason = buildSampleFailureReason({
    sample,
    prediction,
    hasJiraRef,
    hasGitLabEvidence: gitlabEvidenceRefs.length > 0,
    hasAnyCodeEvidence: codeEvidenceRefs.length > 0,
    realJointSample,
    repoHitAt1,
    repoHintHasEvidence
  });

  return {
    taskId: sample.taskId,
    jiraKey: sample.jiraKey,
    expectedNextAction: sample.expectedNextAction,
    predictedNextAction: prediction.nextAction,
    reviewDecision: sample.reviewDecision,
    highRisk: sample.highRisk,
    realJointSample,
    sourceRefCoverageOk,
    repoHitAt1,
    repoHitAt1Eligible,
    planExecutability: scorePlanExecutability(prediction.plan),
    missingRefs,
    reason
  };
}

export function toW8EvalReportJson(report: W8EvalReport): W8EvalReportJson {
  return {
    schema_version: report.schemaVersion,
    generated_at: report.generatedAt,
    status: report.status,
    dataset_source: report.datasetSource,
    loaded_from_legacy_fallback: report.loadedFromLegacyFallback,
    acceptance_profile: toW8AcceptanceProfileJson(report.acceptanceProfile),
    environment: {
      gitlab_config_present: report.environment.gitlabConfigPresent,
      jira_config_present: report.environment.jiraConfigPresent
    },
    summary: {
      sample_count: report.summary.sampleCount,
      required_sample_count: report.summary.requiredSampleCount,
      real_joint_sample_count: report.summary.realJointSampleCount,
      required_real_joint_sample_count: report.summary.requiredRealJointSampleCount,
      high_risk_sample_count: report.summary.highRiskSampleCount
    },
    metrics: {
      repo_hit_at_1: report.metrics.repoHitAt1,
      repo_hit_at_1_numerator: report.metrics.repoHitAt1Numerator,
      repo_hit_at_1_denominator: report.metrics.repoHitAt1Denominator,
      plan_executability_average: report.metrics.planExecutabilityAverage,
      plan_executability_distribution: report.metrics.planExecutabilityDistribution,
      correction_rate: report.metrics.correctionRate,
      correction_rate_numerator: report.metrics.correctionRateNumerator,
      correction_rate_denominator: report.metrics.correctionRateDenominator,
      source_ref_coverage: report.metrics.sourceRefCoverage,
      source_ref_coverage_numerator: report.metrics.sourceRefCoverageNumerator,
      source_ref_coverage_denominator: report.metrics.sourceRefCoverageDenominator,
      accept_rate: report.metrics.acceptRate,
      accept_rate_numerator: report.metrics.acceptRateNumerator,
      accept_rate_denominator: report.metrics.acceptRateDenominator,
      review_time_minutes: report.metrics.reviewTimeMinutes,
      review_time_target_minutes: report.metrics.reviewTimeTargetMinutes,
      plan_executability_target_description: report.metrics.planExecutabilityTargetDescription
    },
    not_ready_reasons: report.notReadyReasons,
    failure_samples: report.failureSamples.map((sample) => ({
      task_id: sample.taskId,
      reason: sample.reason,
      missing_refs: sample.missingRefs,
      next_action: sample.nextAction
    })),
    coverage_gap_samples: report.coverageGapSamples.map((sample) => ({
      task_id: sample.taskId,
      reason: sample.reason,
      missing_refs: sample.missingRefs,
      next_action: sample.nextAction
    })),
    joint_sample_source_ref_proof: report.jointSampleSourceRefProof.map((proof) => ({
      task_id: proof.taskId,
      jira_ref: proof.jiraRef,
      gitlab_evidence_refs: proof.gitlabEvidenceRefs,
      ground_truth_repo: proof.groundTruthRepo,
      ground_truth_modules: proof.groundTruthModules
    })),
    samples: report.samples.map((sample) => ({
      task_id: sample.taskId,
      jira_key: sample.jiraKey,
      expected_next_action: sample.expectedNextAction,
      predicted_next_action: sample.predictedNextAction,
      review_decision: sample.reviewDecision,
      high_risk: sample.highRisk,
      real_joint_sample: sample.realJointSample,
      source_ref_coverage_ok: sample.sourceRefCoverageOk,
      repo_hit_at_1: sample.repoHitAt1,
      repo_hit_at_1_eligible: sample.repoHitAt1Eligible,
      plan_executability: sample.planExecutability,
      missing_refs: sample.missingRefs,
      reason: sample.reason
    })),
    w9_regression_checklist: report.w9RegressionChecklist
  };
}

export function renderW8EvalMarkdown(report: W8EvalReport): string {
  const repoHit =
    report.metrics.repoHitAt1 === null ? 'not_available' : formatPercent(report.metrics.repoHitAt1);
  const acceptRate =
    report.metrics.acceptRate === null ? 'not_available' : formatPercent(report.metrics.acceptRate);
  const reviewTime =
    report.metrics.reviewTimeMinutes === null
      ? 'not_available'
      : `${report.metrics.reviewTimeMinutes} min`;
  const lines: string[] = [
    '# W8 Eval Report',
    '',
    `- status: ${report.status}`,
    `- generated_at: ${report.generatedAt}`,
    `- dataset_source: ${report.datasetSource}`,
    `- acceptance_profile: ${report.acceptanceProfile.name}`,
    `- temporary_profile: ${String(report.acceptanceProfile.temporary)}`,
    `- profile_reason: ${report.acceptanceProfile.reason}`,
    `- sample_count: ${report.summary.sampleCount}/${report.summary.requiredSampleCount}`,
    `- real_joint_sample_count: ${report.summary.realJointSampleCount}/${report.summary.requiredRealJointSampleCount}`,
    `- repo_hit_at_1: ${repoHit} (${report.metrics.repoHitAt1Numerator}/${report.metrics.repoHitAt1Denominator})`,
    `- plan_executability_average: ${report.metrics.planExecutabilityAverage}`,
    `- correction_rate: ${formatPercent(report.metrics.correctionRate)} (${report.metrics.correctionRateNumerator}/${report.metrics.correctionRateDenominator})`,
    `- source_ref_coverage: ${formatPercent(report.metrics.sourceRefCoverage)} (${report.metrics.sourceRefCoverageNumerator}/${report.metrics.sourceRefCoverageDenominator})`,
    `- accept_rate: ${acceptRate} (${report.metrics.acceptRateNumerator}/${report.metrics.acceptRateDenominator})`,
    `- review_time_minutes: ${reviewTime} (target <= ${report.metrics.reviewTimeTargetMinutes})`,
    `- final_target: ${report.acceptanceProfile.finalTarget.requiredSampleCount} samples / ${report.acceptanceProfile.finalTarget.requiredRealJointSampleCount} real joint samples`,
    '',
    '## Environment',
    '',
    `- gitlab_config_present: ${String(report.environment.gitlabConfigPresent)}`,
    `- jira_config_present: ${String(report.environment.jiraConfigPresent)}`,
    '',
    '## Not Ready Reasons',
    ''
  ];

  if (report.notReadyReasons.length === 0) {
    lines.push('- none');
  } else {
    report.notReadyReasons.forEach((reason) => lines.push(`- ${reason}`));
  }

  lines.push('', '## Failure Samples', '');
  if (report.failureSamples.length === 0) {
    lines.push('- none');
  } else {
    report.failureSamples.forEach((sample) => {
      lines.push(
        `- ${sample.taskId}: ${sample.reason}; missing_refs=${sample.missingRefs.join(',') || 'none'}; next_action=${sample.nextAction}`
      );
    });
  }

  lines.push('', '## Joint Sample Source Ref Proof', '');
  if (report.jointSampleSourceRefProof.length === 0) {
    lines.push('- none');
  } else {
    report.jointSampleSourceRefProof.forEach((proof) => {
      lines.push(`- ${proof.taskId}: ${proof.jiraRef}; ${proof.gitlabEvidenceRefs.join('; ')}`);
    });
  }

  lines.push('', '## W9 Regression Checklist', '');
  report.w9RegressionChecklist.forEach((item) => lines.push(`- ${item}`));

  return `${lines.join('\n')}\n`;
}

function w8DatasetFromJson(dataset: W8EvalDatasetJson): W8EvalDataset {
  return {
    schemaVersion: dataset.schema_version,
    samples: dataset.samples.map((sample) => ({
      taskId: sample.task_id,
      evalInputRef: sample.eval_input_ref,
      jiraKey: sample.jira_key,
      sourceRef: sample.source_ref,
      groundTruthRepo: sample.ground_truth_repo,
      groundTruthModules: sample.ground_truth_modules,
      gitlabEvidenceRefs: sample.gitlab_evidence_refs,
      expectedNextAction: sample.expected_next_action,
      reviewDecision: sample.review_decision,
      highRisk: sample.high_risk,
      ...(sample.predicted === undefined
        ? {}
        : {
            predicted: {
              gitlabEvidenceRefs: sample.predicted.gitlab_evidence_refs,
              repoHints: sample.predicted.repo_hints.map((hint) => ({
                project: hint.project,
                module: hint.module,
                confidence: hint.confidence,
                sourceRefs: hint.source_refs
              })),
              plan: {
                summary: sample.predicted.plan.summary,
                steps: sample.predicted.plan.steps,
                files: sample.predicted.plan.files,
                risks: sample.predicted.plan.risks,
                testHints: sample.predicted.plan.test_hints
              },
              nextAction: sample.predicted.next_action
            }
          })
    }))
  };
}

function w8ReviewMetricsFromJson(metrics: W8ReviewMetricsJson): W8ReviewMetrics {
  return {
    schemaVersion: metrics.schema_version,
    source: metrics.source,
    reviewedCount: metrics.reviewed_count,
    acceptedCount: metrics.accepted_count,
    editAcceptedCount: metrics.edit_accepted_count,
    rejectedCount: metrics.rejected_count,
    majorEditCount: metrics.major_edit_count,
    skippedCount: metrics.skipped_count,
    reviewTimeMinutes: metrics.review_time_minutes
  };
}

function w8AcceptanceProfileFromJson(profile: W8AcceptanceProfileJson): W8AcceptanceProfile {
  return {
    schemaVersion: profile.schema_version,
    name: profile.name,
    temporary: profile.temporary,
    reason: profile.reason,
    ...(profile.dataset_path === undefined ? {} : { datasetPath: profile.dataset_path }),
    requiredSampleCount: profile.required_sample_count,
    requiredRealJointSampleCount: profile.required_real_joint_sample_count,
    acceptRateTarget: profile.accept_rate_target,
    requireReviewMetrics: profile.require_review_metrics,
    reviewTimeTargetMinutes: profile.review_time_target_minutes,
    finalTarget: {
      requiredSampleCount: profile.final_target.required_sample_count,
      requiredRealJointSampleCount: profile.final_target.required_real_joint_sample_count
    }
  };
}

function toW8AcceptanceProfileJson(profile: W8AcceptanceProfile): W8AcceptanceProfileJson {
  return {
    schema_version: profile.schemaVersion,
    name: profile.name,
    temporary: profile.temporary,
    reason: profile.reason,
    ...(profile.datasetPath === undefined ? {} : { dataset_path: profile.datasetPath }),
    required_sample_count: profile.requiredSampleCount,
    required_real_joint_sample_count: profile.requiredRealJointSampleCount,
    accept_rate_target: profile.acceptRateTarget,
    require_review_metrics: profile.requireReviewMetrics,
    review_time_target_minutes: profile.reviewTimeTargetMinutes,
    final_target: {
      required_sample_count: profile.finalTarget.requiredSampleCount,
      required_real_joint_sample_count: profile.finalTarget.requiredRealJointSampleCount
    }
  };
}

function parseW8EvalDatasetJson(value: unknown): W8EvalDatasetJson {
  if (!isRecord(value)) {
    throw new Error('W8 eval dataset must be an object');
  }
  const schemaVersion = getString(value, 'schema_version');
  const samples = getArray(value, 'samples').map((sample, index) =>
    parseW8EvalSampleJson(sample, index)
  );
  return {
    schema_version: schemaVersion,
    samples
  };
}

function parseW8EvalSampleJson(value: unknown, index: number): W8EvalSampleJson {
  if (!isRecord(value)) {
    throw new Error(`W8 eval sample at index ${index} must be an object`);
  }
  return {
    task_id: getString(value, 'task_id'),
    eval_input_ref: getString(value, 'eval_input_ref'),
    jira_key: getString(value, 'jira_key'),
    source_ref: getString(value, 'source_ref'),
    ground_truth_repo: getString(value, 'ground_truth_repo'),
    ground_truth_modules: getStringArray(value, 'ground_truth_modules'),
    gitlab_evidence_refs: getStringArray(value, 'gitlab_evidence_refs'),
    expected_next_action: parseNextAction(getString(value, 'expected_next_action')),
    review_decision: parseReviewDecision(getString(value, 'review_decision')),
    high_risk: getBoolean(value, 'high_risk'),
    ...(value.predicted === undefined
      ? {}
      : {
          predicted: parseW8PredictionJson(value.predicted, index)
        })
  };
}

function parseW8PredictionJson(value: unknown, sampleIndex: number): W8PredictionJson {
  if (!isRecord(value)) {
    throw new Error(`W8 eval predicted payload at index ${sampleIndex} must be an object`);
  }
  return {
    gitlab_evidence_refs: getStringArray(value, 'gitlab_evidence_refs'),
    repo_hints: getArray(value, 'repo_hints').map((hint, index) =>
      parseW8RepoHintJson(hint, sampleIndex, index)
    ),
    plan: parseW8PlanJson(value.plan, sampleIndex),
    next_action: parseNextAction(getString(value, 'next_action'))
  };
}

function parseW8RepoHintJson(
  value: unknown,
  sampleIndex: number,
  hintIndex: number
): W8RepoHintJson {
  if (!isRecord(value)) {
    throw new Error(
      `W8 eval repo hint at sample ${sampleIndex}, hint ${hintIndex} must be an object`
    );
  }
  return {
    project: getString(value, 'project'),
    module: getString(value, 'module'),
    confidence: getNumber(value, 'confidence'),
    source_refs: getStringArray(value, 'source_refs')
  };
}

function parseW8PlanJson(value: unknown, sampleIndex: number): W8PredictedPlanJson {
  if (!isRecord(value)) {
    throw new Error(`W8 eval plan at sample ${sampleIndex} must be an object`);
  }
  return {
    summary: getString(value, 'summary'),
    steps: getStringArray(value, 'steps'),
    files: getStringArray(value, 'files'),
    risks: getStringArray(value, 'risks'),
    test_hints: getStringArray(value, 'test_hints')
  };
}

function parseW8ReviewMetricsJson(value: unknown): W8ReviewMetricsJson {
  if (!isRecord(value)) {
    throw new Error('W8 review metrics must be an object');
  }

  const schemaVersion = getString(value, 'schema_version');
  if (schemaVersion !== W8_REVIEW_METRICS_SCHEMA_VERSION) {
    throw new Error(`W8 review metrics schema_version must be ${W8_REVIEW_METRICS_SCHEMA_VERSION}`);
  }

  const metrics = {
    schema_version: schemaVersion,
    source: getString(value, 'source'),
    reviewed_count: getNonNegativeInteger(value, 'reviewed_count'),
    accepted_count: getNonNegativeInteger(value, 'accepted_count'),
    edit_accepted_count: getNonNegativeInteger(value, 'edit_accepted_count'),
    rejected_count: getNonNegativeInteger(value, 'rejected_count'),
    major_edit_count: getNonNegativeInteger(value, 'major_edit_count'),
    skipped_count: getNonNegativeInteger(value, 'skipped_count'),
    review_time_minutes: getNonNegativeNumber(value, 'review_time_minutes')
  };
  const decisionTotal =
    metrics.accepted_count +
    metrics.edit_accepted_count +
    metrics.rejected_count +
    metrics.major_edit_count;
  if (decisionTotal !== metrics.reviewed_count) {
    throw new Error('W8 review metrics reviewed_count must equal accepted+edit_accepted+rejected+major_edit');
  }

  return metrics;
}

function parseW8AcceptanceProfileJson(value: unknown): W8AcceptanceProfileJson {
  if (!isRecord(value)) {
    throw new Error('W8 acceptance profile must be an object');
  }

  const schemaVersion = getString(value, 'schema_version');
  if (schemaVersion !== W8_ACCEPTANCE_PROFILE_SCHEMA_VERSION) {
    throw new Error(
      `W8 acceptance profile schema_version must be ${W8_ACCEPTANCE_PROFILE_SCHEMA_VERSION}`
    );
  }
  const finalTarget = value.final_target;
  if (!isRecord(finalTarget)) {
    throw new Error('W8 acceptance profile final_target must be an object');
  }
  const datasetPath =
    value.dataset_path === undefined ? undefined : getString(value, 'dataset_path');
  return {
    schema_version: schemaVersion,
    name: getString(value, 'name'),
    temporary: getBoolean(value, 'temporary'),
    reason: getString(value, 'reason'),
    ...(datasetPath === undefined ? {} : { dataset_path: datasetPath }),
    required_sample_count: getPositiveInteger(value, 'required_sample_count'),
    required_real_joint_sample_count: getPositiveInteger(
      value,
      'required_real_joint_sample_count'
    ),
    accept_rate_target: getRatio(value, 'accept_rate_target'),
    require_review_metrics: getBoolean(value, 'require_review_metrics'),
    review_time_target_minutes: getNonNegativeNumber(value, 'review_time_target_minutes'),
    final_target: {
      required_sample_count: getPositiveInteger(finalTarget, 'required_sample_count'),
      required_real_joint_sample_count: getPositiveInteger(
        finalTarget,
        'required_real_joint_sample_count'
      )
    }
  };
}

function parseLegacyEvalDatasetJson(value: unknown): LegacyEvalDatasetJson {
  if (!isRecord(value)) {
    throw new Error('Legacy eval dataset must be an object');
  }
  return {
    promptVersion: getString(value, 'promptVersion'),
    samples: getArray(value, 'samples').map((sample, index) => {
      if (!isRecord(sample)) {
        throw new Error(`Legacy eval sample at index ${index} must be an object`);
      }
      return {
        task_id: getString(sample, 'task_id'),
        ground_truth_conclusion: getString(sample, 'ground_truth_conclusion'),
        source_ref: getString(sample, 'source_ref'),
        high_risk: getBoolean(sample, 'high_risk')
      };
    })
  };
}

function buildNoEvidencePrediction(summary: string): W8Prediction {
  return {
    gitlabEvidenceRefs: [],
    repoHints: [],
    plan: {
      summary,
      steps: [],
      files: [],
      risks: ['No GitLab or local repository evidence is attached to this eval sample.'],
      testHints: []
    },
    nextAction: 'need_more_context'
  };
}

function expectedNextActionFromLegacyConclusion(conclusion: string): W8NextAction {
  if (conclusion === 'needs requirement clarification' || conclusion === 'needs safety review') {
    return 'ask_human';
  }
  return 'need_more_context';
}

function buildPlanDistribution(
  results: readonly W8SampleResult[]
): Readonly<Record<'0' | '1' | '2', number>> {
  return results.reduce<Record<'0' | '1' | '2', number>>(
    (accumulator, result) => {
      const key = String(result.planExecutability) as '0' | '1' | '2';
      accumulator[key] += 1;
      return accumulator;
    },
    { '0': 0, '1': 0, '2': 0 }
  );
}

function buildEnvironmentSummary(): W8EnvironmentSummary {
  return {
    gitlabConfigPresent: envHasValue('GITLAB_BASE_URL') && envHasValue('GITLAB_TOKEN'),
    jiraConfigPresent:
      envHasValue('JIRA_BASE_URL') && (envHasValue('JIRA_TOKEN') || envHasValue('JIRA_API_TOKEN'))
  };
}

function buildNotReadyReasons(
  loadResult: W8EvalLoadResult,
  samples: readonly W8EvalSample[],
  realJointSampleCount: number,
  metrics: W8EvalMetrics,
  environment: W8EnvironmentSummary,
  acceptanceProfile: W8AcceptanceProfile
): readonly string[] {
  const reasons: string[] = [];
  if (loadResult.loadedFromLegacyFallback) {
    reasons.push('No W8 real Jira + GitLab dataset file was found; using W6 legacy fallback only.');
  }
  if (samples.length !== acceptanceProfile.requiredSampleCount) {
    reasons.push(
      `Expected ${acceptanceProfile.requiredSampleCount} eval samples, found ${String(samples.length)}.`
    );
  }
  if (realJointSampleCount < acceptanceProfile.requiredRealJointSampleCount) {
    reasons.push(
      `Expected at least ${acceptanceProfile.requiredRealJointSampleCount} real Jira + GitLab joint samples, found ${String(realJointSampleCount)}.`
    );
  }
  if (!environment.gitlabConfigPresent) {
    reasons.push('Read-only GitLab environment is not configured in env.');
  }
  if (!environment.jiraConfigPresent) {
    reasons.push('Read-only Jira environment is not configured in env.');
  }
  if (metrics.sourceRefCoverage < 1) {
    reasons.push('Joint sample source_ref coverage is below 100%.');
  }
  if (
    (acceptanceProfile.requireReviewMetrics || metrics.acceptRate !== null) &&
    (metrics.acceptRate === null || metrics.acceptRate < acceptanceProfile.acceptRateTarget)
  ) {
    reasons.push(
      `Review CLI accept_rate is unavailable or below ${formatPercent(acceptanceProfile.acceptRateTarget)}.`
    );
  }
  if (
    acceptanceProfile.requireReviewMetrics &&
    (metrics.reviewTimeMinutes === null ||
      metrics.reviewTimeMinutes > metrics.reviewTimeTargetMinutes)
  ) {
    reasons.push(
      `Review CLI review time is unavailable or above ${metrics.reviewTimeTargetMinutes} minutes.`
    );
  }
  if (metrics.repoHitAt1 === null) {
    reasons.push('Repo Hit@1 is unavailable because no eligible real joint samples were present.');
  }
  return reasons;
}

function buildMissingRefs(hasJiraRef: boolean, hasGitLabEvidence: boolean): readonly string[] {
  const missingRefs: string[] = [];
  if (!hasJiraRef) {
    missingRefs.push('jira');
  }
  if (!hasGitLabEvidence) {
    missingRefs.push('gitlab');
  }
  return missingRefs;
}

function buildSampleFailureReason(input: {
  readonly sample: W8EvalSample;
  readonly prediction: W8Prediction;
  readonly hasJiraRef: boolean;
  readonly hasGitLabEvidence: boolean;
  readonly hasAnyCodeEvidence: boolean;
  readonly realJointSample: boolean;
  readonly repoHitAt1: boolean | null;
  readonly repoHintHasEvidence: boolean;
}): string | null {
  if (!input.hasJiraRef) {
    return 'missing_jira_source_ref';
  }
  if (!input.hasGitLabEvidence) {
    if (input.prediction.nextAction === 'draft_plan') {
      return 'missing_gitlab_evidence_but_drafted_plan';
    }
    return 'coverage_gap_missing_gitlab_evidence';
  }
  if (!input.hasAnyCodeEvidence && input.prediction.nextAction === 'draft_plan') {
    return 'missing_code_evidence_but_drafted_plan';
  }
  if (!input.realJointSample) {
    return 'sample_is_not_real_joint_evidence';
  }
  if (!input.repoHintHasEvidence && input.prediction.nextAction === 'draft_plan') {
    return 'repo_hint_without_source_ref_but_drafted_plan';
  }
  if (input.repoHitAt1 === false && input.prediction.nextAction === 'draft_plan') {
    return 'repo_hit_at_1_miss_but_drafted_plan';
  }
  if (input.prediction.nextAction !== input.sample.expectedNextAction) {
    return 'next_action_mismatch';
  }
  return null;
}

function scorePlanExecutability(plan: W8PredictedPlan): 0 | 1 | 2 {
  const hasSummary = plan.summary.trim().length > 0;
  const hasSteps = plan.steps.length > 0;
  const hasFiles = plan.files.length > 0;
  const hasRisks = plan.risks.length > 0;
  const hasTests = plan.testHints.length > 0;
  if (hasSummary && hasSteps && hasFiles && hasRisks && hasTests) {
    return 2;
  }
  if (hasSummary && (hasSteps || hasFiles || hasRisks || hasTests)) {
    return 1;
  }
  return 0;
}

function isGitLabSourceRef(ref: string): boolean {
  return /^gitlab:[^#]+#(file:[^@]+@[^#]+#L\d+-L\d+|mr:\d+|commit:[A-Za-z0-9._-]+|pipeline:\d+@[A-Za-z0-9._-]+)$/.test(
    ref
  );
}

function isLocalSourceRef(ref: string): boolean {
  return /^local:[^#]+#file:[^@]+@[^#]+#L\d+-L\d+$/.test(ref);
}

function isCodeEvidenceRef(ref: string): boolean {
  return isGitLabSourceRef(ref) || isLocalSourceRef(ref);
}

function isMockLikeEvalInputRef(ref: string): boolean {
  const lowered = ref.toLowerCase();
  return (
    lowered.includes('mock') ||
    lowered.includes('fixture') ||
    lowered.includes('demo') ||
    lowered.startsWith('legacy:')
  );
}

function isCorrectionDecision(decision: W8ReviewDecision): boolean {
  return decision === 'reject' || decision === 'major_edit';
}

function isAcceptDecision(decision: W8ReviewDecision): boolean {
  return decision === 'accept' || decision === 'edit_accept';
}

function isReviewedDecision(decision: W8ReviewDecision): boolean {
  return (
    decision === 'accept' ||
    decision === 'edit_accept' ||
    decision === 'major_edit' ||
    decision === 'reject'
  );
}

function findSample(samples: readonly W8EvalSample[], taskId: string): W8EvalSample {
  const sample = samples.find((candidate) => candidate.taskId === taskId);
  if (sample === undefined) {
    throw new Error(`Could not find W8 eval sample ${taskId}`);
  }
  return sample;
}

function parseNextAction(value: string): W8NextAction {
  if (value === 'draft_plan' || value === 'ask_human' || value === 'need_more_context') {
    return value;
  }
  throw new Error(`Unsupported W8 next_action: ${value}`);
}

function parseReviewDecision(value: string): W8ReviewDecision {
  if (
    value === 'accept' ||
    value === 'edit_accept' ||
    value === 'major_edit' ||
    value === 'reject' ||
    value === 'skip' ||
    value === 'not_reviewed'
  ) {
    return value;
  }
  throw new Error(`Unsupported W8 review_decision: ${value}`);
}

function getString(record: Readonly<Record<string, unknown>>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string') {
    throw new Error(`Expected string field ${key}`);
  }
  return value;
}

function getBoolean(record: Readonly<Record<string, unknown>>, key: string): boolean {
  const value = record[key];
  if (typeof value !== 'boolean') {
    throw new Error(`Expected boolean field ${key}`);
  }
  return value;
}

function getNumber(record: Readonly<Record<string, unknown>>, key: string): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Expected finite number field ${key}`);
  }
  return value;
}

function getNonNegativeNumber(record: Readonly<Record<string, unknown>>, key: string): number {
  const value = getNumber(record, key);
  if (value < 0) {
    throw new Error(`Expected non-negative number field ${key}`);
  }
  return value;
}

function getNonNegativeInteger(record: Readonly<Record<string, unknown>>, key: string): number {
  const value = getNumber(record, key);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Expected non-negative integer field ${key}`);
  }
  return value;
}

function getPositiveInteger(record: Readonly<Record<string, unknown>>, key: string): number {
  const value = getNumber(record, key);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`Expected positive integer field ${key}`);
  }
  return value;
}

function getRatio(record: Readonly<Record<string, unknown>>, key: string): number {
  const value = getNumber(record, key);
  if (value < 0 || value > 1) {
    throw new Error(`Expected ratio field ${key} in [0, 1]`);
  }
  return value;
}

function getArray(record: Readonly<Record<string, unknown>>, key: string): readonly unknown[] {
  const value = record[key];
  if (!Array.isArray(value)) {
    throw new Error(`Expected array field ${key}`);
  }
  return value;
}

function getStringArray(record: Readonly<Record<string, unknown>>, key: string): readonly string[] {
  return getArray(record, key).map((item, index) => {
    if (typeof item !== 'string') {
      throw new Error(`Expected string item at ${key}[${String(index)}]`);
    }
    return item;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isNodeErrnoException(error) && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

function isNodeErrnoException(error: unknown): error is { readonly code: string } {
  return isRecord(error) && typeof error.code === 'string';
}

function envHasValue(name: string): boolean {
  return (process.env[name] ?? '').trim().length > 0;
}

function roundRatio(numerator: number, denominator: number): number {
  if (denominator <= 0) {
    return 0;
  }
  return roundDecimal(numerator / denominator, 4);
}

function roundDecimal(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runW8EvalCli();
}
