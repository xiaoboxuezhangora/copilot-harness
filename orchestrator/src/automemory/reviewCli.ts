import { constants } from 'node:fs';
import { access, appendFile, mkdir, readdir, readFile, rename, stat } from 'node:fs/promises';
import { basename, dirname, join, parse, relative, resolve } from 'node:path';
import { createInterface, type Interface as ReadlineInterface } from 'node:readline/promises';
import type { Readable, Writable } from 'node:stream';
import { pathToFileURL } from 'node:url';

import type { HarvesterCandidate, HarvesterCandidateKind } from './harvester.js';
import {
  DEFAULT_MEMORY_SQLITE_PATH,
  SqliteMemoryStore,
  findMemoryRedlineViolations,
  type MemoryNamespace,
  type MemoryConflictCandidateV1,
  type MemoryEmbeddingBackend,
  type MemoryFindSimilarInput,
  type MemoryFindSimilarResult,
  type MemoryPutInput,
  type MemoryRecord,
  type MemoryStore
} from '../memory/index.js';
import { resolveRepoRoot } from '../runtime/skillAgentLoader.js';

export type ReviewDecision = 'accept' | 'edit' | 'reject' | 'skip';
export type ConflictCheckDecision = 'no_conflict' | 'compare_required';
export type MemoryConflictResolutionDecision =
  | 'keep_existing'
  | 'replace_existing'
  | 'merge'
  | 'add_new'
  | 'reject'
  | 'skip';
export type ReviewArchiveBucket = 'accepted' | 'rejected';
export type EditableCandidateField =
  | 'key'
  | 'value'
  | 'source_ref'
  | 'producer_agent'
  | 'confidence'
  | 'novelty'
  | 'rationale';

export interface PendingReviewMetadata {
  readonly generatedAt: string;
  readonly taskId: string;
  readonly auditTraceId: string;
  readonly extra: Readonly<Record<string, string>>;
}

export interface PendingReviewFile {
  readonly filePath: string;
  readonly relativePath: string;
  readonly fileMtimeMs: number;
  readonly metadata: PendingReviewMetadata;
  readonly candidates: readonly HarvesterCandidate[];
}

export interface CandidateEdit {
  readonly candidateIndex: number;
  readonly field: EditableCandidateField;
  readonly value: string | number;
}

export interface CandidateDecisionResult {
  readonly candidate: HarvesterCandidate;
  readonly memoryNamespace: MemoryNamespace;
  readonly memoryKey: string;
  readonly memoryWriteOk: boolean;
  readonly editedFields: readonly string[];
  readonly reason: string;
}

export interface CandidateConflictCheck {
  readonly candidateIndex: number;
  readonly candidate: HarvesterCandidate;
  readonly memoryNamespace: MemoryNamespace;
  readonly memoryKey: string;
  readonly conflictResult: MemoryFindSimilarResult;
}

export interface CandidateConflictResolution {
  readonly candidateIndex: number;
  readonly decision: MemoryConflictResolutionDecision;
  readonly reviewerReason?: string | undefined;
  readonly editedFields?: readonly string[] | undefined;
}

export interface ReviewPendingFileResult {
  readonly decision: ReviewDecision;
  readonly archivePath: string | null;
  readonly memoryWriteOk: boolean;
  readonly candidateResults: readonly CandidateDecisionResult[];
  readonly conflictChecks: readonly CandidateConflictCheck[];
  readonly conflictResolutions: readonly CandidateConflictResolution[];
}

export interface ReviewAuditEvent {
  readonly timestamp: string;
  readonly event_name: 'automemory.review_decision';
  readonly task_id: string;
  readonly audit_trace_id: string;
  readonly pending_path: string;
  readonly candidate_key: string;
  readonly candidate_kind: HarvesterCandidateKind;
  readonly source_ref: string;
  readonly decision: ReviewDecision;
  readonly reviewer: string;
  readonly reviewed_at: string;
  readonly edited: boolean;
  readonly edited_fields: readonly string[];
  readonly archive_path: string | null;
  readonly memory_namespace: MemoryNamespace;
  readonly memory_key: string;
  readonly memory_write_ok: boolean;
  readonly reason: string;
}

export interface ConflictCheckAuditEvent {
  readonly timestamp: string;
  readonly event_name: 'automemory.conflict_check';
  readonly task_id: string;
  readonly audit_trace_id: string;
  readonly pending_path: string;
  readonly candidate_key: string;
  readonly candidate_kind: HarvesterCandidateKind;
  readonly namespace: MemoryNamespace;
  readonly conflict_count: number;
  readonly top_similarity: number | null;
  readonly embedding_backend: MemoryEmbeddingBackend;
  readonly decision: ConflictCheckDecision;
  readonly reviewer: string;
  readonly memory_write_ok: boolean;
  readonly source_ref: string;
}

export interface ConflictDecisionAuditEvent {
  readonly timestamp: string;
  readonly event_name: 'automemory.conflict_decision';
  readonly task_id: string;
  readonly audit_trace_id: string;
  readonly pending_path: string;
  readonly candidate_key: string;
  readonly candidate_kind: HarvesterCandidateKind;
  readonly namespace: MemoryNamespace;
  readonly conflict_count: number;
  readonly top_similarity: number | null;
  readonly embedding_backend: MemoryEmbeddingBackend;
  readonly decision: MemoryConflictResolutionDecision;
  readonly reviewer: string;
  readonly reviewer_reason?: string | undefined;
  readonly edited_fields: readonly string[];
  readonly memory_write_ok: boolean;
  readonly source_ref: string;
}

export type AutomemoryAuditEvent =
  | ReviewAuditEvent
  | ConflictCheckAuditEvent
  | ConflictDecisionAuditEvent;

export interface ReviewPendingFileOptions {
  readonly pending: PendingReviewFile;
  readonly pendingDir: string;
  readonly archiveDir: string;
  readonly auditLogPath: string;
  readonly memoryStore: MemoryStore;
  readonly decision: ReviewDecision;
  readonly reviewer: string;
  readonly reviewedAt?: Date | undefined;
  readonly edits?: readonly CandidateEdit[] | undefined;
  readonly conflictResolutions?: readonly CandidateConflictResolution[] | undefined;
}

export interface BuildMemoryPutInputOptions {
  readonly reviewedAt: Date;
  readonly aliasManualEntry?: boolean | undefined;
}

interface ReviewCliConfig {
  readonly repoRoot: string;
  readonly dryRun: boolean;
  readonly pendingDir: string;
  readonly archiveDir: string;
  readonly sqlitePath: string;
  readonly auditLogPath: string;
  readonly reviewer: string;
  readonly limit: number | null;
  readonly help: boolean;
}

