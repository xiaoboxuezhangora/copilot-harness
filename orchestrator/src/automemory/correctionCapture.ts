import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { MEMORY_REDLINE_RULES, findMemoryRedlineViolations } from '../memory/index.js';
import { resolveRepoRoot } from '../runtime/skillAgentLoader.js';
import type { HarvesterCandidate } from './harvester.js';

export type CorrectionRedactionStatus = 'clean' | 'redacted';
export type CorrectionCaptureStatus =
  | 'captured'
  | 'no_actionable_discussions'
  | 'skipped_missing_env';
export type CorrectionCaptureSource = 'gitlab_api' | 'fixture' | 'missing_env';

export interface W11CorrectionRecord {
  readonly schema_version: 'phase-2-w11-correction@1';
  readonly before_diff: string;
  readonly after_diff: string;
  readonly reviewer_reason: string;
  readonly skill_hint: readonly string[];
  readonly source_ref: string;
  readonly redaction_status: CorrectionRedactionStatus;
}

export interface W11CorrectionCaptureReport {
  readonly schema_version: 'phase-2-w11-correction-capture-report@1';
  readonly generated_at: string;
  readonly status: CorrectionCaptureStatus;
  readonly source: CorrectionCaptureSource;
  readonly discussion_count: number;
  readonly note_count: number;
  readonly actionable_note_count: number;
  readonly pending_written_count: number;
  readonly skipped_redline_count: number;
  readonly output_files: readonly string[];
  readonly report_path: string;
  readonly audit_log_path: string;
}

export interface CorrectionCaptureOptions {
  readonly repoRoot?: string | undefined;
  readonly fixturePath?: string | undefined;
  readonly outputDir?: string | undefined;
  readonly reportPath?: string | undefined;
  readonly auditLogPath?: string | undefined;
  readonly gitlabBaseUrl?: string | undefined;
  readonly projectId?: string | undefined;
  readonly mrIid?: string | undefined;
  readonly token?: string | undefined;
  readonly env?: Readonly<Record<string, string | undefined>> | undefined;
  readonly now?: () => Date;
}

interface GitLabDiscussion {
  readonly id: string;
  readonly notes: readonly GitLabNote[];
}

interface GitLabNote {
  readonly id: string;
  readonly body: string;
  readonly system: boolean;
  readonly resolvable: boolean;
  readonly position?: GitLabPosition | undefined;
  readonly suggestions: readonly GitLabSuggestion[];
}

interface GitLabPosition {
  readonly old_path?: string | undefined;
  readonly new_path?: string | undefined;
  readonly old_line?: number | undefined;
  readonly new_line?: number | undefined;
}

interface GitLabSuggestion {
  readonly from_content?: string | undefined;
  readonly to_content?: string | undefined;
}

interface DiscussionLoadResult {
  readonly source: CorrectionCaptureSource;
  readonly status?: 'skipped_missing_env' | undefined;
  readonly discussions: readonly GitLabDiscussion[];
  readonly projectRef: string;
  readonly mrIid: string;
}

interface ExtractedCorrectionRecords {
  readonly records: readonly W11CorrectionRecord[];
  readonly noteCount: number;
  readonly actionableNoteCount: number;
  readonly skippedRedlineCount: number;
}

interface CaptureCliConfig {
  readonly repoRoot: string;
  readonly fixturePath?: string | undefined;
  readonly outputDir: string;
  readonly reportPath: string;
  readonly auditLogPath: string;
  readonly gitlabBaseUrl?: string | undefined;
  readonly projectId?: string | undefined;
  readonly mrIid?: string | undefined;
  readonly help: boolean;
}

interface RedactionRule {
  readonly id: string;
  readonly pattern: RegExp;
}

interface RedactionResult {
  readonly value: string;
  readonly redacted: boolean;
}

