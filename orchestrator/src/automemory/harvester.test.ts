import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  AutoMemoryHarvester,
  Gpt5MiniHarvesterExtractor,
  installAutoMemoryHarvester,
  parseHarvesterExtractionOutput,
  type HarvesterExtractionInput,
  type HarvesterExtractionOutput,
  type HarvesterExtractor,
  type HarvesterMetricsSink
} from './harvester.js';
import type { AgentResult, TurnContext } from '../runtime/index.js';
import type { RuntimeAdapter, RuntimeAdapterProbe, RuntimeAdapterRequest } from '../runtime/index.js';

class StaticExtractor implements HarvesterExtractor {
  constructor(private readonly output: HarvesterExtractionOutput) {}

  extract(_input: HarvesterExtractionInput): Promise<HarvesterExtractionOutput> {
    return Promise.resolve(this.output);
  }
}

class CaptureMetricsSink implements HarvesterMetricsSink {
  readonly metrics: Array<{ name: string; value: number }> = [];

  add(
    name: string,
    value: number,
    _attributes: Readonly<Record<string, string | number | boolean>>
  ): void {
    this.metrics.push({ name, value });
  }

  read(name: string): number {
    return this.metrics
      .filter((item) => item.name === name)
      .reduce((accumulator, item) => accumulator + item.value, 0);
  }
}

