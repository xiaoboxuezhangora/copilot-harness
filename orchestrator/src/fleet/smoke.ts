import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { AuditLogger } from '../audit/index.js';
import { DEFAULT_MODEL, type EvidencePack } from '../runtime/index.js';
import { FleetCoordinator } from './coordinator.js';
import { SqliteArenaStore } from './arenaStore.js';
import {
  W10_FLEET_PROMPT_VERSION,
  type AgentRole,
  type ArenaScoreDimensions,
  type FleetSession,
  type ReviewerDraft
} from './index.js';

export const W10_FLEET_SMOKE_SCHEMA = 'phase-2-w10-fleet-smoke@1';

const REQUIRED_AGENT_ROLES = [
  'planner',
  'implementer',
  'critic',
  'reviewer'
] as const satisfies readonly AgentRole[];

interface SmokeCheck {
  readonly name: string;
  readonly passed: boolean;
  readonly detail: string;
}

interface ReviewerDraftSummary {
  readonly pushed: false;
  readonly merge_request_created: false;
}

export interface W10FleetSmokeReport {
  readonly schema_version: typeof W10_FLEET_SMOKE_SCHEMA;
  readonly version: 1;
  readonly generated_at: string;
  readonly status: 'pass' | 'fail';
  readonly mode: 'mock';
  readonly real_fanout: 'real_disabled';
  readonly real_merge_request: 'real_disabled';
  readonly fleet_session_id: string;
  readonly agent_roles: readonly AgentRole[];
  readonly candidate_count: number;
  readonly critic_score_count: number;
  readonly selected_candidate_id: string | null;
  readonly reviewer_draft: ReviewerDraftSummary;
  readonly audit_log_path: string;
  readonly task_state_path: string;
  readonly snapshot_path: string | null;
  readonly mirrored_snapshot_path: string | null;
  readonly checks: readonly SmokeCheck[];
}

export interface W10FleetSmokeRunResult {
  readonly report: W10FleetSmokeReport;
  readonly jsonPath: string;
  readonly markdownPath: string;
}

interface BuildSmokeReportInput {
  readonly generatedAt: string;
  readonly session: FleetSession;
  readonly auditLogPath: string;
  readonly taskStatePath: string;
  readonly snapshotPath: string | null;
  readonly mirroredSnapshotPath: string | null;
  readonly auditRecords: readonly unknown[];
}

interface RunSmokeOptions {
  readonly repoRoot: string;
  readonly generatedAt?: string;
}

interface ShowcaseExportFunction {
  (_options: { readonly repoRoot: string; readonly date: string }): Promise<unknown> | unknown;
}

interface ShowcaseExportResult {
  readonly outputPath: string;
  readonly mirroredPath: string | null;
}

interface W10FleetTaskState {
  readonly taskId: string;
  readonly turn_state: FleetSession['turnState'];
  readonly execution_mode: 'mock';
  readonly role: 'fleet';
  readonly prompt_version: typeof W10_FLEET_PROMPT_VERSION;
  readonly model: typeof DEFAULT_MODEL;
  readonly runtime: 'contract_stub';
  readonly fleet_session_id: string;
  readonly parent_task_id: string;
  readonly agent_role: 'reviewer';
  readonly worktree_mode: 'real_disabled';
  readonly evidence_pack_size: number;
  readonly memory_hit_count: 0;
  readonly evidencePack: EvidencePack;
  readonly fleet_session: {
    readonly real_fanout: 'real_disabled';
    readonly real_merge_request: 'real_disabled';
    readonly candidate_count: number;
    readonly critic_score_count: number;
    readonly selected_candidate_id: string | null;
    readonly arena: ArenaTaskStateSummary | null;
  };
}

interface ArenaTaskStateSummary {
  readonly candidate_count: number;
  readonly winner: string;
  readonly scores: ArenaScoreDimensions;
  readonly consistency_delta: number;
  readonly archive_path: string;
  readonly scorer_mode: 'mock';
  readonly real_scorer: '未接入';
}