interface CorrectionCaptureAuditEvent {
  readonly timestamp: string;
  readonly event_name: 'automemory.correction_capture';
  readonly task_id: 'w11-correction-capture';
  readonly audit_trace_id: string;
  readonly status: CorrectionCaptureStatus;
  readonly source: CorrectionCaptureSource;
  readonly discussion_count: number;
  readonly note_count: number;
  readonly actionable_note_count: number;
  readonly pending_written_count: number;
  readonly skipped_redline_count: number;
}

const CORRECTION_SCHEMA_VERSION = 'phase-2-w11-correction@1';
const REPORT_SCHEMA_VERSION = 'phase-2-w11-correction-capture-report@1';
const DEFAULT_OUTPUT_DIR = '.memory/pending';
const DEFAULT_REPORT_PATH = 'reports/w11-correction-capture.json';
const DEFAULT_AUDIT_LOG_PATH = 'reports/audit.log';
const PRODUCER_AGENT = 'w11-correction-capture';

const EXTRA_REDACTION_RULES: readonly RedactionRule[] = [
  { id: 'gitlab_token', pattern: /glpat-[A-Za-z0-9_-]{20,}/gi },
  { id: 'openai_key', pattern: /sk-[A-Za-z0-9_-]{20,}/gi }
];

export async function runCorrectionCapture(
  options: CorrectionCaptureOptions = {}
): Promise<W11CorrectionCaptureReport> {
  const repoRoot = resolve(options.repoRoot ?? resolveRepoRoot());
  const now = options.now ?? (() => new Date());
  const timestamp = now();
  const outputDir = resolve(repoRoot, options.outputDir ?? DEFAULT_OUTPUT_DIR);
  const reportPath = resolve(repoRoot, options.reportPath ?? DEFAULT_REPORT_PATH);
  const auditLogPath = resolve(repoRoot, options.auditLogPath ?? DEFAULT_AUDIT_LOG_PATH);
  const loadResult = await loadDiscussions({
    ...options,
    repoRoot
  });
  const extracted =
    loadResult.status === 'skipped_missing_env'
      ? {
          records: [],
          noteCount: 0,
          actionableNoteCount: 0,
          skippedRedlineCount: 0
        }
      : extractCorrectionRecords(loadResult.discussions, {
          projectRef: loadResult.projectRef,
          mrIid: loadResult.mrIid
        });

  const outputFiles =
    extracted.records.length === 0
      ? []
      : [
          await writePendingCorrections({
            outputDir,
            generatedAt: timestamp,
            projectRef: loadResult.projectRef,
            mrIid: loadResult.mrIid,
            records: extracted.records
          })
        ];
  const status = resolveCaptureStatus(loadResult, extracted.records.length);
  const report: W11CorrectionCaptureReport = {
    schema_version: REPORT_SCHEMA_VERSION,
    generated_at: timestamp.toISOString(),
    status,
    source: loadResult.source,
    discussion_count: loadResult.discussions.length,
    note_count: extracted.noteCount,
    actionable_note_count: extracted.actionableNoteCount,
    pending_written_count: outputFiles.length,
    skipped_redline_count: extracted.skippedRedlineCount,
    output_files: outputFiles,
    report_path: toDisplayPath(repoRoot, reportPath),
    audit_log_path: toDisplayPath(repoRoot, auditLogPath)
  };

  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await appendCorrectionCaptureAudit(auditLogPath, {
    timestamp: timestamp.toISOString(),
    event_name: 'automemory.correction_capture',
    task_id: 'w11-correction-capture',
    audit_trace_id: buildAuditTraceId(timestamp),
    status,
    source: loadResult.source,
    discussion_count: report.discussion_count,
    note_count: report.note_count,
    actionable_note_count: report.actionable_note_count,
    pending_written_count: report.pending_written_count,
    skipped_redline_count: report.skipped_redline_count
  });

  return report;
}

