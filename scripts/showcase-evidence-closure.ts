#!/usr/bin/env tsx
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";

import {
  JiraClient,
  createJiraReaderServer,
  loadConfigFromEnv,
  startMockJiraServer,
  type JiraComment,
  type JiraIssue,
  type JiraSearchResult,
  type MockJiraServer,
} from "../mcp-servers/jira-reader/src/index.js";
import { JIRA_ANALYSIS_PROMPT_VERSION } from "../orchestrator/src/jira/context.js";
import {
  DEFAULT_MODEL,
  type AgentCapabilityFlags,
} from "../orchestrator/src/runtime/index.js";
import { exportShowcaseSnapshot } from "./showcase-export-lib.js";

type EvidenceMode = "mock" | "live";
type RequestedMode = EvidenceMode | "auto";
type TurnState =
  | "done"
  | "continue_current"
  | "await_human"
  | "blocked"
  | "handoff_needed";
type ToolName = "searchIssues" | "getIssue" | "getComments";

interface CliOptions {
  readonly date: string;
  readonly mode: RequestedMode;
  readonly skipExport: boolean;
}

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

interface EvalReport {
  readonly promptVersion: string;
  readonly samples: readonly EvalSampleResult[];
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

interface McpTraceRecord {
  readonly timestamp: string;
  readonly trace_id: string;
  readonly task_id: string;
  readonly mcp_server_name: "jira-reader";
  readonly mcp_tool_name: ToolName;
  readonly transport_type: "in_memory";
  readonly side_effect_level: "read";
  readonly confirm_required: false;
  readonly audit_event_name: "mcp.tool_call";
  readonly decision: "allow";
  readonly latency_ms: number;
  readonly success: boolean;
  readonly data_origin: "mock_runtime" | "live_runtime";
  readonly args_preview: string;
}

interface AuditTurnRecord {
  readonly timestamp: string;
  readonly taskId: string;
  readonly turnState: TurnState;
  readonly model: typeof DEFAULT_MODEL;
  readonly runtime: {
    readonly name: "contract_stub";
  };
  readonly toolCalls: Array<{
    readonly toolName: ToolName;
    readonly decision: "allow";
    readonly timestampIso: string;
    readonly argsPreview: string;
  }>;
  readonly traceId: string;
  readonly reasoningEffort: "medium";
  readonly policyDecision: "allow";
  readonly budgetUsage: {
    readonly fanout: number;
    readonly toolCalls: number;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly premiumRequests: number;
  };
  readonly promptVersion: typeof JIRA_ANALYSIS_PROMPT_VERSION;
  readonly capabilities: AgentCapabilityFlags;
  readonly otelAttributes: Readonly<Record<string, string | number | boolean>>;
}

interface EvidencePack {
  readonly taskId: string;
  readonly intent: string;
  readonly evidences: Array<{
    readonly source_ref: string;
    readonly content: string;
    readonly tool?: string;
  }>;
  readonly assumptions: Array<{
    readonly statement: string;
    readonly confidence: number;
  }>;
  readonly confidence: number;
}

interface TaskStateRecord {
  readonly taskId: string;
  readonly turn_state: TurnState;
  readonly execution_mode: string;
  readonly role: string;
  readonly prompt_version: string;
  readonly model: typeof DEFAULT_MODEL;
  readonly runtime: string;
  readonly evidence_pack_size: number;
  readonly memory_hit_count: number;
  readonly jira_issue?: JiraIssue;
  readonly jira_issues?: readonly JiraIssue[];
  readonly evidencePack: EvidencePack;
  readonly closure: Readonly<Record<string, unknown>>;
}

interface ClosureResult {
  readonly mode: EvidenceMode;
  readonly taskId: string;
  readonly auditLogPath: string;
  readonly tracePath: string;
  readonly taskStatePath: string;
  readonly evalTaskStateCount: number;
  readonly snapshotPath: string | null;
  readonly snapshotReadiness: "READY" | "NOT_READY" | null;
  readonly warnings: readonly string[];
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const mode = resolveMode(options.mode);
  const closure = await runClosure(options.date, mode);
  const evalTaskStateCount = await materializeEvalTaskStates(options.date);