describe('AutoMemoryHarvester', () => {
  let tempDir: string;
  let pendingDir: string;
  let auditLogPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'automemory-harvester-'));
    pendingDir = join(tempDir, '.memory', 'pending');
    auditLogPath = join(tempDir, 'reports', 'audit.log');
  });

  afterEach(async () => {
    await rm(tempDir, {
      recursive: true,
      force: true
    });
  });

  it('applies confidence/novelty thresholds and per-turn cap=3', async () => {
    const metrics = new CaptureMetricsSink();
    const harvester = new AutoMemoryHarvester({
      extractor: new StaticExtractor({
        turn_state: 'done',
        candidates: [
          candidate('decision', 'k1', 0.9, 0.9),
          candidate('knowledge', 'k2', 0.8, 0.6),
          candidate('correction', 'k3', 0.75, 0.55),
          candidate('alias', 'k4', 0.72, 0.52),
          candidate('decision', 'k5', 0.69, 0.9)
        ],
        skipped_by_redline: [],
        thinking: ''
      }),
      metricsSink: metrics,
      pendingDir,
      auditLogPath,
      now: () => new Date('2026-05-07T08:00:00.000Z')
    });

    await harvester.onTurnEnd(buildResult('gate-test'), buildContext('gate-test'));

    const pendingFiles = await readdir(pendingDir);
    expect(pendingFiles).toHaveLength(1);

    const pendingContent = await readFile(join(pendingDir, pendingFiles[0]!), 'utf8');
    expect(pendingContent).toContain('pending_written_count: 3');
    expect(pendingContent).toContain('gate_blocked_count: 2');

    expect(metrics.read('automemory.harvester.candidates_total')).toBe(5);
    expect(metrics.read('automemory.harvester.gate_blocked_total')).toBe(2);
    expect(metrics.read('automemory.harvester.redline_blocked_total')).toBe(0);
    expect(metrics.read('automemory.harvester.pending_written_total')).toBe(3);

    const auditLines = (await readFile(auditLogPath, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const gateEvent = auditLines.find((event) => event.event_name === 'automemory.gate_blocked');
    expect(gateEvent).toBeDefined();
  });

  it('blocks redline candidates and records redline audit events', async () => {
    const harvester = new AutoMemoryHarvester({
      extractor: new StaticExtractor({
        turn_state: 'done',
        candidates: [
          {
            kind: 'knowledge',
            key: 'forbidden.secret',
            value: 'Authorization: Bearer top-secret-token',
            source_ref: 'runtime-adapter',
            producer_agent: 'investigator',
            confidence: 0.91,
            novelty: 0.9,
            rationale: 'contains forbidden token'
          }
        ],
        skipped_by_redline: [{ reason: 'contains authorization bearer token' }],
        thinking: ''
      }),
      pendingDir,
      auditLogPath,
      now: () => new Date('2026-05-07T09:00:00.000Z')
    });

    await harvester.onTurnEnd(buildResult('redline-test'), buildContext('redline-test'));

    await expect(readdir(pendingDir)).rejects.toThrow();

    const auditLines = (await readFile(auditLogPath, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);

    const redlineEvents = auditLines.filter(
      (event) => event.event_name === 'automemory.redline_blocked'
    );
    expect(redlineEvents.length).toBeGreaterThanOrEqual(2);

    const summaryEvent = auditLines.find((event) => event.event_name === 'automemory.harvest_summary');
    expect(summaryEvent).toBeDefined();
    const details = summaryEvent?.details as Record<string, unknown>;
    expect(details.redline_blocked_count).toBe(2);
    expect(details.pending_written_count).toBe(0);
  });

  it('writes diff-friendly pending markdown file name and body', async () => {
    const fixedNow = new Date('2026-05-07T12:34:56.789Z');
    const harvester = new AutoMemoryHarvester({
      extractor: new StaticExtractor({
        turn_state: 'done',
        candidates: [candidate('decision', 'stable.key', 0.9, 0.8)],
        skipped_by_redline: [],
        thinking: 'ok'
      }),
      pendingDir,
      auditLogPath,
      now: () => fixedNow
    });

    await harvester.onTurnEnd(buildResult('task with spaces'), buildContext('task with spaces'));

    const pendingFiles = await readdir(pendingDir);
    expect(pendingFiles).toHaveLength(1);
    expect(pendingFiles[0]).toMatch(/^task_with_spaces-20260507T123456Z\.md$/);

    const pendingContent = await readFile(join(pendingDir, pendingFiles[0]!), 'utf8');
    expect(pendingContent).toContain('# Auto-Memory Pending Candidates');
    expect(pendingContent).toContain('### 1. decision :: stable.key');
    expect(pendingContent).toContain('## Harvester Raw Output');
  });

  it('installs harvester hook through runtime.onTurnEnd', () => {
    let installedHook:
      | ((result: AgentResult, context: TurnContext) => Promise<void>)
      | undefined;
    const runtime = {
      onTurnEnd: (hook: (result: AgentResult, context: TurnContext) => Promise<void>) => {
        installedHook = hook;
      }
    };

    const harvester = installAutoMemoryHarvester(runtime, {
      extractor: new StaticExtractor({
        turn_state: 'done',
        candidates: [],
        skipped_by_redline: [],
        thinking: ''
      }),
      pendingDir,
      auditLogPath
    });

    expect(harvester).toBeDefined();
    expect(installedHook).toBe(harvester.onTurnEnd);
  });

  it('skips harvesting and audits missing_source_ref when evidence source refs are absent', async () => {
    const metrics = new CaptureMetricsSink();
    const extractorCalls: HarvesterExtractionInput[] = [];
    const harvester = new AutoMemoryHarvester({
      extractor: {
        extract: async (input) => {
          extractorCalls.push(input);
          return {
            turn_state: 'done',
            candidates: [candidate('decision', 'should.not.happen', 0.9, 0.9)],
            skipped_by_redline: [],
            thinking: ''
          };
        }
      },
      metricsSink: metrics,
      pendingDir,
      auditLogPath,
      now: () => new Date('2026-05-08T10:00:00.000Z')
    });

    await harvester.onTurnEnd(buildResult('missing-source-ref', { withEvidence: false }), buildContext('missing-source-ref'));

    expect(extractorCalls).toHaveLength(0);
    expect(metrics.read('automemory.harvester.missing_source_ref_total')).toBe(1);

    const auditLines = (await readFile(auditLogPath, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(auditLines.some((event) => event.event_name === 'automemory.missing_source_ref')).toBe(
      true
    );

    const summary = auditLines.find((event) => event.event_name === 'automemory.harvest_summary');
    const details = summary?.details as Record<string, unknown>;
    expect(details.reason).toBe('missing_source_ref');
  });
});

describe('parseHarvesterExtractionOutput', () => {
  it('parses fenced JSON response and truncates rationale over 100 chars', () => {
    const parsed = parseHarvesterExtractionOutput(`\n\`\`\`json\n${JSON.stringify({
      turn_state: 'done',
      candidates: [
        {
          kind: 'decision',
          key: 'k',
          value: 'v',
          source_ref: 'runtime-adapter',
          producer_agent: 'investigator',
          confidence: 0.9,
          novelty: 0.8,
          rationale: 'x'.repeat(120)
        }
      ],
      skipped_by_redline: [],
      thinking: ''
    })}\n\`\`\``);

    expect(parsed.candidates[0]?.rationale.length).toBe(100);
  });

  it('rejects outputs with more than 3 candidates', () => {
    expect(() =>
      parseHarvesterExtractionOutput(
        JSON.stringify({
          turn_state: 'done',
          candidates: [
            candidate('decision', 'k1', 0.9, 0.9),
            candidate('decision', 'k2', 0.9, 0.9),
            candidate('decision', 'k3', 0.9, 0.9),
            candidate('decision', 'k4', 0.9, 0.9)
          ],
          skipped_by_redline: [],
          thinking: ''
        })
      )
    ).toThrow('harvester output.candidates must be <= 3');
  });
});

describe('Gpt5MiniHarvesterExtractor', () => {
  it('locks extraction request to gpt-5-mini', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'harvester-prompt-'));
    const promptPath = join(tempDir, 'harvester.v1.md');
    await writeFile(promptPath, 'system prompt', 'utf8');

    const adapter = new RecordingAdapter({
      turn_state: 'done',
      candidates: [],
      skipped_by_redline: [],
      thinking: ''
    });
    const extractor = new Gpt5MiniHarvesterExtractor({
      adapter,
      promptPath,
      now: () => new Date('2026-05-07T00:00:00.000Z')
    });

    await extractor.extract({
      task_id: 'extractor-test',
      audit_trace_id: 'trace-extractor-test',
      turn_state: 'done',
      runtime: 'copilot_sdk',
      model: 'gpt-5-mini',
      prompt_version: 'jira-analysis-prompt@0.1',
      intent: 'intent',
      output: 'output',
      source_refs: ['runtime-adapter']
    });

    expect(adapter.requests).toHaveLength(1);
    expect(adapter.requests[0]?.model).toBe('gpt-5-mini');
    expect(adapter.requests[0]?.reasoningEffort).toBe('low');

    await rm(tempDir, { recursive: true, force: true });
  });
});

