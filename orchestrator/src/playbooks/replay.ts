#!/usr/bin/env tsx
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import type {
  ResolverIntentKind,
  ResolverNextAction,
  ResolverPacketV1,
  ResolverRepoHintLocator,
  ResolverRiskLevel
} from '../resolver/index.js';
import { resolveRepoRoot } from '../runtime/skillAgentLoader.js';
import {
  PLAYBOOK_DEFINITION_V1_JSON_SCHEMA,
  PLAYBOOK_DEFINITIONS,
  evaluatePlaybookRun,
  selectPlaybookSamples,
  validatePlaybookDefinition,
  type PlaybookDefinitionV1,
  type PlaybookDraftPacketRef,
  type PlaybookId,
  type PlaybookRunResult,
  type PlaybookRunStatus
} from './index.js';

export const W17_SHADOW_SCHEMA_VERSION = 'w17-playbook-shadow@1';
export const W17_PLAYBOOK_COLLECTION_SCHEMA_VERSION = 'w17-playbook-definitions@1';
export const W17_REVIEW_QUEUE_SCHEMA_VERSION = 'w17-review-queue@1';
export const W17_TASK_STATE_SCHEMA_VERSION = 'w17-playbook-shadow-state@1';

interface W14PacketCollectionJson {
  readonly schema_version: string;
  readonly packets: readonly ResolverPacketV1[];
}

interface W15DraftPacketCollectionJson {
  readonly schema_version: string;
  readonly packets: readonly PlaybookDraftPacketRef[];
}

interface W17ReplayOptions {
  readonly repoRoot: string;
  readonly generatedAt?: string | undefined;
  readonly resolverPacketsPath?: string | undefined;
  readonly draftPacketsPath?: string | undefined;
  readonly reportsDir?: string | undefined;
  readonly stateDir?: string | undefined;
  readonly sampleCountPerPlaybook?: number | undefined;
}

interface W17RunResult {
  readonly report: W17ShadowReport;
  readonly reviewQueue: W17ReviewQueue;
  readonly artifactPaths: W17ArtifactPaths;
}

interface W17ArtifactPaths {
  readonly playbook_schema: string;
  readonly playbooks_json: string;
  readonly playbook_docs_dir: string;
  readonly weekly_report_json: string;
  readonly weekly_report_md: string;
  readonly review_queue_json: string;
  readonly next_week_fixes_md: string;
  readonly audit_jsonl: string;
  readonly task_state: string;
}

interface W17PlaybookCollection {
  readonly schema_version: typeof W17_PLAYBOOK_COLLECTION_SCHEMA_VERSION;
  readonly generated_at: string;
  readonly playbook_count: number;
  readonly playbooks: readonly PlaybookDefinitionV1[];
}

interface W17ShadowReport {
  readonly schema_version: typeof W17_SHADOW_SCHEMA_VERSION;
  readonly generated_at: string;
  readonly shadow_week: {
    readonly start_date: string;
    readonly end_date: string;
    readonly timezone: 'UTC';
  };
  readonly status: 'PASS' | 'FAIL';
  readonly resolver_packets_path: string;
  readonly draft_packets_path: string;
  readonly sample_count_per_playbook: number;
  readonly playbook_count: number;
  readonly total_run_count: number;
  readonly metrics: W17AggregateMetrics;
  readonly playbooks: readonly W17PlaybookSummary[];
  readonly runs: readonly PlaybookRunResult[];
  readonly review_queue_path: string;
  readonly next_week_fixes_path: string;
  readonly audit_path: string;
  readonly external_writes: {
    readonly git_push: false;
    readonly merge_request_created: false;
    readonly jira_write: false;
    readonly auto_merge: false;
  };
  readonly issues: readonly W17ReportIssue[];
  readonly artifact_paths: W17ArtifactPaths;
}

interface W17AggregateMetrics {
  readonly classification_pass_rate: number;
  readonly classification_pass_numerator: number;
  readonly classification_pass_denominator: number;
  readonly shadow_success_count: number;
  readonly needs_human_review_count: number;
  readonly blocked_missing_evidence_count: number;
  readonly blocked_high_risk_count: number;
  readonly unsafe_auto_success_count: number;
  readonly avg_handling_minutes: number;
  readonly review_queue_count: number;
}

interface W17PlaybookSummary {
  readonly playbook_id: PlaybookId;
  readonly playbook_name: string;
  readonly sample_count: number;
  readonly status_counts: Readonly<Record<PlaybookRunStatus, number>>;
  readonly metrics: W17AggregateMetrics;
  readonly slo: PlaybookDefinitionV1['slo'];
  readonly slo_breaches: readonly string[];
}

interface W17ReportIssue {
  readonly severity: 'SECURITY' | 'QUALITY';
  readonly playbook_id: PlaybookId | 'all';
  readonly message: string;
}

interface W17ReviewQueue {
  readonly schema_version: typeof W17_REVIEW_QUEUE_SCHEMA_VERSION;
  readonly generated_at: string;
  readonly item_count: number;
  readonly items: readonly W17ReviewQueueItem[];
  readonly blocked_item_count: number;
  readonly blocked_items: readonly W17ReviewQueueItem[];
  readonly next_week_fixes: readonly W17NextWeekFixItem[];
}

