import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

type SkillName =
  | 'angular-delivery'
  | 'angular17-upgrade-regression-handler'
  | 'blood-transfusion';

type Conclusion =
  | 'ready for implementation planning'
  | 'needs implementation scoping'
  | 'needs cross-module investigation'
  | 'needs requirement clarification'
  | 'needs safety review';

interface EvalDataset {
  readonly promptVersion: string;
  readonly samples: readonly EvalSample[];
}

interface EvalSample {
  readonly task_id: string;
  readonly domain: string;
  readonly input_description: string;
  readonly expected_skill: SkillName;
  readonly ground_truth_conclusion: Conclusion;
  readonly source_ref: string;
  readonly high_risk: boolean;
}

interface EvalSampleResult {
  readonly task_id: string;
  readonly domain: string;
  readonly passed: boolean;
  readonly high_risk: boolean;
  readonly source_ref_present: boolean;
  readonly memory_hit_count: number;
  readonly failureReason?: string;
  readonly predicted: {
    readonly skill: SkillName;
    readonly conclusion: Conclusion;
  };
}

interface EvalSummary {
  readonly sampleCount: number;
  readonly passedCount: number;
  readonly failedCount: number;
  readonly highRiskSampleCount: number;
  readonly repoHitAt1: 'not_applicable';
  readonly repoHitAt1Reason: string;
  readonly planExecutability: number;
  readonly correctionRate: number;
  readonly memoryHitCount: {
    readonly total: number;
    readonly average: number;
  };
  readonly sourceRefCoverage: number;
  readonly failureCategories: Readonly<Record<string, number>>;
}

interface EvalReport {
  readonly promptVersion: string;
  readonly summary: EvalSummary;
  readonly samples: readonly EvalSampleResult[];
}

const DATASET_PATH = join('eval', 'jira-eval-50.json');
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
  const memoryHitCountTotal = results.reduce((acc, result) => acc + result.memory_hit_count, 0);
  const sourceRefCoverage = roundRatio(
    results.filter((result) => result.source_ref_present).length,
    results.length
  );
  const failureCategories = results.reduce<Readonly<Record<string, number>>>(
    (accumulator, result) => {
      if (result.passed) return accumulator;
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
      highRiskSampleCount: results.filter((result) => result.high_risk).length,
      repoHitAt1: 'not_applicable',
      repoHitAt1Reason:
        'Repo Hit@1 remains not_applicable in W6 and will be enabled after W8 Code Retrieval MCP is online.',
      planExecutability: roundRatio(passedCount, results.length),
      correctionRate: roundRatio(failedCount, results.length),
      memoryHitCount: {
        total: memoryHitCountTotal,
        average: roundRatio(memoryHitCountTotal, results.length)
      },
      sourceRefCoverage,
      failureCategories
    },
    samples: results
  };
}

function evaluateSample(sample: EvalSample): EvalSampleResult {
  const predictedSkill = predictSkill(sample.input_description);
  const predictedConclusion = predictConclusion(sample.input_description, sample.high_risk);
  const sourceRefPresent = sample.source_ref.trim().length > 0;
  const memoryHitCount = estimateMemoryHitCount(sample, predictedSkill, sourceRefPresent);
  const passed =
    predictedSkill === sample.expected_skill &&
    predictedConclusion === sample.ground_truth_conclusion &&
    sourceRefPresent;

  return {
    task_id: sample.task_id,
    domain: sample.domain,
    passed,
    high_risk: sample.high_risk,
    source_ref_present: sourceRefPresent,
    memory_hit_count: memoryHitCount,
    ...(passed
      ? {}
      : {
          failureReason: buildFailureReason(
            sample,
            predictedSkill,
            predictedConclusion,
            sourceRefPresent
          )
        }),
    predicted: {
      skill: predictedSkill,
      conclusion: predictedConclusion
    }
  };
}

function predictSkill(inputDescription: string): SkillName {
  const text = inputDescription.toLowerCase();
  if (
    containsAny(text, [
      'angular 17',
      'angular17',
      '升级后',
      'upgrade regression',
      '回归',
      'twotone',
      '空白',
      'blank page',
      'icon color drift'
    ])
  ) {
    return 'angular17-upgrade-regression-handler';
  }

  if (
    containsAny(text, [
      '输血',
      'blood transfusion',
      'bloodtransfusioncode',
      '备改输',
      'biz857',
      '取血',
      '双人核对',
      'neubtmis',
      'platform push',
      'reaction sop',
      '反应上报'
    ])
  ) {
    return 'blood-transfusion';
  }

  return 'angular-delivery';
}