export async function runCorrectionCaptureCli(
  argv: readonly string[] = process.argv.slice(2),
  env: Readonly<Record<string, string | undefined>> = process.env
): Promise<number> {
  let config: CaptureCliConfig;
  try {
    config = parseCliArgs(argv, env);
  } catch (error: unknown) {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'Invalid correction capture args'}\n`
    );
    process.stderr.write(`${usageText()}\n`);
    return 2;
  }

  if (config.help) {
    process.stdout.write(`${usageText()}\n`);
    return 0;
  }

  const report = await runCorrectionCapture({
    repoRoot: config.repoRoot,
    fixturePath: config.fixturePath,
    outputDir: config.outputDir,
    reportPath: config.reportPath,
    auditLogPath: config.auditLogPath,
    gitlabBaseUrl: config.gitlabBaseUrl,
    projectId: config.projectId,
    mrIid: config.mrIid,
    env
  });

  process.stdout.write(
    `automemory-capture-corrections: ${report.status}; source=${report.source}; pending=${report.pending_written_count}; report=${report.report_path}\n`
  );

  return 0;
}

export function extractCorrectionRecords(
  discussions: readonly GitLabDiscussion[],
  context: Readonly<{ projectRef: string; mrIid: string }>
): ExtractedCorrectionRecords {
  const records: W11CorrectionRecord[] = [];
  let noteCount = 0;
  let actionableNoteCount = 0;
  let skippedRedlineCount = 0;

  for (const discussion of discussions) {
    for (const note of discussion.notes) {
      noteCount += 1;
      if (!isActionableNote(note)) {
        continue;
      }

      actionableNoteCount += 1;
      const record = buildCorrectionRecord(discussion, note, context);
      const redacted = redactCorrectionRecord(record);
      if (findMemoryRedlineViolations(stripRedactionMarkers(JSON.stringify(redacted))).length > 0) {
        skippedRedlineCount += 1;
        continue;
      }
      records.push(redacted);
    }
  }

  return {
    records,
    noteCount,
    actionableNoteCount,
    skippedRedlineCount
  };
}

function buildCorrectionRecord(
  discussion: GitLabDiscussion,
  note: GitLabNote,
  context: Readonly<{ projectRef: string; mrIid: string }>
): W11CorrectionRecord {
  const suggestion = note.suggestions[0];
  const fencedSuggestion = extractSuggestionFence(note.body);
  const path = note.position?.new_path ?? note.position?.old_path ?? 'unknown';
  const line = note.position?.new_line ?? note.position?.old_line;
  const sourceRef = buildSourceRef(
    context.projectRef,
    context.mrIid,
    discussion.id,
    note,
    path,
    line
  );
  const reviewerReason = cleanReviewerReason(note.body);

  return {
    schema_version: CORRECTION_SCHEMA_VERSION,
    before_diff:
      suggestion?.from_content ??
      `[before diff unavailable; review location ${path}${line === undefined ? '' : `:${line}`}]`,
    after_diff: suggestion?.to_content ?? fencedSuggestion ?? reviewerReason,
    reviewer_reason: reviewerReason,
    skill_hint: inferSkillHints(path, note.body),
    source_ref: sourceRef,
    redaction_status: 'clean'
  };
}

function redactCorrectionRecord(record: W11CorrectionRecord): W11CorrectionRecord {
  const before = redactSensitiveText(record.before_diff);
  const after = redactSensitiveText(record.after_diff);
  const reason = redactSensitiveText(record.reviewer_reason);
  const sourceRef = redactSensitiveText(record.source_ref);
  const redacted = before.redacted || after.redacted || reason.redacted || sourceRef.redacted;

  return {
    ...record,
    before_diff: before.value,
    after_diff: after.value,
    reviewer_reason: reason.value,
    source_ref: sourceRef.value,
    redaction_status: redacted ? 'redacted' : 'clean'
  };
}

function redactSensitiveText(value: string): RedactionResult {
  let redacted = value;
  let changed = false;

  for (const rule of redactionRules()) {
    const next = redacted.replace(rule.pattern, `[REDACTED:${rule.id}]`);
    if (next !== redacted) {
      changed = true;
      redacted = next;
    }
  }

  return {
    value: redacted,
    redacted: changed
  };
}

function stripRedactionMarkers(value: string): string {
  return value.replace(/\[REDACTED:[^\]]+\]/g, '[REDACTED]');
}

function redactionRules(): readonly RedactionRule[] {
  return [
    ...MEMORY_REDLINE_RULES.map((rule) => ({
      id: rule.id,
      pattern: globalPattern(rule.pattern)
    })),
    ...EXTRA_REDACTION_RULES
  ];
}

function globalPattern(pattern: RegExp): RegExp {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  return new RegExp(pattern.source, flags);
}

async function loadDiscussions(
  options: CorrectionCaptureOptions & Readonly<{ repoRoot: string }>
): Promise<DiscussionLoadResult> {
  if (options.fixturePath !== undefined) {
    const fixturePath = resolve(options.repoRoot, options.fixturePath);
    const payload = JSON.parse(await readFile(fixturePath, 'utf8')) as unknown;
    return {
      source: 'fixture',
      discussions: readDiscussionsPayload(payload),
      projectRef: options.projectId ?? 'fixture-project',
      mrIid: options.mrIid ?? 'fixture-mr'
    };
  }

  const env = options.env ?? process.env;
  const gitlabBaseUrl = options.gitlabBaseUrl ?? env.GITLAB_BASE_URL ?? env.CI_SERVER_URL;
  const projectId = options.projectId ?? env.CI_PROJECT_ID ?? env.GITLAB_PROJECT_ID;
  const mrIid = options.mrIid ?? env.CI_MERGE_REQUEST_IID ?? env.GITLAB_MERGE_REQUEST_IID;
  const token = options.token ?? env.GITLAB_TOKEN ?? env.GITLAB_API_TOKEN ?? env.CI_JOB_TOKEN;

  if (
    gitlabBaseUrl === undefined ||
    projectId === undefined ||
    mrIid === undefined ||
    token === undefined
  ) {
    return {
      source: 'missing_env',
      status: 'skipped_missing_env',
      discussions: [],
      projectRef: projectId ?? 'missing-project',
      mrIid: mrIid ?? 'missing-mr'
    };
  }

  const url = buildDiscussionsApiUrl(gitlabBaseUrl, projectId, mrIid);
  const headers =
    token === env.CI_JOB_TOKEN
      ? { 'JOB-TOKEN': token }
      : {
          'PRIVATE-TOKEN': token
        };
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`GitLab discussions read failed with status ${response.status}`);
  }

  return {
    source: 'gitlab_api',
    discussions: readDiscussionsPayload((await response.json()) as unknown),
    projectRef: projectId,
    mrIid
  };
}

function buildDiscussionsApiUrl(baseUrl: string, projectId: string, mrIid: string): string {
  const normalized = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const url = new URL(
    `api/v4/projects/${encodeURIComponent(projectId)}/merge_requests/${encodeURIComponent(mrIid)}/discussions`,
    normalized
  );
  return url.toString();
}

function readDiscussionsPayload(value: unknown): readonly GitLabDiscussion[] {
  if (Array.isArray(value)) {
    return value.map((item, index) => readDiscussion(item, `discussions[${index}]`));
  }

  const record = readObject(value, 'discussions payload');
  const discussions = record.discussions;
  if (!Array.isArray(discussions)) {
    throw new Error('discussions payload must be an array or contain discussions[]');
  }
  return discussions.map((item, index) => readDiscussion(item, `discussions[${index}]`));
}

function readDiscussion(value: unknown, label: string): GitLabDiscussion {
  const record = readObject(value, label);
  const notes = record.notes;
  if (!Array.isArray(notes)) {
    throw new Error(`${label}.notes must be an array`);
  }

  return {
    id: readLooseString(record.id, `${label}.id`),
    notes: notes.map((note, index) => readNote(note, `${label}.notes[${index}]`))
  };
}

function readNote(value: unknown, label: string): GitLabNote {
  const record = readObject(value, label);
  const suggestions = Array.isArray(record.suggestions)
    ? record.suggestions.map((suggestion, index) =>
        readSuggestion(suggestion, `${label}.suggestions[${index}]`)
      )
    : [];
  const position =
    typeof record.position === 'object' &&
    record.position !== null &&
    !Array.isArray(record.position)
      ? readPosition(record.position)
      : undefined;

  return {
    id: readLooseString(record.id, `${label}.id`),
    body: readRequiredString(record.body, `${label}.body`),
    system: record.system === true,
    resolvable: record.resolvable === true,
    ...(position !== undefined ? { position } : {}),
    suggestions
  };
}

function readPosition(value: object): GitLabPosition {
  const record = value as Record<string, unknown>;
  return {
    ...(typeof record.old_path === 'string' ? { old_path: record.old_path } : {}),
    ...(typeof record.new_path === 'string' ? { new_path: record.new_path } : {}),
    ...(typeof record.old_line === 'number' ? { old_line: record.old_line } : {}),
    ...(typeof record.new_line === 'number' ? { new_line: record.new_line } : {})
  };
}

function readSuggestion(value: unknown, label: string): GitLabSuggestion {
  const record = readObject(value, label);
  return {
    ...(typeof record.from_content === 'string' ? { from_content: record.from_content } : {}),
    ...(typeof record.to_content === 'string' ? { to_content: record.to_content } : {})
  };
}

function isActionableNote(note: GitLabNote): boolean {
  if (note.system || note.body.trim().length === 0) return false;
  if (note.suggestions.length > 0 || extractSuggestionFence(note.body) !== null) return true;
  if (note.resolvable) return true;
  return /(fix|should|please|建议|修复|更改|改成|correction)/i.test(note.body);
}

function extractSuggestionFence(body: string): string | null {
  const match = body.match(/```suggestion\s*\n([\s\S]*?)```/i);
  const suggestion = match?.[1]?.trim();
  return suggestion === undefined || suggestion.length === 0 ? null : suggestion;
}

function cleanReviewerReason(body: string): string {
  const withoutFences = body.replace(/```suggestion\s*\n[\s\S]*?```/gi, ' ');
  const collapsed = withoutFences.replace(/\s+/g, ' ').trim();
  return collapsed.length === 0 ? 'reviewer requested correction' : truncate(collapsed, 400);
}

function inferSkillHints(path: string, body: string): readonly string[] {
  const hints: string[] = ['review-correction'];
  const lowerPath = path.toLowerCase();
  const lowerBody = body.toLowerCase();
  if (lowerPath.endsWith('.vue')) hints.push('expert-vue');
  if (lowerPath.endsWith('.ts') || lowerPath.endsWith('.tsx')) hints.push('expert-typescript');
  if (lowerPath.includes('test') || lowerBody.includes('test')) hints.push('testing');
  if (lowerPath === '.gitlab-ci.yml' || lowerPath.includes('/ci/') || lowerBody.includes('ci')) {
    hints.push('devops-ci');
  }
  if (lowerBody.includes('policy') || lowerBody.includes('token') || lowerBody.includes('secret')) {
    hints.push('policy-gate');
  }
  return [...new Set(hints)];
}

async function writePendingCorrections(input: {
  readonly outputDir: string;
  readonly generatedAt: Date;
  readonly projectRef: string;
  readonly mrIid: string;
  readonly records: readonly W11CorrectionRecord[];
}): Promise<string> {
  await mkdir(input.outputDir, { recursive: true });
  const fileName = `correction-${sanitizeFileToken(input.mrIid)}-${toFileTimestamp(input.generatedAt)}.md`;
  const filePath = join(input.outputDir, fileName);
  await writeFile(filePath, renderPendingMarkdown(input), 'utf8');
  return filePath;
}

function renderPendingMarkdown(input: {
  readonly generatedAt: Date;
  readonly projectRef: string;
  readonly mrIid: string;
  readonly records: readonly W11CorrectionRecord[];
}): string {
  const candidates = input.records.map((record) => toHarvesterCandidate(record));
  const lines: string[] = [
    '# W11 Correction Capture Pending',
    '',
    `- generated_at: ${input.generatedAt.toISOString()}`,
    `- task_id: w11-correction-capture-${sanitizeFileToken(input.mrIid)}`,
    `- audit_trace_id: ${buildAuditTraceId(input.generatedAt)}`,
    '- turn_state: done',
    '- runtime: gitlab-discussions-readonly',
    '- model: gpt-5-mini',
    '- harvester_prompt_version: correction-capture@0.1',
    `- project_ref_hash: ${hashText(input.projectRef)}`,
    `- merge_request_iid: ${input.mrIid}`,
    `- pending_written_count: ${candidates.length}`,
    '',
    '## Correction Records',
    '',
    '```json',
    `${JSON.stringify(input.records, null, 2)}`,
    '```',
    '',
    '## Accepted Candidates'
  ];

  for (const [index, candidate] of candidates.entries()) {
    lines.push(
      '',
      `### ${index + 1}. ${candidate.kind} :: ${candidate.key}`,
      `- source_ref: ${candidate.source_ref}`,
      `- producer_agent: ${candidate.producer_agent}`,
      `- confidence: ${candidate.confidence}`,
      `- novelty: ${candidate.novelty}`,
      `- rationale: ${candidate.rationale}`,
      '',
      '```json',
      `${JSON.stringify(candidate, null, 2)}`,
      '```'
    );
  }

  lines.push('');
  return lines.join('\n');
}

