#!/usr/bin/env tsx
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import type {
  ResolverIntentKind,
  ResolverNextAction,
  ResolverPacketV1
} from '../resolver/index.js';
import { resolveRepoRoot } from '../runtime/skillAgentLoader.js';
import {
  DRAFT_MR_PACKET_V1_JSON_SCHEMA,
  composeDraftMrBundle,
  guardExternalWriteAttempt,
  validateDraftMrPacketV1,
  type DraftMrPacketV1,
  type ExternalWriteGuardResult
} from './index.js';

export const W15_REPLAY_SCHEMA_VERSION = 'w15-draft-mr-replay@1';
export const W15_PACKET_COLLECTION_SCHEMA_VERSION = 'w15-draft-mr-packets@1';

interface W14PacketCollectionJson {
  readonly schema_version: string;
  readonly packets: readonly ResolverPacketV1[];
}

interface W15ReplayOptions {
  readonly repoRoot: string;
  readonly generatedAt?: string | undefined;
  readonly resolverPacketsPath?: string | undefined;
  readonly reportsDir?: string | undefined;
  readonly sampleCount?: number | undefined;
}

interface W15RunResult {
  readonly report: W15ReplayReport;
  readonly packets: readonly DraftMrPacketV1[];
  readonly artifactPaths: W15ArtifactPaths;
}

interface W15ArtifactPaths {
  readonly packet_schema: string;
  readonly draft_mr_packets: string;
  readonly eval_report_json: string;
  readonly eval_report_md: string;
  readonly audit_jsonl: string;
  readonly diff_bundle_dir: string;
  readonly review_checklist_dir: string;
}

interface W15ReplayReport {
  readonly schema_version: typeof W15_REPLAY_SCHEMA_VERSION;
  readonly generated_at: string;
  readonly status: 'PASS' | 'FAIL';
  readonly resolver_packets_path: string;
  readonly sample_count: number;
  readonly metrics: W15ReplayMetrics;
  readonly issues: readonly W15ReplayIssue[];
  readonly safety_regression: {
    readonly attempted_operations: readonly ExternalWriteGuardResult[];
    readonly all_blocked: boolean;
  };
  readonly artifact_paths: W15ArtifactPaths;
}

interface W15ReplayMetrics {
  readonly packet_schema_pass_rate: number;
  readonly packet_schema_pass_numerator: number;
  readonly packet_schema_pass_denominator: number;
  readonly human_review_executable_rate: number;
  readonly human_review_executable_numerator: number;
  readonly human_review_executable_denominator: number;
  readonly pr_body_source_ref_coverage: number;
  readonly pr_body_source_ref_numerator: number;
  readonly pr_body_source_ref_denominator: number;
  readonly uncertainty_marked_count: number;
  readonly missing_evidence_count: number;
  readonly write_guard_blocked_count: number;
  readonly write_guard_attempt_count: number;
}

interface W15ReplayIssue {
  readonly sample_id: string;
  readonly severity: 'SECURITY' | 'TYPE' | 'QUALITY';
  readonly message: string;
}

interface W15PacketCollection {
  readonly schema_version: typeof W15_PACKET_COLLECTION_SCHEMA_VERSION;
  readonly generated_at: string;
  readonly packet_count: number;
  readonly packets: readonly DraftMrPacketV1[];
}

interface CliOptions {
  readonly resolverPacketsPath?: string | undefined;
  readonly reportsDir?: string | undefined;
  readonly sampleCount?: number | undefined;
}

const WRITE_GUARD_OPERATIONS = [
  'git_push',
  'merge_request_create',
  'merge_request_update',
  'merge_request_merge',
  'jira_write'
] as const;

