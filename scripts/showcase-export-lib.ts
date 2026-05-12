import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export interface PresenceStat {
  present: number;
  missing: number;
  coverage: number;
  status: "present" | "missing" | "partial" | "unknown";
  notes?: string[];
}

export interface ShowcaseSnapshotV1 {
  schemaVersion: "ShowcaseSnapshotV1";
  metadata: {
    generatedAt: string;
    snapshot_date?: string;
    sourceFiles: string[];
    sampleCount: number;
    phase0Readiness: "READY" | "NOT_READY";
    warnings: string[];
  };
  fieldPresence: Record<string, PresenceStat>;
  tasks: ShowcaseTask[];
  mcpCalls: ShowcaseMcpCall[];
  evidencePacks: ShowcaseEvidencePack[];
  routeChains: ShowcaseRouteChain[];
  jiraIssues: ShowcaseJiraIssue[];
}

export interface ShowcaseTask {
  task_id: string;
  fleet_session_id: string | null;
  parent_task_id: string | null;
  agent_role: string | null;
  candidate_id: string | null;
  worktree_mode: "mock" | "real_disabled" | "未接入" | null;
  turn_state:
    | "done"
    | "continue_current"
    | "await_human"
    | "blocked"
    | "handoff_needed"
    | "unknown";
  execution_mode: string | null;
  role: string | null;
  prompt_version: string | null;
  model: string | null;
  runtime: string | null;
  budget_usage: {
    fanout: number | null;
    fleet_fanout: number | null;
    tool_calls: number | null;
    input_tokens: number | null;
    output_tokens: number | null;
    premium_requests: number | null;
  } | null;
  tool_policy_hit: {
    decision: "allow" | "deny" | "escalate" | "unknown";
    hit_count: number;
  } | null;
  evidence_pack_size: number | null;
  memory_hit_count: number | null;
}

export interface ShowcaseMcpCall {
  task_id: string;
  mcp_server_name: string | null;
  mcp_tool_name: string | null;
  transport_type: string | null;
  side_effect_level: "read" | "write" | "high_risk" | "unknown";
  confirm_required: boolean | null;
  audit_event_name: string | null;
  decision: "allow" | "deny" | "escalate" | "unknown";
  latency_ms: number | null;
  success: boolean | null;
}

export interface ShowcaseEvidencePack {
  task_id: string;
  source_refs: string[];
  confidence: number | null;
  assumptions: Array<{
    statement: string;
    confidence: number | null;
  }>;
  evidence_count: number;
}

export interface ShowcaseRouteChain {
  task_id: string;
  task_class: string | null;
  execution_mode: string | null;
  role: string | null;
  model_tier: string | null;
  concrete_model: string | null;
  route_chain: string[];
}

export interface ShowcaseJiraIssue {
  task_id: string;
  key: string;
  summary: string;
  description: string | null;
  issue_type: string | null;
  status: string | null;
  priority: string | null;
  assignee: string | null;
  project: string | null;
  project_name: string | null;
  affected_versions: string[];
  fix_versions: string[];
  created: string | null;
  updated: string | null;
  due_date: string | null;
  target_version: string | null;
  product_module: string | null;
  defect_category: string | null;
  issue_category: string | null;
  project_source: string | null;
  core_recovery: string | null;
  requirement_released: string | null;
  original_estimate_seconds: number | null;
  remaining_estimate_seconds: number | null;
  time_spent_seconds: number | null;
  labels: string[];
  execution_mode: string | null;
  source_refs: string[];
  confidence: number | null;
}

interface AuditToolCall {
  toolName?: unknown;
  decision?: unknown;
}

interface AuditLine {
  taskId?: unknown;
  fleetSessionId?: unknown;
  parentTaskId?: unknown;
  agentRole?: unknown;
  candidateId?: unknown;
  worktreeMode?: unknown;
  fleet_session_id?: unknown;
  parent_task_id?: unknown;
  agent_role?: unknown;
  candidate_id?: unknown;
  worktree_mode?: unknown;
  turnState?: unknown;
  timestamp?: unknown;
  timestampIso?: unknown;
  promptVersion?: unknown;
  model?: unknown;
  runtime?: unknown;
  budgetUsage?: unknown;
  policyDecision?: unknown;
  toolCalls?: unknown;
}

interface EvalReport {
  summary?: {
    sampleCount?: unknown;
    failedCount?: unknown;
  };
}

const READ_ONLY_JIRA_TOOLS = new Set([
  "getIssue",
  "searchIssues",
  "getComments",
]);
const KNOWN_STATES = new Set([
  "done",
  "continue_current",
  "await_human",
  "blocked",
  "handoff_needed",
]);

export interface ExportOptions {
  repoRoot: string;
  date: string;
}

export interface ExportResult {
  snapshot: ShowcaseSnapshotV1;
  outputPath: string;
  mirroredPath: string | null;
}