interface W17ReviewQueueItem {
  readonly trace_ref: string;
  readonly playbook_id: PlaybookId;
  readonly issue_key: string;
  readonly risk_level: ResolverRiskLevel;
  readonly failure_reason: string;
  readonly root_cause: string;
  readonly next_fix: string;
  readonly source_refs: readonly string[];
  readonly missing_info: readonly string[];
  readonly priority: 'P0' | 'P1' | 'P2';
}

interface W17NextWeekFixItem {
  readonly rank: number;
  readonly root_cause: string;
  readonly sample_count: number;
  readonly affected_playbooks: readonly PlaybookId[];
  readonly recommended_fix: string;
}

interface W17TaskState {
  readonly schema_version: typeof W17_TASK_STATE_SCHEMA_VERSION;
  readonly task_id: 'w17-playbook-shadow';
  readonly turn_state: 'done';
  readonly execution_mode: 'shadow';
  readonly generated_at: string;
  readonly report_status: W17ShadowReport['status'];
  readonly playbook_count: number;
  readonly total_run_count: number;
  readonly metrics: W17AggregateMetrics;
  readonly artifact_paths: W17ArtifactPaths;
  readonly external_writes: W17ShadowReport['external_writes'];
}

interface CliOptions {
  readonly resolverPacketsPath?: string | undefined;
  readonly draftPacketsPath?: string | undefined;
  readonly reportsDir?: string | undefined;
  readonly stateDir?: string | undefined;
  readonly sampleCountPerPlaybook?: number | undefined;
}

export async function runW17PlaybookShadow(options: W17ReplayOptions): Promise<W17RunResult> {
  const repoRoot = resolve(options.repoRoot);
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const resolverPacketsPath =
    options.resolverPacketsPath ?? join(repoRoot, 'reports', 'w14', 'resolver-packets.json');
  const draftPacketsPath =
    options.draftPacketsPath ?? join(repoRoot, 'reports', 'w15', 'draft-mr-packets.json');
  const reportsDir = options.reportsDir ?? join(repoRoot, 'reports', 'w17');
  const stateDir = options.stateDir ?? join(repoRoot, 'state', 'tasks', 'w17');
  const sampleCountPerPlaybook = options.sampleCountPerPlaybook ?? 5;
  const artifactPaths: W17ArtifactPaths = {
    playbook_schema: join(reportsDir, 'playbook.schema.json'),
    playbooks_json: join(reportsDir, 'playbooks.json'),
    playbook_docs_dir: join(reportsDir, 'playbooks'),
    weekly_report_json: join(reportsDir, 'weekly-shadow-report.json'),
    weekly_report_md: join(reportsDir, 'weekly-shadow-report.md'),
    review_queue_json: join(reportsDir, 'review-queue.json'),
    next_week_fixes_md: join(reportsDir, 'next-week-fixes.md'),
    audit_jsonl: join(reportsDir, 'audit.jsonl'),
    task_state: join(stateDir, 'playbook-shadow-state.json')
  };

  const resolverPackets = await loadResolverPackets(resolverPacketsPath);
  const draftPackets = await loadDraftPackets(draftPacketsPath);
  const draftByIssueKey = indexDraftPacketsByIssueKey(draftPackets);
  const playbooks = PLAYBOOK_DEFINITIONS;
  const runs = playbooks.flatMap((playbook) =>
    selectPlaybookSamples({
      playbook,
      packets: resolverPackets,
      sampleCount: sampleCountPerPlaybook
    }).map((packet, index) => {
      const traceRef = `w17:shadow:${playbook.id}:${String(index + 1).padStart(2, '0')}:${packet.intent.issue_key}`;
      return evaluatePlaybookRun({
        playbook,
        resolverPacket: packet,
        draftMrPacket: draftByIssueKey.get(packet.intent.issue_key),
        traceRef
      });
    })
  );
  const reviewQueue = buildReviewQueue({
    generatedAt,
    runs,
    resolverPackets
  });
  const report = buildShadowReport({
    generatedAt,
    resolverPacketsPath,
    draftPacketsPath,
    sampleCountPerPlaybook,
    artifactPaths,
    playbooks,
    runs,
    reviewQueue
  });

  await writeArtifacts({
    generatedAt,
    artifactPaths,
    report,
    playbooks,
    reviewQueue
  });

  return {
    report,
    reviewQueue,
    artifactPaths
  };
}

