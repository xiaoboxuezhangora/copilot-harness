export interface PresenceStat {
  present: number;
  missing: number;
  coverage: number;
  status: "present" | "missing" | "partial" | "unknown";
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
  arena?: ShowcaseArenaSummary | null;
}

export interface ShowcaseArenaSummary {
  candidate_count: number | null;
  winner: string | null;
  scores: {
    correctness: number;
    style: number;
    testCoverage: number;
    diffMinimality: number;
  } | null;
  consistency_delta: number | null;
  archive_path: string | null;
  scorer_mode: "mock" | "未接入" | null;
  real_scorer: "未接入" | null;
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
  issue_type?: string | null;
  status: string | null;
  priority: string | null;
  assignee: string | null;
  project: string | null;
  project_name?: string | null;
  affected_versions?: string[];
  fix_versions?: string[];
  created?: string | null;
  updated?: string | null;
  due_date?: string | null;
  target_version?: string | null;
  product_module?: string | null;
  defect_category?: string | null;
  issue_category?: string | null;
  project_source?: string | null;
  core_recovery?: string | null;
  requirement_released?: string | null;
  original_estimate_seconds?: number | null;
  remaining_estimate_seconds?: number | null;
  time_spent_seconds?: number | null;
  labels: string[];
  execution_mode: string | null;
  source_refs: string[];
  confidence: number | null;
}

export type ShowcaseIntegrationTone = "ok" | "warn" | "danger" | "neutral";

export interface ShowcaseIntegrationEndpointStatus {
  id: "jira" | "gitlab" | "codeRetrieval" | "mcp";
  label: string;
  configured: boolean;
  tone: ShowcaseIntegrationTone;
  displayUrl: string | null;
  credentialState: "present" | "missing" | "not_required";
  details: string[];
  requiredEnv: string[];
  applyMode: string;
}

export interface ShowcaseIntegrationStatus {
  schemaVersion: "ShowcaseIntegrationStatusV1";
  generatedAt: string;
  source: "runtime-env";
  directApplySupported: false;
  restartRequired: true;
  endpoints: ShowcaseIntegrationEndpointStatus[];
}

export interface ShowcaseSnapshotV1 {
  schemaVersion: "ShowcaseSnapshotV1";
  metadata: {
    generatedAt: string;
    snapshotDate?: string;
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
  jiraIssues?: ShowcaseJiraIssue[];
  integrationStatus?: ShowcaseIntegrationStatus;
}