export async function runW15DraftMrReplay(options: W15ReplayOptions): Promise<W15RunResult> {
  const repoRoot = resolve(options.repoRoot);
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const resolverPacketsPath =
    options.resolverPacketsPath ?? join(repoRoot, 'reports', 'w14', 'resolver-packets.json');
  const reportsDir = options.reportsDir ?? join(repoRoot, 'reports', 'w15');
  const sampleCount = options.sampleCount ?? 20;
  const artifactPaths: W15ArtifactPaths = {
    packet_schema: join(reportsDir, 'draft-mr-packet.schema.json'),
    draft_mr_packets: join(reportsDir, 'draft-mr-packets.json'),
    eval_report_json: join(reportsDir, 'eval-report.json'),
    eval_report_md: join(reportsDir, 'eval-report.md'),
    audit_jsonl: join(reportsDir, 'audit.jsonl'),
    diff_bundle_dir: join(reportsDir, 'diff-bundles'),
    review_checklist_dir: join(reportsDir, 'review-checklists')
  };

  const resolverPackets = await loadResolverPackets(resolverPacketsPath);
  const selectedPackets = selectManualReviewSamples(resolverPackets, sampleCount);
  const bundles = selectedPackets.map((packet, index) => {
    const traceRef = `w15:shadow:${String(index + 1).padStart(2, '0')}:${packet.intent.issue_key}`;
    const fileStem = `${String(index + 1).padStart(2, '0')}-${sanitizeFileName(packet.intent.issue_key)}`;
    return composeDraftMrBundle(packet, {
      traceRef,
      patchPath: join(artifactPaths.diff_bundle_dir, `${fileStem}.patch`),
      reviewChecklistPath: join(artifactPaths.review_checklist_dir, `${fileStem}.md`)
    });
  });
  const packets = bundles.map((bundle) => bundle.packet);
  const writeGuardAttempts = buildWriteGuardAttempts(packets);
  const report = buildReplayReport({
    generatedAt,
    resolverPacketsPath,
    artifactPaths,
    resolverPackets: selectedPackets,
    draftPackets: packets,
    writeGuardAttempts
  });

  await writeArtifacts({
    generatedAt,
    artifactPaths,
    report,
    bundles,
    writeGuardAttempts
  });

  return {
    report,
    packets,
    artifactPaths
  };
}

