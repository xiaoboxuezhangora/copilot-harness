import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { AgentResult, TurnContext } from '../runtime/index.js';
import { resolveRepoRoot } from '../runtime/skillAgentLoader.js';
import {
  AutoMemoryHarvester,
  Gpt5MiniHarvesterExtractor,
  type HarvesterCandidate,
  type HarvesterExtractionInput,
  type HarvesterExtractionOutput,
  type HarvesterExtractor,
  type HarvesterMetricsSink
} from './harvester.js';

interface EvalDataset {
  readonly promptVersion: string;
  readonly samples: readonly EvalSample[];
}

interface EvalSample {
  readonly id: string;
  readonly domain: string;
  readonly source_ref: string;
  readonly issue: {
    readonly key: string;
    readonly summary: string;
    readonly description: string;
    readonly status: string;
    readonly priority: string;
    readonly assignee: string;
    readonly labels: readonly string[];
    readonly project: string;
  };
}

interface EvalArmStats {
  readonly arm: string;
  readonly sampleCount: number;
  readonly summaryCount: number;
  readonly harvestErrorCount: number;
  readonly candidateTotal: number;
  readonly pendingWrittenTotal: number;
  readonly gateBlockedTotal: number;
  readonly redlineBlockedTotal: number;
  readonly missingSourceRefTotal: number;
  readonly pendingFiles: number;
  readonly pendingDir: string;
  readonly auditLogPath: string;
}

interface EvalThresholds {
  readonly expectedSampleCount: number;
  readonly expectedHarvestErrorCount: number;
  readonly expectedPendingWrittenMin: number;
  readonly expectedPendingWrittenMax: number;
  readonly enforced: boolean;
  readonly passed: boolean;
  readonly failures: readonly string[];
}

interface EvalReport {
  readonly generatedAt: string;
  readonly mode: 'mock' | 'live';
  readonly evidencePolicy: 'regression_only' | 'acceptance_candidate';
  readonly acceptanceNote: string;
  readonly datasetPath: string;
  readonly sampleCount: number;
  readonly baseline: EvalArmStats;
  readonly candidate: EvalArmStats;
  readonly delta: {
    readonly pendingWritten: number;
    readonly gateBlocked: number;
    readonly redlineBlocked: number;
    readonly missingSourceRef: number;
  };
  readonly thresholds: EvalThresholds;
  readonly reportFiles: {
    readonly json: readonly string[];
    readonly markdown: readonly string[];
  };
}

interface EvalCliOptions {
  readonly mode: 'mock' | 'live';
  readonly enforceThresholds: boolean;
}

class CaptureMetricsSink implements HarvesterMetricsSink {
  private readonly totals = new Map<string, number>();

  add(
    name: string,
    value: number,
    _attributes: Readonly<Record<string, string | number | boolean>>
  ): void {
    this.totals.set(name, (this.totals.get(name) ?? 0) + value);
  }

  read(name: string): number {
    return this.totals.get(name) ?? 0;
  }
}

class BaselineExtractor implements HarvesterExtractor {
  extract(_input: HarvesterExtractionInput): Promise<HarvesterExtractionOutput> {
    return Promise.resolve({
      turn_state: 'done',
      candidates: [],
      skipped_by_redline: [],
      thinking: 'baseline-noop'
    });
  }
}

class MockPromptV1Extractor implements HarvesterExtractor {
  extract(input: HarvesterExtractionInput): Promise<HarvesterExtractionOutput> {
    if (input.source_refs.length === 0) {
      return Promise.resolve({
        turn_state: 'done',
        candidates: [],
        skipped_by_redline: [],
        thinking: 'need_more_context'
      });
    }

    const text = input.output.toLowerCase();
    const sourceRef = input.source_refs[0]!;

    const highSignal =
      containsAny(text, [
        'cleanup',
        'copy',
        '排序',
        '导出',
        '状态机',
        '重试',
        '离线',
        '图标',
        'sync',
        'state'
      ]) && !containsAny(text, ['待确认', '未明确', 'clarification']);

    const candidate: HarvesterCandidate = {
      kind: 'knowledge',
      key: `${sanitizeKey(input.task_id)}.summary`,
      value: truncate(input.output.replace(/\s+/g, ' ').trim(), 160),
      source_ref: sourceRef,
      producer_agent: 'investigator',
      confidence: highSignal ? 0.83 : 0.68,
      novelty: highSignal ? 0.57 : 0.46,
      rationale: highSignal ? '跨任务可复用实现约束' : '信息不稳定，先降权'
    };

    const aliasCandidate: HarvesterCandidate = {
      kind: 'alias',
      key: `${sanitizeKey(input.task_id)}.alias`,
      value: `issue:${input.task_id} -> ${sanitizeKey(input.task_id)}`,
      source_ref: sourceRef,
      producer_agent: 'investigator',
      confidence: 0.62,
      novelty: 0.51,
      rationale: '默认降权，避免别名泛滥'
    };

    return Promise.resolve({
      turn_state: 'done',
      candidates: [candidate, aliasCandidate],
      skipped_by_redline: [],
      thinking: 'mock-harvester'
    });
  }
}

