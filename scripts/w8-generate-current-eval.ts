#!/usr/bin/env tsx
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import {
  createCodeRetrievalToolHandlers,
  GitLabClient,
  loadConfigFromEnv,
} from "../mcp-servers/code-retrieval/src/index.js";

interface MappingDraft {
  readonly issue_mappings: readonly MappingIssue[];
}

interface MappingIssue {
  readonly jira_key: string;
  readonly confirmation_status: string;
  readonly candidates: readonly MappingCandidate[];
}

interface MappingCandidate {
  readonly project: string;
  readonly confidence: number;
  readonly ref_candidates: readonly MappingRefCandidate[];
  readonly evidence_refs: readonly string[];
}

interface MappingRefCandidate {
  readonly ref: string;
}

interface AcceptanceProfile {
  readonly required_sample_count: number;
}

interface W8EvalDatasetJson {
  readonly schema_version: "phase-1b-w8-eval@1";
  readonly samples: readonly W8EvalSampleJson[];
}

interface W8EvalSampleJson {
  readonly task_id: string;
  readonly eval_input_ref: string;
  readonly jira_key: string;
  readonly source_ref: string;
  readonly ground_truth_repo: string;
  readonly ground_truth_modules: readonly string[];
  readonly gitlab_evidence_refs: readonly string[];
  readonly expected_next_action: "draft_plan";
  readonly review_decision: "accept";
  readonly high_risk: boolean;
  readonly predicted: {
    readonly gitlab_evidence_refs: readonly string[];
    readonly repo_hints: readonly {
      readonly project: string;
      readonly module: string;
      readonly confidence: number;
      readonly source_refs: readonly string[];
    }[];
    readonly plan: {
      readonly summary: string;
      readonly steps: readonly string[];
      readonly files: readonly string[];
      readonly risks: readonly string[];
      readonly test_hints: readonly string[];
    };
    readonly next_action: "draft_plan";
  };
}

const ROOT_DIR =
  process.env.W8_CURRENT_EVAL_REPO_ROOT ??
  (process.cwd().endsWith("/orchestrator")
    ? resolve(process.cwd(), "..")
    : process.cwd());
const DEFAULT_MAPPING_PATH = join(
  ROOT_DIR,
  "orchestrator",
  "eval",
  "w8-jira-gitlab-mapping-draft.json",
);
const DEFAULT_PROFILE_PATH = join(
  ROOT_DIR,
  "orchestrator",
  "eval",
  "w8-acceptance-profile.json",
);
const DEFAULT_OUTPUT_PATH = join(
  ROOT_DIR,
  "orchestrator",
  "eval",
  "w8-jira-gitlab-eval-current.json",
);

async function main(): Promise<void> {
  const mappingPath =
    process.env.W8_CURRENT_EVAL_MAPPING_PATH ?? DEFAULT_MAPPING_PATH;
  const profilePath =
    process.env.W8_CURRENT_EVAL_PROFILE_PATH ?? DEFAULT_PROFILE_PATH;
  const outputPath =
    process.env.W8_CURRENT_EVAL_OUTPUT_PATH ?? DEFAULT_OUTPUT_PATH;
  const includeCandidates =
    process.env.W8_CURRENT_EVAL_INCLUDE_CANDIDATE === "1";
  const mapping = await readJson<MappingDraft>(mappingPath);
  const profile = await readJson<AcceptanceProfile>(profilePath);
  const confirmed = mapping.issue_mappings
    .filter((issue) => issue.confirmation_status === "confirmed")
    .filter((issue) => issue.candidates[0] !== undefined)
    .map((issue) => ({
      issue,
      confirmation_status: "confirmed" as const,
    }));
  const candidateFallback = includeCandidates
    ? mapping.issue_mappings
        .filter((issue) => issue.confirmation_status === "candidate")
        .filter((issue) => issue.candidates[0] !== undefined)
        .map((issue) => ({
          issue,
          confirmation_status: "candidate" as const,
        }))
    : [];
  const selected = [...confirmed, ...candidateFallback].slice(
    0,
    profile.required_sample_count,
  );

  if (selected.length !== profile.required_sample_count) {
    throw new Error(
      `Expected ${profile.required_sample_count} mapping samples, found ${selected.length}. confirmed=${confirmed.length}, include_candidates=${String(includeCandidates)}`,
    );
  }

  const config = loadConfigFromEnv(process.env);
  if (config.gitlab === undefined) {
    throw new Error("GITLAB_BASE_URL and GITLAB_TOKEN are required");
  }
  const handlers = createCodeRetrievalToolHandlers({
    gitlabClient: new GitLabClient(config.gitlab),
  });
  const fileEvidenceCache = new Map<string, Promise<string>>();

  const samples = await Promise.all(
    selected.map((entry, index) =>
      buildSample({
        issue: entry.issue,
        confirmationStatus: entry.confirmation_status,
        index,
        fileEvidenceCache,
        readEvidence: (project, ref) =>
          readBranchEvidenceSourceRef({ handlers, project, ref }),
      }),
    ),
  );
  const dataset: W8EvalDatasetJson = {
    schema_version: "phase-1b-w8-eval@1",
    samples,
  };

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(dataset, null, 2)}\n`, "utf8");
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        output_path: outputPath,
        sample_count: samples.length,
        include_candidates: includeCandidates,
        confirmed_sample_count: confirmed.length,
        candidate_sample_count: selected.filter(
          (entry) => entry.confirmation_status === "candidate",
        ).length,
        projects: [
          ...new Set(samples.map((sample) => sample.ground_truth_repo)),
        ],
        refs: [
          ...new Set(
            samples.flatMap((sample) =>
              sample.ground_truth_modules.filter((module) =>
                module.startsWith("ref:"),
              ),
            ),
          ),
        ],
      },
      null,
      2,
    )}\n`,
  );
}

