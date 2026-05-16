#!/usr/bin/env tsx
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { resolveRepoRoot } from '../runtime/skillAgentLoader.js';
import {
  RESOLVER_PACKET_V1_JSON_SCHEMA,
  buildResolverPacketV1,
  isRepoEvidenceSourceRef,
  validateResolverPacketV1,
  type ResolverHistoricalRepoHint,
  type ResolverInput,
  type ResolverNextAction,
  type ResolverPacketV1,
  type ResolverRiskLevel
} from './index.js';

export const W14_REPLAY_SCHEMA_VERSION = 'w14-resolver-replay@1';
export const W14_PACKET_COLLECTION_SCHEMA_VERSION = 'w14-resolver-packets@1';
export const W14_TASK_STATE_SCHEMA_VERSION = 'w14-resolver-shadow-state@1';

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
  readonly expected_next_action: string;
  readonly high_risk: boolean;
  readonly predicted?: W8PredictionJson | undefined;
}

interface W8PredictionJson {
  readonly gitlab_evidence_refs: readonly string[];
  readonly repo_hints: readonly W8RepoHintJson[];
  readonly plan: W8PlanJson;
  readonly next_action: string;
}

interface W8RepoHintJson {
  readonly project: string;
  readonly module: string;
  readonly confidence: number;
  readonly source_refs: readonly string[];
}

interface W8PlanJson {
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
  readonly domain: string;
  readonly input_description: string;
  readonly ground_truth_conclusion: string;
  readonly source_ref: string;
  readonly high_risk: boolean;
}

interface W14ReplaySample {
  readonly sampleId: string;
  readonly source: 'w8-current' | 'legacy-eval';
  readonly input: ResolverInput;
  readonly allowedSourceRefs: readonly string[];
  readonly expectedBlocked: boolean;
  readonly expectedBlockedReason: string;
}

interface W14ReplaySampleResult {
  readonly sample_id: string;
  readonly source: W14ReplaySample['source'];
  readonly schema_passed: boolean;
  readonly expected_blocked: boolean;
  readonly expected_blocked_reason: string;
  readonly risk_level: ResolverRiskLevel;
  readonly next_action: ResolverNextAction;
  readonly repo_hint_count: number;
  readonly source_ref_count: number;
  readonly missing_info_count: number;
  readonly issues: readonly string[];
}

interface W14ReplayMetrics {
  readonly sample_count: number;
  readonly schema_pass_rate: number;
  readonly schema_pass_numerator: number;
  readonly schema_pass_denominator: number;
  readonly misrelease_rate: number;
  readonly misrelease_numerator: number;
  readonly misrelease_denominator: number;
  readonly need_more_context_ratio: number;
  readonly need_more_context_numerator: number;
  readonly need_more_context_denominator: number;
  readonly ask_human_count: number;
  readonly await_human_count: number;
  readonly shadow_ready_count: number;
  readonly high_risk_count: number;
  readonly high_risk_await_human_count: number;
  readonly no_repo_evidence_count: number;
  readonly source_ref_fabrication_count: number;
}

interface W14ReplayReport {
  readonly schema_version: typeof W14_REPLAY_SCHEMA_VERSION;
  readonly generated_at: string;
  readonly status: 'PASS' | 'FAIL';
  readonly datasets: readonly string[];
  readonly shadow_guards: W14ShadowGuards;
  readonly metrics: W14ReplayMetrics;
  readonly failures: readonly W14ReplayFailure[];
  readonly samples: readonly W14ReplaySampleResult[];
  readonly artifact_paths: W14ArtifactPaths;
}

interface W14ReplayFailure {
  readonly sample_id: string;
  readonly reason: string;
}

interface W14ShadowGuards {
  readonly git_push: false;
  readonly merge_request_created: false;
  readonly jira_write: false;
  readonly real_fanout: false;
}

interface W14ArtifactPaths {
  readonly resolver_schema: string;
  readonly resolver_packets: string;
  readonly eval_report_json: string;
  readonly eval_report_md: string;
  readonly task_state: string;
}

interface W14PacketCollection {
  readonly schema_version: typeof W14_PACKET_COLLECTION_SCHEMA_VERSION;
  readonly generated_at: string;
  readonly packet_count: number;
  readonly packets: readonly ResolverPacketV1[];
}