export async function runW17PlaybookShadowCli(): Promise<void> {
  const cliOptions = parseCliOptions(process.argv.slice(2));
  const result = await runW17PlaybookShadow({
    repoRoot: resolveRepoRoot(),
    ...(cliOptions.resolverPacketsPath === undefined
      ? {}
      : { resolverPacketsPath: cliOptions.resolverPacketsPath }),
    ...(cliOptions.draftPacketsPath === undefined
      ? {}
      : { draftPacketsPath: cliOptions.draftPacketsPath }),
    ...(cliOptions.reportsDir === undefined ? {} : { reportsDir: cliOptions.reportsDir }),
    ...(cliOptions.stateDir === undefined ? {} : { stateDir: cliOptions.stateDir }),
    ...(cliOptions.sampleCountPerPlaybook === undefined
      ? {}
      : { sampleCountPerPlaybook: cliOptions.sampleCountPerPlaybook })
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        status: result.report.status,
        playbook_count: result.report.playbook_count,
        total_run_count: result.report.total_run_count,
        classification_pass_rate: result.report.metrics.classification_pass_rate,
        unsafe_auto_success_count: result.report.metrics.unsafe_auto_success_count,
        shadow_success_count: result.report.metrics.shadow_success_count,
        needs_human_review_count: result.report.metrics.needs_human_review_count,
        blocked_missing_evidence_count: result.report.metrics.blocked_missing_evidence_count,
        blocked_high_risk_count: result.report.metrics.blocked_high_risk_count,
        review_queue_count: result.report.metrics.review_queue_count,
        report_path: result.artifactPaths.weekly_report_json
      },
      null,
      2
    )}\n`
  );
}

function buildShadowReport(input: {
  readonly generatedAt: string;
  readonly resolverPacketsPath: string;
  readonly draftPacketsPath: string;
  readonly sampleCountPerPlaybook: number;
  readonly artifactPaths: W17ArtifactPaths;
  readonly playbooks: readonly PlaybookDefinitionV1[];
  readonly runs: readonly PlaybookRunResult[];
  readonly reviewQueue: W17ReviewQueue;
}): W17ShadowReport {
  const playbookSummaries = input.playbooks.map((playbook) => {
    const runs = input.runs.filter((run) => run.playbook_id === playbook.id);
    return buildPlaybookSummary(playbook, runs);
  });
  const definitionIssues = input.playbooks.flatMap((playbook) =>
    validatePlaybookDefinition(playbook).map(
      (issue): W17ReportIssue => ({
        severity: 'QUALITY',
        playbook_id: issue.playbook_id,
        message: `${issue.field}: ${issue.message}`
      })
    )
  );
  const sampleIssues = playbookSummaries
    .filter((summary) => summary.sample_count < summary.slo.sample_minimum)
    .map(
      (summary): W17ReportIssue => ({
        severity: 'QUALITY',
        playbook_id: summary.playbook_id,
        message: `sample_count ${summary.sample_count} is below minimum ${summary.slo.sample_minimum}`
      })
    );
  const externalWriteIssue = input.runs.some(
    (run) =>
      run.external_writes.git_push ||
      run.external_writes.merge_request_created ||
      run.external_writes.jira_write
  )
    ? [
        {
          severity: 'SECURITY',
          playbook_id: 'all',
          message: 'external write detected in shadow run'
        } satisfies W17ReportIssue
      ]
    : [];
  const metrics = calculateMetrics(input.runs);
  const classificationIssues =
    metrics.classification_pass_rate === 1 && metrics.unsafe_auto_success_count === 0
      ? []
      : [
          {
            severity: 'QUALITY',
            playbook_id: 'all',
            message: 'shadow classification did not reach engineering closure'
          } satisfies W17ReportIssue
        ];
  const issues = [
    ...definitionIssues,
    ...sampleIssues,
    ...externalWriteIssue,
    ...classificationIssues
  ];

  return {
    schema_version: W17_SHADOW_SCHEMA_VERSION,
    generated_at: input.generatedAt,
    shadow_week: buildShadowWeek(input.generatedAt),
    status: issues.length === 0 ? 'PASS' : 'FAIL',
    resolver_packets_path: input.resolverPacketsPath,
    draft_packets_path: input.draftPacketsPath,
    sample_count_per_playbook: input.sampleCountPerPlaybook,
    playbook_count: input.playbooks.length,
    total_run_count: input.runs.length,
    metrics,
    playbooks: playbookSummaries,
    runs: input.runs,
    review_queue_path: input.artifactPaths.review_queue_json,
    next_week_fixes_path: input.artifactPaths.next_week_fixes_md,
    audit_path: input.artifactPaths.audit_jsonl,
    external_writes: {
      git_push: false,
      merge_request_created: false,
      jira_write: false,
      auto_merge: false
    },
    issues,
    artifact_paths: input.artifactPaths
  };
}

function buildPlaybookSummary(
  playbook: PlaybookDefinitionV1,
  runs: readonly PlaybookRunResult[]
): W17PlaybookSummary {
  const metrics = calculateMetrics(runs);
  const sloBreaches = buildSloBreaches(playbook, metrics);
  return {
    playbook_id: playbook.id,
    playbook_name: playbook.name,
    sample_count: runs.length,
    status_counts: {
      shadow_success: runs.filter((run) => run.status === 'shadow_success').length,
      needs_human_review: runs.filter((run) => run.status === 'needs_human_review').length,
      blocked_missing_evidence: runs.filter((run) => run.status === 'blocked_missing_evidence')
        .length,
      blocked_high_risk: runs.filter((run) => run.status === 'blocked_high_risk').length
    },
    metrics,
    slo: playbook.slo,
    slo_breaches: sloBreaches
  };
}

function buildSloBreaches(
  playbook: PlaybookDefinitionV1,
  metrics: W17AggregateMetrics
): readonly string[] {
  const breaches: string[] = [];
  void playbook;
  if (metrics.classification_pass_rate < 1) {
    breaches.push(
      `classification_pass_rate ${formatPercent(metrics.classification_pass_rate)} below target 100.00%`
    );
  }
  if (metrics.unsafe_auto_success_count > 0) {
    breaches.push(`unsafe_auto_success_count ${metrics.unsafe_auto_success_count} above target 0`);
  }
  return breaches;
}

function calculateMetrics(runs: readonly PlaybookRunResult[]): W17AggregateMetrics {
  const classificationPassed = runs.filter(isClassificationCorrect).length;
  const shadowSuccess = runs.filter((run) => run.status === 'shadow_success').length;
  const needsHumanReview = runs.filter((run) => run.status === 'needs_human_review').length;
  const blockedMissingEvidence = runs.filter(
    (run) => run.status === 'blocked_missing_evidence'
  ).length;
  const blockedHighRisk = runs.filter((run) => run.status === 'blocked_high_risk').length;
  const unsafeAutoSuccess = runs.filter(isUnsafeAutoSuccess).length;
  const totalHandlingMinutes = runs.reduce(
    (total, run) => total + run.estimated_handling_minutes,
    0
  );
  return {
    classification_pass_rate: roundRatio(classificationPassed, runs.length),
    classification_pass_numerator: classificationPassed,
    classification_pass_denominator: runs.length,
    shadow_success_count: shadowSuccess,
    needs_human_review_count: needsHumanReview,
    blocked_missing_evidence_count: blockedMissingEvidence,
    blocked_high_risk_count: blockedHighRisk,
    unsafe_auto_success_count: unsafeAutoSuccess,
    avg_handling_minutes: runs.length === 0 ? 0 : Math.round(totalHandlingMinutes / runs.length),
    review_queue_count: needsHumanReview + blockedHighRisk
  };
}

function isClassificationCorrect(run: PlaybookRunResult): boolean {
  if (run.failure_reason === null) {
    return run.status === 'shadow_success';
  }
  if (run.failure_reason === 'missing_source_ref') {
    return run.status === 'blocked_missing_evidence';
  }
  if (run.failure_reason === 'high_risk_requires_human') {
    return run.status === 'blocked_high_risk';
  }
  return run.status === 'needs_human_review';
}

function isUnsafeAutoSuccess(run: PlaybookRunResult): boolean {
  return (
    run.status === 'shadow_success' &&
    (run.failure_reason !== null ||
      run.repo_evidence_refs.length === 0 ||
      run.risk_level === 'L3' ||
      run.resolver_next_action !== 'shadow_ready' ||
      run.approval_gate !== 'shadow_only')
  );
}

function buildReviewQueue(input: {
  readonly generatedAt: string;
  readonly runs: readonly PlaybookRunResult[];
  readonly resolverPackets: readonly ResolverPacketV1[];
}): W17ReviewQueue {
  const resolverByIssueKey = new Map(
    input.resolverPackets.map((packet) => [packet.intent.issue_key, packet] as const)
  );
  const items = input.runs
    .filter((run) => run.status === 'needs_human_review' || run.status === 'blocked_high_risk')
    .map((run) => buildReviewQueueItem(run, resolverByIssueKey.get(run.issue_key)))
    .sort(compareReviewQueueItems);
  const blockedItems = input.runs
    .filter((run) => run.status === 'blocked_missing_evidence')
    .map((run) => buildReviewQueueItem(run, resolverByIssueKey.get(run.issue_key)))
    .sort(compareReviewQueueItems);
  return {
    schema_version: W17_REVIEW_QUEUE_SCHEMA_VERSION,
    generated_at: input.generatedAt,
    item_count: items.length,
    items,
    blocked_item_count: blockedItems.length,
    blocked_items: blockedItems,
    next_week_fixes: buildNextWeekFixes([...items, ...blockedItems])
  };
}

function buildReviewQueueItem(
  run: PlaybookRunResult,
  resolverPacket: ResolverPacketV1 | undefined
): W17ReviewQueueItem {
  const rootCause = mapFailureRootCause(run.failure_reason);
  return {
    trace_ref: run.trace_ref,
    playbook_id: run.playbook_id,
    issue_key: run.issue_key,
    risk_level: run.risk_level,
    failure_reason: run.failure_reason ?? 'unknown',
    root_cause: rootCause,
    next_fix: recommendedFixForRootCause(rootCause),
    source_refs: run.source_refs,
    missing_info: resolverPacket?.missing_info ?? [],
    priority: priorityForRun(run)
  };
}

function buildNextWeekFixes(items: readonly W17ReviewQueueItem[]): readonly W17NextWeekFixItem[] {
  const byRootCause = new Map<string, W17ReviewQueueItem[]>();
  items.forEach((item) => {
    const existing = byRootCause.get(item.root_cause) ?? [];
    byRootCause.set(item.root_cause, [...existing, item]);
  });

  return [...byRootCause.entries()]
    .map(([rootCause, rootItems]) => ({
      rootCause,
      rootItems
    }))
    .sort((left, right) => right.rootItems.length - left.rootItems.length)
    .map((group, index): W17NextWeekFixItem => {
      const affectedPlaybooks = dedupe(group.rootItems.map((item) => item.playbook_id));
      return {
        rank: index + 1,
        root_cause: group.rootCause,
        sample_count: group.rootItems.length,
        affected_playbooks: affectedPlaybooks,
        recommended_fix: recommendedFixForRootCause(group.rootCause)
      };
    });
}

async function writeArtifacts(input: {
  readonly generatedAt: string;
  readonly artifactPaths: W17ArtifactPaths;
  readonly report: W17ShadowReport;
  readonly playbooks: readonly PlaybookDefinitionV1[];
  readonly reviewQueue: W17ReviewQueue;
}): Promise<void> {
  await Promise.all([
    mkdir(dirname(input.artifactPaths.playbook_schema), { recursive: true }),
    mkdir(input.artifactPaths.playbook_docs_dir, { recursive: true }),
    mkdir(dirname(input.artifactPaths.task_state), { recursive: true })
  ]);

  const playbookCollection: W17PlaybookCollection = {
    schema_version: W17_PLAYBOOK_COLLECTION_SCHEMA_VERSION,
    generated_at: input.generatedAt,
    playbook_count: input.playbooks.length,
    playbooks: input.playbooks
  };
  const taskState: W17TaskState = {
    schema_version: W17_TASK_STATE_SCHEMA_VERSION,
    task_id: 'w17-playbook-shadow',
    turn_state: 'done',
    execution_mode: 'shadow',
    generated_at: input.generatedAt,
    report_status: input.report.status,
    playbook_count: input.report.playbook_count,
    total_run_count: input.report.total_run_count,
    metrics: input.report.metrics,
    artifact_paths: input.artifactPaths,
    external_writes: input.report.external_writes
  };

  await Promise.all([
    writeFile(
      input.artifactPaths.playbook_schema,
      `${JSON.stringify(PLAYBOOK_DEFINITION_V1_JSON_SCHEMA, null, 2)}\n`,
      'utf8'
    ),
    writeFile(
      input.artifactPaths.playbooks_json,
      `${JSON.stringify(playbookCollection, null, 2)}\n`,
      'utf8'
    ),
    ...input.playbooks.map((playbook) =>
      writeFile(
        join(input.artifactPaths.playbook_docs_dir, `${playbook.id}.md`),
        renderPlaybookMarkdown(playbook),
        'utf8'
      )
    ),
    writeFile(
      input.artifactPaths.weekly_report_json,
      `${JSON.stringify(input.report, null, 2)}\n`,
      'utf8'
    ),
    writeFile(
      input.artifactPaths.weekly_report_md,
      renderWeeklyReportMarkdown(input.report),
      'utf8'
    ),
    writeFile(
      input.artifactPaths.review_queue_json,
      `${JSON.stringify(input.reviewQueue, null, 2)}\n`,
      'utf8'
    ),
    writeFile(
      input.artifactPaths.next_week_fixes_md,
      renderNextWeekFixes(input.reviewQueue),
      'utf8'
    ),
    writeFile(
      input.artifactPaths.audit_jsonl,
      renderAuditJsonl(input.report, input.reviewQueue),
      'utf8'
    ),
    writeFile(input.artifactPaths.task_state, `${JSON.stringify(taskState, null, 2)}\n`, 'utf8')
  ]);
}

function renderPlaybookMarkdown(playbook: PlaybookDefinitionV1): string {
  return [
    `# ${playbook.name}`,
    '',
    `- schema_version: ${playbook.schema_version}`,
    `- id: ${playbook.id}`,
    `- description: ${playbook.description}`,
    '',
    '## Trigger Conditions',
    ...playbook.trigger_conditions.map((condition) => `- ${condition}`),
    '',
    '## Input Contract',
    `- required_packets: ${playbook.input_contract.required_packets.join(', ')}`,
    `- optional_packets: ${playbook.input_contract.optional_packets.join(', ')}`,
    ...playbook.input_contract.evidence_requirements.map((item) => `- evidence: ${item}`),
    `- forbidden_actions: ${playbook.input_contract.forbidden_actions.join(', ')}`,
    '',
    '## Step Graph',
    ...playbook.step_graph.nodes.map((node) => `- ${node.id}: ${node.title} - ${node.action}`),
    '',
    '## Failure Branches',
    ...playbook.failure_branches.map(
      (branch) =>
        `- ${branch.condition}: ${branch.action}; queue_reason=${branch.review_queue_reason}`
    ),
    '',
    '## Rollback Actions',
    ...playbook.rollback_actions.map((action) => `- ${action}`),
    '',
    '## SLO',
    `- sample_minimum: ${playbook.slo.sample_minimum}`,
    `- target_success_rate: ${formatPercent(playbook.slo.target_success_rate)}`,
    `- max_fallback_rate: ${formatPercent(playbook.slo.max_fallback_rate)}`,
    `- max_human_intervention_rate: ${formatPercent(playbook.slo.max_human_intervention_rate)}`,
    `- target_avg_handling_minutes: ${playbook.slo.target_avg_handling_minutes}`,
    '',
    '## Source Ref Rules',
    `- allowed_prefixes: ${playbook.source_ref_rules.allowed_prefixes.join(', ')}`,
    `- minimum_repo_evidence_refs: ${playbook.source_ref_rules.minimum_repo_evidence_refs}`,
    `- missing_source_ref_action: ${playbook.source_ref_rules.missing_source_ref_action}`,
    `- fabrication_guard: ${playbook.source_ref_rules.fabrication_guard}`,
    '',
    '## Approval Thresholds',
    ...Object.entries(playbook.approval_thresholds).map(([risk, gate]) => `- ${risk}: ${gate}`),
    ''
  ].join('\n');
}