interface ReviewCliRuntimeOptions {
  readonly stdin?: Readable | undefined;
  readonly stdout?: Writable | undefined;
  readonly stderr?: Writable | undefined;
  readonly env?: Readonly<Record<string, string | undefined>> | undefined;
}

class ReviewPolicyError extends Error {
  constructor(
    message: string,
    readonly reason: string
  ) {
    super(message);
    this.name = 'ReviewPolicyError';
  }
}

const DEFAULT_PENDING_DIR = '.memory/pending';
const DEFAULT_ARCHIVE_DIR = '.memory/archive';
const DEFAULT_AUDIT_LOG_PATH = 'reports/audit.log';
const REVIEW_EVENT_NAME = 'automemory.review_decision';

export async function runReviewCli(
  argv: readonly string[] = process.argv.slice(2),
  runtime: ReviewCliRuntimeOptions = {}
): Promise<number> {
  const stdout = runtime.stdout ?? process.stdout;
  const stderr = runtime.stderr ?? process.stderr;
  let config: ReviewCliConfig;

  try {
    config = parseReviewCliArgs(argv, runtime.env ?? process.env);
  } catch (error: unknown) {
    writeLine(stderr, error instanceof Error ? error.message : 'Invalid automemory-review args');
    writeLine(stderr, usageText());
    return 2;
  }

  if (config.help) {
    writeLine(stdout, usageText());
    return 0;
  }

  const pendingFiles = applyReviewLimit(
    sortPendingReviewFiles(await loadPendingReviewFiles(config.pendingDir)),
    config.limit
  );

  if (config.dryRun) {
    writeLine(stdout, renderDryRunSummary(pendingFiles, config));
    return 0;
  }

  if (pendingFiles.length === 0) {
    writeLine(stdout, 'automemory-review: no pending Markdown files found.');
    return 0;
  }

  const input = runtime.stdin ?? process.stdin;
  const output = runtime.stdout ?? process.stdout;
  const readline = createInterface({
    input,
    output
  });
  const store = new SqliteMemoryStore({
    sqlitePath: config.sqlitePath
  });

  try {
    for (const [index, pending] of pendingFiles.entries()) {
      writeLine(stdout, renderPendingReviewPrompt(pending, index + 1, pendingFiles.length));
      const decision = await askDecision(readline);
      if (decision === 'quit') {
        writeLine(stdout, 'automemory-review: quit requested.');
        break;
      }

      const edits = decision === 'edit' ? await askCandidateEdit(readline, pending) : [];
      const reviewedAt = new Date();
      const editedCandidates = applyCandidateEdits(pending.candidates, edits);
      const conflictChecks = await previewCandidateConflictChecks({
        decision,
        candidates: editedCandidates,
        memoryStore: store,
        reviewedAt
      });
      const conflictResolutions = conflictChecks.some(
        (check) => check.conflictResult.candidates.length > 0
      )
        ? await askConflictResolutions(readline, stdout, conflictChecks)
        : [];
      const result = await reviewPendingFile({
        pending,
        pendingDir: config.pendingDir,
        archiveDir: config.archiveDir,
        auditLogPath: config.auditLogPath,
        memoryStore: store,
        decision,
        reviewer: config.reviewer,
        reviewedAt,
        edits,
        conflictResolutions
      });

      writeLine(stdout, renderReviewResult(result));
    }
  } finally {
    readline.close();
    store.close();
  }

  return 0;
}

export async function loadPendingReviewFiles(
  pendingDir: string
): Promise<readonly PendingReviewFile[]> {
  const root = resolve(pendingDir);
  const markdownFiles = await findMarkdownFiles(root);
  const pendingFiles: PendingReviewFile[] = [];

  for (const filePath of markdownFiles) {
    const [content, fileStat] = await Promise.all([readFile(filePath, 'utf8'), stat(filePath)]);
    const parsed = parsePendingMarkdown(content, {
      filePath,
      relativePath: safeRelativePath(root, filePath),
      fileMtimeMs: fileStat.mtimeMs
    });
    if (parsed.candidates.length > 0) {
      pendingFiles.push(parsed);
    }
  }

  return pendingFiles;
}

export function parsePendingMarkdown(
  content: string,
  file: Readonly<{
    filePath: string;
    relativePath?: string | undefined;
    fileMtimeMs?: number | undefined;
  }>
): PendingReviewFile {
  const metadata = parsePendingMetadata(content, file.filePath);
  const candidates = parseAcceptedCandidates(content);

  return {
    filePath: resolve(file.filePath),
    relativePath: file.relativePath ?? basename(file.filePath),
    fileMtimeMs: file.fileMtimeMs ?? 0,
    metadata,
    candidates
  };
}

export function sortPendingReviewFiles(
  pendingFiles: readonly PendingReviewFile[]
): readonly PendingReviewFile[] {
  return [...pendingFiles].sort((left, right) => {
    const leftRank = rankPendingReviewFile(left);
    const rightRank = rankPendingReviewFile(right);

    if (leftRank.confidence !== rightRank.confidence) {
      return rightRank.confidence - leftRank.confidence;
    }

    if (leftRank.novelty !== rightRank.novelty) {
      return rightRank.novelty - leftRank.novelty;
    }

    if (left.fileMtimeMs !== right.fileMtimeMs) {
      return left.fileMtimeMs - right.fileMtimeMs;
    }

    return left.relativePath.localeCompare(right.relativePath);
  });
}