const repoRoot = resolveRepoRoot();
const datasetPath = join(repoRoot, 'orchestrator', 'eval', 'jira-eval-20.json');
const options = parseCliOptions(process.argv);

const dataset = await loadDataset(datasetPath);

const baseline = await runArm({
  arm: 'A-baseline',
  extractor: new BaselineExtractor(),
  dataset
});

const candidate = await runArm({
  arm: 'B-harvester',
  extractor:
    options.mode === 'live'
      ? new Gpt5MiniHarvesterExtractor({ repoRoot })
      : new MockPromptV1Extractor(),
  dataset
});

const thresholds = evaluateThresholds(options, dataset.samples.length, candidate);

const reportBase: Omit<EvalReport, 'reportFiles'> = {
  generatedAt: new Date().toISOString(),
  mode: options.mode,
  evidencePolicy: options.mode === 'mock' ? 'regression_only' : 'acceptance_candidate',
  acceptanceNote:
    options.mode === 'mock'
      ? 'mock 模式仅用于离线回归，不可作为最终验收证据。'
      : 'live 模式结果可作为验收候选证据，需结合 MR 评审结论。',
  datasetPath,
  sampleCount: dataset.samples.length,
  baseline,
  candidate,
  delta: {
    pendingWritten: candidate.pendingWrittenTotal - baseline.pendingWrittenTotal,
    gateBlocked: candidate.gateBlockedTotal - baseline.gateBlockedTotal,
    redlineBlocked: candidate.redlineBlockedTotal - baseline.redlineBlockedTotal,
    missingSourceRef: candidate.missingSourceRefTotal - baseline.missingSourceRefTotal
  },
  thresholds
};

const reportFilePaths = await writeEvalReports(reportBase, options.mode);
const report: EvalReport = {
  ...reportBase,
  reportFiles: reportFilePaths
};

