import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { metrics, type Counter } from '@opentelemetry/api';

import { findMemoryRedlineViolations, type MemoryRedlineMatch } from '../memory/index.js';
import type { AgentResult, AgentRuntime, TurnContext, TurnEndHook } from '../runtime/index.js';
import { CopilotSdkAdapter } from '../runtime/adapters/copilotSdkAdapter.js';
import type { RuntimeAdapter } from '../runtime/adapters/types.js';
import { resolveRepoRoot } from '../runtime/skillAgentLoader.js';

export type HarvesterCandidateKind = 'decision' | 'knowledge' | 'correction' | 'alias';

export interface HarvesterCandidate {
  readonly kind: HarvesterCandidateKind;
  readonly key: string;
  readonly value: string;
  readonly source_ref: string;
  readonly producer_agent: string;
  readonly confidence: number;
  readonly novelty: number;
  readonly rationale: string;
}

export interface HarvesterRedlineSkip {
  readonly reason: string;
}

export interface HarvesterExtractionOutput {
  readonly turn_state: 'done';
  readonly candidates: readonly HarvesterCandidate[];
  readonly skipped_by_redline: readonly HarvesterRedlineSkip[];
  readonly thinking: string;
}

export interface HarvesterExtractionInput {
  readonly task_id: string;
  readonly audit_trace_id: string;
  readonly turn_state: AgentResult['turnState'];
  readonly runtime: AgentResult['runtime']['name'];
  readonly model: AgentResult['model'];
  readonly prompt_version: string;
  readonly intent: string;
  readonly output: string;
  readonly source_refs: readonly string[];
}

export interface HarvesterExtractor {
  extract(input: HarvesterExtractionInput): Promise<HarvesterExtractionOutput>;
}

export interface HarvesterMetricsSink {
  add(name: string, value: number, attributes: Readonly<Record<string, string | number | boolean>>): void;
}

export interface HarvesterAuditEvent {
  readonly timestamp: string;
  readonly event_name: string;
  readonly task_id: string;
  readonly audit_trace_id: string;
  readonly runtime: string;
  readonly model: string;
  readonly turn_state: string;
  readonly prompt_version: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export interface AutoMemoryHarvesterOptions {
  readonly extractor?: HarvesterExtractor;
  readonly metricsSink?: HarvesterMetricsSink;
  readonly now?: () => Date;
  readonly repoRoot?: string;
  readonly pendingDir?: string;
  readonly auditLogPath?: string;
  readonly promptVersion?: string;
  readonly confidenceThreshold?: number;
  readonly noveltyThreshold?: number;
  readonly maxPendingPerTurn?: number;
}

interface LocalRedlineBlock {
  readonly candidate: HarvesterCandidate;
  readonly violations: readonly MemoryRedlineMatch[];
}

interface GateEvaluation {
  readonly accepted: readonly HarvesterCandidate[];
  readonly gateBlockedCount: number;
  readonly gateBlockedReasons: readonly GateBlockedReason[];
  readonly redlineBlockedCount: number;
  readonly localRedlineBlocks: readonly LocalRedlineBlock[];
}

interface GateBlockedReason {
  readonly reason: 'source_ref_mismatch' | 'threshold' | 'per_turn_cap';
  readonly key: string;
  readonly source_ref: string;
  readonly confidence: number;
  readonly novelty: number;
}

const DEFAULT_PROMPT_VERSION = 'harvester.v1';
const DEFAULT_CONFIDENCE_THRESHOLD = 0.7;
const DEFAULT_NOVELTY_THRESHOLD = 0.5;
const DEFAULT_MAX_PENDING_PER_TURN = 3;
const HARVESTER_OUTPUT_MAX_CANDIDATES = 3;
const HARVESTER_PROMPT_RELATIVE_PATH = 'prompts/harvester.v1.md';
const HARVESTER_PENDING_RELATIVE_DIR = '.memory/pending';
const HARVESTER_AUDIT_LOG_RELATIVE_PATH = 'reports/audit.log';

const HARVESTER_METER = metrics.getMeter('copilot-harness.automemory', '0.1.0');

export class OTelHarvesterMetricsSink implements HarvesterMetricsSink {
  private readonly counters = new Map<string, Counter>();