export async function reviewPendingFile(
  options: ReviewPendingFileOptions
): Promise<ReviewPendingFileResult> {
  const reviewedAt = options.reviewedAt ?? new Date();
  const candidates = applyCandidateEdits(options.pending.candidates, options.edits ?? []);
  const editedFieldMap = buildEditedFieldMap(options.edits ?? []);

  if (options.decision === 'skip') {
    const results = buildCandidateDecisionResults({
      candidates,
      editedFieldMap,
      reviewedAt,
      memoryWriteOk: false,
      reason: 'skipped_by_reviewer'
    });
    await appendReviewAuditEvents(options, reviewedAt, null, results);
    return {
      decision: options.decision,
      archivePath: null,
      memoryWriteOk: false,
      candidateResults: results,
      conflictChecks: [],
      conflictResolutions: []
    };
  }

  if (options.decision === 'reject') {
    const archivePath = await archivePendingFile({
      pending: options.pending,
      pendingDir: options.pendingDir,
      archiveDir: options.archiveDir,
      reviewedAt,
      bucket: 'rejected'
    });
    const results = buildCandidateDecisionResults({
      candidates,
      editedFieldMap,
      reviewedAt,
      memoryWriteOk: false,
      reason: 'rejected_by_reviewer'
    });
    await appendReviewAuditEvents(options, reviewedAt, archivePath, results);
    return {
      decision: options.decision,
      archivePath,
      memoryWriteOk: false,
      candidateResults: results,
      conflictChecks: [],
      conflictResolutions: []
    };
  }

  try {
    const conflictChecks = await findCandidateConflictChecks({
      candidates,
      memoryStore: options.memoryStore,
      reviewedAt
    });
    await appendConflictCheckAuditEvents(options, reviewedAt, conflictChecks);

    const conflictResolutions = resolveConflictDecisions({
      conflictChecks,
      explicitResolutions: options.conflictResolutions ?? [],
      editedFieldMap
    });

    if (conflictResolutions.some((resolution) => resolution.decision === 'skip')) {
      const results = buildCandidateDecisionResults({
        candidates,
        editedFieldMap,
        reviewedAt,
        memoryWriteOk: false,
        reason: 'conflict_skipped_by_reviewer'
      });
      await appendConflictDecisionAuditEvents(
        options,
        reviewedAt,
        conflictChecks,
        conflictResolutions,
        editedFieldMap
      );
      await appendReviewAuditEvents(options, reviewedAt, null, results);

      return {
        decision: options.decision,
        archivePath: null,
        memoryWriteOk: false,
        candidateResults: results,
        conflictChecks,
        conflictResolutions
      };
    }

    if (conflictResolutions.some((resolution) => resolution.decision === 'reject')) {
      const archivePath = await archivePendingFile({
        pending: options.pending,
        pendingDir: options.pendingDir,
        archiveDir: options.archiveDir,
        reviewedAt,
        bucket: 'rejected'
      });
      const results = buildCandidateDecisionResults({
        candidates,
        editedFieldMap,
        reviewedAt,
        memoryWriteOk: false,
        reason: 'conflict_rejected_by_reviewer'
      });
      await appendConflictDecisionAuditEvents(
        options,
        reviewedAt,
        conflictChecks,
        conflictResolutions,
        editedFieldMap
      );
      await appendReviewAuditEvents(options, reviewedAt, archivePath, results);

      return {
        decision: options.decision,
        archivePath,
        memoryWriteOk: false,
        candidateResults: results,
        conflictChecks,
        conflictResolutions
      };
    }

    const memoryRecords = await writeAcceptedCandidatesToMemory({
      candidates,
      memoryStore: options.memoryStore,
      reviewedAt,
      conflictResolutions
    });
    const archivePath = await archivePendingFile({
      pending: options.pending,
      pendingDir: options.pendingDir,
      archiveDir: options.archiveDir,
      reviewedAt,
      bucket: 'accepted'
    });
    const results = candidates.map((candidate, index) =>
      buildCandidateDecisionResult({
        candidate,
        editedFields: mergeEditedFields(
          editedFieldMap.get(index) ?? [],
          conflictResolutions.find((resolution) => resolution.candidateIndex === index)
            ?.editedFields ?? []
        ),
        reviewedAt,
        memoryWriteOk: memoryRecords[index] !== null,
        reason: resolveAcceptedReason({
          candidateIndex: index,
          reviewDecision: options.decision,
          conflictResolutions
        }),
        memoryKey: memoryRecords[index]?.key
      })
    );
    await appendConflictDecisionAuditEvents(
      options,
      reviewedAt,
      conflictChecks,
      conflictResolutions,
      editedFieldMap
    );
    await appendReviewAuditEvents(options, reviewedAt, archivePath, results);

    return {
      decision: options.decision,
      archivePath,
      memoryWriteOk: results.every((result) => result.memoryWriteOk),
      candidateResults: results,
      conflictChecks,
      conflictResolutions
    };
  } catch (error: unknown) {
    const reason = error instanceof ReviewPolicyError ? error.reason : safeErrorReason(error);
    const results = buildCandidateDecisionResults({
      candidates,
      editedFieldMap,
      reviewedAt,
      memoryWriteOk: false,
      reason
    });
    await appendReviewAuditEvents(options, reviewedAt, null, results);

    return {
      decision: options.decision,
      archivePath: null,
      memoryWriteOk: false,
      candidateResults: results,
      conflictChecks: [],
      conflictResolutions: []
    };
  }
}

export async function writeAcceptedCandidatesToMemory(input: {
  readonly candidates: readonly HarvesterCandidate[];
  readonly memoryStore: MemoryStore;
  readonly reviewedAt: Date;
  readonly aliasManualEntry?: boolean | undefined;
  readonly conflictResolutions?: readonly CandidateConflictResolution[] | undefined;
}): Promise<readonly (MemoryRecord | null)[]> {
  const putInputs = input.candidates.map((candidate) =>
    buildMemoryPutInput(candidate, {
      reviewedAt: input.reviewedAt,
      aliasManualEntry: input.aliasManualEntry
    })
  );

  for (const [index, putInput] of putInputs.entries()) {
    assertMemoryPutInputAllowed(input.candidates[index]!, putInput);
  }

  const records: (MemoryRecord | null)[] = [];
  const resolutionMap = buildConflictResolutionMap(input.conflictResolutions ?? []);
  for (const [index, putInput] of putInputs.entries()) {
    const resolution = resolutionMap.get(index);
    if (resolution?.decision === 'keep_existing') {
      records.push(null);
      continue;
    }

    records.push(await input.memoryStore.put(putInput));
  }

  return records;
}

export function buildMemoryPutInput(
  candidate: HarvesterCandidate,
  options: BuildMemoryPutInputOptions
): MemoryPutInput {
  const namespace = memoryNamespaceForKind(candidate.kind);
  const key =
    candidate.kind === 'correction' ? normalizeCorrectionKey(candidate.key) : candidate.key;
  const ts = options.reviewedAt.toISOString();

  if (namespace === 'decisions') {
    return {
      namespace,
      key,
      value: candidate.value,
      sourceRef: candidate.source_ref,
      ts,
      producerAgent: candidate.producer_agent,
      confidence: candidate.confidence
    };
  }

  if (namespace === 'knowledge_index') {
    return {
      namespace,
      key,
      value: candidate.value,
      sourceRef: candidate.source_ref,
      ts,
      triggerDescription: candidate.rationale
    };
  }

  return {
    namespace,
    key,
    value: candidate.value,
    sourceRef: candidate.source_ref,
    ts,
    producerAgent: candidate.producer_agent,
    manualEntry: options.aliasManualEntry ?? true
  };
}