interface ParsedEvidencePackLike {
  evidences: unknown[];
  assumptions: unknown[];
  confidence: number | null;
}

interface McpCallEntry {
  call: ShowcaseMcpCall;
  strictIdentity: string;
  looseIdentity: string;
}

export async function exportShowcaseSnapshot(
  options: ExportOptions,
): Promise<ExportResult> {
  const repoRoot = resolve(options.repoRoot);
  const warnings: string[] = [];
  const sourceFiles: string[] = [];

  const reportPath = join(repoRoot, "orchestrator", "eval", "report.json");
  const evalReport = await readJsonFile<EvalReport>(
    reportPath,
    warnings,
    sourceFiles,
  );

  const auditFiles = await collectAuditFiles(repoRoot);
  const auditLines = await readJsonlFiles(auditFiles, warnings, sourceFiles);

  const taskStateFiles = await collectTaskStateFiles(repoRoot);
  const taskStateRecords = await readJsonFiles(
    taskStateFiles,
    warnings,
    sourceFiles,
  );

  const mcpTraceFiles = await collectMcpTraceFiles(repoRoot);
  const realTraceFiles = mcpTraceFiles.filter((file) => !file.includes("demo"));
  const usingDemoTrace = realTraceFiles.length === 0;
  const effectiveTraceFiles = usingDemoTrace
    ? [join(repoRoot, "orchestrator", "docs", "mcp-trace-demo.jsonl")]
    : realTraceFiles;

  if (usingDemoTrace) {
    warnings.push(
      "missing real MCP trace; using demo fixture: orchestrator/docs/mcp-trace-demo.jsonl",
    );
  }

  const traceLines = await readJsonlFiles(
    effectiveTraceFiles,
    warnings,
    sourceFiles,
  );
  const tasks = buildTasks(auditLines, taskStateRecords);
  const mcpCalls = buildMcpCalls(auditLines, traceLines);
  const evidencePacks = buildEvidencePacks(tasks, taskStateRecords);
  const routeChains = buildRouteChains(tasks);
  const jiraIssues = buildJiraIssues(taskStateRecords, evidencePacks);

  const sampleCount = readNumber(evalReport?.summary?.sampleCount) ?? 0;
  const failedCount = readNumber(evalReport?.summary?.failedCount);
  const phase0Readiness = computePhaseReadiness({
    failedCount,
    hasTaskState: taskStateFiles.length > 0,
    hasRealTrace: realTraceFiles.length > 0,
    hasAuditLog: auditFiles.some((file) => file.endsWith("reports/audit.log")),
  });

  if (taskStateFiles.length === 0)
    warnings.push("missing state/tasks/**/*.json");
  if (!auditFiles.some((file) => file.endsWith("reports/audit.log"))) {
    warnings.push(
      "missing reports/audit.log; fallback to orchestrator/docs/audit-sample*.jsonl",
    );
  }
  if (phase0Readiness === "NOT_READY")
    warnings.push("phase0 readiness is NOT_READY");

  const snapshot: ShowcaseSnapshotV1 = {
    schemaVersion: "ShowcaseSnapshotV1",
    metadata: {
      generatedAt: new Date().toISOString(),
      snapshot_date: options.date,
      sourceFiles: unique(
        sourceFiles.map((path) => toRelative(repoRoot, path)),
      ),
      sampleCount,
      phase0Readiness,
      warnings: unique(warnings),
    },
    fieldPresence: {},
    tasks,
    mcpCalls,
    evidencePacks,
    routeChains,
    jiraIssues,
  };

  snapshot.fieldPresence = buildFieldPresence(snapshot);

  const outputPath = join(
    repoRoot,
    "reports",
    "showcase",
    options.date,
    "snapshot.json",
  );
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");

  const showcaseGeneratedPath = join(
    repoRoot,
    "apps",
    "showcase",
    "src",
    "generated",
    "snapshot.json",
  );
  let mirroredPath: string | null = null;
  if (await exists(dirname(showcaseGeneratedPath))) {
    await mkdir(dirname(showcaseGeneratedPath), { recursive: true });
    await writeFile(
      showcaseGeneratedPath,
      `${JSON.stringify(snapshot, null, 2)}\n`,
      "utf8",
    );
    mirroredPath = showcaseGeneratedPath;
  }

  return {
    snapshot,
    outputPath,
    mirroredPath,
  };
}

export function parseJsonlContent(
  content: string,
  filePath: string,
  warnings: string[],
): unknown[] {
  const records: unknown[] = [];
  const lines = content.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? "";
    if (line.length === 0) continue;
    try {
      records.push(JSON.parse(line) as unknown);
    } catch {
      warnings.push(
        `invalid jsonl line skipped: ${toPortablePath(filePath)}:${index + 1}`,
      );
    }
  }
  return records;
}