function renderWeeklyReportMarkdown(report: W17ShadowReport): string {
  const lines = [
    '# W17 Playbook Shadow Weekly Report',
    '',
    `- status: ${report.status}`,
    `- generated_at: ${report.generated_at}`,
    `- shadow_week: ${report.shadow_week.start_date} to ${report.shadow_week.end_date} (${report.shadow_week.timezone})`,
    `- playbook_count: ${report.playbook_count}`,
    `- total_run_count: ${report.total_run_count}`,
    `- engineering_closure_status: ${report.status === 'PASS' ? 'complete' : 'incomplete'}`,
    `- classification_pass_rate: ${formatPercent(report.metrics.classification_pass_rate)} (${report.metrics.classification_pass_numerator}/${report.metrics.classification_pass_denominator})`,
    `- unsafe_auto_success_count: ${report.metrics.unsafe_auto_success_count}`,
    `- shadow_success_count: ${report.metrics.shadow_success_count}`,
    `- needs_human_review_count: ${report.metrics.needs_human_review_count}`,
    `- blocked_missing_evidence_count: ${report.metrics.blocked_missing_evidence_count}`,
    `- blocked_high_risk_count: ${report.metrics.blocked_high_risk_count}`,
    `- avg_handling_minutes: ${report.metrics.avg_handling_minutes}`,
    `- review_queue_count: ${report.metrics.review_queue_count}`,
    `- note: W17 validates shadow classification and audit closure; it does not indicate real auto-execution or release readiness.`,
    '',
    '## Playbooks',
    ''
  ];

  report.playbooks.forEach((playbook) => {
    lines.push(
      `- ${playbook.playbook_name}: samples=${playbook.sample_count}; shadow_success=${playbook.status_counts.shadow_success}; needs_human_review=${playbook.status_counts.needs_human_review}; blocked_missing_evidence=${playbook.status_counts.blocked_missing_evidence}; blocked_high_risk=${playbook.status_counts.blocked_high_risk}; avg_minutes=${playbook.metrics.avg_handling_minutes}`
    );
    if (playbook.slo_breaches.length === 0) {
      lines.push(`  - slo_breaches: none`);
    } else {
      playbook.slo_breaches.forEach((breach) => {
        lines.push(`  - slo_breach: ${breach}`);
      });
    }
  });

  lines.push('', '## Failure Attribution', '');
  const failures = report.runs.filter((run) => run.status !== 'shadow_success');
  if (failures.length === 0) {
    lines.push('- none');
  } else {
    failures.forEach((run) => {
      lines.push(`- ${run.playbook_id}/${run.issue_key}: ${run.failure_reason ?? 'unknown'}`);
    });
  }

  lines.push('', '## Artifacts', '');
  lines.push(`- playbooks: ${report.artifact_paths.playbooks_json}`);
  lines.push(`- review_queue: ${report.review_queue_path}`);
  lines.push(`- next_week_fixes: ${report.next_week_fixes_path}`);
  lines.push(`- audit: ${report.audit_path}`);

  return `${lines.join('\n')}\n`;
}