  add(
    name: string,
    value: number,
    attributes: Readonly<Record<string, string | number | boolean>>
  ): void {
    if (value <= 0) {
      return;
    }

    this.readCounter(name).add(value, attributes);
  }

  private readCounter(name: string): Counter {
    const cached = this.counters.get(name);
    if (cached !== undefined) {
      return cached;
    }

    const counter = HARVESTER_METER.createCounter(name, {
      description: `Auto-memory harvester metric: ${name}`
    });
    this.counters.set(name, counter);
    return counter;
  }
}

export class Gpt5MiniHarvesterExtractor implements HarvesterExtractor {
  private readonly adapter: RuntimeAdapter;
  private readonly now: () => Date;
  private readonly promptPath: string;

  constructor(
    options: {
      readonly adapter?: RuntimeAdapter;
      readonly now?: () => Date;
      readonly repoRoot?: string;
      readonly promptPath?: string;
    } = {}
  ) {
    const repoRoot = options.repoRoot ?? resolveRepoRoot();

    this.adapter =
      options.adapter ??
      new CopilotSdkAdapter({
        allowExternalExecution: true,
        repoRoot,
        cwd: repoRoot,
        enableConfigDiscovery: true
      });
    this.now = options.now ?? (() => new Date());
    this.promptPath = options.promptPath ?? join(repoRoot, HARVESTER_PROMPT_RELATIVE_PATH);
  }

  async extract(input: HarvesterExtractionInput): Promise<HarvesterExtractionOutput> {
    const systemPrompt = await readFile(this.promptPath, 'utf8');
    const requestPrompt = buildHarvesterRequestPrompt(systemPrompt, input);

    const response = await this.adapter.execute({
      taskId: `${input.task_id}-harvest-${toFileTimestamp(this.now())}`,
      prompt: requestPrompt,
      taskDescription: 'W7 auto-memory structured extraction',
      model: 'gpt-5-mini',
      reasoningEffort: 'low',
      timeoutMs: 45_000
    });

    return parseHarvesterExtractionOutput(response.output);
  }
}

export class AutoMemoryHarvester {
  private readonly extractor: HarvesterExtractor;
  private readonly metricsSink: HarvesterMetricsSink;
  private readonly now: () => Date;
  private readonly pendingDir: string;
  private readonly auditLogPath: string;
  private readonly promptVersion: string;
  private readonly confidenceThreshold: number;
  private readonly noveltyThreshold: number;
  private readonly maxPendingPerTurn: number;

  constructor(options: AutoMemoryHarvesterOptions = {}) {
    const repoRoot = options.repoRoot ?? resolveRepoRoot();

    this.extractor = options.extractor ?? new Gpt5MiniHarvesterExtractor({ repoRoot });
    this.metricsSink = options.metricsSink ?? new OTelHarvesterMetricsSink();
    this.now = options.now ?? (() => new Date());
    this.pendingDir = options.pendingDir ?? join(repoRoot, HARVESTER_PENDING_RELATIVE_DIR);
    this.auditLogPath = options.auditLogPath ?? join(repoRoot, HARVESTER_AUDIT_LOG_RELATIVE_PATH);
    this.promptVersion = options.promptVersion ?? DEFAULT_PROMPT_VERSION;
    this.confidenceThreshold = options.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
    this.noveltyThreshold = options.noveltyThreshold ?? DEFAULT_NOVELTY_THRESHOLD;
    this.maxPendingPerTurn = options.maxPendingPerTurn ?? DEFAULT_MAX_PENDING_PER_TURN;
  }