export function assertMemoryPutInputAllowed(
  candidate: HarvesterCandidate,
  input: MemoryPutInput
): void {
  if (input.namespace === 'aliases' && input.manualEntry !== true) {
    throw new ReviewPolicyError(
      'alias memory writes require manualEntry=true',
      'alias_manual_entry_required'
    );
  }

  const violations = findMemoryRedlineViolations(
    [
      candidate.kind,
      input.key,
      input.value,
      input.sourceRef,
      input.producerAgent ?? '',
      input.triggerDescription ?? '',
      candidate.rationale
    ].join('\n')
  );

  if (violations.length > 0) {
    const ruleIds = [...new Set(violations.map((violation) => violation.id))].join(',');
    throw new ReviewPolicyError(
      'memory write rejected by redline policy',
      `redline_violation:${ruleIds}`
    );
  }
}

export async function findCandidateConflictChecks(input: {
  readonly candidates: readonly HarvesterCandidate[];
  readonly memoryStore: MemoryStore;
  readonly reviewedAt: Date;
}): Promise<readonly CandidateConflictCheck[]> {
  const checks: CandidateConflictCheck[] = [];

  for (const [candidateIndex, candidate] of input.candidates.entries()) {
    const putInput = buildMemoryPutInput(candidate, {
      reviewedAt: input.reviewedAt
    });
    assertMemoryPutInputAllowed(candidate, putInput);
    const conflictInput = toMemoryFindSimilarInput(putInput);
    const conflictResult = await input.memoryStore.findSimilarMemoryRecords(conflictInput);

    checks.push({
      candidateIndex,
      candidate,
      memoryNamespace: putInput.namespace,
      memoryKey: putInput.key,
      conflictResult
    });
  }

  return checks;
}

async function previewCandidateConflictChecks(input: {
  readonly decision: ReviewDecision;
  readonly candidates: readonly HarvesterCandidate[];
  readonly memoryStore: MemoryStore;
  readonly reviewedAt: Date;
}): Promise<readonly CandidateConflictCheck[]> {
  if (input.decision !== 'accept' && input.decision !== 'edit') {
    return [];
  }

  try {
    return await findCandidateConflictChecks({
      candidates: input.candidates,
      memoryStore: input.memoryStore,
      reviewedAt: input.reviewedAt
    });
  } catch {
    return [];
  }
}

function toMemoryFindSimilarInput(input: MemoryPutInput): MemoryFindSimilarInput {
  return {
    namespace: input.namespace,
    key: input.key,
    value: input.value,
    sourceRef: input.sourceRef,
    producerAgent: input.producerAgent,
    triggerDescription: input.triggerDescription,
    threshold: 0.85,
    limit: 5,
    includeExpired: false,
    embeddingProvider: 'deterministic_test'
  };
}

function resolveConflictDecisions(input: {
  readonly conflictChecks: readonly CandidateConflictCheck[];
  readonly explicitResolutions: readonly CandidateConflictResolution[];
  readonly editedFieldMap: ReadonlyMap<number, readonly string[]>;
}): readonly CandidateConflictResolution[] {
  const resolutions: CandidateConflictResolution[] = [];
  const explicitMap = buildConflictResolutionMap(input.explicitResolutions);

  for (const check of input.conflictChecks) {
    if (check.conflictResult.candidates.length === 0) {
      continue;
    }

    const explicit = explicitMap.get(check.candidateIndex);
    if (explicit === undefined) {
      throw new ReviewPolicyError(
        'memory conflict must be resolved before write',
        'memory_conflict_unresolved'
      );
    }

    validateConflictResolution(explicit, input.editedFieldMap.get(check.candidateIndex) ?? []);
    resolutions.push(explicit);
  }

  return resolutions;
}

function validateConflictResolution(
  resolution: CandidateConflictResolution,
  candidateEditedFields: readonly string[]
): void {
  if (
    resolution.decision === 'replace_existing' ||
    resolution.decision === 'merge'
  ) {
    const editedFields = mergeEditedFields(candidateEditedFields, resolution.editedFields ?? []);
    if (editedFields.length === 0) {
      throw new ReviewPolicyError(
        `${resolution.decision} requires edited_fields`,
        'conflict_resolution_requires_edited_fields'
      );
    }
  }

  if (
    resolution.decision === 'add_new' &&
    (resolution.reviewerReason === undefined || resolution.reviewerReason.trim().length === 0)
  ) {
    throw new ReviewPolicyError(
      'add_new requires reviewer reason',
      'conflict_add_new_requires_reason'
    );
  }
}

function buildConflictResolutionMap(
  resolutions: readonly CandidateConflictResolution[]
): ReadonlyMap<number, CandidateConflictResolution> {
  const map = new Map<number, CandidateConflictResolution>();
  for (const resolution of resolutions) {
    map.set(resolution.candidateIndex, resolution);
  }
  return map;
}

export function memoryNamespaceForKind(kind: HarvesterCandidateKind): MemoryNamespace {
  if (kind === 'knowledge') {
    return 'knowledge_index';
  }

  if (kind === 'alias') {
    return 'aliases';
  }

  return 'decisions';
}

export function normalizeCorrectionKey(key: string): string {
  const trimmed = key.trim();
  return trimmed.startsWith('correction.') ? trimmed : `correction.${trimmed}`;
}

export async function archivePendingFile(input: {
  readonly pending: PendingReviewFile;
  readonly pendingDir: string;
  readonly archiveDir: string;
  readonly reviewedAt: Date;
  readonly bucket: ReviewArchiveBucket;
}): Promise<string> {
  const day = input.reviewedAt.toISOString().slice(0, 10);
  const relativePendingPath = input.pending.relativePath.trim();
  const archiveRelativePath =
    relativePendingPath.length > 0 ? relativePendingPath : basename(input.pending.filePath);
  const destinationBase = join(input.archiveDir, day, input.bucket, archiveRelativePath);
  const destination = await nextAvailablePath(destinationBase);

  await mkdir(dirname(destination), {
    recursive: true
  });
  await rename(input.pending.filePath, destination);
  return destination;
}

export async function appendReviewAuditEvent(
  auditLogPath: string,
  event: AutomemoryAuditEvent
): Promise<void> {
  await mkdir(dirname(auditLogPath), {
    recursive: true
  });
  await appendFile(auditLogPath, `${JSON.stringify(event)}\n`, 'utf8');
}

