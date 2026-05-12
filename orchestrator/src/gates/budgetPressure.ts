import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type { BudgetUsage } from '../runtime/index.js';
import {
  BudgetExceededError,
  DefaultBudgetGate,
  toBudgetOverrunPartialResultV1,
  type BudgetGateInput,
  type BudgetLimitConfig,
  type BudgetLimitKey,
  type BudgetOverrunPartialResultV1
} from './index.js';

export type BudgetPressureScenario =
  | 'baseline_single_turn'
  | 'fanout_5_auto_memory'
  | 'forced_overrun';

export interface BudgetPressureSampleV1 {
  readonly schema_version: 'phase-1c-w9-budget-pressure-sample@1';
  readonly sample_id: string;
  readonly scenario: BudgetPressureScenario;
  readonly usage: BudgetUsage;
  readonly budget_limit: BudgetLimitConfig;
  readonly decision: 'allow' | 'deny';
  readonly audit_trace_id: string;
  readonly exceeded_budget?: BudgetLimitKey;
  readonly partial_result?: BudgetOverrunPartialResultV1;
  readonly notes: readonly string[];
}

export interface BudgetPressureReportV1 {
  readonly schema_version: 'phase-1c-w9-budget-pressure-report@1';
  readonly generated_at: string;
  readonly status: 'pass' | 'fail';
  readonly harness: 'deterministic_mock';
  readonly model: 'gpt-5-mini';
  readonly p95_method: 'nearest_rank';
  readonly p95_usage: BudgetUsage;
  readonly suggested_thresholds: BudgetLimitConfig;
  readonly forced_overrun: {
    readonly passed: number;
    readonly total: 5;
    readonly cases: readonly BudgetPressureSampleV1[];
  };
  readonly samples: readonly BudgetPressureSampleV1[];
}

const FORCED_OVERRUN_KEYS: readonly BudgetLimitKey[] = [
  'maxFanout',
  'maxToolCalls',
  'maxInputTokens',
  'maxOutputTokens',
  'maxPremiumRequests'
];

export function buildBudgetPressureReport(
  generatedAt: string = new Date().toISOString()
): BudgetPressureReportV1 {
  const baselineUsages = buildDeterministicPressureUsages();
  const p95Usage = calculateP95Usage(baselineUsages);
  const suggestedThresholds = suggestThresholds(p95Usage);
  const baselineSamples = baselineUsages.map((usage, index) =>
    evaluatePressureSample({
      taskId: `w9-pressure-${String(index + 1).padStart(2, '0')}`,
      scenario: index % 4 === 0 ? 'baseline_single_turn' : 'fanout_5_auto_memory',
      usage,
      budgetLimit: suggestedThresholds,
      notes:
        index % 4 === 0
          ? ['single gpt-5-mini deterministic sample']
          : ['fanout=5 auto-memory deterministic pressure sample']
    })
  );
  const forcedOverrunSamples = FORCED_OVERRUN_KEYS.map((key) =>
    evaluatePressureSample({
      taskId: `w9-forced-${key}`,
      scenario: 'forced_overrun',
      usage: forceUsageOverrun(key, p95Usage, suggestedThresholds),
      budgetLimit: suggestedThresholds,
      notes: [`forced ${key} overrun`]
    })
  );
  const forcedPassed = forcedOverrunSamples.filter(
    (sample) =>
      sample.decision === 'deny' &&
      sample.partial_result?.turn_state === 'blocked' &&
      sample.partial_result.policy_decision === 'deny' &&
      sample.exceeded_budget !== undefined
  ).length;
  const baselinePassed = baselineSamples.every((sample) => sample.decision === 'allow');

  return {
    schema_version: 'phase-1c-w9-budget-pressure-report@1',
    generated_at: generatedAt,
    status: forcedPassed === 5 && baselinePassed ? 'pass' : 'fail',
    harness: 'deterministic_mock',
    model: 'gpt-5-mini',
    p95_method: 'nearest_rank',
    p95_usage: p95Usage,
    suggested_thresholds: suggestedThresholds,
    forced_overrun: {
      passed: forcedPassed,
      total: 5,
      cases: forcedOverrunSamples
    },
    samples: [...baselineSamples, ...forcedOverrunSamples]
  };
}