export async function runW15DraftMrReplayCli(): Promise<void> {
  const cliOptions = parseCliOptions(process.argv.slice(2));
  const result = await runW15DraftMrReplay({
    repoRoot: resolveRepoRoot(),
    ...(cliOptions.resolverPacketsPath === undefined
      ? {}
      : { resolverPacketsPath: cliOptions.resolverPacketsPath }),
    ...(cliOptions.reportsDir === undefined ? {} : { reportsDir: cliOptions.reportsDir }),
    ...(cliOptions.sampleCount === undefined ? {} : { sampleCount: cliOptions.sampleCount })
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        status: result.report.status,
        sample_count: result.report.sample_count,
        packet_schema_pass_rate: result.report.metrics.packet_schema_pass_rate,
        human_review_executable_rate: result.report.metrics.human_review_executable_rate,
        write_guard_blocked_count: result.report.metrics.write_guard_blocked_count,
        report_path: result.artifactPaths.eval_report_json
      },
      null,
      2
    )}\n`
  );
}

function selectManualReviewSamples(
  packets: readonly ResolverPacketV1[],
  sampleCount: number
): readonly ResolverPacketV1[] {
  const shadowReady = packets
    .filter((packet) => packet.next_action === 'shadow_ready')
    .slice(0, 12);
  const awaitHuman = packets.filter((packet) => packet.next_action === 'await_human').slice(0, 4);
  const needMoreContext = packets
    .filter((packet) => packet.next_action === 'need_more_context')
    .slice(0, 4);
  const selected = dedupePackets([...shadowReady, ...awaitHuman, ...needMoreContext]);

  if (selected.length >= sampleCount) {
    return selected.slice(0, sampleCount);
  }

  const selectedKeys = new Set(selected.map(packetKey));
  const fillers = packets.filter((packet) => !selectedKeys.has(packetKey(packet)));
  return [...selected, ...fillers].slice(0, sampleCount);
}

function buildReplayReport(input: {
  readonly generatedAt: string;
  readonly resolverPacketsPath: string;
  readonly artifactPaths: W15ArtifactPaths;
  readonly resolverPackets: readonly ResolverPacketV1[];
  readonly draftPackets: readonly DraftMrPacketV1[];
  readonly writeGuardAttempts: readonly ExternalWriteGuardResult[];
}): W15ReplayReport {
  const issues = input.draftPackets.flatMap((packet, index) =>
    evaluateDraftPacket(input.resolverPackets[index], packet)
  );
  const schemaPassed = input.draftPackets.filter(
    (packet) => validateDraftMrPacketV1(packet).length === 0
  );
  const executablePackets = input.draftPackets.filter(isHumanReviewExecutable);
  const prBodySourceRefCovered = input.draftPackets.filter((packet) =>
    packet.source_refs.every((sourceRef) => packet.pr_body.includes(sourceRef))
  );
  const missingEvidencePackets = input.resolverPackets.filter((packet) => !hasRepoEvidence(packet));
  const uncertaintyMarked = input.draftPackets.filter(
    (packet) => packet.diff_bundle.uncertainty.length > 0
  );
  const blockedGuardAttempts = input.writeGuardAttempts.filter((attempt) => !attempt.allowed);
  const metrics: W15ReplayMetrics = {
    packet_schema_pass_rate: roundRatio(schemaPassed.length, input.draftPackets.length),
    packet_schema_pass_numerator: schemaPassed.length,
    packet_schema_pass_denominator: input.draftPackets.length,
    human_review_executable_rate: roundRatio(executablePackets.length, input.draftPackets.length),
    human_review_executable_numerator: executablePackets.length,
    human_review_executable_denominator: input.draftPackets.length,
    pr_body_source_ref_coverage: roundRatio(
      prBodySourceRefCovered.length,
      input.draftPackets.length
    ),
    pr_body_source_ref_numerator: prBodySourceRefCovered.length,
    pr_body_source_ref_denominator: input.draftPackets.length,
    uncertainty_marked_count: uncertaintyMarked.length,
    missing_evidence_count: missingEvidencePackets.length,
    write_guard_blocked_count: blockedGuardAttempts.length,
    write_guard_attempt_count: input.writeGuardAttempts.length
  };
  const allGuarded = blockedGuardAttempts.length === input.writeGuardAttempts.length;
  const status =
    issues.length === 0 &&
    input.draftPackets.length >= 20 &&
    metrics.packet_schema_pass_rate === 1 &&
    metrics.human_review_executable_rate === 1 &&
    metrics.pr_body_source_ref_coverage === 1 &&
    allGuarded
      ? 'PASS'
      : 'FAIL';

  return {
    schema_version: W15_REPLAY_SCHEMA_VERSION,
    generated_at: input.generatedAt,
    status,
    resolver_packets_path: input.resolverPacketsPath,
    sample_count: input.draftPackets.length,
    metrics,
    issues,
    safety_regression: {
      attempted_operations: input.writeGuardAttempts,
      all_blocked: allGuarded
    },
    artifact_paths: input.artifactPaths
  };
}

function evaluateDraftPacket(
  resolverPacket: ResolverPacketV1 | undefined,
  packet: DraftMrPacketV1
): readonly W15ReplayIssue[] {
  const sampleId = packet.trace_ref;
  const issues: W15ReplayIssue[] = validateDraftMrPacketV1(packet).map((issue) => ({
    sample_id: sampleId,
    severity: 'TYPE',
    message: `${issue.field}: ${issue.message}`
  }));

  if (resolverPacket === undefined) {
    issues.push({
      sample_id: sampleId,
      severity: 'QUALITY',
      message: 'resolver packet missing for draft packet'
    });
    return issues;
  }

  if (!isHumanReviewExecutable(packet)) {
    issues.push({
      sample_id: sampleId,
      severity: 'QUALITY',
      message: 'draft MR packet is not executable for human review'
    });
  }

  if (!hasRepoEvidence(resolverPacket) && packet.diff_bundle.uncertainty.length === 0) {
    issues.push({
      sample_id: sampleId,
      severity: 'SECURITY',
      message: 'missing evidence packet did not mark uncertainty'
    });
  }

  if (resolverPacket.risk_level === 'L3' && !packet.pr_body.includes('manual approval')) {
    issues.push({
      sample_id: sampleId,
      severity: 'SECURITY',
      message: 'L3 packet PR body must mention manual approval'
    });
  }

  return issues;
}

async function writeArtifacts(input: {
  readonly generatedAt: string;
  readonly artifactPaths: W15ArtifactPaths;
  readonly report: W15ReplayReport;
  readonly bundles: readonly ReturnType<typeof composeDraftMrBundle>[];
  readonly writeGuardAttempts: readonly ExternalWriteGuardResult[];
}): Promise<void> {
  await Promise.all([
    mkdir(dirname(input.artifactPaths.packet_schema), { recursive: true }),
    mkdir(input.artifactPaths.diff_bundle_dir, { recursive: true }),
    mkdir(input.artifactPaths.review_checklist_dir, { recursive: true })
  ]);

  await Promise.all(
    input.bundles.flatMap((bundle) => [
      writeFile(bundle.packet.diff_bundle.patch_path, bundle.patchText, 'utf8'),
      writeFile(bundle.packet.diff_bundle.review_checklist_path, bundle.reviewChecklistText, 'utf8')
    ])
  );

  const packetCollection: W15PacketCollection = {
    schema_version: W15_PACKET_COLLECTION_SCHEMA_VERSION,
    generated_at: input.generatedAt,
    packet_count: input.bundles.length,
    packets: input.bundles.map((bundle) => bundle.packet)
  };
  const auditLines = [
    ...input.bundles.map((bundle) => JSON.stringify(bundle.auditRecord)),
    ...input.writeGuardAttempts.map((attempt) =>
      JSON.stringify({
        schema_version: 'w15-draft-mr-audit@1',
        event_name: 'external_write.blocked',
        trace_ref: attempt.trace_ref,
        timestamp: input.generatedAt,
        operation: attempt.operation,
        source_refs: attempt.source_refs,
        warning: attempt.warning
      })
    )
  ];

  await Promise.all([
    writeFile(
      input.artifactPaths.packet_schema,
      `${JSON.stringify(DRAFT_MR_PACKET_V1_JSON_SCHEMA, null, 2)}\n`,
      'utf8'
    ),
    writeFile(
      input.artifactPaths.draft_mr_packets,
      `${JSON.stringify(packetCollection, null, 2)}\n`,
      'utf8'
    ),
    writeFile(
      input.artifactPaths.eval_report_json,
      `${JSON.stringify(input.report, null, 2)}\n`,
      'utf8'
    ),
    writeFile(input.artifactPaths.eval_report_md, renderReplayMarkdown(input.report), 'utf8'),
    writeFile(input.artifactPaths.audit_jsonl, `${auditLines.join('\n')}\n`, 'utf8')
  ]);
}

function buildWriteGuardAttempts(
  packets: readonly DraftMrPacketV1[]
): readonly ExternalWriteGuardResult[] {
  const referencePacket = packets[0];
  const traceRef = referencePacket?.trace_ref ?? 'w15:shadow:no-packet';
  const sourceRefs = referencePacket?.source_refs ?? [];

  return WRITE_GUARD_OPERATIONS.map((operation) =>
    guardExternalWriteAttempt({
      operation,
      traceRef,
      sourceRefs
    })
  );
}

function renderReplayMarkdown(report: W15ReplayReport): string {
  const lines = [
    '# W15 Draft MR Composer Shadow',
    '',
    `- status: ${report.status}`,
    `- generated_at: ${report.generated_at}`,
    `- sample_count: ${report.sample_count}`,
    `- packet_schema_pass_rate: ${formatPercent(report.metrics.packet_schema_pass_rate)} (${report.metrics.packet_schema_pass_numerator}/${report.metrics.packet_schema_pass_denominator})`,
    `- human_review_executable_rate: ${formatPercent(report.metrics.human_review_executable_rate)} (${report.metrics.human_review_executable_numerator}/${report.metrics.human_review_executable_denominator})`,
    `- pr_body_source_ref_coverage: ${formatPercent(report.metrics.pr_body_source_ref_coverage)} (${report.metrics.pr_body_source_ref_numerator}/${report.metrics.pr_body_source_ref_denominator})`,
    `- missing_evidence_count: ${report.metrics.missing_evidence_count}`,
    `- uncertainty_marked_count: ${report.metrics.uncertainty_marked_count}`,
    `- write_guard_blocked: ${report.metrics.write_guard_blocked_count}/${report.metrics.write_guard_attempt_count}`,
    '',
    '## Issues',
    ''
  ];

  if (report.issues.length === 0) {
    lines.push('- none');
  } else {
    report.issues.forEach((issue) => {
      lines.push(`- ${issue.severity} ${issue.sample_id}: ${issue.message}`);
    });
  }

  lines.push('', '## Artifacts', '');
  lines.push(`- packets: ${report.artifact_paths.draft_mr_packets}`);
  lines.push(`- audit: ${report.artifact_paths.audit_jsonl}`);
  lines.push(`- diff_bundles: ${report.artifact_paths.diff_bundle_dir}`);
  lines.push(`- review_checklists: ${report.artifact_paths.review_checklist_dir}`);

  return `${lines.join('\n')}\n`;
}

async function loadResolverPackets(path: string): Promise<readonly ResolverPacketV1[]> {
  const raw = await readFile(path, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  const collection = parseW14PacketCollection(parsed);
  return collection.packets;
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

function parseRiskLevel(value: unknown): ResolverPacketV1['risk_level'] {
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

function parseRepoHintLocator(value: unknown): ResolverPacketV1['repo_hints'][number]['locator'] {
  if (value === 'historical_evidence' || value === 'source_ref' || value === 'retrieval_hint') {
    return value;
  }
  throw new Error('invalid resolver repo hint locator');
}

function isHumanReviewExecutable(packet: DraftMrPacketV1): boolean {
  return (
    validateDraftMrPacketV1(packet).length === 0 &&
    packet.diff_bundle.patch_path.endsWith('.patch') &&
    packet.diff_bundle.review_checklist_path.endsWith('.md') &&
    packet.test_plan.length >= 3 &&
    packet.rollback_plan.steps.length > 0 &&
    packet.commit_plan.commits.length > 0
  );
}

function hasRepoEvidence(packet: ResolverPacketV1): boolean {
  return packet.source_refs.some(
    (sourceRef) => sourceRef.startsWith('gitlab:') || sourceRef.startsWith('local:')
  );
}

function parseCliOptions(args: readonly string[]): CliOptions {
  const options: {
    resolverPacketsPath?: string;
    reportsDir?: string;
    sampleCount?: number;
  } = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === '--resolver-packets' && next !== undefined) {
      options.resolverPacketsPath = next;
      index += 1;
    } else if (arg === '--reports-dir' && next !== undefined) {
      options.reportsDir = next;
      index += 1;
    } else if (arg === '--sample-count' && next !== undefined) {
      options.sampleCount = Number.parseInt(next, 10);
      index += 1;
    }
  }

  return options;
}

function dedupePackets(packets: readonly ResolverPacketV1[]): readonly ResolverPacketV1[] {
  const seen = new Set<string>();
  const deduped: ResolverPacketV1[] = [];
  for (const packet of packets) {
    const key = packetKey(packet);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(packet);
  }
  return deduped;
}

function packetKey(packet: ResolverPacketV1): string {
  return `${packet.intent.issue_key}:${packet.next_action}:${packet.risk_level}`;
}

function readString(value: Readonly<Record<string, unknown>>, field: string): string {
  const fieldValue = value[field];
  if (typeof fieldValue !== 'string') {
    throw new Error(`${field} must be a string`);
  }
  return fieldValue;
}

function readNullableString(
  value: Readonly<Record<string, unknown>>,
  field: string
): string | null {
  const fieldValue = value[field];
  if (fieldValue === null) {
    return null;
  }
  if (typeof fieldValue !== 'string') {
    throw new Error(`${field} must be a string or null`);
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

function sanitizeFileName(value: string): string {
  const sanitized = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  return sanitized.length === 0 ? 'draft-mr' : sanitized;
}

function roundRatio(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Number((numerator / denominator).toFixed(4));
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

const entryPoint =
  process.argv[1] === undefined ? null : pathToFileURL(resolve(process.argv[1])).href;
if (entryPoint === import.meta.url) {
  await runW15DraftMrReplayCli();
}