function toHarvesterCandidate(record: W11CorrectionRecord): HarvesterCandidate {
  return {
    kind: 'correction',
    key: `correction.${sanitizeKey(record.source_ref)}`,
    value: JSON.stringify(record),
    source_ref: record.source_ref,
    producer_agent: PRODUCER_AGENT,
    confidence: 0.86,
    novelty: 0.72,
    rationale: truncate(record.reviewer_reason, 100)
  };
}

async function appendCorrectionCaptureAudit(
  auditLogPath: string,
  event: CorrectionCaptureAuditEvent
): Promise<void> {
  await mkdir(dirname(auditLogPath), { recursive: true });
  await appendFile(auditLogPath, `${JSON.stringify(event)}\n`, 'utf8');
}

function resolveCaptureStatus(
  loadResult: DiscussionLoadResult,
  recordCount: number
): CorrectionCaptureStatus {
  if (loadResult.status === 'skipped_missing_env') return 'skipped_missing_env';
  return recordCount > 0 ? 'captured' : 'no_actionable_discussions';
}

function buildSourceRef(
  projectRef: string,
  mrIid: string,
  discussionId: string,
  note: GitLabNote,
  path: string,
  line: number | undefined
): string {
  const location =
    path === 'unknown' ? '' : `#file:${path}${line === undefined ? '' : `#L${line}`}`;
  return `gitlab:${projectRef}#mr:${mrIid}#discussion:${discussionId}#note:${note.id}${location}`;
}

