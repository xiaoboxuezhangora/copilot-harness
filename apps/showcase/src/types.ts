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

export interface ShowcaseJiraCurrentUser {
  name?: string;
  key?: string;
  displayName?: string;
  accountId?: string;
}

export interface ShowcaseJiraCurrentUserResponse {
  status: "ready" | "degraded";
  currentUser?: ShowcaseJiraCurrentUser;
  message: string;
  identityScope: "authenticated_principal" | "unknown";
  mayBeServiceAccount: boolean;
}

export interface ShowcaseJiraIssuesResponse {
  status: "ready" | "degraded";
  issues: ShowcaseJiraIssue[];
  message: string;
  source: "jira-api" | "runtime-fallback";
  mcpCallsByTaskId?: Record<string, string[]>;
}

export interface ShowcaseDryRunPlanResponse {
  status: "ready" | "need_more_context" | "degraded";
  runId: string | null;
  issueKey: string | null;
  message: string;
  generatedAt: string;
  dryRun: true;
  codeEvidenceCount: number;
  mcpCalls: string[];
  target: {
    project: string;
    ref: string;
    reason: string;
  } | null;
  artifacts: {
    planMd: string;
    planJson: string;
  } | null;
  planPreview: {
    summary: string;
    bugCause: {
      statement: string;
      confidence: number;
      evidence: string[];
    };
    modificationPlan: {
      goal: string;
      changes: string[];
      files: string[];
    };
    approvalExecution: {
      summary: string;
      actions: string[];
      safeguards: string[];
    };
    steps: string[];
    risks: string[];
    tests: string[];
    codeEvidenceFiles: Array<{
      repo: string;
      branch: string;
      file: string;
      startLine?: number;
      endLine?: number;
      sourceRef?: string;
    }>;
  };
  changePreview: {
    mode: "suggested_patch" | "needs_executor";
    summary: string;
    confidence: number;
    files: Array<{
      repo: string;
      branch: string;
      file: string;
      language: string;
      sourceRef: string;
      reason: string;
      hunks: Array<{
        header: string;
        oldStart: number;
        oldLines: number;
        newStart: number;
        newLines: number;
        rationale: string;
        diffLines: Array<{
          type: "context" | "add" | "remove";
          oldLineNumber?: number;
          newLineNumber?: number;
          content: string;
        }>;
      }>;
    }>;
    limitations: string[];
  };
  warnings: string[];
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
export type RequirementsReviewMode = "replay" | "shadow" | "read-only";

export type RequirementsReviewIssueProfile =
  | "Visual"
  | "Integration"
  | "Workflow"
  | "Billing"
  | "AccessControl"
  | "General";

export type RequirementsReviewSpecType =
  | "VisualDefectSpecV0"
  | "IntegrationSpecV0"
  | "WorkflowRequirementSpecV0";

export type RequirementsReviewLight = "green" | "yellow" | "red";
export type RequirementsReviewGateAxis =
  | "Goal"
  | "Evidence"
  | "Scope"
  | "Testability"
  | "Profile"
  | "Policy";
export type RequirementsReviewSpecStatus =
  | "spec_ready"
  | "gap_blocked"
  | "unsupported_profile";

export interface RequirementsReviewAssertion {
  assertion: string;
  sourceRef: string;
}

export interface RequirementsReviewEvidenceItem {
  evidenceType: "attachment" | "media";
  attachmentId: string;
  filename: string;
  mimeType: string;
  byteLength: number | null;
  sourceRef: string;
}

export interface RequirementsReviewTraceableText {
  text: string;
  sourceRef: string;
}

export interface RequirementsReviewJiraEvidencePackSummary {
  issueKey: string;
  summary: string;
  issueType: string;
  status: string;
  priority: string;
  counts: {
    comments: number;
    fields: number;
    attachments: number;
    mediaEvidence: number;
  };
  sourceRefCoverage: {
    total: number;
    covered: number;
    uncovered: number;
    highlights: string[];
  };
}

export interface RequirementsReviewRouterResult {
  profile: RequirementsReviewIssueProfile;
  confidence: number;
  matchedSignals: Array<{
    kind:
      | "issue_type"
      | "summary_keyword"
      | "description_keyword"
      | "comment_keyword"
      | "attachment_mime"
      | "project_metadata"
      | "field_value"
      | "historical_mapping";
    profile: RequirementsReviewIssueProfile;
    value: string;
    weight: number;
    sourceRef: string;
  }>;
  rationale: string;
  sourceRefs: string[];
  fallbackReason: string | null;
}

export interface RequirementsReviewVisualSpec {
  kind: "VisualDefectSpecV0";
  pageOrComponent: RequirementsReviewTraceableText[];
  actualBehavior: RequirementsReviewTraceableText[];
  expectedBehavior: RequirementsReviewTraceableText[];
  visualEvidence: RequirementsReviewEvidenceItem[];
  baselineEvidence: RequirementsReviewTraceableText[];
  viewport: RequirementsReviewTraceableText[];
  acceptanceAssertions: RequirementsReviewAssertion[];
}

export interface RequirementsReviewIntegrationSpec {
  kind: "IntegrationSpecV0";
  upstreamSystem: RequirementsReviewTraceableText[];
  downstreamSystem: RequirementsReviewTraceableText[];
  apiContract: RequirementsReviewTraceableText[];
  fieldMapping: RequirementsReviewTraceableText[];
  authBoundary: RequirementsReviewTraceableText[];
  failureHandling: RequirementsReviewTraceableText[];
  testFixtures: RequirementsReviewTraceableText[];
  acceptanceAssertions: RequirementsReviewAssertion[];
}

export interface RequirementsReviewWorkflowSpec {
  kind: "WorkflowRequirementSpecV0";
  roles: RequirementsReviewTraceableText[];
  triggerConditions: RequirementsReviewTraceableText[];
  processSteps: RequirementsReviewTraceableText[];
  businessRules: RequirementsReviewTraceableText[];
  exceptionPaths: RequirementsReviewTraceableText[];
  auditTrail: RequirementsReviewTraceableText[];
  acceptanceAssertions: RequirementsReviewAssertion[];
}

export interface RequirementsReviewProfileGap {
  field: string;
  reason: string;
  clarificationQuestion: string;
  sourceRefs: string[];
}

export interface RequirementsReviewProfileSpecResult {
  schemaVersion: "RequirementProfileSpecV0";
  profile: RequirementsReviewIssueProfile;
  status: RequirementsReviewSpecStatus;
  spec:
    | RequirementsReviewVisualSpec
    | RequirementsReviewIntegrationSpec
    | RequirementsReviewWorkflowSpec;
  gaps: RequirementsReviewProfileGap[];
  sourceRefs: string[];
}

export interface RequirementsReviewReqGateAxisResult {
  axis: RequirementsReviewGateAxis;
  light: RequirementsReviewLight;
  reason: string;
  sourceRefs: string[];
}

export interface RequirementsReviewReqGateLayerResult {
  light: RequirementsReviewLight;
  reason: string;
  axisResults: RequirementsReviewReqGateAxisResult[];
  sourceRefs: string[];
}

export interface RequirementsReviewReqGateGap {
  axis: RequirementsReviewGateAxis;
  field: string;
  severity: "blocking" | "warning";
  reason: string;
  clarificationQuestion: string;
  turnGreenCondition: string;
  sourceRefs: string[];
}

export interface RequirementsReviewReqGateHardBlock {
  ruleId: string;
  reason: string;
  sourceRefs: string[];
}

export interface RequirementsReviewReqGateRuleEvaluation {
  ruleId: string;
  passed: boolean;
  reason: string;
  sourceRefs: string[];
}

export interface RequirementsReviewReqGateAuditPayload {
  schemaVersion: "RequirementGateAuditPayloadV0";
  profileSpecStatus: RequirementsReviewSpecStatus;
  usedFallbackProfileSpec: boolean;
  runtimeFlags: {
    attemptedJiraWrite?: boolean;
    highRiskMedicalDomain?: boolean;
  };
  ruleEvaluations: RequirementsReviewReqGateRuleEvaluation[];
  sourceRefs: string[];
}

export interface RequirementsReviewClarificationQuestionViewProjection {
  question: string;
  fromGapAxis: RequirementsReviewGateAxis;
  fromGapField: string;
  sourceRefs: string[];
}

export interface RequirementsReviewReqGateResult {
  schemaVersion: "RequirementGateResultV0";
  profile: RequirementsReviewIssueProfile;
  investigationReady: RequirementsReviewReqGateLayerResult;
  implementationReady: RequirementsReviewReqGateLayerResult;
  gaps: RequirementsReviewReqGateGap[];
  clarificationQuestions: string[];
  clarificationQuestionsViewProjection?: RequirementsReviewClarificationQuestionViewProjection[];
  hardBlocks: RequirementsReviewReqGateHardBlock[];
  sourceRefs: string[];
  auditPayload: RequirementsReviewReqGateAuditPayload;
}

export interface RequirementsReviewSourceRefConclusion {
  conclusion: string;
  sourceRefs: string[];
}

export interface RequirementsReviewSample {
  id: string;
  label: string;
  mode: {
    replay: boolean;
    shadow: boolean;
    readOnly: boolean;
  };
  jiraEvidencePack: RequirementsReviewJiraEvidencePackSummary;
  router: RequirementsReviewRouterResult;
  profileSpecResult: RequirementsReviewProfileSpecResult;
  reqGateResult: RequirementsReviewReqGateResult;
  sourceRefConclusions: RequirementsReviewSourceRefConclusion[];
  requirementsEvalSummary?: string | null;
}

export interface RequirementsReviewSnapshotV1 {
  schemaVersion: "RequirementsReviewSnapshotV1";
  metadata: {
    generatedAt: string;
    source: "fixture-replay-shadow";
    notes: string[];
  };
  samples: RequirementsReviewSample[];
}