export function buildTasks(
  auditLines: unknown[],
  taskStateRecords: unknown[],
): ShowcaseTask[] {
  const tasksById = new Map<string, ShowcaseTask>();
  const taskStateById = new Map<string, Record<string, unknown>>();

  for (const record of taskStateRecords) {
    const object = asRecord(record);
    if (object === undefined) continue;
    const taskId = readString(object.taskId) ?? readString(object.task_id);
    if (taskId !== undefined) taskStateById.set(taskId, object);
  }

  for (const line of auditLines) {
    const audit = asRecord(line) as AuditLine | undefined;
    if (audit === undefined) continue;
    const taskId = readString(audit.taskId);
    if (taskId === undefined) continue;

    const turnState = readString(audit.turnState);
    const toolCalls = normalizeToolCalls(audit.toolCalls);
    const policyDecision = normalizeDecision(audit.policyDecision);
    const derivedDecision = aggregateDecision(toolCalls, policyDecision);
    const budgetUsage = normalizeBudgetUsage(audit.budgetUsage);
    const taskStateRecord = taskStateById.get(taskId);
    const parsedEvidencePack = parseEvidencePackLike(taskStateRecord);
    const evidencePackSize =
      readNumber(taskStateRecord?.evidence_pack_size) ??
      parsedEvidencePack.evidences.length;

    tasksById.set(taskId, {
      task_id: taskId,
      fleet_session_id:
        readString(audit.fleetSessionId) ??
        readString(audit.fleet_session_id) ??
        null,
      parent_task_id:
        readString(audit.parentTaskId) ??
        readString(audit.parent_task_id) ??
        null,
      agent_role:
        readString(audit.agentRole) ?? readString(audit.agent_role) ?? null,
      candidate_id:
        readString(audit.candidateId) ?? readString(audit.candidate_id) ?? null,
      worktree_mode: normalizeWorktreeMode(
        readString(audit.worktreeMode) ?? readString(audit.worktree_mode),
      ),
      turn_state: normalizeTurnState(turnState),
      execution_mode: deriveExecutionMode(taskId, taskStateRecord),
      role: deriveRole(taskStateRecord),
      prompt_version: readString(audit.promptVersion) ?? null,
      model: readString(audit.model) ?? null,
      runtime: readString(asRecord(audit.runtime)?.name) ?? null,
      budget_usage: budgetUsage,
      tool_policy_hit:
        toolCalls.length === 0 && derivedDecision === "unknown"
          ? null
          : {
              decision: derivedDecision,
              hit_count: toolCalls.length,
            },
      evidence_pack_size: evidencePackSize,
      memory_hit_count: readNumber(taskStateRecord?.memory_hit_count) ?? null,
    });
  }

  for (const [taskId, record] of taskStateById.entries()) {
    if (tasksById.has(taskId)) continue;
    const parsedEvidencePack = parseEvidencePackLike(record);
    tasksById.set(taskId, {
      task_id: taskId,
      fleet_session_id:
        readString(record.fleet_session_id) ??
        readString(record.fleetSessionId) ??
        null,
      parent_task_id:
        readString(record.parent_task_id) ??
        readString(record.parentTaskId) ??
        null,
      agent_role:
        readString(record.agent_role) ?? readString(record.agentRole) ?? null,
      candidate_id:
        readString(record.candidate_id) ??
        readString(record.candidateId) ??
        null,
      worktree_mode: normalizeWorktreeMode(
        readString(record.worktree_mode) ?? readString(record.worktreeMode),
      ),
      turn_state: normalizeTurnState(
        readString(record.turn_state) ?? readString(record.turnState),
      ),
      execution_mode: deriveExecutionMode(taskId, record),
      role: deriveRole(record),
      prompt_version:
        readString(record.prompt_version) ??
        readString(record.promptVersion) ??
        null,
      model: readString(record.model) ?? null,
      runtime: readString(record.runtime) ?? null,
      budget_usage: null,
      tool_policy_hit: null,
      evidence_pack_size:
        readNumber(record.evidence_pack_size) ??
        parsedEvidencePack.evidences.length,
      memory_hit_count: readNumber(record.memory_hit_count) ?? null,
    });
  }

  return [...tasksById.values()].sort((left, right) =>
    left.task_id.localeCompare(right.task_id),
  );
}

export function buildMcpCalls(
  auditLines: unknown[],
  traceLines: unknown[],
): ShowcaseMcpCall[] {
  const traceEntries = buildMcpCallsFromTrace(traceLines);
  const traceIdentitySet = new Set<string>();
  for (const entry of traceEntries) {
    traceIdentitySet.add(entry.strictIdentity);
    traceIdentitySet.add(entry.looseIdentity);
  }

  const auditEntries = buildMcpCallsFromAudit(auditLines).filter((entry) => {
    return (
      !traceIdentitySet.has(entry.strictIdentity) &&
      !traceIdentitySet.has(entry.looseIdentity)
    );
  });

  return [
    ...traceEntries.map((entry) => entry.call),
    ...auditEntries.map((entry) => entry.call),
  ];
}