export function parseReviewCliArgs(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>> = process.env
): ReviewCliConfig {
  const repoRoot = resolveRepoRoot();
  const parsed: {
    dryRun: boolean;
    pendingDir: string;
    archiveDir: string;
    sqlitePath: string;
    auditLogPath: string;
    reviewer: string;
    limit: number | null;
    help: boolean;
  } = {
    dryRun: false,
    pendingDir: join(repoRoot, DEFAULT_PENDING_DIR),
    archiveDir: join(repoRoot, DEFAULT_ARCHIVE_DIR),
    sqlitePath: join(repoRoot, DEFAULT_MEMORY_SQLITE_PATH),
    auditLogPath: join(repoRoot, DEFAULT_AUDIT_LOG_PATH),
    reviewer: env.USER?.trim() || env.USERNAME?.trim() || 'human-reviewer',
    limit: null,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === '--') {
      continue;
    } else if (arg === '--dry-run') {
      parsed.dryRun = true;
    } else if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    } else if (arg === '--pending-dir') {
      parsed.pendingDir = resolve(readNextArg(argv, index, arg));
      index += 1;
    } else if (arg.startsWith('--pending-dir=')) {
      parsed.pendingDir = resolve(readInlineArg(arg, '--pending-dir'));
    } else if (arg === '--archive-dir') {
      parsed.archiveDir = resolve(readNextArg(argv, index, arg));
      index += 1;
    } else if (arg.startsWith('--archive-dir=')) {
      parsed.archiveDir = resolve(readInlineArg(arg, '--archive-dir'));
    } else if (arg === '--sqlite-path') {
      parsed.sqlitePath = resolve(readNextArg(argv, index, arg));
      index += 1;
    } else if (arg.startsWith('--sqlite-path=')) {
      parsed.sqlitePath = resolve(readInlineArg(arg, '--sqlite-path'));
    } else if (arg === '--reviewer') {
      parsed.reviewer = readNonEmpty(readNextArg(argv, index, arg), '--reviewer');
      index += 1;
    } else if (arg.startsWith('--reviewer=')) {
      parsed.reviewer = readNonEmpty(readInlineArg(arg, '--reviewer'), '--reviewer');
    } else if (arg === '--limit') {
      parsed.limit = readPositiveInteger(readNextArg(argv, index, arg), '--limit');
      index += 1;
    } else if (arg.startsWith('--limit=')) {
      parsed.limit = readPositiveInteger(readInlineArg(arg, '--limit'), '--limit');
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return {
    repoRoot,
    dryRun: parsed.dryRun,
    pendingDir: parsed.pendingDir,
    archiveDir: parsed.archiveDir,
    sqlitePath: parsed.sqlitePath,
    auditLogPath: parsed.auditLogPath,
    reviewer: parsed.reviewer,
    limit: parsed.limit,
    help: parsed.help
  };
}

function parsePendingMetadata(content: string, filePath: string): PendingReviewMetadata {
  const header = readHeaderBlock(content);
  const parsed = parseYamlStyleHeader(header) ?? parseBulletHeader(header);

  return {
    generatedAt: readMetadataValue(parsed, 'generated_at', filePath),
    taskId: readMetadataValue(parsed, 'task_id', filePath),
    auditTraceId: readMetadataValue(parsed, 'audit_trace_id', filePath),
    extra: parsed
  };
}

function parseAcceptedCandidates(content: string): readonly HarvesterCandidate[] {
  const acceptedSection = readH2Section(content, 'Accepted Candidates');
  if (acceptedSection !== null) {
    const acceptedCandidates = readCandidateJsonBlocks(acceptedSection);
    if (acceptedCandidates.length > 0) {
      return acceptedCandidates;
    }
  }

  const rawSection = readH2Section(content, 'Harvester Raw Output');
  if (rawSection === null) {
    return [];
  }

  const rawBlocks = readJsonBlocks(rawSection);
  const rawPayload = rawBlocks[0];
  if (rawPayload === undefined) {
    return [];
  }

  const payload = readObject(rawPayload, 'harvester raw output');
  const candidates = payload.candidates;
  if (!Array.isArray(candidates)) {
    return [];
  }

  return candidates.map((candidate, index) =>
    readCandidate(candidate, `harvester raw output candidates[${index}]`)
  );
}

function readHeaderBlock(content: string): string {
  const h2Match = /\n##\s+/.exec(content);
  const end = h2Match?.index ?? content.length;
  return content.slice(0, end);
}

function parseYamlStyleHeader(header: string): Readonly<Record<string, string>> | null {
  const lines = header.split(/\r?\n/);
  const firstNonEmpty = lines.findIndex((line) => line.trim().length > 0);
  if (firstNonEmpty < 0 || lines[firstNonEmpty]?.trim() !== '---') {
    return null;
  }

  const values: Record<string, string> = {};
  for (let index = firstNonEmpty + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined) {
      continue;
    }

    if (line.trim() === '---') {
      return values;
    }

    const match = /^\s*([A-Za-z0-9_]+):\s*(.*?)\s*$/.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined) {
      values[match[1]] = match[2];
    }
  }

  return values;
}

function parseBulletHeader(header: string): Readonly<Record<string, string>> {
  const values: Record<string, string> = {};
  const pattern = /^\s*-\s*([A-Za-z0-9_]+):\s*(.*?)\s*$/gm;

  for (const match of header.matchAll(pattern)) {
    const key = match[1];
    const value = match[2];
    if (key !== undefined && value !== undefined) {
      values[key] = value;
    }
  }

  return values;
}

function readH2Section(content: string, title: string): string | null {
  const heading = `## ${title}`;
  const start = content.indexOf(heading);
  if (start < 0) {
    return null;
  }

  const sectionStart = start + heading.length;
  const rest = content.slice(sectionStart);
  const nextH2 = /\n##\s+/.exec(rest);
  const sectionEnd = nextH2 === null ? content.length : sectionStart + nextH2.index;
  return content.slice(sectionStart, sectionEnd);
}

function readCandidateJsonBlocks(section: string): readonly HarvesterCandidate[] {
  return readJsonBlocks(section).map((block, index) =>
    readCandidate(block, `accepted candidate json block[${index}]`)
  );
}

function readJsonBlocks(section: string): readonly unknown[] {
  const blocks: unknown[] = [];
  const pattern = /```json\s*([\s\S]*?)```/gi;

  for (const match of section.matchAll(pattern)) {
    const raw = match[1]?.trim();
    if (raw === undefined || raw.length === 0) {
      continue;
    }

    blocks.push(JSON.parse(raw) as unknown);
  }

  return blocks;
}

function readCandidate(value: unknown, label: string): HarvesterCandidate {
  const record = readObject(value, label);
  return {
    kind: readCandidateKind(record.kind),
    key: readRequiredString(record, 'key'),
    value: readRequiredString(record, 'value'),
    source_ref: readRequiredString(record, 'source_ref'),
    producer_agent: readRequiredString(record, 'producer_agent'),
    confidence: readUnitScore(record, 'confidence'),
    novelty: readUnitScore(record, 'novelty'),
    rationale: readRequiredString(record, 'rationale')
  };
}