function buildAuditTraceId(timestamp: Date): string {
  return `trace-w11-correction-capture-${toFileTimestamp(timestamp)}`;
}

function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function sanitizeKey(value: string): string {
  return hashText(value);
}

function sanitizeFileToken(value: string): string {
  const collapsed = value.replace(/[^a-zA-Z0-9._-]/g, '_');
  return collapsed.length > 0 ? collapsed : 'correction';
}

function toFileTimestamp(now: Date): string {
  const iso = now.toISOString();
  const compact = iso.replace(/[-:]/g, '');
  return compact.replace(/\.\d{3}Z$/, 'Z');
}

function truncate(value: string, maxLength: number): string {
  const chars = Array.from(value);
  return chars.length <= maxLength ? value : chars.slice(0, maxLength).join('');
}

function toDisplayPath(repoRoot: string, path: string): string {
  const relativePath = path.startsWith(repoRoot) ? path.slice(repoRoot.length + 1) : path;
  return relativePath.length > 0 ? relativePath : path;
}

function readDiscussionsCliEnv(
  env: Readonly<Record<string, string | undefined>>
): Pick<CaptureCliConfig, 'gitlabBaseUrl' | 'projectId' | 'mrIid'> {
  return {
    ...(env.GITLAB_BASE_URL !== undefined ? { gitlabBaseUrl: env.GITLAB_BASE_URL } : {}),
    ...(env.CI_PROJECT_ID !== undefined ? { projectId: env.CI_PROJECT_ID } : {}),
    ...(env.CI_MERGE_REQUEST_IID !== undefined ? { mrIid: env.CI_MERGE_REQUEST_IID } : {})
  };
}