  readonly onTurnEnd: TurnEndHook = async (result, context) => {
    if (result.turnState !== 'done') {
      return;
    }

    const input = buildExtractionInput(result, context);
    if (input.source_refs.length === 0) {
      const metricAttributes = {
        runtime: result.runtime.name,
        model: result.model,
        turn_state: result.turnState,
        prompt_version: this.promptVersion
      } as const;

      this.metricsSink.add('automemory.harvester.candidates_total', 0, metricAttributes);
      this.metricsSink.add('automemory.harvester.gate_blocked_total', 0, metricAttributes);
      this.metricsSink.add('automemory.harvester.redline_blocked_total', 0, metricAttributes);
      this.metricsSink.add('automemory.harvester.pending_written_total', 0, metricAttributes);
      this.metricsSink.add('automemory.harvester.missing_source_ref_total', 1, metricAttributes);

      await this.appendAuditEvent({
        timestamp: this.now().toISOString(),
        event_name: 'automemory.missing_source_ref',
        task_id: result.taskId,
        audit_trace_id: result.auditTraceId,
        runtime: result.runtime.name,
        model: result.model,
        turn_state: result.turnState,
        prompt_version: this.promptVersion,
        details: {
          reason: 'need_more_context:evidence_source_ref_missing',
          evidence_count: result.evidencePack.evidences.length
        }
      });

      await this.appendAuditEvent({
        timestamp: this.now().toISOString(),
        event_name: 'automemory.harvest_summary',
        task_id: result.taskId,
        audit_trace_id: result.auditTraceId,
        runtime: result.runtime.name,
        model: result.model,
        turn_state: result.turnState,
        prompt_version: this.promptVersion,
        details: {
          candidate_total: 0,
          gate_blocked_count: 0,
          redline_blocked_count: 0,
          missing_source_ref_count: 1,
          pending_written_count: 0,
          reason: 'missing_source_ref'
        }
      });
      return;
    }

    let extracted: HarvesterExtractionOutput;
    try {
      extracted = await this.extractor.extract(input);
    } catch (error: unknown) {
      await this.appendAuditEvent({
        timestamp: this.now().toISOString(),
        event_name: 'automemory.harvest_error',
        task_id: result.taskId,
        audit_trace_id: result.auditTraceId,
        runtime: result.runtime.name,
        model: result.model,
        turn_state: result.turnState,
        prompt_version: this.promptVersion,
        details: {
          message: error instanceof Error ? error.message : 'unknown harvester extractor error'
        }
      });
      return;
    }

    const gate = this.evaluateGate(extracted, input.source_refs);
    const pendingPath =
      gate.accepted.length > 0
        ? await this.writePendingFile({
            result,
            extracted,
            acceptedCandidates: gate.accepted,
            gateBlockedCount: gate.gateBlockedCount,
            redlineBlockedCount: gate.redlineBlockedCount
          })
        : undefined;

    for (const skipped of extracted.skipped_by_redline) {
      await this.appendAuditEvent({
        timestamp: this.now().toISOString(),
        event_name: 'automemory.redline_blocked',
        task_id: result.taskId,
        audit_trace_id: result.auditTraceId,
        runtime: result.runtime.name,
        model: result.model,
        turn_state: result.turnState,
        prompt_version: this.promptVersion,
        details: {
          reason: skipped.reason,
          source: 'model_skipped_by_redline'
        }
      });
    }

    for (const block of gate.localRedlineBlocks) {
      await this.appendAuditEvent({
        timestamp: this.now().toISOString(),
        event_name: 'automemory.redline_blocked',
        task_id: result.taskId,
        audit_trace_id: result.auditTraceId,
        runtime: result.runtime.name,
        model: result.model,
        turn_state: result.turnState,
        prompt_version: this.promptVersion,
        details: {
          key: block.candidate.key,
          kind: block.candidate.kind,
          source_ref: block.candidate.source_ref,
          rule_ids: [...new Set(block.violations.map((item) => item.id))],
          source: 'local_redline_scan'
        }
      });
    }

    if (gate.gateBlockedReasons.length > 0) {
      await this.appendAuditEvent({
        timestamp: this.now().toISOString(),
        event_name: 'automemory.gate_blocked',
        task_id: result.taskId,
        audit_trace_id: result.auditTraceId,
        runtime: result.runtime.name,
        model: result.model,
        turn_state: result.turnState,
        prompt_version: this.promptVersion,
        details: {
          blocked_count: gate.gateBlockedReasons.length,
          reasons: gate.gateBlockedReasons
        }
      });
    }

    const metricAttributes = {
      runtime: result.runtime.name,
      model: result.model,
      turn_state: result.turnState,
      prompt_version: this.promptVersion
    } as const;

    this.metricsSink.add(
      'automemory.harvester.candidates_total',
      extracted.candidates.length,
      metricAttributes
    );
    this.metricsSink.add(
      'automemory.harvester.gate_blocked_total',
      gate.gateBlockedCount,
      metricAttributes
    );
    this.metricsSink.add(
      'automemory.harvester.redline_blocked_total',
      gate.redlineBlockedCount,
      metricAttributes
    );
    this.metricsSink.add(
      'automemory.harvester.pending_written_total',
      gate.accepted.length,
      metricAttributes
    );

    await this.appendAuditEvent({
      timestamp: this.now().toISOString(),
      event_name: 'automemory.harvest_summary',
      task_id: result.taskId,
      audit_trace_id: result.auditTraceId,
      runtime: result.runtime.name,
      model: result.model,
      turn_state: result.turnState,
      prompt_version: this.promptVersion,
      details: {
        candidate_total: extracted.candidates.length,
        gate_blocked_count: gate.gateBlockedCount,
        redline_blocked_count: gate.redlineBlockedCount,
        missing_source_ref_count: 0,
        pending_written_count: gate.accepted.length,
        pending_file: pendingPath
      }
    });
  };