async function buildSample(input: {
  readonly issue: MappingIssue;
  readonly confirmationStatus: "confirmed" | "candidate";
  readonly index: number;
  readonly fileEvidenceCache: Map<string, Promise<string>>;
  readonly readEvidence: (project: string, ref: string) => Promise<string>;
}): Promise<W8EvalSampleJson> {
  const candidate = input.issue.candidates[0];
  if (candidate === undefined) {
    throw new Error(`Missing candidate for ${input.issue.jira_key}`);
  }
  const ref = candidate.ref_candidates[0]?.ref ?? "HEAD";
  const cacheKey = `${candidate.project}@${ref}`;
  let fileEvidence = input.fileEvidenceCache.get(cacheKey);
  if (fileEvidence === undefined) {
    fileEvidence = input.readEvidence(candidate.project, ref);
    input.fileEvidenceCache.set(cacheKey, fileEvidence);
  }
  const evidenceRefs = dedupe([
    ...(candidate.evidence_refs ?? []),
    await fileEvidence,
  ]);
  const module = `ref:${ref}`;
  const taskId = `w8-current-${String(input.index + 1).padStart(2, "0")}-${input.issue.jira_key}`;
  const riskNote =
    input.confirmationStatus === "candidate"
      ? "该样本来自 candidate 映射回填，需后续人工确认。"
      : "该样本来自 confirmed 映射。";

  return {
    task_id: taskId,
    eval_input_ref: `jira-live:${input.issue.jira_key}`,
    jira_key: input.issue.jira_key,
    source_ref: `jira:${input.issue.jira_key}`,
    ground_truth_repo: candidate.project,
    ground_truth_modules: [module],
    gitlab_evidence_refs: evidenceRefs,
    expected_next_action: "draft_plan",
    review_decision: "accept",
    high_risk: false,
    predicted: {
      gitlab_evidence_refs: evidenceRefs,
      repo_hints: [
        {
          project: candidate.project,
          module,
          confidence: candidate.confidence,
          source_refs: evidenceRefs,
        },
      ],
      plan: {
        summary:
          input.confirmationStatus === "candidate"
            ? `基于候选映射处理 ${input.issue.jira_key}（需人工确认）。`
            : `基于已确认映射处理 ${input.issue.jira_key}。`,
        steps: [
          `在 ${candidate.project}@${ref} 定位对应实现。`,
          "按 Jira 描述补充实现或验证现有行为。",
          "执行相关前端构建、类型检查或回归测试。",
        ],
        files: ["README.md"],
        risks: [
          riskNote,
          "当前为 W8 联合评估数据集，最终仍需持续维护真实证据与人工确认。",
        ],
        test_hints: ["pnpm typecheck", "pnpm test"],
      },
      next_action: "draft_plan",
    },
  };
}

async function readBranchEvidenceSourceRef(input: {
  readonly handlers: ReturnType<typeof createCodeRetrievalToolHandlers>;
  readonly project: string;
  readonly ref: string;
}): Promise<string> {
  const result = await input.handlers.readFile({
    project: input.project,
    path: "README.md",
    ref: input.ref,
    range: {
      start: 1,
      end: 3,
    },
  });
  const payload = parseToolPayload(result);
  const sourceRef = payload.file?.source_ref;
  if (typeof sourceRef !== "string") {
    throw new Error(
      `Could not read README.md source_ref for ${input.project}@${input.ref}`,
    );
  }
  return sourceRef;
}

function parseToolPayload(result: unknown): Record<string, unknown> & {
  readonly file?: { readonly source_ref?: unknown };
} {
  if (!isRecord(result) || !Array.isArray(result.content)) {
    return {};
  }
  const first = result.content[0];
  if (
    !isRecord(first) ||
    first.type !== "text" ||
    typeof first.text !== "string"
  ) {
    return {};
  }
  return JSON.parse(first.text) as Record<string, unknown> & {
    readonly file?: { readonly source_ref?: unknown };
  };
}

async function readJson<T>(path: string): Promise<T> {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as T;
}

function dedupe(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error
      ? error.message
      : "Failed to generate W8 current eval dataset";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