export async function runW10FleetSmoke(options: RunSmokeOptions): Promise<W10FleetSmokeRunResult> {
  const repoRoot = resolve(options.repoRoot);
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const evalDir = join(repoRoot, 'orchestrator', 'eval');
  const auditLogPath = join(repoRoot, 'reports', 'audit.log');
  const arenaStore = new SqliteArenaStore({
    sqlitePath: join(repoRoot, 'reports', 'arena.sqlite')
  });
  const taskStatePath = join(repoRoot, 'state', 'tasks', 'w10', 'w10-fleet-smoke.json');
  const fleetSessionId = 'fleet-w10-fleet-smoke';

  await resetFleetAuditRecords(auditLogPath, fleetSessionId);
  const coordinator = new FleetCoordinator({
    auditLogger: new AuditLogger(auditLogPath),
    arenaStore,
    arenaArchiveRoot: join(repoRoot, 'reports', 'arena', 'archive')
  });
  const session = await coordinator
    .run({
      taskId: 'w10-fleet-smoke',
      parentTaskId: 'w10-fleet-smoke',
      prompt: 'Run W10 deterministic mock fleet smoke without real fanout.',
      intent: 'W10 fleet smoke',
      allowedFiles: [
        'orchestrator/src/fleet/types.ts',
        'orchestrator/src/fleet/coordinator.ts',
        'orchestrator/src/fleet/smoke.ts'
      ],
      acceptance: [
        'planner emits bounded atomic steps',
        'implementer emits anonymous mock diff',
        'reviewer emits draft artifact only'
      ],
      fanout: 3
    })
    .finally(() => {
      arenaStore.close();
    });

  await writeTaskState(taskStatePath, session);

  const exportShowcaseSnapshot = await loadShowcaseExporter();
  const snapshot = await exportShowcaseSnapshot({
    repoRoot,
    date: formatLocalDate(new Date(generatedAt))
  });
  const auditRecords = await readFleetAuditRecords(auditLogPath, session.fleetSessionId);
  const report = buildW10FleetSmokeReport({
    generatedAt,
    session,
    auditLogPath,
    taskStatePath,
    snapshotPath: snapshot.outputPath,
    mirroredSnapshotPath: snapshot.mirroredPath,
    auditRecords
  });

  const jsonPath = join(evalDir, 'w10-fleet-smoke.json');
  const markdownPath = join(evalDir, 'w10-fleet-smoke.md');
  await mkdir(evalDir, { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(markdownPath, renderW10FleetSmokeMarkdown(report), 'utf8');

  return {
    report,
    jsonPath,
    markdownPath
  };
}

async function resetFleetAuditRecords(auditLogPath: string, fleetSessionId: string): Promise<void> {
  let content: string;
  try {
    content = await readFile(auditLogPath, 'utf8');
  } catch (error: unknown) {
    if (isMissingFileError(error)) return;
    throw error;
  }

  const retainedLines = content
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .filter((line) => readString(asRecord(parseJsonLine(line))?.fleetSessionId) !== fleetSessionId);
  await mkdir(dirname(auditLogPath), { recursive: true });
  await writeFile(
    auditLogPath,
    retainedLines.length > 0 ? `${retainedLines.join('\n')}\n` : '',
    'utf8'
  );
}

export function buildW10FleetSmokeReport(input: BuildSmokeReportInput): W10FleetSmokeReport {
  const auditedRoles = new Set(
    input.auditRecords
      .map((record) => readString(asRecord(record)?.agentRole))
      .filter((role): role is AgentRole => isAgentRole(role))
  );
  const selectedCandidateId = input.session.reviewerDraft?.selectedCandidateId ?? null;
  const reviewerDraft = input.session.reviewerDraft;
  const checks: readonly SmokeCheck[] = [
    check(
      'fleet session completed',
      input.session.turnState === 'done',
      `turn_state=${input.session.turnState}`
    ),
    check(
      'real fanout disabled',
      input.session.realFanout === 'real_disabled',
      `real_fanout=${input.session.realFanout}`
    ),
    check(
      'real merge request disabled',
      input.session.realMergeRequest === 'real_disabled',
      `real_merge_request=${input.session.realMergeRequest}`
    ),
    check(
      'candidate count is three',
      input.session.candidates.length === 3,
      `candidate_count=${input.session.candidates.length}`
    ),
    check(
      'critic score count is three',
      input.session.criticScores.length === 3,
      `critic_score_count=${input.session.criticScores.length}`
    ),
    check(
      'reviewer selected a candidate',
      selectedCandidateId !== null,
      `selected_candidate_id=${selectedCandidateId ?? 'missing'}`
    ),
    check(
      'reviewer draft has no real write',
      reviewerDraftHasNoRealWrite(reviewerDraft),
      formatReviewerDraftDetail(reviewerDraft)
    ),
    check(
      'audit contains all fleet roles',
      REQUIRED_AGENT_ROLES.every((role) => auditedRoles.has(role)),
      `audited_roles=${[...auditedRoles].sort().join(',')}`
    )
  ];

  return {
    schema_version: W10_FLEET_SMOKE_SCHEMA,
    version: 1,
    generated_at: input.generatedAt,
    status: checks.every((item) => item.passed) ? 'pass' : 'fail',
    mode: 'mock',
    real_fanout: 'real_disabled',
    real_merge_request: 'real_disabled',
    fleet_session_id: input.session.fleetSessionId,
    agent_roles: REQUIRED_AGENT_ROLES,
    candidate_count: input.session.candidates.length,
    critic_score_count: input.session.criticScores.length,
    selected_candidate_id: selectedCandidateId,
    reviewer_draft: {
      pushed: false,
      merge_request_created: false
    },
    audit_log_path: input.auditLogPath,
    task_state_path: input.taskStatePath,
    snapshot_path: input.snapshotPath,
    mirrored_snapshot_path: input.mirroredSnapshotPath,
    checks
  };
}

export function renderW10FleetSmokeMarkdown(report: W10FleetSmokeReport): string {
  const checkRows = report.checks
    .map(
      (item) =>
        `| ${item.name} | ${item.passed ? 'pass' : 'fail'} | ${item.detail.replaceAll('\n', ' ')} |`
    )
    .join('\n');

  return [
    '# W10 Fleet Smoke Report',
    '',
    `- Schema: \`${report.schema_version}\``,
    `- Generated: ${report.generated_at}`,
    `- Status: ${report.status.toUpperCase()}`,
    `- Mode: ${report.mode}`,
    `- Real /fleet: ${report.real_fanout}`,
    `- Real GitLab MR: ${report.real_merge_request}`,
    `- Fleet session: ${report.fleet_session_id}`,
    `- Candidates: ${report.candidate_count}`,
    `- Critic scores: ${report.critic_score_count}`,
    `- Selected candidate: ${report.selected_candidate_id ?? 'missing'}`,
    '',
    '## Evidence Files',
    '',
    `- Audit log: \`${report.audit_log_path}\``,
    `- Task state: \`${report.task_state_path}\``,
    `- Snapshot: \`${report.snapshot_path ?? 'not generated'}\``,
    `- Showcase mirror: \`${report.mirrored_snapshot_path ?? 'not generated'}\``,
    '',
    '## Checks',
    '',
    '| Check | Result | Detail |',
    '| --- | --- | --- |',
    checkRows,
    ''
  ].join('\n');
}

async function writeTaskState(path: string, session: FleetSession): Promise<void> {
  const record: W10FleetTaskState = {
    taskId: session.taskId,
    turn_state: session.turnState,
    execution_mode: 'mock',
    role: 'fleet',
    prompt_version: W10_FLEET_PROMPT_VERSION,
    model: DEFAULT_MODEL,
    runtime: 'contract_stub',
    fleet_session_id: session.fleetSessionId,
    parent_task_id: session.parentTaskId,
    agent_role: 'reviewer',
    worktree_mode: 'real_disabled',
    evidence_pack_size: session.evidencePack.evidences.length,
    memory_hit_count: 0,
    evidencePack: session.evidencePack,
    fleet_session: {
      real_fanout: session.realFanout,
      real_merge_request: session.realMergeRequest,
      candidate_count: session.candidates.length,
      critic_score_count: session.criticScores.length,
      selected_candidate_id: session.reviewerDraft?.selectedCandidateId ?? null,
      arena:
        session.arena === undefined
          ? null
          : {
              candidate_count: session.arena.candidateCount,
              winner: session.arena.winner.candidateId,
              scores: session.arena.winner.dimensions,
              consistency_delta: session.arena.winner.consistencyDelta,
              archive_path: session.arena.archivePath,
              scorer_mode: session.arena.scorerMode,
              real_scorer: session.arena.realScorer
            }
    }
  };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
}

async function readFleetAuditRecords(
  auditLogPath: string,
  fleetSessionId: string
): Promise<readonly unknown[]> {
  const content = await readFile(auditLogPath, 'utf8');
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map(parseJsonLine)
    .filter((record) => readString(asRecord(record)?.fleetSessionId) === fleetSessionId);
}

async function loadShowcaseExporter(): Promise<
  (options: { readonly repoRoot: string; readonly date: string }) => Promise<ShowcaseExportResult>
> {
  const imported = (await import('../../../scripts/showcase-export-lib.js')) as unknown;
  const exportFunction =
    readShowcaseExportFunction(imported) ??
    readShowcaseExportFunction(asRecord(imported)?.default) ??
    readShowcaseExportFunction(asRecord(imported)?.['module.exports']);
  if (exportFunction === undefined) {
    throw new Error('showcase-export-lib exportShowcaseSnapshot was not found');
  }
  return async (options) => normalizeShowcaseExportResult(await exportFunction(options));
}

function readShowcaseExportFunction(value: unknown): ShowcaseExportFunction | undefined {
  const candidate = asRecord(value)?.exportShowcaseSnapshot;
  if (typeof candidate !== 'function') return undefined;
  return candidate as ShowcaseExportFunction;
}

function normalizeShowcaseExportResult(value: unknown): ShowcaseExportResult {
  const record = asRecord(value);
  const outputPath = readString(record?.outputPath);
  const mirroredPathValue = record?.mirroredPath;
  if (outputPath === undefined) {
    throw new Error('showcase export result missing outputPath');
  }
  return {
    outputPath,
    mirroredPath: mirroredPathValue === null ? null : (readString(mirroredPathValue) ?? null)
  };
}

function parseJsonLine(line: string): unknown {
  try {
    return JSON.parse(line) as unknown;
  } catch {
    return undefined;
  }
}

function reviewerDraftHasNoRealWrite(draft: ReviewerDraft | undefined): boolean {
  return (
    draft !== undefined &&
    draft.isDraft === true &&
    draft.pushed === false &&
    draft.mergeRequestCreated === false &&
    draft.worktreeMode === 'real_disabled'
  );
}

function formatReviewerDraftDetail(draft: ReviewerDraft | undefined): string {
  if (draft === undefined) return 'reviewer_draft=missing';
  return `pushed=${draft.pushed}; merge_request_created=${draft.mergeRequestCreated}; worktree_mode=${draft.worktreeMode}`;
}

function check(name: string, passed: boolean, detail: string): SmokeCheck {
  return {
    name,
    passed,
    detail
  };
}

function isAgentRole(value: string | undefined): value is AgentRole {
  return (
    value === 'planner' || value === 'implementer' || value === 'critic' || value === 'reviewer'
  );
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as { readonly code?: unknown }).code === 'ENOENT'
  );
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isDirectCli(argvPath: string | undefined, importMetaUrl: string): boolean {
  return argvPath !== undefined && pathToFileURL(resolve(argvPath)).href === importMetaUrl;
}

async function main(): Promise<void> {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  const result = await runW10FleetSmoke({ repoRoot });
  process.stdout.write(
    `${JSON.stringify(
      {
        status: result.report.status,
        jsonPath: result.jsonPath,
        markdownPath: result.markdownPath,
        auditLogPath: result.report.audit_log_path,
        snapshotPath: result.report.snapshot_path,
        mirroredSnapshotPath: result.report.mirrored_snapshot_path
      },
      null,
      2
    )}\n`
  );
  if (result.report.status !== 'pass') {
    process.exitCode = 1;
  }
}

if (isDirectCli(process.argv[1], import.meta.url)) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