  private evaluateGate(
    extracted: HarvesterExtractionOutput,
    allowedSourceRefs: readonly string[]
  ): GateEvaluation {
    const acceptedBeforeCap: HarvesterCandidate[] = [];
    let gateBlockedCount = 0;
    const gateBlockedReasons: GateBlockedReason[] = [];
    const localRedlineBlocks: LocalRedlineBlock[] = [];
    const allowedSourceRefSet = new Set(allowedSourceRefs.filter((value) => value.trim().length > 0));

    for (const candidate of extracted.candidates) {
      if (!allowedSourceRefSet.has(candidate.source_ref)) {
        gateBlockedCount += 1;
        gateBlockedReasons.push({
          reason: 'source_ref_mismatch',
          key: candidate.key,
          source_ref: candidate.source_ref,
          confidence: candidate.confidence,
          novelty: candidate.novelty
        });
        continue;
      }

      const localViolations = findMemoryRedlineViolations(
        `${candidate.key}\n${candidate.value}\n${candidate.rationale}\n${candidate.source_ref}`
      );
      if (localViolations.length > 0) {
        localRedlineBlocks.push({
          candidate,
          violations: localViolations
        });
        continue;
      }

      const passThreshold =
        candidate.confidence >= this.confidenceThreshold && candidate.novelty >= this.noveltyThreshold;
      if (!passThreshold) {
        gateBlockedCount += 1;
        gateBlockedReasons.push({
          reason: 'threshold',
          key: candidate.key,
          source_ref: candidate.source_ref,
          confidence: candidate.confidence,
          novelty: candidate.novelty
        });
        continue;
      }

      acceptedBeforeCap.push(candidate);
    }

    const accepted = acceptedBeforeCap.slice(0, this.maxPendingPerTurn);
    const capped = acceptedBeforeCap.slice(this.maxPendingPerTurn);
    gateBlockedCount += capped.length;
    gateBlockedReasons.push(
      ...capped.map((candidate) => ({
        reason: 'per_turn_cap' as const,
        key: candidate.key,
        source_ref: candidate.source_ref,
        confidence: candidate.confidence,
        novelty: candidate.novelty
      }))
    );

    return {
      accepted,
      gateBlockedCount,
      gateBlockedReasons,
      redlineBlockedCount: localRedlineBlocks.length + extracted.skipped_by_redline.length,
      localRedlineBlocks
    };
  }