function buildMcpCallsFromAudit(auditLines: unknown[]): McpCallEntry[] {
  const calls: McpCallEntry[] = [];
  for (const line of auditLines) {
    const audit = asRecord(line) as AuditLine | undefined;
    if (audit === undefined) continue;
    const taskId = readString(audit.taskId);
    if (taskId === undefined) continue;
    for (const toolCall of normalizeToolCalls(audit.toolCalls)) {
      const toolName = readString(toolCall.toolName) ?? null;
      const toolCallRecord = asRecord(toolCall);
      const discriminator =
        readString(toolCallRecord?.timestampIso) ??
        readString(toolCallRecord?.timestamp) ??
        readString(audit.timestampIso) ??
        readString(audit.timestamp);
      const call: ShowcaseMcpCall = {
        task_id: taskId,
        mcp_server_name: deriveMcpServerName(toolName),
        mcp_tool_name: toolName,
        transport_type: null,
        side_effect_level: deriveSideEffectLevel(toolName, undefined),
        confirm_required: null,
        audit_event_name: null,
        decision: normalizeDecision(toolCall.decision),
        latency_ms: null,
        success: null,
      };
      calls.push({
        call,
        strictIdentity: buildMcpCallIdentity(taskId, toolName, discriminator),
        looseIdentity: buildMcpCallIdentity(taskId, toolName),
      });
    }
  }
  return calls;
}

function buildMcpCallsFromTrace(traceLines: unknown[]): McpCallEntry[] {
  const calls: McpCallEntry[] = [];
  for (const line of traceLines) {
    const trace = asRecord(line);
    if (trace === undefined) continue;
    const taskId =
      readString(trace.task_id) ?? readString(trace.taskId) ?? "unknown";
    const toolName =
      readString(trace.mcp_tool_name) ?? readString(trace.mcpToolName) ?? null;
    const sideEffectFromTrace =
      readString(trace.side_effect_level) ??
      readString(trace.sideEffectLevel) ??
      undefined;
    const discriminator =
      readString(trace.trace_id) ??
      readString(trace.traceId) ??
      readString(trace.event_id) ??
      readString(trace.eventId) ??
      readString(trace.timestamp) ??
      readString(trace.timestampIso) ??
      readString(trace.audit_event_name) ??
      readString(trace.auditEventName);

    const call: ShowcaseMcpCall = {
      task_id: taskId,
      mcp_server_name:
        readString(trace.mcp_server_name) ??
        readString(trace.mcpServerName) ??
        null,
      mcp_tool_name: toolName,
      transport_type:
        readString(trace.transport_type) ??
        readString(trace.transportType) ??
        null,
      side_effect_level: deriveSideEffectLevel(toolName, sideEffectFromTrace),
      confirm_required:
        readBoolean(trace.confirm_required) ??
        readBoolean(trace.confirmRequired) ??
        null,
      audit_event_name:
        readString(trace.audit_event_name) ??
        readString(trace.auditEventName) ??
        null,
      decision: normalizeDecision(trace.decision),
      latency_ms:
        readNumber(trace.latency_ms) ?? readNumber(trace.latencyMs) ?? null,
      success: readBoolean(trace.success) ?? null,
    };
    calls.push({
      call,
      strictIdentity: buildMcpCallIdentity(taskId, toolName, discriminator),
      looseIdentity: buildMcpCallIdentity(taskId, toolName),
    });
  }
  return calls;
}

function buildMcpCallIdentity(
  taskId: string,
  toolName: string | null,
  discriminator?: string | null,
): string {
  const base = `${taskId}::${toolName ?? "unknown"}`;
  if (
    discriminator === undefined ||
    discriminator === null ||
    discriminator.length === 0
  ) {
    return base;
  }
  return `${base}::${discriminator}`;
}

export function buildEvidencePacks(
  tasks: ShowcaseTask[],
  taskStateRecords: unknown[],
): ShowcaseEvidencePack[] {
  const packs = new Map<string, ShowcaseEvidencePack>();
  for (const record of taskStateRecords) {
    const object = asRecord(record);
    if (object === undefined) continue;
    const taskId = readString(object.taskId) ?? readString(object.task_id);
    if (taskId === undefined) continue;

    const parsedEvidencePack = parseEvidencePackLike(object);
    const sourceRefs = parsedEvidencePack.evidences
      .map(
        (item) =>
          readString(asRecord(item)?.source_ref) ??
          readString(asRecord(item)?.sourceRef),
      )
      .filter((value): value is string => value !== undefined);
    packs.set(taskId, {
      task_id: taskId,
      source_refs: sourceRefs,
      confidence: parsedEvidencePack.confidence,
      assumptions: parsedEvidencePack.assumptions
        .map((item) => {
          const assumption = asRecord(item);
          if (assumption === undefined) return undefined;
          const statement = readString(assumption.statement);
          if (statement === undefined) return undefined;
          return {
            statement,
            confidence: readNumber(assumption.confidence) ?? null,
          };
        })
        .filter(
          (value): value is { statement: string; confidence: number | null } =>
            value !== undefined,
        ),
      evidence_count: parsedEvidencePack.evidences.length,
    });
  }

  for (const task of tasks) {
    if (packs.has(task.task_id)) continue;
    packs.set(task.task_id, {
      task_id: task.task_id,
      source_refs: [],
      confidence: null,
      assumptions: [],
      evidence_count: 0,
    });
  }

  return [...packs.values()].sort((left, right) =>
    left.task_id.localeCompare(right.task_id),
  );
}