if (thresholds.enforced && !thresholds.passed) {
  process.stderr.write(`Harvester eval threshold check failed: ${thresholds.failures.join('; ')}\n`);
  process.exitCode = 1;
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${renderMarkdown(report)}\n`);

async function runArm(input: {
  readonly arm: string;
  readonly extractor: HarvesterExtractor;
  readonly dataset: EvalDataset;
}): Promise<EvalArmStats> {
  const pendingDir = join(repoRoot, '.memory', 'pending', sanitizeKey(input.arm));
  const auditLogPath = join(repoRoot, 'reports', `automemory-${sanitizeKey(input.arm)}.audit.log`);

  await rm(pendingDir, {
    recursive: true,
    force: true
  });
  await rm(auditLogPath, {
    force: true
  });

  const metrics = new CaptureMetricsSink();
  let tick = 0;

  const harvester = new AutoMemoryHarvester({
    extractor: input.extractor,
    metricsSink: metrics,
    repoRoot,
    pendingDir,
    auditLogPath,
    now: () => {
      tick += 1;
      return new Date(`2026-05-08T00:00:${String(tick).padStart(2, '0')}.000Z`);
    }
  });

  for (const sample of input.dataset.samples) {
    await harvester.onTurnEnd(buildResult(sample), buildContext(sample));
  }

  const events = await readAuditEvents(auditLogPath);
  const summaryEvents = events.filter((event) => event.event_name === 'automemory.harvest_summary');
  const harvestErrors = events.filter((event) => event.event_name === 'automemory.harvest_error');

  return {
    arm: input.arm,
    sampleCount: input.dataset.samples.length,
    summaryCount: summaryEvents.length,
    harvestErrorCount: harvestErrors.length,
    candidateTotal: metrics.read('automemory.harvester.candidates_total'),
    pendingWrittenTotal: metrics.read('automemory.harvester.pending_written_total'),
    gateBlockedTotal: metrics.read('automemory.harvester.gate_blocked_total'),
    redlineBlockedTotal: metrics.read('automemory.harvester.redline_blocked_total'),
    missingSourceRefTotal: metrics.read('automemory.harvester.missing_source_ref_total'),
    pendingFiles: await countPendingFiles(pendingDir),
    pendingDir,
    auditLogPath
  };
}

function evaluateThresholds(
  options: EvalCliOptions,
  sampleCount: number,
  candidate: EvalArmStats
): EvalThresholds {
  const expectedSampleCount = 20;
  const expectedHarvestErrorCount = 0;
  const expectedPendingWrittenMin = 5;
  const expectedPendingWrittenMax = 15;
  const failures: string[] = [];

  if (sampleCount !== expectedSampleCount) {
    failures.push(`sampleCount expected ${expectedSampleCount}, got ${sampleCount}`);
  }

  if (candidate.harvestErrorCount !== expectedHarvestErrorCount) {
    failures.push(
      `harvestErrorCount expected ${expectedHarvestErrorCount}, got ${candidate.harvestErrorCount}`
    );
  }

  if (
    candidate.pendingWrittenTotal < expectedPendingWrittenMin ||
    candidate.pendingWrittenTotal > expectedPendingWrittenMax
  ) {
    failures.push(
      `pendingWrittenTotal expected in [${expectedPendingWrittenMin}, ${expectedPendingWrittenMax}], got ${candidate.pendingWrittenTotal}`
    );
  }

  const enforced = options.enforceThresholds;
  return {
    expectedSampleCount,
    expectedHarvestErrorCount,
    expectedPendingWrittenMin,
    expectedPendingWrittenMax,
    enforced,
    passed: failures.length === 0,
    failures
  };
}

async function writeEvalReports(
  report: Omit<EvalReport, 'reportFiles'>,
  mode: 'mock' | 'live'
): Promise<EvalReport['reportFiles']> {
  const evalDir = join(repoRoot, 'orchestrator', 'eval');
  const storageDir = join(evalDir, 'harvester');
  await mkdir(evalDir, { recursive: true });
  await mkdir(storageDir, { recursive: true });

  const stamp = toFileTimestamp(new Date(report.generatedAt));
  const legacyJsonPath = join(evalDir, 'harvester-report.json');
  const legacyMdPath = join(evalDir, 'harvester-report.md');
  const modeLatestJsonPath = join(storageDir, `harvester-report-${mode}-latest.json`);
  const modeLatestMdPath = join(storageDir, `harvester-report-${mode}-latest.md`);
  const modeStampedJsonPath = join(storageDir, `harvester-report-${mode}-${stamp}.json`);
  const modeStampedMdPath = join(storageDir, `harvester-report-${mode}-${stamp}.md`);

  const reportWithPlaceholders: EvalReport = {
    ...report,
    reportFiles: {
      json: [legacyJsonPath, modeLatestJsonPath, modeStampedJsonPath],
      markdown: [legacyMdPath, modeLatestMdPath, modeStampedMdPath]
    }
  };
  const markdown = renderMarkdown(reportWithPlaceholders);

  await Promise.all([
    writeFile(legacyJsonPath, `${JSON.stringify(reportWithPlaceholders, null, 2)}\n`, 'utf8'),
    writeFile(legacyMdPath, markdown, 'utf8'),
    writeFile(modeLatestJsonPath, `${JSON.stringify(reportWithPlaceholders, null, 2)}\n`, 'utf8'),
    writeFile(modeLatestMdPath, markdown, 'utf8'),
    writeFile(modeStampedJsonPath, `${JSON.stringify(reportWithPlaceholders, null, 2)}\n`, 'utf8'),
    writeFile(modeStampedMdPath, markdown, 'utf8')
  ]);

  return reportWithPlaceholders.reportFiles;
}

async function loadDataset(path: string): Promise<EvalDataset> {
  const raw = await readFile(path, 'utf8');
  const parsed: unknown = JSON.parse(raw);

  if (!isDataset(parsed)) {
    throw new Error('Invalid jira-eval-20 dataset format');
  }

  return parsed;
}

function buildResult(sample: EvalSample): AgentResult {
  return {
    taskId: sample.id,
    turnState: 'done',
    output: `${sample.issue.summary}\n${sample.issue.description}`,
    evidencePack: {
      taskId: sample.id,
      intent: `${sample.domain} issue harvesting`,
      evidences: [
        {
          source_ref: sample.source_ref,
          content: `${sample.issue.summary}\n${sample.issue.description}`,
          tool: 'jira-eval-fixture'
        }
      ],
      assumptions: [],
      confidence: 0.8
    },
    auditTraceId: `trace-${sample.id}`,
    model: 'gpt-5-mini',
    runtime: {
      name: 'copilot_sdk',
      version: 'eval'
    },
    reasoningEffort: 'medium',
    promptVersion: 'jira-analysis-prompt@0.1',
    capabilities: {
      canSpawn: false,
      canUseTools: true,
      canResume: true,
      canReadMemory: false,
      canWriteMemory: false,
      canUseMcp: true,
      supportsSessions: true,
      supportsHooks: true,
      supportsReasoningEffort: true,
      supportsHeadless: true,
      externalExecution: false,
      capabilitySupported: true,
      unsupportedReasons: []
    },
    toolCalls: []
  };
}

function buildContext(sample: EvalSample): TurnContext {
  return {
    taskId: sample.id,
    model: 'gpt-5-mini',
    runtime: {
      name: 'copilot_sdk',
      version: 'eval'
    },
    runOptions: {
      reasoningEffort: 'medium'
    },
    turnState: 'done',
    auditTraceId: `trace-${sample.id}`,
    toolCalls: []
  };
}

async function countPendingFiles(path: string): Promise<number> {
  try {
    const entries = await readdir(path, {
      withFileTypes: true
    });
    return entries.filter((entry) => entry.isFile() && entry.name.endsWith('.md')).length;
  } catch {
    return 0;
  }
}

async function readAuditEvents(path: string): Promise<ReadonlyArray<Record<string, unknown>>> {
  try {
    const raw = await readFile(path, 'utf8');
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  } catch {
    return [];
  }
}

function renderMarkdown(report: EvalReport): string {
  const lines = [
    '# Harvester Eval (20 Samples)',
    '',
    `- Mode: ${report.mode}`,
    `- Evidence policy: ${report.evidencePolicy}`,
    `- Acceptance note: ${report.acceptanceNote}`,
    `- Dataset: ${report.datasetPath}`,
    `- Samples: ${report.sampleCount}`,
    `- Threshold enforced: ${report.thresholds.enforced}`,
    `- Threshold passed: ${report.thresholds.passed}`,
    `- Threshold failures: ${report.thresholds.failures.length === 0 ? 'none' : report.thresholds.failures.join('; ')}`,
    '',
    '## A/B',
    `- A pending_written_total: ${report.baseline.pendingWrittenTotal}`,
    `- B pending_written_total: ${report.candidate.pendingWrittenTotal}`,
    `- Delta pending_written: ${report.delta.pendingWritten}`,
    `- B gate_blocked_total: ${report.candidate.gateBlockedTotal}`,
    `- B redline_blocked_total: ${report.candidate.redlineBlockedTotal}`,
    `- B missing_source_ref_total: ${report.candidate.missingSourceRefTotal}`,
    `- B candidate_total: ${report.candidate.candidateTotal}`,
    `- B pending_files: ${report.candidate.pendingFiles}`,
    '',
    '## Evidence',
    `- Baseline audit: ${report.baseline.auditLogPath}`,
    `- Candidate audit: ${report.candidate.auditLogPath}`,
    `- Baseline pending dir: ${report.baseline.pendingDir}`,
    `- Candidate pending dir: ${report.candidate.pendingDir}`,
    '',
    '## Live Mode Execution',
    '- Command: `pnpm --filter @copilot-harness/orchestrator eval:harvester -- --mode=live`',
    '- Storage: `orchestrator/eval/harvester/harvester-report-live-latest.{json,md}` + timestamped snapshots',
    '- Rule: mock reports are regression-only and cannot be used as final acceptance evidence.'
  ];

  return `${lines.join('\n')}\n`;
}

function parseCliOptions(argv: readonly string[]): EvalCliOptions {
  const modeArg = argv.find((item) => item.startsWith('--mode='));
  const mode = modeArg === '--mode=live' ? 'live' : 'mock';
  const forceEnforce = argv.includes('--enforce-thresholds');

  return {
    mode,
    enforceThresholds: forceEnforce || mode === 'mock'
  };
}

function sanitizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}...`;
}