function candidate(
  kind: 'decision' | 'knowledge' | 'correction' | 'alias',
  key: string,
  confidence: number,
  novelty: number
): HarvesterExtractionOutput['candidates'][number] {
  return {
    kind,
    key,
    value: `value:${key}`,
    source_ref: 'runtime-adapter',
    producer_agent: 'investigator',
    confidence,
    novelty,
    rationale: `rationale:${key}`
  };
}

function buildResult(taskId: string, options: { readonly withEvidence?: boolean } = {}): AgentResult {
  const evidences =
    options.withEvidence === false
      ? []
      : [
          {
            source_ref: 'runtime-adapter',
            content: 'runtime output',
            tool: 'runtime-adapter'
          }
        ];

  return {
    taskId,
    turnState: 'done',
    output: 'runtime output',
    evidencePack: {
      taskId,
      intent: 'intent',
      evidences,
      assumptions: [],
      confidence: 0.8
    },
    auditTraceId: `trace-${taskId}`,
    model: 'gpt-5-mini',
    runtime: {
      name: 'copilot_sdk',
      version: 'test'
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

function buildContext(taskId: string): TurnContext {
  return {
    taskId,
    model: 'gpt-5-mini',
    runtime: {
      name: 'copilot_sdk',
      version: 'test'
    },
    runOptions: {
      reasoningEffort: 'medium'
    },
    turnState: 'done',
    auditTraceId: `trace-${taskId}`,
    toolCalls: []
  };
}

class RecordingAdapter implements RuntimeAdapter {
  readonly requests: RuntimeAdapterRequest[] = [];

  constructor(private readonly output: HarvesterExtractionOutput) {}

  probe(): Promise<RuntimeAdapterProbe> {
    return Promise.resolve({
      runtime: {
        name: 'copilot_sdk',
        version: 'test'
      },
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
        externalExecution: true,
        capabilitySupported: true,
        unsupportedReasons: []
      },
      rawSummary: 'recording adapter'
    });
  }

  execute(request: RuntimeAdapterRequest): Promise<{
    readonly output: string;
    readonly toolCalls: readonly [];
    readonly capabilityNotes: readonly string[];
  }> {
    this.requests.push(request);
    return Promise.resolve({
      output: JSON.stringify(this.output),
      toolCalls: [],
      capabilityNotes: []
    });
  }
}