export function buildJiraIssues(
  taskStateRecords: unknown[],
  evidencePacks: ShowcaseEvidencePack[],
): ShowcaseJiraIssue[] {
  const evidenceByTaskId = new Map(
    evidencePacks.map((pack) => [pack.task_id, pack]),
  );
  const issues: ShowcaseJiraIssue[] = [];

  for (const record of taskStateRecords) {
    const object = asRecord(record);
    if (object === undefined) continue;
    const taskId = readString(object.taskId) ?? readString(object.task_id);
    if (taskId === undefined) continue;
    const evidencePack = evidenceByTaskId.get(taskId);

    for (const jiraIssue of collectJiraIssueRecords(object)) {
      const key = readString(jiraIssue.key);
      const summary = readString(jiraIssue.summary);
      if (key === undefined || summary === undefined) continue;

      const assignee = asRecord(jiraIssue.assignee);
      const project = asRecord(jiraIssue.project);
      const timeTracking = asRecord(jiraIssue.timeTracking);
      issues.push({
        task_id: taskId,
        key,
        summary,
        description: readString(jiraIssue.description) ?? null,
        issue_type: readString(jiraIssue.issueType) ?? null,
        status: readString(jiraIssue.status) ?? null,
        priority: readString(jiraIssue.priority) ?? null,
        assignee:
          readString(assignee?.displayName) ??
          readString(assignee?.name) ??
          readString(jiraIssue.assignee) ??
          null,
        project:
          readString(project?.key) ?? readString(jiraIssue.project) ?? null,
        project_name: readString(project?.name) ?? null,
        affected_versions: readStringArray(jiraIssue.affectedVersions),
        fix_versions: readStringArray(jiraIssue.fixVersions),
        created: readString(jiraIssue.created) ?? null,
        updated: readString(jiraIssue.updated) ?? null,
        due_date: readString(jiraIssue.dueDate) ?? null,
        target_version: readString(jiraIssue.targetVersion) ?? null,
        product_module: readString(jiraIssue.productModule) ?? null,
        defect_category: readString(jiraIssue.defectCategory) ?? null,
        issue_category: readString(jiraIssue.issueCategory) ?? null,
        project_source: readString(jiraIssue.projectSource) ?? null,
        core_recovery: readString(jiraIssue.coreRecovery) ?? null,
        requirement_released: readString(jiraIssue.requirementReleased) ?? null,
        original_estimate_seconds:
          readNumber(timeTracking?.originalEstimateSeconds) ?? null,
        remaining_estimate_seconds:
          readNumber(timeTracking?.remainingEstimateSeconds) ?? null,
        time_spent_seconds: readNumber(timeTracking?.timeSpentSeconds) ?? null,
        labels: readStringArray(jiraIssue.labels),
        execution_mode: deriveExecutionMode(taskId, object),
        source_refs: evidencePack?.source_refs ?? [],
        confidence: evidencePack?.confidence ?? null,
      });
    }
  }

  return uniqueBy(issues, (issue) => issue.key).sort((left, right) =>
    left.key.localeCompare(right.key),
  );
}

function collectJiraIssueRecords(
  taskStateRecord: Record<string, unknown>,
): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  const append = (value: unknown): void => {
    const record = asRecord(value);
    if (record !== undefined) records.push(record);
  };

  append(taskStateRecord.jira_issue);
  append(taskStateRecord.jiraIssue);

  for (const value of readArray(taskStateRecord.jira_issues)) append(value);
  for (const value of readArray(taskStateRecord.jiraIssues)) append(value);

  return records;
}

function parseEvidencePackLike(
  record: Record<string, unknown> | undefined,
): ParsedEvidencePackLike {
  const evidencePack =
    asRecord(record?.evidencePack) ?? asRecord(record?.evidence_pack);
  const evidences = readArray(evidencePack?.evidences ?? record?.evidences);
  const assumptions = readArray(
    evidencePack?.assumptions ?? record?.assumptions,
  );
  const confidence =
    readNumber(evidencePack?.confidence) ??
    readNumber(record?.confidence) ??
    null;
  return {
    evidences,
    assumptions,
    confidence,
  };
}