function toFileTimestamp(now: Date): string {
  const iso = now.toISOString();
  const compact = iso.replace(/[-:]/g, '');
  return compact.replace(/\.\d{3}Z$/, 'Z');
}

function containsAny(text: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => text.includes(pattern));
}

function isDataset(value: unknown): value is EvalDataset {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.promptVersion === 'string' &&
    Array.isArray(candidate.samples) &&
    candidate.samples.every((sample) => isSample(sample))
  );
}

function isSample(value: unknown): value is EvalSample {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const sample = value as Record<string, unknown>;
  const issue = sample.issue;

  if (typeof issue !== 'object' || issue === null || Array.isArray(issue)) {
    return false;
  }

  const issueRecord = issue as Record<string, unknown>;
  return (
    typeof sample.id === 'string' &&
    typeof sample.domain === 'string' &&
    typeof sample.source_ref === 'string' &&
    typeof issueRecord.key === 'string' &&
    typeof issueRecord.summary === 'string' &&
    typeof issueRecord.description === 'string' &&
    typeof issueRecord.status === 'string' &&
    typeof issueRecord.priority === 'string' &&
    typeof issueRecord.assignee === 'string' &&
    Array.isArray(issueRecord.labels) &&
    typeof issueRecord.project === 'string'
  );
}
