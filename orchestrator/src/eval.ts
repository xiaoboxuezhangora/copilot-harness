import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

interface EvalDataset {
  readonly promptVersion: string;
  readonly samples: readonly EvalSample[];
}

interface EvalSample {
  readonly id: string;
  readonly domain: string;
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
  readonly source_ref: string;
  readonly ground_truth: {
    readonly modules: readonly string[];
    readonly expected_skill: string;
    readonly expected_conclusion: string;
  };
}

interface EvalSampleResult {
  readonly id: string;
  readonly domain: string;
  readonly passed: boolean;
  readonly failureReason?: string;
  readonly predicted: {
    readonly problem_summary: string;
    readonly impact_scope: readonly string[];
    readonly priority_suggestion: string;
    readonly attachment_notes: readonly string[];
    readonly ambiguity: string;
    readonly executable_score: number;
    readonly next_queries: readonly string[];
    readonly conclusion: string;
  };
}

interface EvalSummary {
  readonly sampleCount: number;
  readonly passedCount: number;
  readonly failedCount: number;
  readonly repoHitAt1: 'not_applicable';
  readonly repoHitAt1Reason: string;
  readonly planExecutability: number;
  readonly correctionRate: number;
  readonly failureCategories: Readonly<Record<string, number>>;
}

interface EvalReport {
  readonly promptVersion: string;
  readonly summary: EvalSummary;
  readonly samples: readonly EvalSampleResult[];
}

const DATASET_PATH = join('eval', 'jira-eval-20.json');
const OUTPUT_JSON_PATH = join('eval', 'report.json');
const OUTPUT_MD_PATH = join('eval', 'report.md');

