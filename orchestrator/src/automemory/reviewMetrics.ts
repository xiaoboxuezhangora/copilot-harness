import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { ReviewAuditEvent } from './reviewCli.js';

export interface ReviewMetricsOptions {
  readonly auditLogPath: string;
  readonly outputPath: string;
}

export interface W8ReviewMetricsJson {
  readonly schema_version: 'phase-1b-w8-review-metrics@1';
  readonly source: string;
  readonly reviewed_count: number;
  readonly accepted_count: number;
  readonly edit_accepted_count: number;
  readonly rejected_count: number;
  readonly major_edit_count: number;
  readonly skipped_count: number;
  readonly review_time_minutes: number;
}

const REVIEW_METRICS_SCHEMA_VERSION = 'phase-1b-w8-review-metrics@1';
const REVIEW_EVENT_NAME = 'automemory.review_decision';
const DEFAULT_AUDIT_LOG_PATH = join('reports', 'audit.log');
const DEFAULT_OUTPUT_PATH = join('eval', 'w8-review-metrics.json');

export async function generateW8ReviewMetrics(
  options: ReviewMetricsOptions
): Promise<W8ReviewMetricsJson> {
  const events = await readReviewAuditEvents(options.auditLogPath);
  const acceptedCount = countDecision(events, 'accept');
  const editAcceptedCount = countDecision(events, 'edit');
  const rejectedCount = countDecision(events, 'reject');
  const skippedCount = countDecision(events, 'skip');
  const reviewedCount = acceptedCount + editAcceptedCount + rejectedCount;
  const reviewTimeMinutes = calculateReviewTimeMinutes(events);

  return {
    schema_version: REVIEW_METRICS_SCHEMA_VERSION,
    source: `${options.auditLogPath}#${REVIEW_EVENT_NAME}`,
    reviewed_count: reviewedCount,
    accepted_count: acceptedCount,
    edit_accepted_count: editAcceptedCount,
    rejected_count: rejectedCount,
    major_edit_count: 0,
    skipped_count: skippedCount,
    review_time_minutes: reviewTimeMinutes
  };
}

export async function writeW8ReviewMetrics(options: ReviewMetricsOptions): Promise<W8ReviewMetricsJson> {
  const metrics = await generateW8ReviewMetrics(options);
  await mkdir(dirname(options.outputPath), { recursive: true });
  await writeFile(options.outputPath, `${JSON.stringify(metrics, null, 2)}\n`, 'utf8');
  return metrics;
}

export async function runReviewMetricsCli(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(argv);
  const metrics = await writeW8ReviewMetrics(options);
  process.stdout.write(`${JSON.stringify(metrics, null, 2)}\n`);
}

async function readReviewAuditEvents(auditLogPath: string): Promise<readonly ReviewAuditEvent[]> {
  const raw = await readFile(auditLogPath, 'utf8');
  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as unknown)
    .filter(isReviewAuditEvent);
}

function countDecision(events: readonly ReviewAuditEvent[], decision: ReviewAuditEvent['decision']): number {
  return events.filter((event) => event.decision === decision).length;
}

function calculateReviewTimeMinutes(events: readonly ReviewAuditEvent[]): number {
  const timestamps = events
    .map((event) => Date.parse(event.reviewed_at || event.timestamp))
    .filter((value) => Number.isFinite(value));
  if (timestamps.length <= 1) {
    return 0;
  }

  const min = Math.min(...timestamps);
  const max = Math.max(...timestamps);
  return Math.round(((max - min) / 60_000) * 100) / 100;
}

function isReviewAuditEvent(value: unknown): value is ReviewAuditEvent {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record.event_name === REVIEW_EVENT_NAME &&
    typeof record.timestamp === 'string' &&
    typeof record.task_id === 'string' &&
    typeof record.audit_trace_id === 'string' &&
    typeof record.pending_path === 'string' &&
    typeof record.candidate_key === 'string' &&
    typeof record.candidate_kind === 'string' &&
    typeof record.source_ref === 'string' &&
    isReviewDecision(record.decision) &&
    typeof record.reviewer === 'string' &&
    typeof record.reviewed_at === 'string' &&
    typeof record.edited === 'boolean' &&
    Array.isArray(record.edited_fields) &&
    typeof record.memory_namespace === 'string' &&
    typeof record.memory_key === 'string' &&
    typeof record.memory_write_ok === 'boolean' &&
    typeof record.reason === 'string'
  );
}

function isReviewDecision(value: unknown): value is ReviewAuditEvent['decision'] {
  return value === 'accept' || value === 'edit' || value === 'reject' || value === 'skip';
}

function parseArgs(argv: readonly string[]): ReviewMetricsOptions {
  let auditLogPath = DEFAULT_AUDIT_LOG_PATH;
  let outputPath = DEFAULT_OUTPUT_PATH;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === '--audit-log') {
      auditLogPath = readNext(argv, index, arg);
      index += 1;
    } else if (arg.startsWith('--audit-log=')) {
      auditLogPath = arg.slice('--audit-log='.length);
    } else if (arg === '--output') {
      outputPath = readNext(argv, index, arg);
      index += 1;
    } else if (arg.startsWith('--output=')) {
      outputPath = arg.slice('--output='.length);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return { auditLogPath, outputPath };
}

function readNext(argv: readonly string[], index: number, option: string): string {
  const value = argv[index + 1];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runReviewMetricsCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Failed to generate W8 review metrics';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