interface W14TaskState {
  readonly schema_version: typeof W14_TASK_STATE_SCHEMA_VERSION;
  readonly task_id: 'w14-resolver-shadow';
  readonly turn_state: 'done';
  readonly execution_mode: 'shadow';
  readonly generated_at: string;
  readonly resolver_packet_schema_version: ResolverPacketV1['schema_version'];
  readonly sample_count: number;
  readonly report_status: W14ReplayReport['status'];
  readonly metrics: W14ReplayMetrics;
  readonly artifact_paths: W14ArtifactPaths;
  readonly external_writes: W14ShadowGuards;
}

export interface W14ReplayOptions {
  readonly repoRoot: string;
  readonly generatedAt?: string | undefined;
  readonly w8DatasetPath?: string | undefined;
  readonly legacyDatasetPath?: string | undefined;
  readonly reportsDir?: string | undefined;
  readonly stateDir?: string | undefined;
}

export interface W14ReplayRunResult {
  readonly report: W14ReplayReport;
  readonly packets: readonly ResolverPacketV1[];
  readonly artifactPaths: W14ArtifactPaths;
}

interface CliOptions {
  readonly w8DatasetPath?: string | undefined;
  readonly legacyDatasetPath?: string | undefined;
  readonly reportsDir?: string | undefined;
  readonly stateDir?: string | undefined;
}

export async function runW14ResolverReplay(options: W14ReplayOptions): Promise<W14ReplayRunResult> {
  const repoRoot = resolve(options.repoRoot);
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const w8DatasetPath =
    options.w8DatasetPath ??
    join(repoRoot, 'orchestrator', 'eval', 'w8-jira-gitlab-eval-current.json');
  const legacyDatasetPath =
    options.legacyDatasetPath ?? join(repoRoot, 'orchestrator', 'eval', 'jira-eval-50.json');
  const reportsDir = options.reportsDir ?? join(repoRoot, 'reports', 'w14');
  const stateDir = options.stateDir ?? join(repoRoot, 'state', 'tasks', 'w14');
  const artifactPaths: W14ArtifactPaths = {
    resolver_schema: join(reportsDir, 'resolver-packet.schema.json'),
    resolver_packets: join(reportsDir, 'resolver-packets.json'),
    eval_report_json: join(reportsDir, 'eval-report.json'),
    eval_report_md: join(reportsDir, 'eval-report.md'),
    task_state: join(stateDir, 'resolver-shadow-state.json')
  };

  const samples = await loadReplaySamples(w8DatasetPath, legacyDatasetPath);
  const packets = samples.map((sample) => buildResolverPacketV1(sample.input));
  const sampleResults = samples.map((sample, index) => {
    const packet = packets[index];
    if (packet === undefined) {
      throw new Error(`Missing packet for sample ${sample.sampleId}`);
    }
    return evaluateReplaySample(sample, packet);
  });
  const report = buildReplayReport({
    generatedAt,
    datasetPaths: [w8DatasetPath, legacyDatasetPath],
    artifactPaths,
    sampleResults
  });

  await writeArtifacts({
    generatedAt,
    artifactPaths,
    report,
    packets
  });

  return {
    report,
    packets,
    artifactPaths
  };
}