export function buildRouteChains(tasks: ShowcaseTask[]): ShowcaseRouteChain[] {
  return tasks.map((task) => {
    const taskClass = deriveTaskClass(task.task_id);
    const modelTier = deriveModelTier(task.model);
    const role = task.role ?? "unknown";
    const executionMode = task.execution_mode ?? "unknown";
    const concreteModel = task.model ?? "unknown";
    return {
      task_id: task.task_id,
      task_class: taskClass,
      execution_mode: task.execution_mode,
      role: task.role,
      model_tier: modelTier,
      concrete_model: task.model,
      route_chain: [
        taskClass ?? "unknown",
        executionMode,
        role,
        modelTier ?? "unknown",
        concreteModel,
      ],
    };
  });
}

export function buildFieldPresence(
  snapshot: ShowcaseSnapshotV1,
): Record<string, PresenceStat> {
  const stats: Record<string, PresenceStat> = {};
  const add = (key: string, values: unknown[], notes?: string[]): void => {
    const present = values.filter((value) => isPresent(value)).length;
    const total = values.length;
    const missing = total - present;
    const coverage = total === 0 ? 0 : round3(present / total);
    stats[key] = {
      present,
      missing,
      coverage,
      status: derivePresenceStatus(present, missing, total),
      ...(notes !== undefined ? { notes } : {}),
    };
  };

  add("metadata.generatedAt", [snapshot.metadata.generatedAt]);
  add("metadata.sourceFiles", [snapshot.metadata.sourceFiles]);
  add("metadata.sampleCount", [snapshot.metadata.sampleCount]);
  add("metadata.phase0Readiness", [snapshot.metadata.phase0Readiness]);
  add("metadata.warnings", [snapshot.metadata.warnings]);

  add(
    "tasks.fleet_session_id",
    snapshot.tasks.map((item) => item.fleet_session_id),
  );
  add(
    "tasks.parent_task_id",
    snapshot.tasks.map((item) => item.parent_task_id),
  );
  add(
    "tasks.agent_role",
    snapshot.tasks.map((item) => item.agent_role),
  );
  add(
    "tasks.candidate_id",
    snapshot.tasks.map((item) => item.candidate_id),
  );
  add(
    "tasks.worktree_mode",
    snapshot.tasks.map((item) => item.worktree_mode),
  );
  add(
    "tasks.task_id",
    snapshot.tasks.map((item) => item.task_id),
  );
  add(
    "tasks.turn_state",
    snapshot.tasks.map((item) => item.turn_state),
  );
  add(
    "tasks.execution_mode",
    snapshot.tasks.map((item) => item.execution_mode),
  );
  add(
    "tasks.role",
    snapshot.tasks.map((item) => item.role),
  );
  add(
    "tasks.prompt_version",
    snapshot.tasks.map((item) => item.prompt_version),
  );
  add(
    "tasks.model",
    snapshot.tasks.map((item) => item.model),
  );
  add(
    "tasks.runtime",
    snapshot.tasks.map((item) => item.runtime),
  );
  add(
    "tasks.budget_usage",
    snapshot.tasks.map((item) => item.budget_usage),
  );
  add(
    "tasks.tool_policy_hit",
    snapshot.tasks.map((item) => item.tool_policy_hit),
  );
  add(
    "tasks.evidence_pack_size",
    snapshot.tasks.map((item) => item.evidence_pack_size),
  );
  add(
    "tasks.memory_hit_count",
    snapshot.tasks.map((item) => item.memory_hit_count),
  );

  add(
    "mcpCalls.task_id",
    snapshot.mcpCalls.map((item) => item.task_id),
  );
  add(
    "mcpCalls.mcp_server_name",
    snapshot.mcpCalls.map((item) => item.mcp_server_name),
  );
  add(
    "mcpCalls.mcp_tool_name",
    snapshot.mcpCalls.map((item) => item.mcp_tool_name),
  );
  add(
    "mcpCalls.transport_type",
    snapshot.mcpCalls.map((item) => item.transport_type),
  );
  add(
    "mcpCalls.side_effect_level",
    snapshot.mcpCalls.map((item) => item.side_effect_level),
  );
  add(
    "mcpCalls.confirm_required",
    snapshot.mcpCalls.map((item) => item.confirm_required),
  );
  add(
    "mcpCalls.audit_event_name",
    snapshot.mcpCalls.map((item) => item.audit_event_name),
  );
  add(
    "mcpCalls.decision",
    snapshot.mcpCalls.map((item) => item.decision),
  );
  add(
    "mcpCalls.latency_ms",
    snapshot.mcpCalls.map((item) => item.latency_ms),
  );
  add(
    "mcpCalls.success",
    snapshot.mcpCalls.map((item) => item.success),
  );

  add(
    "evidencePacks.task_id",
    snapshot.evidencePacks.map((item) => item.task_id),
  );
  add(
    "evidencePacks.source_refs",
    snapshot.evidencePacks.map((item) => item.source_refs),
  );
  add(
    "evidencePacks.confidence",
    snapshot.evidencePacks.map((item) => item.confidence),
  );
  add(
    "evidencePacks.assumptions",
    snapshot.evidencePacks.map((item) => item.assumptions),
  );
  add(
    "evidencePacks.evidence_count",
    snapshot.evidencePacks.map((item) => item.evidence_count),
  );

  add(
    "routeChains.task_id",
    snapshot.routeChains.map((item) => item.task_id),
  );
  add(
    "routeChains.task_class",
    snapshot.routeChains.map((item) => item.task_class),
  );
  add(
    "routeChains.execution_mode",
    snapshot.routeChains.map((item) => item.execution_mode),
  );
  add(
    "routeChains.role",
    snapshot.routeChains.map((item) => item.role),
  );
  add(
    "routeChains.model_tier",
    snapshot.routeChains.map((item) => item.model_tier),
  );
  add(
    "routeChains.concrete_model",
    snapshot.routeChains.map((item) => item.concrete_model),
  );
  add(
    "routeChains.route_chain",
    snapshot.routeChains.map((item) => item.route_chain),
  );

  add(
    "jiraIssues.key",
    snapshot.jiraIssues.map((item) => item.key),
  );
  add(
    "jiraIssues.summary",
    snapshot.jiraIssues.map((item) => item.summary),
  );
  add(
    "jiraIssues.status",
    snapshot.jiraIssues.map((item) => item.status),
  );
  add(
    "jiraIssues.priority",
    snapshot.jiraIssues.map((item) => item.priority),
  );
  add(
    "jiraIssues.execution_mode",
    snapshot.jiraIssues.map((item) => item.execution_mode),
  );

  return stats;
}