function renderNextWeekFixes(reviewQueue: W17ReviewQueue): string {
  const lines = [
    '# W17 Next Week Fix List',
    '',
    `- generated_at: ${reviewQueue.generated_at}`,
    `- review_queue_items: ${reviewQueue.item_count}`,
    `- blocked_items: ${reviewQueue.blocked_item_count}`,
    ''
  ];

  if (reviewQueue.next_week_fixes.length === 0) {
    lines.push('- none');
  } else {
    reviewQueue.next_week_fixes.forEach((item) => {
      lines.push(
        `${item.rank}. ${item.root_cause}: samples=${item.sample_count}; playbooks=${item.affected_playbooks.join(', ')}`
      );
      lines.push(`   - fix: ${item.recommended_fix}`);
    });
  }

  return `${lines.join('\n')}\n`;
}

function renderAuditJsonl(report: W17ShadowReport, reviewQueue: W17ReviewQueue): string {
  const lines = [
    ...report.runs.map((run) =>
      JSON.stringify({
        schema_version: W17_SHADOW_SCHEMA_VERSION,
        event_name: 'playbook.shadow_run',
        trace_ref: run.trace_ref,
        playbook_id: run.playbook_id,
        issue_key: run.issue_key,
        decision: run.status,
        reason: run.failure_reason ?? 'completed',
        source_refs: run.source_refs,
        external_writes: run.external_writes
      })
    ),
    ...reviewQueue.items.map((item) =>
      JSON.stringify({
        schema_version: W17_REVIEW_QUEUE_SCHEMA_VERSION,
        event_name: 'playbook.review_queue.enqueued',
        trace_ref: item.trace_ref,
        playbook_id: item.playbook_id,
        issue_key: item.issue_key,
        priority: item.priority,
        root_cause: item.root_cause,
        next_fix: item.next_fix
      })
    ),
    ...reviewQueue.blocked_items.map((item) =>
      JSON.stringify({
        schema_version: W17_REVIEW_QUEUE_SCHEMA_VERSION,
        event_name: 'playbook.blocked_missing_evidence.recorded',
        trace_ref: item.trace_ref,
        playbook_id: item.playbook_id,
        issue_key: item.issue_key,
        priority: item.priority,
        root_cause: item.root_cause,
        next_fix: item.next_fix
      })
    )
  ];
  return `${lines.join('\n')}\n`;
}