export async function runW14ResolverReplayCli(): Promise<void> {
  const cliOptions = parseCliOptions(process.argv.slice(2));
  const result = await runW14ResolverReplay({
    repoRoot: resolveRepoRoot(),
    ...(cliOptions.w8DatasetPath === undefined ? {} : { w8DatasetPath: cliOptions.w8DatasetPath }),
    ...(cliOptions.legacyDatasetPath === undefined
      ? {}
      : { legacyDatasetPath: cliOptions.legacyDatasetPath }),
    ...(cliOptions.reportsDir === undefined ? {} : { reportsDir: cliOptions.reportsDir }),
    ...(cliOptions.stateDir === undefined ? {} : { stateDir: cliOptions.stateDir })
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        status: result.report.status,
        sample_count: result.report.metrics.sample_count,
        schema_pass_rate: result.report.metrics.schema_pass_rate,
        misrelease_rate: result.report.metrics.misrelease_rate,
        need_more_context_ratio: result.report.metrics.need_more_context_ratio,
        report_path: result.artifactPaths.eval_report_json,
        task_state_path: result.artifactPaths.task_state
      },
      null,
      2
    )}\n`
  );
}

function evaluateReplaySample(
  sample: W14ReplaySample,
  packet: ResolverPacketV1
): W14ReplaySampleResult {
  const validationIssues = validateResolverPacketV1(packet, {
    allowedSourceRefs: sample.allowedSourceRefs
  });
  const issues = validationIssues.map((issue) => `${issue.field}: ${issue.message}`);

  return {
    sample_id: sample.sampleId,
    source: sample.source,
    schema_passed: validationIssues.length === 0,
    expected_blocked: sample.expectedBlocked,
    expected_blocked_reason: sample.expectedBlockedReason,
    risk_level: packet.risk_level,
    next_action: packet.next_action,
    repo_hint_count: packet.repo_hints.length,
    source_ref_count: packet.source_refs.length,
    missing_info_count: packet.missing_info.length,
    issues
  };
}

function buildReplayReport(input: {
  readonly generatedAt: string;
  readonly datasetPaths: readonly string[];
  readonly artifactPaths: W14ArtifactPaths;
  readonly sampleResults: readonly W14ReplaySampleResult[];
}): W14ReplayReport {
  const schemaPassed = input.sampleResults.filter((sample) => sample.schema_passed);
  const expectedBlocked = input.sampleResults.filter((sample) => sample.expected_blocked);
  const misreleased = expectedBlocked.filter((sample) => sample.next_action === 'shadow_ready');
  const needMoreContext = input.sampleResults.filter(
    (sample) => sample.next_action === 'need_more_context'
  );
  const askHuman = input.sampleResults.filter((sample) => sample.next_action === 'ask_human');
  const awaitHuman = input.sampleResults.filter((sample) => sample.next_action === 'await_human');
  const shadowReady = input.sampleResults.filter((sample) => sample.next_action === 'shadow_ready');
  const highRisk = input.sampleResults.filter((sample) => sample.risk_level === 'L3');
  const noRepoEvidence = input.sampleResults.filter(
    (sample) => sample.expected_blocked_reason === 'missing_repo_evidence'
  );
  const sourceRefFabricationCount = input.sampleResults.reduce(
    (count, sample) =>
      count +
      sample.issues.filter((issue) => issue.includes('source_ref must come from resolver input'))
        .length,
    0
  );
  const metrics: W14ReplayMetrics = {
    sample_count: input.sampleResults.length,
    schema_pass_rate: roundRatio(schemaPassed.length, input.sampleResults.length),
    schema_pass_numerator: schemaPassed.length,
    schema_pass_denominator: input.sampleResults.length,
    misrelease_rate: roundRatio(misreleased.length, expectedBlocked.length),
    misrelease_numerator: misreleased.length,
    misrelease_denominator: expectedBlocked.length,
    need_more_context_ratio: roundRatio(needMoreContext.length, input.sampleResults.length),
    need_more_context_numerator: needMoreContext.length,
    need_more_context_denominator: input.sampleResults.length,
    ask_human_count: askHuman.length,
    await_human_count: awaitHuman.length,
    shadow_ready_count: shadowReady.length,
    high_risk_count: highRisk.length,
    high_risk_await_human_count: highRisk.filter((sample) => sample.next_action === 'await_human')
      .length,
    no_repo_evidence_count: noRepoEvidence.length,
    source_ref_fabrication_count: sourceRefFabricationCount
  };
  const failures = buildFailures(input.sampleResults, metrics);

  return {
    schema_version: W14_REPLAY_SCHEMA_VERSION,
    generated_at: input.generatedAt,
    status: failures.length === 0 ? 'PASS' : 'FAIL',
    datasets: input.datasetPaths,
    shadow_guards: buildShadowGuards(),
    metrics,
    failures,
    samples: input.sampleResults,
    artifact_paths: input.artifactPaths
  };
}

function buildFailures(
  sampleResults: readonly W14ReplaySampleResult[],
  metrics: W14ReplayMetrics
): readonly W14ReplayFailure[] {
  const failures: W14ReplayFailure[] = [];

  for (const sample of sampleResults) {
    if (!sample.schema_passed) {
      failures.push({
        sample_id: sample.sample_id,
        reason: `schema failed: ${sample.issues.join('; ')}`
      });
    }
    if (sample.expected_blocked && sample.next_action === 'shadow_ready') {
      failures.push({
        sample_id: sample.sample_id,
        reason: `misrelease: expected blocked by ${sample.expected_blocked_reason}`
      });
    }
    if (sample.risk_level === 'L3' && sample.next_action !== 'await_human') {
      failures.push({
        sample_id: sample.sample_id,
        reason: 'L3 risk did not await human'
      });
    }
  }

  if (metrics.sample_count < 50) {
    failures.push({
      sample_id: 'dataset',
      reason: `W14 replay requires at least 50 samples, got ${metrics.sample_count}`
    });
  }

  return failures;
}

async function writeArtifacts(input: {
  readonly generatedAt: string;
  readonly artifactPaths: W14ArtifactPaths;
  readonly report: W14ReplayReport;
  readonly packets: readonly ResolverPacketV1[];
}): Promise<void> {
  await Promise.all([
    mkdir(dirname(input.artifactPaths.resolver_schema), { recursive: true }),
    mkdir(dirname(input.artifactPaths.task_state), { recursive: true })
  ]);

  const packetCollection: W14PacketCollection = {
    schema_version: W14_PACKET_COLLECTION_SCHEMA_VERSION,
    generated_at: input.generatedAt,
    packet_count: input.packets.length,
    packets: input.packets
  };
  const taskState: W14TaskState = {
    schema_version: W14_TASK_STATE_SCHEMA_VERSION,
    task_id: 'w14-resolver-shadow',
    turn_state: 'done',
    execution_mode: 'shadow',
    generated_at: input.generatedAt,
    resolver_packet_schema_version: input.packets[0]?.schema_version ?? 'resolver_packet.v1',
    sample_count: input.packets.length,
    report_status: input.report.status,
    metrics: input.report.metrics,
    artifact_paths: input.artifactPaths,
    external_writes: buildShadowGuards()
  };

  await Promise.all([
    writeFile(
      input.artifactPaths.resolver_schema,
      `${JSON.stringify(RESOLVER_PACKET_V1_JSON_SCHEMA, null, 2)}\n`,
      'utf8'
    ),
    writeFile(
      input.artifactPaths.resolver_packets,
      `${JSON.stringify(packetCollection, null, 2)}\n`,
      'utf8'
    ),
    writeFile(
      input.artifactPaths.eval_report_json,
      `${JSON.stringify(input.report, null, 2)}\n`,
      'utf8'
    ),
    writeFile(input.artifactPaths.eval_report_md, renderReplayMarkdown(input.report), 'utf8'),
    writeFile(input.artifactPaths.task_state, `${JSON.stringify(taskState, null, 2)}\n`, 'utf8')
  ]);
}

async function loadReplaySamples(
  w8DatasetPath: string,
  legacyDatasetPath: string
): Promise<readonly W14ReplaySample[]> {
  const [w8Dataset, legacyDataset] = await Promise.all([
    readJson(w8DatasetPath, parseW8EvalDatasetJson),
    readJson(legacyDatasetPath, parseLegacyEvalDatasetJson)
  ]);
  const currentSamples = w8Dataset.samples.map(toW8ReplaySample);
  const legacySamples = legacyDataset.samples.map(toLegacyReplaySample);
  return [...currentSamples, ...legacySamples];
}

function toW8ReplaySample(sample: W8EvalSampleJson): W14ReplaySample {
  const historicalRepoHints: readonly ResolverHistoricalRepoHint[] =
    sample.predicted?.repo_hints.map((hint) => ({
      project: hint.project,
      module: hint.module,
      confidence: hint.confidence,
      sourceRefs: hint.source_refs
    })) ?? [];
  const descriptionParts = [
    sample.predicted?.plan.summary ?? '',
    ...(sample.predicted?.plan.steps ?? []),
    ...(sample.predicted?.plan.risks ?? []),
    ...(sample.predicted?.plan.test_hints ?? [])
  ].filter((part) => part.trim().length > 0);
  const input: ResolverInput = {
    jira: {
      issueKey: sample.jira_key,
      summary: sample.predicted?.plan.summary ?? `Jira ${sample.jira_key}`,
      description: descriptionParts.join(' '),
      labels: ['w8-current', sample.ground_truth_repo, ...sample.ground_truth_modules],
      sourceRef: sample.source_ref
    },
    evidenceRefs: sample.gitlab_evidence_refs,
    historicalRepoHints,
    constraints: ['shadow_replay_from_w8_eval'],
    knownHighRisk: sample.high_risk
  };
  const allowedSourceRefs = dedupe([
    sample.source_ref,
    ...sample.gitlab_evidence_refs,
    ...historicalRepoHints.flatMap((hint) => hint.sourceRefs)
  ]);
  const hasRepoEvidence = sample.gitlab_evidence_refs.some(isRepoEvidenceSourceRef);

  return {
    sampleId: sample.task_id,
    source: 'w8-current',
    input,
    allowedSourceRefs,
    expectedBlocked:
      sample.high_risk || !hasRepoEvidence || sample.expected_next_action !== 'draft_plan',
    expectedBlockedReason: sample.high_risk
      ? 'high_risk'
      : hasRepoEvidence
        ? 'not_blocked'
        : 'missing_repo_evidence'
  };
}

function toLegacyReplaySample(sample: LegacyEvalSampleJson): W14ReplaySample {
  const input: ResolverInput = {
    jira: {
      issueKey: sample.task_id.toUpperCase(),
      summary: sample.input_description,
      description: sample.ground_truth_conclusion,
      labels: [sample.domain],
      sourceRef: sample.source_ref
    },
    evidenceRefs: [],
    historicalRepoHints: [],
    constraints: ['shadow_replay_from_legacy_eval'],
    knownHighRisk: sample.high_risk
  };

  return {
    sampleId: `legacy-${sample.task_id}`,
    source: 'legacy-eval',
    input,
    allowedSourceRefs: [sample.source_ref],
    expectedBlocked: true,
    expectedBlockedReason: sample.high_risk ? 'high_risk' : 'missing_repo_evidence'
  };
}

function renderReplayMarkdown(report: W14ReplayReport): string {
  const lines = [
    '# W14 Resolver Replay',
    '',
    `- status: ${report.status}`,
    `- generated_at: ${report.generated_at}`,
    `- sample_count: ${report.metrics.sample_count}`,
    `- schema_pass_rate: ${formatPercent(report.metrics.schema_pass_rate)} (${report.metrics.schema_pass_numerator}/${report.metrics.schema_pass_denominator})`,
    `- misrelease_rate: ${formatPercent(report.metrics.misrelease_rate)} (${report.metrics.misrelease_numerator}/${report.metrics.misrelease_denominator})`,
    `- need_more_context_ratio: ${formatPercent(report.metrics.need_more_context_ratio)} (${report.metrics.need_more_context_numerator}/${report.metrics.need_more_context_denominator})`,
    `- high_risk_await_human: ${report.metrics.high_risk_await_human_count}/${report.metrics.high_risk_count}`,
    `- source_ref_fabrication_count: ${report.metrics.source_ref_fabrication_count}`,
    '',
    '## Shadow Guards',
    '',
    `- git_push: ${String(report.shadow_guards.git_push)}`,
    `- merge_request_created: ${String(report.shadow_guards.merge_request_created)}`,
    `- jira_write: ${String(report.shadow_guards.jira_write)}`,
    `- real_fanout: ${String(report.shadow_guards.real_fanout)}`,
    '',
    '## Failures',
    ''
  ];

  if (report.failures.length === 0) {
    lines.push('- none');
  } else {
    report.failures.forEach((failure) => {
      lines.push(`- ${failure.sample_id}: ${failure.reason}`);
    });
  }

  lines.push('', '## Datasets', '');
  report.datasets.forEach((dataset) => lines.push(`- ${dataset}`));

  return `${lines.join('\n')}\n`;
}

function buildShadowGuards(): W14ShadowGuards {
  return {
    git_push: false,
    merge_request_created: false,
    jira_write: false,
    real_fanout: false
  };
}

async function readJson<T>(path: string, parse: (value: unknown) => T): Promise<T> {
  const raw = await readFile(path, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  return parse(parsed);
}

function parseW8EvalDatasetJson(value: unknown): W8EvalDatasetJson {
  if (!isRecord(value)) {
    throw new Error('W8 eval dataset must be an object');
  }
  return {
    schema_version: readString(value, 'schema_version'),
    samples: readArray(value, 'samples').map(parseW8EvalSampleJson)
  };
}

function parseW8EvalSampleJson(value: unknown): W8EvalSampleJson {
  if (!isRecord(value)) {
    throw new Error('W8 eval sample must be an object');
  }
  const prediction =
    value.predicted === undefined ? undefined : parseW8PredictionJson(value.predicted);
  return {
    task_id: readString(value, 'task_id'),
    eval_input_ref: readString(value, 'eval_input_ref'),
    jira_key: readString(value, 'jira_key'),
    source_ref: readString(value, 'source_ref'),
    ground_truth_repo: readString(value, 'ground_truth_repo'),
    ground_truth_modules: readStringArray(value, 'ground_truth_modules'),
    gitlab_evidence_refs: readStringArray(value, 'gitlab_evidence_refs'),
    expected_next_action: readString(value, 'expected_next_action'),
    high_risk: readBoolean(value, 'high_risk'),
    ...(prediction === undefined ? {} : { predicted: prediction })
  };
}

function parseW8PredictionJson(value: unknown): W8PredictionJson {
  if (!isRecord(value)) {
    throw new Error('W8 prediction must be an object');
  }
  return {
    gitlab_evidence_refs: readStringArray(value, 'gitlab_evidence_refs'),
    repo_hints: readArray(value, 'repo_hints').map(parseW8RepoHintJson),
    plan: parseW8PlanJson(value.plan),
    next_action: readString(value, 'next_action')
  };
}

function parseW8RepoHintJson(value: unknown): W8RepoHintJson {
  if (!isRecord(value)) {
    throw new Error('W8 repo hint must be an object');
  }
  return {
    project: readString(value, 'project'),
    module: readString(value, 'module'),
    confidence: readNumber(value, 'confidence'),
    source_refs: readStringArray(value, 'source_refs')
  };
}

function parseW8PlanJson(value: unknown): W8PlanJson {
  if (!isRecord(value)) {
    throw new Error('W8 plan must be an object');
  }
  return {
    summary: readString(value, 'summary'),
    steps: readStringArray(value, 'steps'),
    files: readStringArray(value, 'files'),
    risks: readStringArray(value, 'risks'),
    test_hints: readStringArray(value, 'test_hints')
  };
}

function parseLegacyEvalDatasetJson(value: unknown): LegacyEvalDatasetJson {
  if (!isRecord(value)) {
    throw new Error('Legacy eval dataset must be an object');
  }
  return {
    promptVersion: readString(value, 'promptVersion'),
    samples: readArray(value, 'samples').map(parseLegacyEvalSampleJson)
  };
}

function parseLegacyEvalSampleJson(value: unknown): LegacyEvalSampleJson {
  if (!isRecord(value)) {
    throw new Error('Legacy eval sample must be an object');
  }
  return {
    task_id: readString(value, 'task_id'),
    domain: readString(value, 'domain'),
    input_description: readString(value, 'input_description'),
    ground_truth_conclusion: readString(value, 'ground_truth_conclusion'),
    source_ref: readString(value, 'source_ref'),
    high_risk: readBoolean(value, 'high_risk')
  };
}

function parseCliOptions(args: readonly string[]): CliOptions {
  const options: {
    w8DatasetPath?: string;
    legacyDatasetPath?: string;
    reportsDir?: string;
    stateDir?: string;
  } = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === '--w8-dataset' && next !== undefined) {
      options.w8DatasetPath = next;
      index += 1;
    } else if (arg === '--legacy-dataset' && next !== undefined) {
      options.legacyDatasetPath = next;
      index += 1;
    } else if (arg === '--reports-dir' && next !== undefined) {
      options.reportsDir = next;
      index += 1;
    } else if (arg === '--state-dir' && next !== undefined) {
      options.stateDir = next;
      index += 1;
    }
  }

  return options;
}

function readString(value: Readonly<Record<string, unknown>>, field: string): string {
  const fieldValue = value[field];
  if (typeof fieldValue !== 'string') {
    throw new Error(`${field} must be a string`);
  }
  return fieldValue;
}

function readNumber(value: Readonly<Record<string, unknown>>, field: string): number {
  const fieldValue = value[field];
  if (typeof fieldValue !== 'number' || Number.isNaN(fieldValue)) {
    throw new Error(`${field} must be a number`);
  }
  return fieldValue;
}

function readBoolean(value: Readonly<Record<string, unknown>>, field: string): boolean {
  const fieldValue = value[field];
  if (typeof fieldValue !== 'boolean') {
    throw new Error(`${field} must be a boolean`);
  }
  return fieldValue;
}

function readArray(value: Readonly<Record<string, unknown>>, field: string): readonly unknown[] {
  const fieldValue = value[field];
  if (!Array.isArray(fieldValue)) {
    throw new Error(`${field} must be an array`);
  }
  return fieldValue;
}

function readStringArray(
  value: Readonly<Record<string, unknown>>,
  field: string
): readonly string[] {
  return readArray(value, field).map((item) => {
    if (typeof item !== 'string') {
      throw new Error(`${field} items must be strings`);
    }
    return item;
  });
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function roundRatio(numerator: number, denominator: number): number {
  if (denominator === 0) {
    return 0;
  }
  return Number((numerator / denominator).toFixed(4));
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function dedupe(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

const entryPoint =
  process.argv[1] === undefined ? null : pathToFileURL(resolve(process.argv[1])).href;
if (entryPoint === import.meta.url) {
  await runW14ResolverReplayCli();
}