async function collectAuditFiles(repoRoot: string): Promise<string[]> {
  const files = [
    join(repoRoot, "reports", "audit.log"),
    join(repoRoot, "orchestrator", "docs", "audit-sample.jsonl"),
    join(repoRoot, "orchestrator", "docs", "audit-sample-w3.jsonl"),
  ];

  const existing: string[] = [];
  for (const file of files) {
    if (await exists(file)) existing.push(file);
  }
  return existing;
}

async function collectTaskStateFiles(repoRoot: string): Promise<string[]> {
  const stateRoot = join(repoRoot, "state", "tasks");
  if (!(await exists(stateRoot))) return [];
  return walkFiles(stateRoot, (path) => path.endsWith(".json"));
}

async function collectMcpTraceFiles(repoRoot: string): Promise<string[]> {
  const files = await walkFiles(repoRoot, (path) => {
    if (!path.endsWith(".jsonl")) return false;
    const name = path.toLowerCase();
    return name.includes("mcp") && name.includes("trace");
  });
  return files;
}

async function readJsonlFiles(
  files: string[],
  warnings: string[],
  sourceFiles: string[],
): Promise<unknown[]> {
  const lines: unknown[] = [];
  for (const file of files) {
    if (!(await exists(file))) {
      warnings.push(`missing input file: ${toPortablePath(file)}`);
      continue;
    }
    sourceFiles.push(file);
    const content = await readFile(file, "utf8");
    lines.push(...parseJsonlContent(content, file, warnings));
  }
  return lines;
}

async function readJsonFiles(
  files: string[],
  warnings: string[],
  sourceFiles: string[],
): Promise<unknown[]> {
  const records: unknown[] = [];
  for (const file of files) {
    const parsed = await readJsonFile<unknown>(file, warnings, sourceFiles);
    if (parsed !== undefined) records.push(parsed);
  }
  return records;
}

async function readJsonFile<T>(
  file: string,
  warnings: string[],
  sourceFiles: string[],
): Promise<T | undefined> {
  if (!(await exists(file))) {
    warnings.push(`missing input file: ${toPortablePath(file)}`);
    return undefined;
  }
  try {
    sourceFiles.push(file);
    const content = await readFile(file, "utf8");
    return JSON.parse(content) as T;
  } catch {
    warnings.push(`invalid json file skipped: ${toPortablePath(file)}`);
    return undefined;
  }
}

async function walkFiles(
  root: string,
  matcher: (path: string) => boolean,
): Promise<string[]> {
  const result: string[] = [];
  const queue = [root];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (
        entry.name === ".git" ||
        entry.name === "node_modules" ||
        entry.name === "dist"
      ) {
        continue;
      }
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      if (entry.isFile() && matcher(fullPath)) result.push(fullPath);
    }
  }
  return result.sort((left, right) => left.localeCompare(right));
}

function computePhaseReadiness(input: {
  failedCount: number | null;
  hasTaskState: boolean;
  hasRealTrace: boolean;
  hasAuditLog: boolean;
}): "READY" | "NOT_READY" {
  if (!input.hasTaskState || !input.hasRealTrace || !input.hasAuditLog)
    return "NOT_READY";
  if (input.failedCount !== null && input.failedCount > 0) return "NOT_READY";
  return "READY";
}