function rankPendingReviewFile(
  pending: PendingReviewFile
): Readonly<{ confidence: number; novelty: number }> {
  return pending.candidates.reduce(
    (best, candidate) => {
      if (candidate.confidence > best.confidence) {
        return {
          confidence: candidate.confidence,
          novelty: candidate.novelty
        };
      }

      if (candidate.confidence === best.confidence && candidate.novelty > best.novelty) {
        return {
          confidence: candidate.confidence,
          novelty: candidate.novelty
        };
      }

      return best;
    },
    {
      confidence: 0,
      novelty: 0
    }
  );
}

function applyReviewLimit(
  pendingFiles: readonly PendingReviewFile[],
  limit: number | null
): readonly PendingReviewFile[] {
  return limit === null ? pendingFiles : pendingFiles.slice(0, limit);
}

function applyCandidateEdits(
  candidates: readonly HarvesterCandidate[],
  edits: readonly CandidateEdit[]
): readonly HarvesterCandidate[] {
  const edited = [...candidates];

  for (const edit of edits) {
    const current = edited[edit.candidateIndex];
    if (current === undefined) {
      throw new Error(`candidate edit index out of range: ${edit.candidateIndex}`);
    }

    edited[edit.candidateIndex] = applyCandidateEdit(current, edit);
  }

  return edited;
}

function applyCandidateEdit(
  candidate: HarvesterCandidate,
  edit: CandidateEdit
): HarvesterCandidate {
  if (edit.field === 'confidence' || edit.field === 'novelty') {
    const score = readEditedScore(edit.value, edit.field);
    return {
      ...candidate,
      [edit.field]: score
    };
  }

  const stringValue = readEditedString(edit.value, edit.field);
  if (edit.field === 'key') {
    return {
      ...candidate,
      key: stringValue
    };
  }

  if (edit.field === 'value') {
    return {
      ...candidate,
      value: stringValue
    };
  }

  if (edit.field === 'source_ref') {
    return {
      ...candidate,
      source_ref: stringValue
    };
  }

  if (edit.field === 'producer_agent') {
    return {
      ...candidate,
      producer_agent: stringValue
    };
  }

  return {
    ...candidate,
    rationale: stringValue
  };
}

function buildEditedFieldMap(
  edits: readonly CandidateEdit[]
): ReadonlyMap<number, readonly string[]> {
  const map = new Map<number, string[]>();

  for (const edit of edits) {
    const fields = map.get(edit.candidateIndex) ?? [];
    if (!fields.includes(edit.field)) {
      fields.push(edit.field);
    }
    map.set(edit.candidateIndex, fields);
  }

  return map;
}

function mergeEditedFields(
  candidateEditedFields: readonly string[],
  resolutionEditedFields: readonly string[]
): readonly string[] {
  const merged: string[] = [];
  for (const field of [...candidateEditedFields, ...resolutionEditedFields]) {
    if (!merged.includes(field)) {
      merged.push(field);
    }
  }
  return merged;
}

function resolveAcceptedReason(input: {
  readonly candidateIndex: number;
  readonly reviewDecision: ReviewDecision;
  readonly conflictResolutions: readonly CandidateConflictResolution[];
}): string {
  const resolution = input.conflictResolutions.find(
    (item) => item.candidateIndex === input.candidateIndex
  );
  if (resolution !== undefined) {
    return `conflict_${resolution.decision}`;
  }

  return input.reviewDecision === 'edit' ? 'edited_and_accepted' : 'accepted';
}

function buildCandidateDecisionResults(input: {
  readonly candidates: readonly HarvesterCandidate[];
  readonly editedFieldMap: ReadonlyMap<number, readonly string[]>;
  readonly reviewedAt: Date;
  readonly memoryWriteOk: boolean;
  readonly reason: string;
}): readonly CandidateDecisionResult[] {
  return input.candidates.map((candidate, index) =>
    buildCandidateDecisionResult({
      candidate,
      editedFields: input.editedFieldMap.get(index) ?? [],
      reviewedAt: input.reviewedAt,
      memoryWriteOk: input.memoryWriteOk,
      reason: input.reason
    })
  );
}

function buildCandidateDecisionResult(input: {
  readonly candidate: HarvesterCandidate;
  readonly editedFields: readonly string[];
  readonly reviewedAt: Date;
  readonly memoryWriteOk: boolean;
  readonly reason: string;
  readonly memoryKey?: string | undefined;
}): CandidateDecisionResult {
  const putInput = buildMemoryPutInput(input.candidate, {
    reviewedAt: input.reviewedAt
  });
  return {
    candidate: input.candidate,
    memoryNamespace: putInput.namespace,
    memoryKey: input.memoryKey ?? putInput.key,
    memoryWriteOk: input.memoryWriteOk,
    editedFields: input.editedFields,
    reason: input.reason
  };
}

async function appendReviewAuditEvents(
  options: ReviewPendingFileOptions,
  reviewedAt: Date,
  archivePath: string | null,
  results: readonly CandidateDecisionResult[]
): Promise<void> {
  for (const result of results) {
    await appendReviewAuditEvent(options.auditLogPath, {
      timestamp: reviewedAt.toISOString(),
      event_name: REVIEW_EVENT_NAME,
      task_id: options.pending.metadata.taskId,
      audit_trace_id: options.pending.metadata.auditTraceId,
      pending_path: options.pending.filePath,
      candidate_key: result.candidate.key,
      candidate_kind: result.candidate.kind,
      source_ref: result.candidate.source_ref,
      decision: options.decision,
      reviewer: options.reviewer,
      reviewed_at: reviewedAt.toISOString(),
      edited: result.editedFields.length > 0,
      edited_fields: result.editedFields,
      archive_path: archivePath,
      memory_namespace: result.memoryNamespace,
      memory_key: result.memoryKey,
      memory_write_ok: result.memoryWriteOk,
      reason: result.reason
    });
  }
}

async function appendConflictCheckAuditEvents(
  options: ReviewPendingFileOptions,
  reviewedAt: Date,
  checks: readonly CandidateConflictCheck[]
): Promise<void> {
  for (const check of checks) {
    await appendReviewAuditEvent(options.auditLogPath, {
      timestamp: reviewedAt.toISOString(),
      event_name: 'automemory.conflict_check',
      task_id: options.pending.metadata.taskId,
      audit_trace_id: options.pending.metadata.auditTraceId,
      pending_path: options.pending.filePath,
      candidate_key: check.candidate.key,
      candidate_kind: check.candidate.kind,
      namespace: check.memoryNamespace,
      conflict_count: check.conflictResult.candidates.length,
      top_similarity: topSimilarity(check.conflictResult.candidates),
      embedding_backend: check.conflictResult.embedding_backend,
      decision:
        check.conflictResult.candidates.length > 0 ? 'compare_required' : 'no_conflict',
      reviewer: options.reviewer,
      memory_write_ok: false,
      source_ref: check.candidate.source_ref
    });
  }
}