function parseCliArgs(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>
): CaptureCliConfig {
  const repoRoot = resolve(env.CI_PROJECT_DIR ?? resolveRepoRoot());
  let fixturePath: string | undefined;
  let outputDir = DEFAULT_OUTPUT_DIR;
  let reportPath = DEFAULT_REPORT_PATH;
  let auditLogPath = DEFAULT_AUDIT_LOG_PATH;
  let { gitlabBaseUrl, projectId, mrIid } = readDiscussionsCliEnv(env);
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === '--help' || arg === '-h') {
      help = true;
    } else if (arg === '--fixture') {
      fixturePath = readNext(argv, index, arg);
      index += 1;
    } else if (arg.startsWith('--fixture=')) {
      fixturePath = arg.slice('--fixture='.length);
    } else if (arg === '--output-dir') {
      outputDir = readNext(argv, index, arg);
      index += 1;
    } else if (arg.startsWith('--output-dir=')) {
      outputDir = arg.slice('--output-dir='.length);
    } else if (arg === '--report') {
      reportPath = readNext(argv, index, arg);
      index += 1;
    } else if (arg.startsWith('--report=')) {
      reportPath = arg.slice('--report='.length);
    } else if (arg === '--audit-log') {
      auditLogPath = readNext(argv, index, arg);
      index += 1;
    } else if (arg.startsWith('--audit-log=')) {
      auditLogPath = arg.slice('--audit-log='.length);
    } else if (arg === '--gitlab-base-url') {
      gitlabBaseUrl = readNext(argv, index, arg);
      index += 1;
    } else if (arg.startsWith('--gitlab-base-url=')) {
      gitlabBaseUrl = arg.slice('--gitlab-base-url='.length);
    } else if (arg === '--project-id') {
      projectId = readNext(argv, index, arg);
      index += 1;
    } else if (arg.startsWith('--project-id=')) {
      projectId = arg.slice('--project-id='.length);
    } else if (arg === '--mr-iid') {
      mrIid = readNext(argv, index, arg);
      index += 1;
    } else if (arg.startsWith('--mr-iid=')) {
      mrIid = arg.slice('--mr-iid='.length);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return {
    repoRoot,
    ...(fixturePath !== undefined ? { fixturePath } : {}),
    outputDir,
    reportPath,
    auditLogPath,
    ...(gitlabBaseUrl !== undefined ? { gitlabBaseUrl } : {}),
    ...(projectId !== undefined ? { projectId } : {}),
    ...(mrIid !== undefined ? { mrIid } : {}),
    help
  };
}

function readNext(argv: readonly string[], index: number, option: string): string {
  const value = argv[index + 1];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

function readObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function readLooseString(value: unknown, label: string): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  throw new Error(`${label} must be a string or number`);
}

function readRequiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function usageText(): string {
  return [
    'Usage: automemory-capture-corrections [--fixture <path>] [--output-dir <path>] [--report <path>] [--audit-log <path>] [--gitlab-base-url <url>] [--project-id <id>] [--mr-iid <iid>]',
    '',
    'Reads GitLab MR discussions when read-only env is present. If env is missing, writes a deterministic zero-pending report.'
  ].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCorrectionCaptureCli().then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : 'automemory-capture-corrections failed'}\n`
      );
      process.exitCode = 1;
    }
  );
}