  let snapshotPath: string | null = null;
  let snapshotReadiness: "READY" | "NOT_READY" | null = null;
  let warnings: readonly string[] = [];

  if (!options.skipExport) {
    const result = await exportShowcaseSnapshot({
      repoRoot,
      date: options.date,
    });
    snapshotPath = result.outputPath;
    snapshotReadiness = result.snapshot.metadata.phase0Readiness;
    warnings = result.snapshot.metadata.warnings;
  }

  const output: ClosureResult = {
    mode,
    taskId: closure.taskId,
    auditLogPath: closure.auditLogPath,
    tracePath: closure.tracePath,
    taskStatePath: closure.taskStatePath,
    evalTaskStateCount,
    snapshotPath,
    snapshotReadiness,
    warnings,
  };

  await writeClosureReport(options.date, output);
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

async function runClosure(
  date: string,
  mode: EvidenceMode,
): Promise<{
  taskId: string;
  auditLogPath: string;
  tracePath: string;
  taskStatePath: string;
}> {
  const taskId = `w4-evidence-jira-reader-${mode}`;
  const traceId = `showcase-${mode}-${date}`;
  const jiraRuntime = await createJiraRuntime(mode);
  const traceRecords: McpTraceRecord[] = [];
  const server = createJiraReaderServer(jiraRuntime.client);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({
    name: "showcase-evidence-closure",
    version: "0.1.0",
  });

  await Promise.all([
    server.connect(serverTransport),
    mcpClient.connect(clientTransport),
  ]);

  try {
    const searchPayload = await callJiraTool<JiraSearchResult>({
      mcpClient,
      mode,
      taskId,
      traceId,
      traceRecords,
      toolName: "searchIssues",
      args: {
        jql: jiraRuntime.jql,
        maxResults: 50,
      },
    });
    const firstIssueKey = searchPayload.search.issues[0]?.key;
    if (firstIssueKey === undefined) {
      throw new Error(
        `No Jira issues returned for evidence closure JQL: ${jiraRuntime.jql}`,
      );
    }

    const issuePayload = await callJiraTool<JiraIssue>({
      mcpClient,
      mode,
      taskId,
      traceId,
      traceRecords,
      toolName: "getIssue",
      args: {
        issueKey: firstIssueKey,
      },
    });
    const commentsPayload = await callJiraTool<readonly JiraComment[]>({
      mcpClient,
      mode,
      taskId,
      traceId,
      traceRecords,
      toolName: "getComments",
      args: {
        issueKey: firstIssueKey,
      },
    });

    const tracePath = join(
      repoRoot,
      "reports",
      "mcp-traces",
      date,
      "jira-reader-trace.jsonl",
    );
    await writeJsonl(tracePath, traceRecords);

    const evidencePack = buildJiraEvidencePack({
      taskId,
      mode,
      issue: issuePayload.issue,
      comments: commentsPayload.comments,
      search: searchPayload.search,
      traceRecords,
    });
    const taskState = buildJiraTaskState({
      taskId,
      date,
      mode,
      issue: issuePayload.issue,
      search: searchPayload.search,
      evidencePack,
      tracePath,
    });
    const taskStatePath = join(
      repoRoot,
      "state",
      "tasks",
      "showcase",
      `${taskId}.json`,
    );
    await writeJson(taskStatePath, taskState);

    const auditLogPath = join(repoRoot, "reports", "audit.log");
    await upsertAuditRecord(
      auditLogPath,
      buildAuditTurnRecord({
        taskId,
        traceId,
        mode,
        traceRecords,
        evidencePack,
      }),
    );

    return {
      taskId,
      auditLogPath,
      tracePath,
      taskStatePath,
    };
  } finally {
    await mcpClient.close();
    await server.close();
    if (jiraRuntime.mockServer !== undefined) {
      await jiraRuntime.mockServer.close();
    }
  }
}

async function createJiraRuntime(mode: EvidenceMode): Promise<{
  client: JiraClient;
  jql: string;
  mockServer?: MockJiraServer;
}> {
  if (mode === "mock") {
    const mockServer = await startMockJiraServer();
    return {
      client: new JiraClient({
        baseUrl: mockServer.baseUrl,
        projectAllowlist: ["OPS"],
        requestTimeoutMs: 5_000,
      }),
      jql: "project = OPS ORDER BY updated DESC",
      mockServer,
    };
  }

  const config = loadConfigFromEnv({
    ...process.env,
    ...(process.env.JIRA_PROJECT_ALLOWLIST === undefined
      ? { JIRA_PROJECT_ALLOWLIST: "APMIS" }
      : {}),
  });
  const projectKey = config.projectAllowlist[0] ?? "APMIS";
  return {
    client: new JiraClient(config),
    jql:
      process.env.JIRA_SMOKE_JQL ??
      `project = ${projectKey} ORDER BY updated DESC`,
  };
}

async function callJiraTool<T>(input: {
  mcpClient: Client;
  mode: EvidenceMode;
  taskId: string;
  traceId: string;
  traceRecords: McpTraceRecord[];
  toolName: ToolName;
  args: Record<string, unknown>;
}): Promise<Record<string, T>> {
  const started = performance.now();
  const timestamp = new Date().toISOString();
  const traceRecordBase = {
    timestamp,
    trace_id: `${input.traceId}-${input.toolName}-${input.traceRecords.length + 1}`,
    task_id: input.taskId,
    mcp_server_name: "jira-reader",
    mcp_tool_name: input.toolName,
    transport_type: "in_memory",
    side_effect_level: "read",
    confirm_required: false,
    audit_event_name: "mcp.tool_call",
    decision: "allow",
    data_origin: input.mode === "live" ? "live_runtime" : "mock_runtime",
    args_preview: previewArgs(input.args),
  } as const;

  try {
    const result = await input.mcpClient.callTool(
      {
        name: input.toolName,
        arguments: input.args,
      },
      CallToolResultSchema,
    );
    const payload = parseTextPayload<Record<string, T>>(result.content);
    input.traceRecords.push({
      ...traceRecordBase,
      latency_ms: Math.round(performance.now() - started),
      success: true,
    });
    return payload;
  } catch (error) {
    input.traceRecords.push({
      ...traceRecordBase,
      latency_ms: Math.round(performance.now() - started),
      success: false,
    });
    throw error;
  }
}

function buildJiraEvidencePack(input: {
  taskId: string;
  mode: EvidenceMode;
  issue: JiraIssue;
  comments: readonly JiraComment[];
  search: JiraSearchResult;
  traceRecords: readonly McpTraceRecord[];
}): EvidencePack {
  return {
    taskId: input.taskId,
    intent: "P0.5 Showcase evidence closure for JiraReader MCP read-only path",
    evidences: [
      {
        source_ref: `mcp:jira-reader.searchIssues#${input.traceRecords[0]?.trace_id ?? "unknown"}`,
        content: `JiraReader.searchIssues returned ${input.search.issues.length}/${input.search.total} issues in ${input.mode} mode.`,
        tool: "searchIssues",
      },
      {
        source_ref: `jira:${input.issue.key}`,
        content: `${input.issue.key} ${input.issue.summary}`,
        tool: "getIssue",
      },
      {
        source_ref: `jira:${input.issue.key}#comments`,
        content: `JiraReader.getComments returned ${input.comments.length} comments.`,
        tool: "getComments",
      },
    ],
    assumptions: [
      {
        statement:
          input.mode === "live"
            ? "Evidence was collected from the configured Jira environment through the JiraReader MCP server."
            : "Evidence was collected from the repository mock Jira server through the real JiraReader MCP server path.",
        confidence: input.mode === "live" ? 0.9 : 0.75,
      },
    ],
    confidence: input.mode === "live" ? 0.9 : 0.78,
  };
}

function buildJiraTaskState(input: {
  taskId: string;
  date: string;
  mode: EvidenceMode;
  issue: JiraIssue;
  search: JiraSearchResult;
  evidencePack: EvidencePack;
  tracePath: string;
}): TaskStateRecord {
  return {
    taskId: input.taskId,
    turn_state: "done",
    execution_mode: input.mode,
    role: "investigator",
    prompt_version: JIRA_ANALYSIS_PROMPT_VERSION,
    model: DEFAULT_MODEL,
    runtime: "contract_stub",
    evidence_pack_size: input.evidencePack.evidences.length,
    memory_hit_count: 0,
    jira_issue: input.issue,
    jira_issues: input.search.issues,
    evidencePack: input.evidencePack,
    closure: {
      generated_at: new Date().toISOString(),
      snapshot_date: input.date,
      mode: input.mode,
      trace_file: toRelativePath(input.tracePath),
    },
  };
}

function buildAuditTurnRecord(input: {
  taskId: string;
  traceId: string;
  mode: EvidenceMode;
  traceRecords: readonly McpTraceRecord[];
  evidencePack: EvidencePack;
}): AuditTurnRecord {
  const inputTokens = 64;
  const outputTokens = estimateOutputTokens(input.evidencePack);
  return {
    timestamp: new Date().toISOString(),
    taskId: input.taskId,
    turnState: "done",
    model: DEFAULT_MODEL,
    runtime: {
      name: "contract_stub",
    },
    toolCalls: input.traceRecords.map((record) => ({
      toolName: record.mcp_tool_name,
      decision: "allow",
      timestampIso: record.timestamp,
      argsPreview: record.args_preview,
    })),
    traceId: input.traceId,
    reasoningEffort: "medium",
    policyDecision: "allow",
    budgetUsage: {
      fanout: 1,
      toolCalls: input.traceRecords.length,
      inputTokens,
      outputTokens,
      premiumRequests: 0,
    },
    promptVersion: JIRA_ANALYSIS_PROMPT_VERSION,
    capabilities: {
      canSpawn: false,
      canUseTools: true,
      canResume: false,
      canReadMemory: false,
      canWriteMemory: false,
      canUseMcp: true,
      supportsSessions: false,
      supportsHooks: true,
      supportsReasoningEffort: true,
      supportsHeadless: true,
      externalExecution: input.mode === "live",
      capabilitySupported: true,
      unsupportedReasons:
        input.mode === "live"
          ? []
          : [
              "External Jira disabled; mock Jira runtime used for deterministic evidence closure",
            ],
    },
    otelAttributes: {
      "gen_ai.system": "contract_stub",
      "gen_ai.request.model": DEFAULT_MODEL,
      "gen_ai.usage.input_tokens": inputTokens,
      "gen_ai.usage.output_tokens": outputTokens,
      "gen_ai.request.reasoning_effort": "medium",
      "copilot_harness.evidence_mode": input.mode,
    },
  };
}

async function materializeEvalTaskStates(date: string): Promise<number> {
  const dataset = await readJson<EvalDataset>(
    join(repoRoot, "orchestrator", "eval", "jira-eval-20.json"),
  );
  const report = await readJson<EvalReport>(
    join(repoRoot, "orchestrator", "eval", "report.json"),
  );
  const samplesById = new Map(
    dataset.samples.map((sample) => [sample.id, sample]),
  );
  const targetRoot = join(repoRoot, "state", "tasks", "eval");
  let count = 0;

  for (const result of report.samples) {
    const sample = samplesById.get(result.id);
    if (sample === undefined) continue;
    const taskId = `w3-eval-${result.id}`;
    const evidencePack: EvidencePack = {
      taskId,
      intent: `Jira requirement analysis eval sample ${result.id}`,
      evidences: [
        {
          source_ref: sample.source_ref,
          content: `${sample.issue.key} ${sample.issue.summary}`,
          tool: "jira-eval-fixture",
        },
        {
          source_ref: `eval:${result.id}#prediction`,
          content: `Predicted conclusion: ${result.predicted.conclusion}; executable_score=${result.predicted.executable_score}.`,
          tool: "jira-requirement-analysis",
        },
      ],
      assumptions: [
        {
          statement: result.passed
            ? "Eval prediction matched the W3 ground truth."
            : `Eval prediction did not match W3 ground truth: ${result.failureReason ?? "unknown"}.`,
          confidence: result.passed ? 0.8 : 0.45,
        },
      ],
      confidence: result.passed ? 0.82 : 0.52,
    };
    const state: TaskStateRecord = {
      taskId,
      turn_state: mapEvalTurnState(result.predicted.conclusion, result.passed),
      execution_mode: "eval",
      role: "investigator",
      prompt_version: report.promptVersion,
      model: DEFAULT_MODEL,
      runtime: "eval_fixture",
      evidence_pack_size: evidencePack.evidences.length,
      memory_hit_count: 0,
      evidencePack,
      closure: {
        generated_at: new Date().toISOString(),
        snapshot_date: date,
        data_origin: "orchestrator/eval/report.json",
        domain: result.domain,
        passed: result.passed,
      },
    };
    await writeJson(join(targetRoot, `${taskId}.json`), state);
    count += 1;
  }

  return count;
}

function mapEvalTurnState(conclusion: string, passed: boolean): TurnState {
  if (passed) return "done";
  if (conclusion === "await_human") return "await_human";
  if (
    conclusion.includes("clarification") ||
    conclusion.includes("investigation")
  ) {
    return "continue_current";
  }
  if (conclusion.includes("safety")) return "await_human";
  return "continue_current";
}

async function upsertAuditRecord(
  path: string,
  record: AuditTurnRecord,
): Promise<void> {
  const existing = await readJsonlIfExists<AuditTurnRecord>(path);
  const next = existing.filter((item) => item.taskId !== record.taskId);
  next.push(record);
  await writeJsonl(path, next);
}

async function writeClosureReport(
  date: string,
  result: ClosureResult,
): Promise<void> {
  await writeJson(
    join(repoRoot, "reports", "showcase", date, "evidence-closure-report.json"),
    {
      ...result,
      generatedAt: new Date().toISOString(),
    },
  );
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

async function readJsonlIfExists<T>(path: string): Promise<T[]> {
  try {
    const content = await readFile(path, "utf8");
    return content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as T);
  } catch {
    return [];
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeJsonl(
  path: string,
  records: readonly unknown[],
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
    "utf8",
  );
}

function parseTextPayload<T>(content: unknown): T {
  if (!Array.isArray(content)) {
    throw new Error("Tool result did not include array content");
  }

  const first = content[0];
  if (
    typeof first !== "object" ||
    first === null ||
    (first as Record<string, unknown>).type !== "text" ||
    typeof (first as Record<string, unknown>).text !== "string"
  ) {
    throw new Error("Tool result did not include text content");
  }

  return JSON.parse((first as { text: string }).text) as T;
}

function resolveMode(mode: RequestedMode): EvidenceMode {
  if (mode === "mock" || mode === "live") return mode;
  return process.env.JIRA_BASE_URL === undefined ? "mock" : "live";
}

function parseArgs(args: readonly string[]): CliOptions {
  let date = formatLocalDate(new Date());
  let mode: RequestedMode = "auto";
  let skipExport = false;

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (current === "--date" || current === "-d") {
      const value = args[index + 1];
      if (value === undefined || !isValidDate(value)) {
        throw new Error("Invalid --date value. Expected YYYY-MM-DD.");
      }
      date = value;
      index += 1;
      continue;
    }
    if (current === "--mode") {
      const value = args[index + 1];
      if (value !== "mock" && value !== "live" && value !== "auto") {
        throw new Error("Invalid --mode value. Expected mock, live, or auto.");
      }
      mode = value;
      index += 1;
      continue;
    }
    if (current === "--skip-export") {
      skipExport = true;
      continue;
    }
    if (current === "--help" || current === "-h") {
      process.stdout.write(
        "Usage: tsx scripts/showcase-evidence-closure.ts [--date YYYY-MM-DD] [--mode mock|live|auto] [--skip-export]\n",
      );
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${current}`);
  }

  return {
    date,
    mode,
    skipExport,
  };
}

function previewArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args).map(([key, value]) => {
    if (typeof value === "string" && value.length > 80)
      return `${key}=${value.slice(0, 77)}...`;
    return `${key}=${String(value)}`;
  });
  return entries.join(", ");
}

function estimateOutputTokens(evidencePack: EvidencePack): number {
  return Math.max(1, Math.ceil(JSON.stringify(evidencePack).length / 4));
}

function toRelativePath(path: string): string {
  const normalizedRoot = `${repoRoot}/`;
  return path.startsWith(normalizedRoot)
    ? path.slice(normalizedRoot.length)
    : path;
}

function isValidDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}