async function appendConflictDecisionAuditEvents(
  options: ReviewPendingFileOptions,
  reviewedAt: Date,
  checks: readonly CandidateConflictCheck[],
  resolutions: readonly CandidateConflictResolution[],
  editedFieldMap: ReadonlyMap<number, readonly string[]>
): Promise<void> {
  const checkMap = new Map(checks.map((check) => [check.candidateIndex, check]));
  for (const resolution of resolutions) {
    const check = checkMap.get(resolution.candidateIndex);
    if (check === undefined) {
      continue;
    }

    const editedFields = mergeEditedFields(
      editedFieldMap.get(resolution.candidateIndex) ?? [],
      resolution.editedFields ?? []
    );

    await appendReviewAuditEvent(options.auditLogPath, {
      timestamp: reviewedAt.toISOString(),
      event_name: 'automemory.conflict_decision',
      task_id: options.pending.metadata.taskId,
      audit_trace_id: options.pending.metadata.auditTraceId,
      pending_path: options.pending.filePath,
      candidate_key: check.candidate.key,
      candidate_kind: check.candidate.kind,
      namespace: check.memoryNamespace,
      conflict_count: check.conflictResult.candidates.length,
      top_similarity: topSimilarity(check.conflictResult.candidates),
      embedding_backend: check.conflictResult.embedding_backend,
      decision: resolution.decision,
      reviewer: options.reviewer,
      ...(resolution.reviewerReason !== undefined
        ? { reviewer_reason: resolution.reviewerReason }
        : {}),
      edited_fields: editedFields,
      memory_write_ok:
        resolution.decision === 'add_new' ||
        resolution.decision === 'replace_existing' ||
        resolution.decision === 'merge',
      source_ref: check.candidate.source_ref
    });
  }
}

function topSimilarity(candidates: readonly MemoryConflictCandidateV1[]): number | null {
  return candidates[0]?.similarity ?? null;
}

async function findMarkdownFiles(root: string): Promise<readonly string[]> {
  if (!(await pathExists(root))) {
    return [];
  }

  const entries = await readdir(root, {
    withFileTypes: true
  });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findMarkdownFiles(entryPath)));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(entryPath);
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

async function nextAvailablePath(path: string): Promise<string> {
  if (!(await pathExists(path))) {
    return path;
  }

  const parsed = parse(path);
  for (let index = 1; index < 10_000; index += 1) {
    const candidate = join(parsed.dir, `${parsed.name}-${index}${parsed.ext}`);
    if (!(await pathExists(candidate))) {
      return candidate;
    }
  }

  throw new Error(`Could not allocate archive path for ${path}`);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function safeRelativePath(root: string, filePath: string): string {
  const rawRelative = relative(root, filePath);
  if (rawRelative.startsWith('..')) {
    return basename(filePath);
  }

  return rawRelative;
}

function readObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }

  return value as Record<string, unknown>;
}

function readCandidateKind(value: unknown): HarvesterCandidateKind {
  if (
    value === 'decision' ||
    value === 'knowledge' ||
    value === 'correction' ||
    value === 'alias'
  ) {
    return value;
  }

  throw new Error('candidate kind must be decision|knowledge|correction|alias');
}

function readRequiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${key} must be a non-empty string`);
  }

  return value;
}

function readUnitScore(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${key} must be a finite number in [0, 1]`);
  }

  return value;
}

function readMetadataValue(
  metadata: Readonly<Record<string, string>>,
  key: string,
  filePath: string
): string {
  const value = metadata[key]?.trim();
  if (value === undefined || value.length === 0) {
    throw new Error(`${filePath} missing pending metadata: ${key}`);
  }

  return value;
}

function readEditedString(value: string | number, field: EditableCandidateField): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${field} edit must be a non-empty string`);
  }

  return value;
}

function readEditedScore(value: string | number, field: EditableCandidateField): number {
  const score = typeof value === 'number' ? value : Number.parseFloat(value);
  if (!Number.isFinite(score) || score < 0 || score > 1) {
    throw new Error(`${field} edit must be a number in [0, 1]`);
  }

  return score;
}

function safeErrorReason(error: unknown): string {
  const message = error instanceof Error ? error.message : 'unknown memory write error';
  return `memory_write_failed:${message}`;
}

function readNextArg(argv: readonly string[], index: number, optionName: string): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${optionName} requires a value`);
  }

  return value;
}

function readInlineArg(arg: string, optionName: string): string {
  const prefix = `${optionName}=`;
  const value = arg.slice(prefix.length);
  if (value.length === 0) {
    throw new Error(`${optionName} requires a value`);
  }

  return value;
}

function readNonEmpty(value: string, optionName: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${optionName} requires a non-empty value`);
  }

  return trimmed;
}

function readPositiveInteger(value: string, optionName: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${optionName} must be a positive integer`);
  }

  return parsed;
}

function renderDryRunSummary(
  pendingFiles: readonly PendingReviewFile[],
  config: ReviewCliConfig
): string {
  const candidateTotal = pendingFiles.reduce(
    (total, pending) => total + pending.candidates.length,
    0
  );
  const lines = [
    'automemory-review dry-run',
    `pending_dir: ${config.pendingDir}`,
    `archive_dir: ${config.archiveDir}`,
    `sqlite_path: ${config.sqlitePath}`,
    `pending_files: ${pendingFiles.length}`,
    `candidate_total: ${candidateTotal}`
  ];

  pendingFiles.forEach((pending, index) => {
    const rank = rankPendingReviewFile(pending);
    lines.push(
      `${index + 1}. ${pending.relativePath} task_id=${pending.metadata.taskId} candidates=${pending.candidates.length} confidence=${rank.confidence} novelty=${rank.novelty}`
    );
    for (const candidate of pending.candidates) {
      lines.push(
        `   - ${candidate.kind} ${candidate.key} source_ref=${candidate.source_ref} confidence=${candidate.confidence} novelty=${candidate.novelty}`
      );
    }
  });

  return lines.join('\n');
}

function renderPendingReviewPrompt(
  pending: PendingReviewFile,
  index: number,
  total: number
): string {
  const lines = [
    '',
    `[${index}/${total}] ${pending.relativePath}`,
    `task_id: ${pending.metadata.taskId}`,
    `audit_trace_id: ${pending.metadata.auditTraceId}`
  ];

  pending.candidates.forEach((candidate, candidateIndex) => {
    lines.push(
      `${candidateIndex + 1}. ${candidate.kind} :: ${candidate.key}`,
      `   source_ref=${candidate.source_ref}`,
      `   confidence=${candidate.confidence} novelty=${candidate.novelty}`,
      `   value=${candidate.value}`,
      `   rationale=${candidate.rationale}`
    );
  });

  return lines.join('\n');
}