  private async writePendingFile(input: {
    readonly result: AgentResult;
    readonly extracted: HarvesterExtractionOutput;
    readonly acceptedCandidates: readonly HarvesterCandidate[];
    readonly gateBlockedCount: number;
    readonly redlineBlockedCount: number;
  }): Promise<string> {
    const timestamp = this.now();
    const filePath = join(
      this.pendingDir,
      `${sanitizeFileToken(input.result.taskId)}-${toFileTimestamp(timestamp)}.md`
    );

    const markdown = renderPendingMarkdown({
      timestamp,
      promptVersion: this.promptVersion,
      result: input.result,
      extracted: input.extracted,
      acceptedCandidates: input.acceptedCandidates,
      gateBlockedCount: input.gateBlockedCount,
      redlineBlockedCount: input.redlineBlockedCount
    });

    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, markdown, 'utf8');
    return filePath;
  }

  private async appendAuditEvent(event: HarvesterAuditEvent): Promise<void> {
    await mkdir(dirname(this.auditLogPath), {
      recursive: true
    });
    await appendFile(this.auditLogPath, `${JSON.stringify(event)}\n`, 'utf8');
  }
}

export function installAutoMemoryHarvester(
  runtime: Pick<AgentRuntime, 'onTurnEnd'>,
  options: AutoMemoryHarvesterOptions = {}
): AutoMemoryHarvester {
  const harvester = new AutoMemoryHarvester(options);
  runtime.onTurnEnd(harvester.onTurnEnd);
  return harvester;
}

function buildExtractionInput(result: AgentResult, _context: TurnContext): HarvesterExtractionInput {
  const sourceRefs = [...new Set(result.evidencePack.evidences.map((item) => item.source_ref))];

  return {
    task_id: result.taskId,
    audit_trace_id: result.auditTraceId,
    turn_state: result.turnState,
    runtime: result.runtime.name,
    model: result.model,
    prompt_version: result.promptVersion,
    intent: result.evidencePack.intent,
    output: result.output,
    source_refs: sourceRefs
  };
}

function buildHarvesterRequestPrompt(systemPrompt: string, input: HarvesterExtractionInput): string {
  return [
    systemPrompt.trim(),
    '',
    'HARVEST_INPUT_JSON:',
    JSON.stringify(input, null, 2),
    '',
    '仅输出一个严格 JSON 对象，不要使用 Markdown 代码块。'
  ].join('\n');
}

export function parseHarvesterExtractionOutput(raw: string): HarvesterExtractionOutput {
  const payload = readObject(parseJsonObject(raw), 'harvester extraction output');

  if (payload.turn_state !== 'done') {
    throw new Error('harvester output.turn_state must be "done"');
  }

  if (!Array.isArray(payload.candidates)) {
    throw new Error('harvester output.candidates must be an array');
  }

  if (!Array.isArray(payload.skipped_by_redline)) {
    throw new Error('harvester output.skipped_by_redline must be an array');
  }

  const candidates = payload.candidates.map((candidate, index) =>
    readCandidate(candidate, `harvester candidates[${index}]`)
  );
  if (candidates.length > HARVESTER_OUTPUT_MAX_CANDIDATES) {
    throw new Error(
      `harvester output.candidates must be <= ${HARVESTER_OUTPUT_MAX_CANDIDATES}, got ${candidates.length}`
    );
  }
  const skippedByRedline = payload.skipped_by_redline.map((item, index) =>
    readRedlineSkip(item, `harvester skipped_by_redline[${index}]`)
  );

  return {
    turn_state: 'done',
    candidates,
    skipped_by_redline: skippedByRedline,
    thinking: readString(payload, 'thinking', true)
  };
}