const main = async (): Promise<void> => {
  const dataset = await loadDataset(DATASET_PATH);
  const report = buildReport(dataset);

  await mkdir(dirname(OUTPUT_JSON_PATH), { recursive: true });
  await writeFile(OUTPUT_JSON_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(OUTPUT_MD_PATH, renderMarkdown(report), 'utf8');

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${renderMarkdown(report)}\n`);
};

await main();

async function loadDataset(path: string): Promise<EvalDataset> {
  const raw = await readFile(path, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  if (!isDataset(parsed)) {
    throw new Error('Eval dataset is malformed');
  }
  return parsed;
}

function buildReport(dataset: EvalDataset): EvalReport {
  const results = dataset.samples.map((sample) => evaluateSample(sample));
  const passedCount = results.filter((result) => result.passed).length;
  const failedCount = results.length - passedCount;
  const failureCategories = results.reduce<Readonly<Record<string, number>>>(
    (accumulator, result) => {
      if (result.passed) {
        return accumulator;
      }

      const category = categorizeFailure(result.failureReason ?? 'unknown');
      return {
        ...accumulator,
        [category]: (accumulator[category] ?? 0) + 1
      };
    },
    {}
  );

  return {
    promptVersion: dataset.promptVersion,
    summary: {
      sampleCount: results.length,
      passedCount,
      failedCount,
      repoHitAt1: 'not_applicable',
      repoHitAt1Reason: 'Repo resolver is not implemented in W3; score is intentionally withheld.',
      planExecutability: roundRatio(passedCount, results.length),
      correctionRate: roundRatio(failedCount, results.length),
      failureCategories
    },
    samples: results
  };
}

function evaluateSample(sample: EvalSample): EvalSampleResult {
  const modules = sample.ground_truth.modules.map((module) => module.toLowerCase());
  const conclusion = predictConclusion(sample);
  const predictedModules = predictModules(sample);
  const moduleCoverage = coverageRatio(normalizeList(predictedModules), normalizeList(modules));
  const passed =
    moduleCoverage >= 0.5 &&
    conclusion === sample.ground_truth.expected_conclusion &&
    sample.ground_truth.expected_skill === 'jira-requirement-analysis';

  return {
    id: sample.id,
    domain: sample.domain,
    passed,
    ...(passed
      ? {}
      : {
          failureReason: buildFailureReason(sample, predictedModules, conclusion)
        }),
    predicted: {
      problem_summary: sample.issue.summary,
      impact_scope: predictedModules,
      priority_suggestion: sample.issue.priority,
      attachment_notes: [],
      ambiguity: sample.issue.description,
      executable_score: scoreFromIssue(sample),
      next_queries: predictedModules.length === 0 ? ['clarify module ownership'] : [],
      conclusion
    }
  };
}

function predictModules(sample: EvalSample): readonly string[] {
  const text =
    `${sample.issue.summary} ${sample.issue.description} ${sample.issue.labels.join(' ')}`.toLowerCase();
  const modules: string[] = [];
  if (text.includes('sso') || text.includes('login') || text.includes('session'))
    modules.push('auth');
  if (text.includes('mobile')) modules.push('mobile');
  if (text.includes('pda') || text.includes('device')) modules.push('device');
  if (
    text.includes('ui') ||
    text.includes('screen') ||
    text.includes('copy') ||
    text.includes('图标') ||
    text.includes('页面') ||
    text.includes('展示') ||
    text.includes('list')
  ) {
    modules.push('ui');
  }
  if (text.includes('audit') || text.includes('追踪') || text.includes('log'))
    modules.push('audit');
  if (
    text.includes('workflow') ||
    text.includes('状态') ||
    text.includes('步骤') ||
    text.includes('核对')
  ) {
    modules.push('workflow');
  }
  if (text.includes('attachment') || text.includes('附件')) modules.push('attachments');
  if (
    text.includes('api') ||
    text.includes('接口') ||
    text.includes('service') ||
    text.includes('search')
  ) {
    modules.push('backend');
  }
  if (text.includes('病案')) modules.push('clinical-records');
  if (text.includes('输血')) modules.push('blood-safety');
  return [...new Set(modules)];
}

function predictConclusion(sample: EvalSample): string {
  const text = `${sample.issue.summary} ${sample.issue.description}`.toLowerCase();
  if (text.includes('原文') || text.includes('患者') || text.includes('ca')) return 'await_human';
  if (text.includes('未明确') || text.includes('clarify') || text.includes('范围'))
    return 'needs requirement clarification';
  if (
    text.includes('重试') ||
    text.includes('同步') ||
    text.includes('追踪') ||
    text.includes('接口')
  ) {
    return 'needs cross-module investigation';
  }
  if (
    text.includes('只替换') ||
    text.includes('只调整') ||
    text.includes('元数据') ||
    text.includes('导出') ||
    text.includes('排序') ||
    text.includes('优化') ||
    text.includes('reminder')
  ) {
    return 'ready for implementation planning';
  }
  if (text.includes('安全') || text.includes('token') || text.includes('兼容'))
    return 'needs safety review';
  return 'needs implementation scoping';
}

function scoreFromIssue(sample: EvalSample): number {
  const text = `${sample.issue.summary} ${sample.issue.description}`;
  const clarity = text.length > 80 ? 0.85 : text.length > 40 ? 0.7 : 0.4;
  const moduleClues = sample.issue.labels.length > 1 ? 0.8 : 0.5;
  const acceptance =
    sample.issue.description.includes('only') || sample.issue.description.includes('只')
      ? 0.8
      : 0.4;
  const missingInfo = sample.issue.description.includes('未明确') ? 0.2 : 0.7;
  return clamp01((clarity + moduleClues + acceptance + missingInfo) / 4);
}

function buildFailureReason(
  sample: EvalSample,
  predictedModules: readonly string[],
  conclusion: string
): string {
  if (sample.ground_truth.expected_skill !== 'jira-requirement-analysis') {
    return 'skill_mismatch';
  }
  if (
    coverageRatio(normalizeList(predictedModules), normalizeList(sample.ground_truth.modules)) < 0.5
  ) {
    return 'module_mismatch';
  }
  if (conclusion !== sample.ground_truth.expected_conclusion) {
    return 'conclusion_mismatch';
  }
  return 'unknown';
}

function renderMarkdown(report: EvalReport): string {
  const lines = [
    '# Eval Summary',
    '',
    `- Samples: ${report.summary.sampleCount}`,
    `- Passed: ${report.summary.passedCount}`,
    `- Failed: ${report.summary.failedCount}`,
    `- Repo Hit@1: ${report.summary.repoHitAt1}`,
    `- Repo Hit@1 reason: ${report.summary.repoHitAt1Reason}`,
    `- Plan Executability: ${report.summary.planExecutability}`,
    `- Correction Rate: ${report.summary.correctionRate}`,
    '',
    '## Failure Categories',
    ...Object.entries(report.summary.failureCategories).map(([key, value]) => `- ${key}: ${value}`),
    '',
    '## Failed Samples',
    ...report.samples
      .filter((sample) => !sample.passed)
      .map((sample) => `- ${sample.id}: ${sample.failureReason ?? 'unknown'}`)
  ];
  return `${lines.join('\n')}\n`;
}

function roundRatio(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 1000;
}

function normalizeList(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => value.toLowerCase()).sort())];
}

function coverageRatio(left: readonly string[], right: readonly string[]): number {
  if (right.length === 0) return 1;
  const covered = right.filter((value) => left.includes(value)).length;
  return covered / right.length;
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function categorizeFailure(reason: string): string {
  if (reason.includes('module')) return 'module_mismatch';
  if (reason.includes('conclusion')) return 'conclusion_mismatch';
  return 'other';
}

function isDataset(value: unknown): value is EvalDataset {
  return (
    typeof value === 'object' &&
    value !== null &&
    'promptVersion' in value &&
    'samples' in value &&
    Array.isArray((value as { samples?: unknown }).samples)
  );
}