function predictConclusion(inputDescription: string, highRisk: boolean): Conclusion {
  const text = inputDescription.toLowerCase();

  if (
    containsAny(text, ['未明确', '待确认', 'clarify', '范围待定', 'scope not confirmed', '待澄清'])
  ) {
    return 'needs requirement clarification';
  }

  if (
    highRisk ||
    containsAny(text, [
      'double-check',
      '双人核对',
      'scan gate',
      'reaction',
      'authorization',
      'token',
      'credential',
      '凭证'
    ])
  ) {
    return 'needs safety review';
  }

  if (
    containsAny(text, [
      'intermittent',
      '偶发',
      '根因',
      'trace',
      '复现困难',
      'cross-module',
      '跨模块',
      'timing uncertain'
    ])
  ) {
    return 'needs cross-module investigation';
  }

  if (
    containsAny(text, [
      '只调整',
      'only update',
      '文案',
      'copy',
      '样式',
      'style',
      '排序',
      'export',
      '字段映射',
      '明确验收',
      'acceptance criteria provided'
    ])
  ) {
    return 'ready for implementation planning';
  }

  return 'needs implementation scoping';
}

function estimateMemoryHitCount(
  sample: EvalSample,
  predictedSkill: SkillName,
  sourceRefPresent: boolean
): number {
  if (!sourceRefPresent) return 0;
  const expectedSkillRef = sample.source_ref.toLowerCase().includes(predictedSkill);
  return expectedSkillRef ? 1 : 0;
}

function buildFailureReason(
  sample: EvalSample,
  predictedSkill: SkillName,
  predictedConclusion: Conclusion,
  sourceRefPresent: boolean
): string {
  if (!sourceRefPresent) return 'source_ref_missing';
  if (predictedSkill !== sample.expected_skill) return 'skill_mismatch';
  if (predictedConclusion !== sample.ground_truth_conclusion) return 'conclusion_mismatch';
  return 'unknown';
}

function renderMarkdown(report: EvalReport): string {
  const lines = [
    '# Eval Summary',
    '',
    `- Samples: ${report.summary.sampleCount}`,
    `- Passed: ${report.summary.passedCount}`,
    `- Failed: ${report.summary.failedCount}`,
    `- High-risk samples: ${report.summary.highRiskSampleCount}`,
    `- Repo Hit@1: ${report.summary.repoHitAt1}`,
    `- Repo Hit@1 reason: ${report.summary.repoHitAt1Reason}`,
    `- Plan Executability: ${report.summary.planExecutability}`,
    `- Correction Rate: ${report.summary.correctionRate}`,
    `- memory_hit_count.total: ${report.summary.memoryHitCount.total}`,
    `- memory_hit_count.average: ${report.summary.memoryHitCount.average}`,
    `- source_ref coverage: ${report.summary.sourceRefCoverage}`,
    '',
    '## Failure Categories',
    ...Object.entries(report.summary.failureCategories).map(([key, value]) => `- ${key}: ${value}`),
    '',
    '## Failed Samples',
    ...report.samples
      .filter((sample) => !sample.passed)
      .map((sample) => `- ${sample.task_id}: ${sample.failureReason ?? 'unknown'}`)
  ];

  return `${lines.join('\n')}\n`;
}

function roundRatio(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 1000;
}

function containsAny(text: string, needles: readonly string[]): boolean {
  return needles.some((needle) => text.includes(needle));
}

function categorizeFailure(reason: string): string {
  if (reason.includes('skill')) return 'skill_mismatch';
  if (reason.includes('conclusion')) return 'conclusion_mismatch';
  if (reason.includes('source_ref')) return 'source_ref_missing';
  return 'other';
}

function isDataset(value: unknown): value is EvalDataset {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.promptVersion === 'string' &&
    Array.isArray(candidate.samples) &&
    candidate.samples.every((sample) => isSample(sample))
  );
}

function isSample(value: unknown): value is EvalSample {
  if (typeof value !== 'object' || value === null) return false;
  const sample = value as Record<string, unknown>;
  return (
    typeof sample.task_id === 'string' &&
    typeof sample.domain === 'string' &&
    typeof sample.input_description === 'string' &&
    (sample.expected_skill === 'angular-delivery' ||
      sample.expected_skill === 'angular17-upgrade-regression-handler' ||
      sample.expected_skill === 'blood-transfusion') &&
    typeof sample.ground_truth_conclusion === 'string' &&
    typeof sample.source_ref === 'string' &&
    typeof sample.high_risk === 'boolean'
  );
}