function renderReviewResult(result: ReviewPendingFileResult): string {
  const lines = [
    `decision=${result.decision} memory_write_ok=${result.memoryWriteOk} archive_path=${result.archivePath ?? 'null'}`
  ];

  for (const check of result.conflictChecks) {
    lines.push(
      `conflict_check ${check.candidate.kind} ${check.candidate.key} namespace=${check.memoryNamespace} conflicts=${check.conflictResult.candidates.length} top_similarity=${topSimilarity(check.conflictResult.candidates) ?? 'null'} embedding_backend=${check.conflictResult.embedding_backend}`
    );
  }

  for (const resolution of result.conflictResolutions) {
    lines.push(
      `conflict_decision candidate=${resolution.candidateIndex + 1} decision=${resolution.decision} edited_fields=${(resolution.editedFields ?? []).join(',') || 'none'}`
    );
  }

  for (const candidateResult of result.candidateResults) {
    lines.push(
      `- ${candidateResult.candidate.kind} ${candidateResult.candidate.key} namespace=${candidateResult.memoryNamespace} write_ok=${candidateResult.memoryWriteOk} reason=${candidateResult.reason}`
    );
  }

  return lines.join('\n');
}

async function askDecision(readline: ReadlineInterface): Promise<ReviewDecision | 'quit'> {
  for (;;) {
    const answer = (await readline.question('[a]ccept [r]eject [e]dit [s]kip [q]uit > '))
      .trim()
      .toLowerCase();
    if (answer === 'a') return 'accept';
    if (answer === 'r') return 'reject';
    if (answer === 'e') return 'edit';
    if (answer === 's') return 'skip';
    if (answer === 'q') return 'quit';
  }
}

async function askCandidateEdit(
  readline: ReadlineInterface,
  pending: PendingReviewFile
): Promise<readonly CandidateEdit[]> {
  const rawIndex = await readline.question('candidate number to edit > ');
  const candidateIndex = readPositiveInteger(rawIndex, 'candidate number') - 1;
  if (candidateIndex >= pending.candidates.length) {
    throw new Error(`candidate number out of range: ${candidateIndex + 1}`);
  }

  const rawField = (
    await readline.question(
      'field key|value|source_ref|producer_agent|confidence|novelty|rationale > '
    )
  ).trim();
  const field = readEditableCandidateField(rawField);
  const value = await readline.question('new value > ');

  return [
    {
      candidateIndex,
      field,
      value
    }
  ];
}

async function askConflictResolutions(
  readline: ReadlineInterface,
  stdout: Writable,
  checks: readonly CandidateConflictCheck[]
): Promise<readonly CandidateConflictResolution[]> {
  const resolutions: CandidateConflictResolution[] = [];

  for (const check of checks) {
    if (check.conflictResult.candidates.length === 0) {
      continue;
    }

    writeLine(stdout, renderConflictSummary(check));
    for (;;) {
      const answer = (
        await readline.question(
          '[c]ompare [k]eep-existing re[p]lace [m]erge [a]dd-new [r]eject [s]kip > '
        )
      )
        .trim()
        .toLowerCase();

      if (answer === 'c') {
        writeLine(stdout, renderConflictCompare(check));
        continue;
      }

      const decision = readConflictResolutionDecision(answer);
      const reviewerReason =
        decision === 'add_new' ? await readline.question('reviewer reason for add_new > ') : undefined;
      const editedFields =
        decision === 'replace_existing' || decision === 'merge'
          ? readEditedFields(await readline.question('edited_fields comma list > '))
          : [];
      resolutions.push({
        candidateIndex: check.candidateIndex,
        decision,
        ...(reviewerReason !== undefined ? { reviewerReason } : {}),
        editedFields
      });
      break;
    }
  }

  return resolutions;
}

function renderConflictSummary(check: CandidateConflictCheck): string {
  return [
    '',
    `memory conflict detected for candidate ${check.candidateIndex + 1}: ${check.candidate.kind} ${check.candidate.key}`,
    `namespace=${check.memoryNamespace} conflict_count=${check.conflictResult.candidates.length} top_similarity=${topSimilarity(check.conflictResult.candidates) ?? 'null'} embedding_backend=${check.conflictResult.embedding_backend}`,
    'choose [c] compare before selecting a conflict decision'
  ].join('\n');
}

function renderConflictCompare(check: CandidateConflictCheck): string {
  const lines = [
    `candidate: ${check.candidate.kind} ${check.candidate.key}`,
    `candidate_source_ref: ${check.candidate.source_ref}`
  ];

  check.conflictResult.candidates.forEach((candidate, index) => {
    lines.push(
      `${index + 1}. existing ${candidate.namespace} ${candidate.key}`,
      `   source_ref=${candidate.source_ref}`,
      `   similarity=${candidate.similarity}`,
      `   embedding_backend=${candidate.embedding_backend}`
    );
  });

  return lines.join('\n');
}

function readConflictResolutionDecision(value: string): MemoryConflictResolutionDecision {
  if (value === 'k') return 'keep_existing';
  if (value === 'p') return 'replace_existing';
  if (value === 'm') return 'merge';
  if (value === 'a') return 'add_new';
  if (value === 'r') return 'reject';
  if (value === 's') return 'skip';
  throw new Error(`Unsupported conflict resolution decision: ${value}`);
}

function readEditedFields(value: string): readonly string[] {
  const fields = value
    .split(',')
    .map((field) => field.trim())
    .filter((field) => field.length > 0);

  if (fields.length === 0) {
    throw new Error('edited_fields must not be empty for replace_existing or merge');
  }

  return fields;
}

function readEditableCandidateField(value: string): EditableCandidateField {
  if (
    value === 'key' ||
    value === 'value' ||
    value === 'source_ref' ||
    value === 'producer_agent' ||
    value === 'confidence' ||
    value === 'novelty' ||
    value === 'rationale'
  ) {
    return value;
  }

  throw new Error(`Unsupported edit field: ${value}`);
}

function usageText(): string {
  return [
    'Usage: automemory-review [--dry-run] [--pending-dir <path>] [--archive-dir <path>] [--sqlite-path <path>] [--reviewer <name>] [--limit <n>]',
    '',
    'Reviews .memory/pending/**/*.md and writes accepted candidates into local Memory SQLite.'
  ].join('\n');
}

function writeLine(stream: Writable, line: string): void {
  stream.write(`${line}\n`);
}

const invokedPath = process.argv[1] === undefined ? null : pathToFileURL(process.argv[1]).href;
if (invokedPath === import.meta.url) {
  void runReviewCli()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error: unknown) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : 'automemory-review failed'}\n`
      );
      process.exitCode = 1;
    });
}