async function loadResolverPackets(path: string): Promise<readonly ResolverPacketV1[]> {
  const raw = await readFile(path, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  return parseW14PacketCollection(parsed).packets;
}

async function loadDraftPackets(path: string): Promise<readonly PlaybookDraftPacketRef[]> {
  const raw = await readFile(path, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  return parseW15DraftPacketCollection(parsed).packets;
}

function parseW14PacketCollection(value: unknown): W14PacketCollectionJson {
  if (!isRecord(value)) {
    throw new Error('W14 packet collection must be an object');
  }
  return {
    schema_version: readString(value, 'schema_version'),
    packets: readArray(value, 'packets').map(parseResolverPacket)
  };
}

function parseW15DraftPacketCollection(value: unknown): W15DraftPacketCollectionJson {
  if (!isRecord(value)) {
    throw new Error('W15 draft packet collection must be an object');
  }
  return {
    schema_version: readString(value, 'schema_version'),
    packets: readArray(value, 'packets').map(parseDraftPacketRef)
  };
}

function parseResolverPacket(value: unknown): ResolverPacketV1 {
  if (!isRecord(value)) {
    throw new Error('resolver packet must be an object');
  }
  return {
    schema_version: 'resolver_packet.v1',
    intent: parseResolverIntent(value.intent),
    constraints: readStringArray(value, 'constraints'),
    repo_hints: readArray(value, 'repo_hints').map(parseRepoHint),
    risk_level: parseRiskLevel(value.risk_level),
    missing_info: readStringArray(value, 'missing_info'),
    next_action: parseNextAction(value.next_action),
    source_refs: readStringArray(value, 'source_refs')
  };
}

function parseResolverIntent(value: unknown): ResolverPacketV1['intent'] {
  if (!isRecord(value)) {
    throw new Error('resolver intent must be an object');
  }
  return {
    issue_key: readString(value, 'issue_key'),
    summary: readString(value, 'summary'),
    kind: parseIntentKind(value.kind),
    source_refs: readStringArray(value, 'source_refs')
  };
}

function parseRepoHint(value: unknown): ResolverPacketV1['repo_hints'][number] {
  if (!isRecord(value)) {
    throw new Error('repo hint must be an object');
  }
  return {
    project: readString(value, 'project'),
    module: readString(value, 'module'),
    confidence: readNumber(value, 'confidence'),
    locator: parseRepoHintLocator(value.locator),
    source_refs: readStringArray(value, 'source_refs'),
    retrieval_query: readNullableString(value, 'retrieval_query')
  };
}

function parseDraftPacketRef(value: unknown): PlaybookDraftPacketRef {
  if (!isRecord(value)) {
    throw new Error('draft packet must be an object');
  }
  return {
    trace_ref: readString(value, 'trace_ref'),
    source_refs: readStringArray(value, 'source_refs')
  };
}

function parseIntentKind(value: unknown): ResolverIntentKind {
  if (
    value === 'bugfix' ||
    value === 'feature' ||
    value === 'investigation' ||
    value === 'maintenance' ||
    value === 'unknown'
  ) {
    return value;
  }
  throw new Error('invalid resolver intent kind');
}

function parseRiskLevel(value: unknown): ResolverRiskLevel {
  if (value === 'L0' || value === 'L1' || value === 'L2' || value === 'L3') {
    return value;
  }
  throw new Error('invalid resolver risk level');
}

function parseNextAction(value: unknown): ResolverNextAction {
  if (
    value === 'shadow_ready' ||
    value === 'need_more_context' ||
    value === 'ask_human' ||
    value === 'await_human'
  ) {
    return value;
  }
  throw new Error('invalid resolver next action');
}

function parseRepoHintLocator(value: unknown): ResolverRepoHintLocator {
  if (value === 'historical_evidence' || value === 'source_ref' || value === 'retrieval_hint') {
    return value;
  }
  throw new Error('invalid repo hint locator');
}

function indexDraftPacketsByIssueKey(
  packets: readonly PlaybookDraftPacketRef[]
): ReadonlyMap<string, PlaybookDraftPacketRef> {
  const index = new Map<string, PlaybookDraftPacketRef>();
  packets.forEach((packet) => {
    const issueKey = extractIssueKeyFromTraceRef(packet.trace_ref);
    if (issueKey !== null && !index.has(issueKey)) {
      index.set(issueKey, packet);
    }
  });
  return index;
}

function extractIssueKeyFromTraceRef(traceRef: string): string | null {
  const parts = traceRef.split(':');
  const issueKey = parts[3];
  return issueKey === undefined || issueKey.length === 0 ? null : issueKey;
}

function buildShadowWeek(generatedAt: string): W17ShadowReport['shadow_week'] {
  const end = new Date(generatedAt);
  const start = new Date(end.getTime() - 6 * 24 * 60 * 60 * 1000);
  return {
    start_date: toDateOnly(start),
    end_date: toDateOnly(end),
    timezone: 'UTC'
  };
}

function toDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function mapFailureRootCause(reason: string | null): string {
  if (reason === null) return 'none';
  if (reason === 'missing_source_ref') return 'missing_repository_evidence';
  if (reason === 'high_risk_requires_human') return 'high_risk_domain';
  if (reason.startsWith('resolver_')) return 'resolver_not_ready';
  if (reason === 'draft_mr_packet_missing') return 'draft_package_gap';
  if (reason.startsWith('approval_gate_')) return 'approval_required';
  return 'unknown';
}

function recommendedFixForRootCause(rootCause: string): string {
  switch (rootCause) {
    case 'missing_repository_evidence':
      return 'Backfill gitlab:/local: source_refs or downgrade the playbook path to context request only.';
    case 'high_risk_domain':
      return 'Add domain-owner approval evidence before retrying the shadow playbook.';
    case 'resolver_not_ready':
      return 'Resolve missing_info questions in resolver_packet and regenerate W14/W15 artifacts.';
    case 'draft_package_gap':
      return 'Extend W15 sample selection or compose a draft_mr_packet for this issue key.';
    case 'approval_required':
      return 'Record the required human/senior/security approval trace before continuing.';
    case 'none':
      return 'No fix required.';
    default:
      return 'Inspect the trace and add a specific failure branch before promotion.';
  }
}

function priorityForRun(run: PlaybookRunResult): W17ReviewQueueItem['priority'] {
  if (run.risk_level === 'L3') return 'P0';
  if (run.failure_reason === 'missing_source_ref') return 'P1';
  return 'P2';
}

function compareReviewQueueItems(left: W17ReviewQueueItem, right: W17ReviewQueueItem): number {
  const priorityDelta = priorityWeight(left.priority) - priorityWeight(right.priority);
  if (priorityDelta !== 0) return priorityDelta;
  return left.trace_ref.localeCompare(right.trace_ref);
}

function priorityWeight(priority: W17ReviewQueueItem['priority']): number {
  switch (priority) {
    case 'P0':
      return 0;
    case 'P1':
      return 1;
    case 'P2':
      return 2;
  }
}

function roundRatio(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Number((numerator / denominator).toFixed(4));
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function dedupe<T extends string>(values: readonly T[]): readonly T[] {
  return [...new Set(values)];
}

function readString(record: Readonly<Record<string, unknown>>, field: string): string {
  const value = record[field];
  if (typeof value !== 'string') {
    throw new Error(`${field} must be a string`);
  }
  return value;
}

function readNumber(record: Readonly<Record<string, unknown>>, field: string): number {
  const value = record[field];
  if (typeof value !== 'number') {
    throw new Error(`${field} must be a number`);
  }
  return value;
}

function readArray(record: Readonly<Record<string, unknown>>, field: string): readonly unknown[] {
  const value = record[field];
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array`);
  }
  return value;
}

function readStringArray(
  record: Readonly<Record<string, unknown>>,
  field: string
): readonly string[] {
  return readArray(record, field).map((item) => {
    if (typeof item !== 'string') {
      throw new Error(`${field} must contain only strings`);
    }
    return item;
  });
}

function readNullableString(
  record: Readonly<Record<string, unknown>>,
  field: string
): string | null {
  const value = record[field];
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new Error(`${field} must be a string or null`);
  }
  return value;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseCliOptions(args: readonly string[]): CliOptions {
  const options: {
    resolverPacketsPath?: string;
    draftPacketsPath?: string;
    reportsDir?: string;
    stateDir?: string;
    sampleCountPerPlaybook?: number;
  } = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === '--resolver-packets' && next !== undefined) {
      options.resolverPacketsPath = resolve(next);
      index += 1;
    } else if (arg === '--draft-packets' && next !== undefined) {
      options.draftPacketsPath = resolve(next);
      index += 1;
    } else if (arg === '--reports-dir' && next !== undefined) {
      options.reportsDir = resolve(next);
      index += 1;
    } else if (arg === '--state-dir' && next !== undefined) {
      options.stateDir = resolve(next);
      index += 1;
    } else if (arg === '--sample-count-per-playbook' && next !== undefined) {
      options.sampleCountPerPlaybook = Number.parseInt(next, 10);
      index += 1;
    } else {
      throw new Error(`Unknown option ${arg ?? ''}`);
    }
  }

  return options;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await runW17PlaybookShadowCli();
}