export function calculateP95(values: readonly number[]): number {
  if (values.length === 0) {
    throw new Error('Cannot calculate P95 for an empty sample set.');
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.ceil(sorted.length * 0.95) - 1;
  return sorted[Math.max(0, index)] ?? sorted[sorted.length - 1] ?? 0;
}

export function calculateP95Usage(samples: readonly BudgetUsage[]): BudgetUsage {
  return {
    fanout: calculateP95(samples.map((sample) => sample.fanout)),
    toolCalls: calculateP95(samples.map((sample) => sample.toolCalls)),
    inputTokens: calculateP95(samples.map((sample) => sample.inputTokens)),
    outputTokens: calculateP95(samples.map((sample) => sample.outputTokens)),
    premiumRequests: calculateP95(samples.map((sample) => sample.premiumRequests))
  };
}

export function suggestThresholds(p95Usage: BudgetUsage): BudgetLimitConfig {
  return {
    maxFanout: Math.ceil(p95Usage.fanout * 1.2),
    maxToolCalls: Math.ceil(p95Usage.toolCalls * 1.2),
    maxInputTokens: Math.ceil(p95Usage.inputTokens * 1.2),
    maxOutputTokens: Math.ceil(p95Usage.outputTokens * 1.2),
    maxPremiumRequests: Math.ceil(p95Usage.premiumRequests * 1.2)
  };
}

export async function writeBudgetPressureReportFiles(
  report: BudgetPressureReportV1,
  outputDir: string
): Promise<readonly string[]> {
  const jsonPath = join(outputDir, 'w9-budget-pressure.json');
  const markdownPath = join(outputDir, 'w9-budget-pressure.md');

  await mkdir(dirname(jsonPath), {
    recursive: true
  });
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(markdownPath, renderBudgetPressureMarkdown(report), 'utf8');
  return [jsonPath, markdownPath];
}

export function renderBudgetPressureMarkdown(report: BudgetPressureReportV1): string {
  const lines = [
    '# W9 BudgetGate Pressure Report',
    '',
    `- status: ${report.status}`,
    `- generated_at: ${report.generated_at}`,
    `- harness: ${report.harness}`,
    `- model: ${report.model}`,
    `- p95_method: ${report.p95_method}`,
    `- forced_overrun: ${report.forced_overrun.passed}/${report.forced_overrun.total}`,
    '',
    '## P95 Usage',
    '',
    `- fanout: ${report.p95_usage.fanout}`,
    `- tool_calls: ${report.p95_usage.toolCalls}`,
    `- input_tokens: ${report.p95_usage.inputTokens}`,
    `- output_tokens: ${report.p95_usage.outputTokens}`,
    `- premium_requests: ${report.p95_usage.premiumRequests}`,
    '',
    '## Suggested Thresholds',
    '',
    `- maxFanout: ${report.suggested_thresholds.maxFanout}`,
    `- maxToolCalls: ${report.suggested_thresholds.maxToolCalls}`,
    `- maxInputTokens: ${report.suggested_thresholds.maxInputTokens}`,
    `- maxOutputTokens: ${report.suggested_thresholds.maxOutputTokens}`,
    `- maxPremiumRequests: ${report.suggested_thresholds.maxPremiumRequests}`,
    '',
    '## Forced Overrun Evidence',
    ''
  ];

  for (const sample of report.forced_overrun.cases) {
    lines.push(
      `- ${sample.sample_id}: decision=${sample.decision}, exceeded_budget=${sample.exceeded_budget ?? 'none'}, turn_state=${sample.partial_result?.turn_state ?? 'none'}, policy_decision=${sample.partial_result?.policy_decision ?? 'none'}`
    );
  }

  lines.push(
    '',
    '## Conclusion',
    '',
    report.status === 'pass'
      ? 'BudgetGate forced overrun conversion passed 5/5 in deterministic harness.'
      : 'BudgetGate pressure harness failed; inspect JSON evidence before W10.'
  );

  return `${lines.join('\n')}\n`;
}

function buildDeterministicPressureUsages(): readonly BudgetUsage[] {
  return [
    usage(1, 3, 2_400, 520, 0),
    usage(5, 7, 7_600, 1_480, 1),
    usage(5, 8, 8_100, 1_620, 1),
    usage(5, 8, 8_400, 1_680, 1),
    usage(1, 4, 3_100, 610, 0),
    usage(5, 9, 8_900, 1_740, 1),
    usage(5, 9, 9_200, 1_860, 1),
    usage(5, 10, 9_500, 1_920, 1),
    usage(1, 5, 3_400, 700, 0),
    usage(5, 10, 9_800, 2_020, 1),
    usage(5, 10, 10_100, 2_140, 1),
    usage(5, 11, 10_400, 2_260, 1),
    usage(1, 5, 3_800, 780, 0),
    usage(5, 11, 10_700, 2_360, 1),
    usage(5, 11, 11_000, 2_440, 1),
    usage(5, 12, 11_300, 2_520, 1),
    usage(1, 6, 4_200, 860, 0),
    usage(5, 12, 11_600, 2_620, 1),
    usage(5, 12, 11_900, 2_720, 1),
    usage(5, 13, 12_100, 2_840, 1)
  ];
}

function usage(
  fanout: number,
  toolCalls: number,
  inputTokens: number,
  outputTokens: number,
  premiumRequests: number
): BudgetUsage {
  return {
    fanout,
    toolCalls,
    inputTokens,
    outputTokens,
    premiumRequests
  };
}

function evaluatePressureSample(input: {
  readonly taskId: string;
  readonly scenario: BudgetPressureScenario;
  readonly usage: BudgetUsage;
  readonly budgetLimit: BudgetLimitConfig;
  readonly notes: readonly string[];
}): BudgetPressureSampleV1 {
  const traceId = `${input.taskId}-trace`;
  const gateInput: BudgetGateInput = {
    taskId: input.taskId,
    traceId,
    budgetLimit: input.budgetLimit,
    usage: input.usage
  };

  try {
    new DefaultBudgetGate().evaluate(gateInput);
    return {
      schema_version: 'phase-1c-w9-budget-pressure-sample@1',
      sample_id: input.taskId,
      scenario: input.scenario,
      usage: input.usage,
      budget_limit: input.budgetLimit,
      decision: 'allow',
      audit_trace_id: traceId,
      notes: input.notes
    };
  } catch (error: unknown) {
    if (!(error instanceof BudgetExceededError)) {
      throw error;
    }

    return {
      schema_version: 'phase-1c-w9-budget-pressure-sample@1',
      sample_id: input.taskId,
      scenario: input.scenario,
      usage: input.usage,
      budget_limit: input.budgetLimit,
      decision: 'deny',
      audit_trace_id: traceId,
      exceeded_budget: error.exceededBudget,
      partial_result: toBudgetOverrunPartialResultV1(error),
      notes: input.notes
    };
  }
}

function forceUsageOverrun(
  key: BudgetLimitKey,
  baseUsage: BudgetUsage,
  limit: BudgetLimitConfig
): BudgetUsage {
  return {
    fanout: key === 'maxFanout' ? limit.maxFanout + 1 : Math.min(baseUsage.fanout, limit.maxFanout),
    toolCalls:
      key === 'maxToolCalls' ? limit.maxToolCalls + 1 : Math.min(baseUsage.toolCalls, limit.maxToolCalls),
    inputTokens:
      key === 'maxInputTokens'
        ? limit.maxInputTokens + 1
        : Math.min(baseUsage.inputTokens, limit.maxInputTokens),
    outputTokens:
      key === 'maxOutputTokens'
        ? limit.maxOutputTokens + 1
        : Math.min(baseUsage.outputTokens, limit.maxOutputTokens),
    premiumRequests:
      key === 'maxPremiumRequests'
        ? limit.maxPremiumRequests + 1
        : Math.min(baseUsage.premiumRequests, limit.maxPremiumRequests)
  };
}

async function main(): Promise<void> {
  const packageRoot = fileURLToPath(new URL('../../', import.meta.url));
  const report = buildBudgetPressureReport();
  const paths = await writeBudgetPressureReportFiles(report, join(packageRoot, 'eval'));
  process.stdout.write(`${paths.join('\n')}\n`);
}

const entrypoint = process.argv[1] === undefined ? undefined : pathToFileURL(resolve(process.argv[1])).href;

if (entrypoint === import.meta.url) {
  await main();
}