function renderPendingMarkdown(input: {
  readonly timestamp: Date;
  readonly promptVersion: string;
  readonly result: AgentResult;
  readonly extracted: HarvesterExtractionOutput;
  readonly acceptedCandidates: readonly HarvesterCandidate[];
  readonly gateBlockedCount: number;
  readonly redlineBlockedCount: number;
}): string {
  const lines: string[] = [
    '# Auto-Memory Pending Candidates',
    '',
    `- generated_at: ${input.timestamp.toISOString()}`,
    `- task_id: ${input.result.taskId}`,
    `- audit_trace_id: ${input.result.auditTraceId}`,
    `- turn_state: ${input.result.turnState}`,
    `- runtime: ${input.result.runtime.name}`,
    `- model: ${input.result.model}`,
    `- harvester_prompt_version: ${input.promptVersion}`,
    `- candidate_total: ${input.extracted.candidates.length}`,
    `- gate_blocked_count: ${input.gateBlockedCount}`,
    `- redline_blocked_count: ${input.redlineBlockedCount}`,
    `- pending_written_count: ${input.acceptedCandidates.length}`,
    '',
    '## Accepted Candidates'
  ];

  for (const [index, candidate] of input.acceptedCandidates.entries()) {
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

  lines.push('', '## Harvester Raw Output', '', '```json');
  lines.push(`${JSON.stringify(input.extracted, null, 2)}`);
  lines.push('```', '');

  return lines.join('\n');
}

function readCandidate(value: unknown, label: string): HarvesterCandidate {
  const record = readObject(value, label);
  const kind = readKind(record, 'kind');
  const rationale = truncateToCodePoints(readString(record, 'rationale'), 100);

  return {
    kind,
    key: readString(record, 'key'),
    value: readString(record, 'value'),
    source_ref: readString(record, 'source_ref'),
    producer_agent: readString(record, 'producer_agent'),
    confidence: readUnitScore(record, 'confidence'),
    novelty: readUnitScore(record, 'novelty'),
    rationale
  };
}

function readRedlineSkip(value: unknown, label: string): HarvesterRedlineSkip {
  const record = readObject(value, label);

  return {
    reason: readString(record, 'reason')
  };
}

function parseJsonObject(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error('harvester extractor returned empty content');
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;

  try {
    return JSON.parse(candidate) as unknown;
  } catch {
    const firstBrace = candidate.indexOf('{');
    const lastBrace = candidate.lastIndexOf('}');
    if (firstBrace < 0 || lastBrace <= firstBrace) {
      throw new Error('harvester extractor did not return parseable JSON object');
    }

    const narrowed = candidate.slice(firstBrace, lastBrace + 1);
    return JSON.parse(narrowed) as unknown;
  }
}

function readObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }

  return value as Record<string, unknown>;
}

function readString(
  record: Record<string, unknown>,
  key: string,
  allowEmpty = false
): string {
  const value = record[key];
  if (typeof value !== 'string') {
    throw new Error(`${key} must be a string`);
  }

  if (!allowEmpty && value.trim().length === 0) {
    throw new Error(`${key} must be a non-empty string`);
  }

  return value;
}

function readUnitScore(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${key} must be a finite number in [0, 1]`);
  }

  return Math.round(value * 1_000) / 1_000;
}

function readKind(record: Record<string, unknown>, key: string): HarvesterCandidateKind {
  const value = record[key];
  if (value === 'decision' || value === 'knowledge' || value === 'correction' || value === 'alias') {
    return value;
  }

  throw new Error(`${key} must be one of decision|knowledge|correction|alias`);
}

function truncateToCodePoints(text: string, maxLength: number): string {
  const chars = Array.from(text);
  if (chars.length <= maxLength) {
    return text;
  }

  return chars.slice(0, maxLength).join('');
}

function sanitizeFileToken(value: string): string {
  const collapsed = value.replace(/[^a-zA-Z0-9._-]/g, '_');
  return collapsed.length > 0 ? collapsed : 'task';
}

function toFileTimestamp(now: Date): string {
  const iso = now.toISOString();
  const compact = iso.replace(/[-:]/g, '');
  return compact.replace(/\.\d{3}Z$/, 'Z');
}