function normalizeTurnState(
  value: string | undefined,
): ShowcaseTask["turn_state"] {
  if (value !== undefined && KNOWN_STATES.has(value)) {
    return value as ShowcaseTask["turn_state"];
  }
  return "unknown";
}

function normalizeToolCalls(value: unknown): AuditToolCall[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => (asRecord(item) ?? {}) as AuditToolCall);
}

function normalizeBudgetUsage(value: unknown): ShowcaseTask["budget_usage"] {
  const record = asRecord(value);
  if (record === undefined) return null;
  return {
    fanout: readNumber(record.fanout) ?? null,
    fleet_fanout:
      readNumber(record.fleetFanout) ?? readNumber(record.fleet_fanout) ?? null,
    tool_calls:
      readNumber(record.toolCalls) ?? readNumber(record.tool_calls) ?? null,
    input_tokens:
      readNumber(record.inputTokens) ?? readNumber(record.input_tokens) ?? null,
    output_tokens:
      readNumber(record.outputTokens) ??
      readNumber(record.output_tokens) ??
      null,
    premium_requests:
      readNumber(record.premiumRequests) ??
      readNumber(record.premium_requests) ??
      null,
  };
}

function normalizeWorktreeMode(
  value: string | undefined,
): ShowcaseTask["worktree_mode"] {
  if (value === "mock" || value === "real_disabled") return value;
  return "未接入";
}

function aggregateDecision(
  toolCalls: AuditToolCall[],
  policyDecision: ShowcaseMcpCall["decision"],
): ShowcaseMcpCall["decision"] {
  if (policyDecision !== "unknown") return policyDecision;
  const decisions = toolCalls.map((item) => normalizeDecision(item.decision));
  if (decisions.includes("escalate")) return "escalate";
  if (decisions.includes("deny")) return "deny";
  if (decisions.includes("allow")) return "allow";
  return "unknown";
}

function normalizeDecision(value: unknown): ShowcaseMcpCall["decision"] {
  const text = readString(value);
  if (text === "allow" || text === "deny" || text === "escalate") return text;
  return "unknown";
}

function deriveExecutionMode(
  taskId: string,
  record?: Record<string, unknown>,
): string | null {
  const fromRecord =
    readString(record?.execution_mode) ?? readString(record?.executionMode);
  if (fromRecord !== undefined) return fromRecord;
  if (taskId.includes("-mock")) return "mock";
  if (taskId.includes("-live")) return "live";
  return "unknown";
}

function deriveRole(
  record: Record<string, unknown> | undefined,
): string | null {
  if (record === undefined) return "unknown";
  return (
    readString(record.role) ??
    readString(record.agent_role) ??
    readString(record.agentRole) ??
    "unknown"
  );
}

function deriveMcpServerName(toolName: string | null): string | null {
  if (toolName !== null && READ_ONLY_JIRA_TOOLS.has(toolName))
    return "jira-reader";
  return null;
}

function deriveSideEffectLevel(
  toolName: string | null,
  fromTrace: string | undefined,
): ShowcaseMcpCall["side_effect_level"] {
  if (
    fromTrace === "read" ||
    fromTrace === "write" ||
    fromTrace === "high_risk"
  )
    return fromTrace;
  if (toolName !== null && READ_ONLY_JIRA_TOOLS.has(toolName)) return "read";
  return "unknown";
}

function deriveTaskClass(taskId: string): string | null {
  const split = taskId.split("-");
  if (split.length === 0) return "unknown";
  const first = split[0];
  return first !== undefined && first.length > 0 ? first : "unknown";
}

function deriveModelTier(model: string | null): string | null {
  if (model === null) return "unknown";
  if (model.includes("mini")) return "mini";
  if (model.includes("nano")) return "nano";
  if (model.includes("gpt-5")) return "standard";
  return "unknown";
}

function derivePresenceStatus(
  present: number,
  missing: number,
  total: number,
): PresenceStat["status"] {
  if (total === 0) return "unknown";
  if (present === total) return "present";
  if (missing === total) return "missing";
  return "partial";
}

function isPresent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string")
    return value.length > 0 && value !== "unknown" && value !== "未接入";
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return undefined;
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

async function exists(path: string): Promise<boolean> {
  try {
    const current = await stat(path);
    return current.isFile() || current.isDirectory();
  } catch {
    return false;
  }
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function uniqueBy<T>(values: T[], identity: (value: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const value of values) {
    const key = identity(value);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function toRelative(root: string, path: string): string {
  const normalizedRoot = `${toPortablePath(root)}/`;
  const portable = toPortablePath(path);
  if (portable.startsWith(normalizedRoot))
    return portable.slice(normalizedRoot.length);
  return portable;
}

function toPortablePath(path: string): string {
  return path.replaceAll("\\", "/");
}
