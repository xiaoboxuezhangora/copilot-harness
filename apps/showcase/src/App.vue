<script setup lang="ts">
import * as THREE from "three";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import mascotVirtualAssistant from "./assets/mascot/cow-hook-guide.png";
import mascotStrategyAssistant from "./assets/mascot/cow-chief-presenter.png";
import rawSnapshot from "./generated/snapshot.json";
import type {
  ShowcaseArenaSummary,
  ShowcaseIntegrationEndpointStatus,
  ShowcaseIntegrationStatus,
  ShowcaseJiraIssue,
  ShowcaseSnapshotV1,
} from "./types";

type Tone = "ok" | "warn" | "danger" | "neutral";

interface KpiCard {
  id: string;
  label: string;
  value: string;
  caption: string;
  trend: string;
  tone: Tone;
  bars: number[];
}

interface EngineeringIssue {
  taskId: string;
  key: string;
  summary: string;
  project: string;
  projectName: string;
  fixVersion: string;
  sprint: string;
  epic: string;
  issueType: string;
  status: string;
  priority: string;
  assignee: string;
  assigneeRole: string;
  storyPoints: number;
  component: string;
  affectedVersion?: string;
  targetVersion?: string;
  productModule?: string;
  defectCategory?: string;
  issueCategory?: string;
  projectSource?: string;
  coreRecovery?: string;
  requirementReleased?: string;
  created?: string;
  updated?: string;
  dueDate?: string;
  originalEstimateSeconds?: number;
  remainingEstimateSeconds?: number;
  timeSpentSeconds?: number;
  labels: string[];
  gitlabMr: string;
  gitlabScore: number | null;
  mrUrl: string;
  riskLevel: string;
  riskTone: Tone;
  observedTime: string;
  description: string;
  expectation: string;
  impactedRepos: string[];
  impactedModules: string[];
  aiUnderstanding: string[];
  plan: Array<{ step: string; owner: string; due: string; done: boolean }>;
  skills: string[];
  mcpCalls: string[];
  evidence: Array<{ name: string; size: string }>;
  reasoning: string[];
  decision: string;
}

interface DecisionItem {
  id: string;
  kind: string;
  issueKey: string;
  title: string;
  impact: string;
  action: string;
  tone: Tone;
}

interface AssistantMessage {
  id: string;
  role: "assistant" | "user";
  text: string;
  time: string;
}

interface BusinessSkillMatch {
  id: string;
  label: string;
  skillId: string;
  confidence: string;
  repo: string;
  branch: string;
  reason: string;
  signals: string[];
  analysisFocus: string[];
}

interface CodeAnalysisFlowStep {
  label: string;
  detail: string;
}

interface ModuleNotice {
  module: string;
  title: string;
  detail: string;
}

type DrawerTab = "overview" | "skills" | "steps" | "evidence" | "mr";
type ThemeMode = "day" | "night";
type DispatchStatus =
  | "待编排"
  | "草稿"
  | "Skill 已分配"
  | "Agent 执行中"
  | "MR 待 Review"
  | "等待人工确认"
  | "已完成"
  | "失败";
type OrchestrationStatus =
  | "待开始"
  | "编排中"
  | "等待人工处理"
  | "已完成"
  | "失败";
type StageRuntimeStatus = "pending" | "running" | "waiting" | "done" | "failed";
type EventLevel = "info" | "warn" | "error" | "success";
type ArtifactStatus = "pending" | "running" | "ready" | "failed";

interface CalendarDay {
  key: string;
  label: number;
  muted: boolean;
  today: boolean;
  hasPlan: boolean;
}

interface SkillCandidate {
  id: string;
  name: string;
  agent: string;
  mcp: string;
  input: string;
  estimate: number;
  gate: string;
  tags: string[];
}

interface PipelineCard {
  key: string;
  summary: string;
  skills: string[];
  agent: string;
  status: DispatchStatus;
  duration: string;
  tone: Tone;
  preview?: boolean;
}

interface PipelineColumn {
  id: string;
  title: string;
  count: number;
  cards: PipelineCard[];
}

interface AuditRecord {
  id: string;
  issueKey: string;
  skill: string;
  agent: string;
  workflow: string;
  duration: string;
  status: "已完成" | "运行中" | "等待" | "失败" | "草稿";
  artifacts: string[];
  time: string;
}

interface OrchestrationStageRuntime {
  id: string;
  name: string;
  description: string;
  agent: string;
  skill: string;
  status: StageRuntimeStatus;
  started_at: string | null;
  ended_at: string | null;
  reason: string | null;
}

interface OrchestrationArtifactRuntime {
  id: string;
  name: string;
  status: ArtifactStatus;
  detail: string;
}

interface OrchestrationEventRuntime {
  id: string;
  stage_id: string | null;
  level: EventLevel;
  at: string;
  title: string;
  detail: string;
}

interface JiraOrchestrationRuntime {
  issue_key: string;
  status: OrchestrationStatus;
  progress_percent: number;
  current_stage_id: string | null;
  current_stage_name: string;
  current_agent: string;
  current_skill: string;
  started_at: string | null;
  elapsed_seconds: number;
  eta_seconds: number | null;
  eta_at: string | null;
  wait_reason: string | null;
  failure_reason: string | null;
  stages: OrchestrationStageRuntime[];
  artifacts: OrchestrationArtifactRuntime[];
  events: OrchestrationEventRuntime[];
}

interface OrchestrationStatusSummary {
  status: OrchestrationStatus;
  count: number;
  active: boolean;
}

interface FleetAuditTask {
  id: string;
  role: string;
  mode: string;
  fanout: string;
  candidateId: string;
  arenaCandidateCount: string;
  winner: string;
  arenaScores: string;
  consistencyDelta: string;
  archivePath: string;
  scorer: string;
}

type ConfigSectionKey =
  | "jira"
  | "gitlab"
  | "mcp"
  | "codeRetrieval"
  | "agent"
  | "skillRules"
  | "securityAudit";

interface JiraConfig {
  baseUrl: string;
  projectKey: string;
  defaultJql: string;
  authMethod: "Token" | "Basic + API Token" | "OAuth2";
  token: string;
  lastTestResult: string;
}

interface GitlabConfig {
  baseUrl: string;
  groupOrProject: string;
  defaultBranch: string;
  token: string;
  lastTestResult: string;
}

interface McpConfig {
  allowList: string;
  defaultTimeoutMs: number;
  gateway: string;
  notes: string;
}

interface RepoMappingRule {
  id: string;
  source: string;
  repository: string;
  module: string;
}

interface BranchMappingRule {
  id: string;
  source: string;
  branch: string;
}

interface JiraKeywordMatchRule {
  id: string;
  keyword: string;
  repository: string;
  module: string;
  branch: string;
}

interface CodeRetrievalConfig {
  repoMappings: RepoMappingRule[];
  branchMappings: BranchMappingRule[];
  jiraKeywordRules: JiraKeywordMatchRule[];
}

interface AgentConfig {
  plannerAgent: string;
  reviewerAgent: string;
  maxParallelism: number;
  autoDispatch: boolean;
  fallbackPolicy: string;
}

interface SkillMatchRule {
  id: string;
  businessKeyword: string;
  repository: string;
  branch: string;
  recommendedSkill: string;
  confidenceRule: string;
}

interface SecurityAuditConfig {
  enableTokenMasking: boolean;
  requireHumanApproval: boolean;
  enableAuditLog: boolean;
  auditRetentionDays: number;
}

interface ConfigCenterState {
  jira: JiraConfig;
  gitlab: GitlabConfig;
  mcp: McpConfig;
  codeRetrieval: CodeRetrievalConfig;
  agent: AgentConfig;
  skillRules: SkillMatchRule[];
  securityAudit: SecurityAuditConfig;
  updatedAt: string;
}

interface ConfigFeedback {
  tone: Tone;
  title: string;
  detail: string;
}

interface ConfigChangeRequest {
  id: string;
  section: ConfigSectionKey;
  sectionTitle: string;
  createdAt: string;
  status: "draft" | "awaiting_policy_gate";
  summary: string;
  applyMode: string;
}

const snapshotData = rawSnapshot as unknown as ShowcaseSnapshotV1;
const liveJiraIssues = buildLiveJiraIssues(snapshotData.jiraIssues ?? []);
const defaultProjectFilter = "APMIS";
const themeStorageKey = "showcase-theme-mode";
const configStorageKey = "showcase-config-center-v2";
const configChangeRequestStorageKey = "showcase-config-change-requests-v1";
const integrationStatusApiPath = "/api/showcase/integration-status";
const angular17Repo = "apmis/odcbs/odcbs-frontend";
const angular17Branch = "develop_to_angular17";
const angular17SkillId = "angular17-regression";
const angular17AnalysisFocus = [
  "确认升级回归范围：路由空白、图标色差、布局变形、动态表单或弹窗异常。",
  "限定代码扫描范围：优先检索 Angular17 分支与前端共享组件。",
  "结合 Jira 描述、历史 MR 和模块标签定位 affected component。",
  "输出可验证修复建议：组件路径、样式/模板/状态变更点和回归测试命令。",
];
const enabledNavItems = ["Jira 调度", "配置"] as const;
const configSectionTitles: Record<ConfigSectionKey, string> = {
  jira: "Jira 配置",
  gitlab: "GitLab 配置",
  mcp: "MCP 配置",
  codeRetrieval: "代码检索配置",
  agent: "Agent 配置",
  skillRules: "Skill 匹配规则",
  securityAudit: "安全与审计配置",
};

const defaultConfigState: ConfigCenterState = {
  jira: {
    baseUrl: "",
    projectKey: "APMIS",
    defaultJql:
      "project = APMIS AND status in (处理中, 待处理) ORDER BY updated DESC",
    authMethod: "Token",
    token: "",
    lastTestResult: "未检查",
  },
  gitlab: {
    baseUrl: "",
    groupOrProject: angular17Repo,
    defaultBranch: angular17Branch,
    token: "",
    lastTestResult: "未检查",
  },
  mcp: {
    allowList: "JiraReader, GitLabReader, CodeRetrieval, PolicyMCP",
    defaultTimeoutMs: 60000,
    gateway: "stdio / dev runtime",
    notes: "Showcase 只读取运行配置状态；真实生效由 MCP 启动环境决定。",
  },
  codeRetrieval: {
    repoMappings: [
      {
        id: "repo-main",
        source: "APMIS 主版本",
        repository: angular17Repo,
        module: "odcbs-frontend",
      },
    ],
    branchMappings: [
      {
        id: "branch-main",
        source: "Angular17 升级线",
        branch: angular17Branch,
      },
    ],
    jiraKeywordRules: [
      {
        id: "jira-angular17",
        keyword: "Angular17",
        repository: angular17Repo,
        module: "odcbs-frontend",
        branch: angular17Branch,
      },
    ],
  },
  agent: {
    plannerAgent: "Orchestrator",
    reviewerAgent: "Reviewer Agent",
    maxParallelism: 3,
    autoDispatch: false,
    fallbackPolicy: "高风险场景转人工确认",
  },
  skillRules: [
    {
      id: "skill-angular17",
      businessKeyword: "Angular17, 升级后, 空白页, 图标色差",
      repository: angular17Repo,
      branch: angular17Branch,
      recommendedSkill: "Angular17 升级回归",
      confidenceRule: "命中 Angular17 且 >=2 个异常信号 => 高置信",
    },
  ],
  securityAudit: {
    enableTokenMasking: true,
    requireHumanApproval: true,
    enableAuditLog: true,
    auditRetentionDays: 90,
  },
  updatedAt: "未保存",
};

function cloneConfigState<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function loadConfigStateFromStorage() {
  if (typeof window === "undefined") return cloneConfigState(defaultConfigState);
  try {
    const raw = window.localStorage.getItem(configStorageKey);
    if (raw === null || raw.length === 0) return cloneConfigState(defaultConfigState);
    const parsed = JSON.parse(raw) as Partial<ConfigCenterState>;
    return {
      ...cloneConfigState(defaultConfigState),
      ...parsed,
      jira: { ...defaultConfigState.jira, ...(parsed.jira ?? {}) },
      gitlab: { ...defaultConfigState.gitlab, ...(parsed.gitlab ?? {}) },
      mcp: { ...defaultConfigState.mcp, ...(parsed.mcp ?? {}) },
      codeRetrieval: {
        ...defaultConfigState.codeRetrieval,
        ...(parsed.codeRetrieval ?? {}),
      },
      agent: { ...defaultConfigState.agent, ...(parsed.agent ?? {}) },
      securityAudit: {
        ...defaultConfigState.securityAudit,
        ...(parsed.securityAudit ?? {}),
      },
      skillRules:
        parsed.skillRules !== undefined &&
        Array.isArray(parsed.skillRules) &&
        parsed.skillRules.length > 0
          ? parsed.skillRules
          : cloneConfigState(defaultConfigState.skillRules),
    } satisfies ConfigCenterState;
  } catch {
    return cloneConfigState(defaultConfigState);
  }
}

function loadConfigChangeRequestsFromStorage(): ConfigChangeRequest[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(configChangeRequestStorageKey);
    if (raw === null || raw.length === 0) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isConfigChangeRequest) : [];
  } catch {
    return [];
  }
}

function isConfigChangeRequest(value: unknown): value is ConfigChangeRequest {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ConfigChangeRequest>;
  return (
    typeof candidate.id === "string" &&
    isConfigSectionKey(candidate.section) &&
    typeof candidate.sectionTitle === "string" &&
    typeof candidate.createdAt === "string" &&
    (candidate.status === "draft" ||
      candidate.status === "awaiting_policy_gate") &&
    typeof candidate.summary === "string" &&
    typeof candidate.applyMode === "string"
  );
}

function isConfigSectionKey(value: unknown): value is ConfigSectionKey {
  return (
    value === "jira" ||
    value === "gitlab" ||
    value === "mcp" ||
    value === "codeRetrieval" ||
    value === "agent" ||
    value === "skillRules" ||
    value === "securityAudit"
  );
}

function buildFallbackIntegrationStatus(): ShowcaseIntegrationStatus {
  return {
    schemaVersion: "ShowcaseIntegrationStatusV1",
    generatedAt: snapshotData.metadata.generatedAt,
    source: "runtime-env",
    directApplySupported: false,
    restartRequired: true,
    endpoints: [
      {
        id: "jira",
        label: "Jira Reader MCP",
        configured: false,
        tone: "warn",
        displayUrl: null,
        credentialState: "missing",
        details: ["未读取到本地运行状态接口；请确认 Vite dev server 正在运行。"],
        requiredEnv: ["JIRA_BASE_URL", "JIRA_USERNAME", "JIRA_API_TOKEN"],
        applyMode: "环境变量驱动；变更后需要重启 Jira Reader MCP",
      },
      {
        id: "gitlab",
        label: "GitLab API",
        configured: false,
        tone: "warn",
        displayUrl: null,
        credentialState: "missing",
        details: ["未读取到本地运行状态接口；静态构建只显示快照状态。"],
        requiredEnv: ["GITLAB_BASE_URL", "GITLAB_TOKEN"],
        applyMode: "环境变量驱动；变更后需要重启 Code Retrieval MCP",
      },
      {
        id: "codeRetrieval",
        label: "Code Retrieval MCP",
        configured: false,
        tone: "warn",
        displayUrl: null,
        credentialState: "missing",
        details: ["未读取到 Code Retrieval 运行状态。"],
        requiredEnv: ["CODE_RETRIEVAL_LOCAL_REPO_ROOT", "CODE_RETRIEVAL_REQUEST_TIMEOUT_MS"],
        applyMode: "环境变量或本地仓库路径驱动；变更后需要重启 Code Retrieval MCP",
      },
      {
        id: "mcp",
        label: "MCP Runtime",
        configured: false,
        tone: "warn",
        displayUrl: null,
        credentialState: "not_required",
        details: ["Showcase 只读运行，当前未连接状态接口。"],
        requiredEnv: ["JIRA_*", "GITLAB_*", "CODE_RETRIEVAL_*"],
        applyMode: "真实生效由 MCP 启动环境决定",
      },
    ],
  };
}
const orchestrationStatusOrder: OrchestrationStatus[] = [
  "待开始",
  "编排中",
  "等待人工处理",
  "已完成",
  "失败",
];
const orchestrationStageBlueprint = [
  {
    id: "jira-understand",
    name: "Jira 理解",
    description: "读取 Jira 描述、评论、字段并完成需求要点归一。",
    agent: "JiraReader MCP",
    skill: "需求澄清",
    estimateMinutes: 6,
  },
  {
    id: "skill-match",
    name: "Skill 匹配",
    description: "按 Jira 特征匹配通用与业务 Skill，确定执行链路。",
    agent: "Orchestrator",
    skill: "Skill Router",
    estimateMinutes: 4,
  },
  {
    id: "code-search",
    name: "代码检索",
    description: "限定仓库/分支范围，定位受影响模块、路由与样式。",
    agent: "Code Searcher",
    skill: "代码检索",
    estimateMinutes: 10,
  },
  {
    id: "solution-plan",
    name: "方案生成",
    description: "基于检索证据生成修复方案、风险和验证命令。",
    agent: "Solution Architect",
    skill: "方案生成",
    estimateMinutes: 8,
  },
  {
    id: "human-review",
    name: "人工 Review",
    description: "涉及高风险写入、预算超限或策略冲突时等待人工确认。",
    agent: "Reviewer Agent",
    skill: "人工 Review",
    estimateMinutes: 6,
  },
  {
    id: "evidence-pack",
    name: "Evidence Pack",
    description: "汇总 Trace、MCP 调用和关键证据，生成审计可追踪包。",
    agent: "Evidence Curator",
    skill: "Evidence Pack",
    estimateMinutes: 5,
  },
  {
    id: "mr-delivery",
    name: "MR/产物生成",
    description: "输出 MR 草稿、变更摘要与产物清单。",
    agent: "Delivery Agent",
    skill: "MR 产物生成",
    estimateMinutes: 9,
  },
  {
    id: "eval-regression",
    name: "Eval 回归",
    description: "执行回归评估并汇总通过率与遗留风险。",
    agent: "QA Agent",
    skill: "Eval 回归",
    estimateMinutes: 7,
  },
] as const;

const currentTime = ref(new Date());
const themeMode = ref<ThemeMode>(resolveInitialThemeMode());
const selectedIssueKey = ref(liveJiraIssues[0]?.key ?? "");
const acknowledgedDecisionIds = ref<string[]>([]);
const searchQuery = ref("");
const projectFilter = ref(defaultProjectFilter);
const issueTypeFilter = ref("all");
const statusFilter = ref("all");
const assigneeScopeFilter = ref<"all" | "currentUser" | "selected">("all");
const assigneeFilter = ref("all");
const filterCollapsed = ref(false);
const drawerVisible = ref(true);
const activeNavItem = ref("Jira 调度");
const moduleNotice = ref<ModuleNotice | null>(null);
const selectedDrawerTab = ref<DrawerTab>("skills");
const selectedRuntimeStageId = ref<string | null>(null);
const selectedIssueKeys = ref<string[]>([]);
const autoExecuteEnabled = ref(false);
const auditExpanded = ref(false);
const calendarOpen = ref(false);
const descriptionExpanded = ref(false);
const mcpDetailExpanded = ref(false);
const skillAssignments = ref<Record<string, string[]>>({});
const dispatchOverrides = ref<Record<string, DispatchStatus>>({});
const businessSkillAppliedIssueKeys = ref<string[]>([]);
const assistantQuestion = ref("");
const assistantAnswer = ref(
  "可以基于当前真实 Jira 描述、状态、优先级、目标版本和模块字段，推荐需要分配的 Skill 与执行顺序。",
);
const assistantAvatarCanvas = ref<HTMLCanvasElement | null>(null);
const assistantAvatarReady = ref(false);
const assistantDialogOpen = ref(false);
const assistantDialogQuestion = ref("");
const assistantMessages = ref<AssistantMessage[]>([
  {
    id: "assistant-opening",
    role: "assistant",
    text: "我已读取当前目标版本、Jira 筛选结果和高优先级队列。可以直接问我今天应该先确认什么、哪个 Jira 需要升级处理。",
    time: "刚刚",
  },
]);
const savedConfigState = ref<ConfigCenterState>(loadConfigStateFromStorage());
const draftConfigState = ref<ConfigCenterState>(
  cloneConfigState(savedConfigState.value),
);
const integrationStatus = ref<ShowcaseIntegrationStatus>(
  snapshotData.integrationStatus ?? buildFallbackIntegrationStatus(),
);
const integrationStatusLoading = ref(false);
const integrationStatusError = ref<string | null>(null);
const configChangeRequests = ref<ConfigChangeRequest[]>(
  loadConfigChangeRequestsFromStorage(),
);
const editingConfigSections = ref<Record<ConfigSectionKey, boolean>>({
  jira: false,
  gitlab: false,
  mcp: false,
  codeRetrieval: false,
  agent: false,
  skillRules: false,
  securityAudit: false,
});
const configFeedback = ref<ConfigFeedback | null>(null);
let clockTimer: number | undefined;
let configFeedbackTimer: number | undefined;
let assistantAvatarCleanup: (() => void) | undefined;

const themeModeLabel = computed(() =>
  themeMode.value === "day" ? "白天" : "夜晚",
);
const themeToggleLabel = computed(() =>
  themeMode.value === "day" ? "切换到夜晚模式" : "切换到白天模式",
);
let assistantMessageSeq = 0;

const assistantQuickQuestions = [
  "这个 Jira 应该分配哪些 Skill？",
  "当前流水线瓶颈在哪里？",
  "哪些任务需要主管先确认？",
];

const isConfigCenter = computed(() => activeNavItem.value === "配置");
const integrationEndpointCards = computed(() => integrationStatus.value.endpoints);
const jiraRuntimeStatus = computed(() => getIntegrationEndpoint("jira"));
const gitlabRuntimeStatus = computed(() => getIntegrationEndpoint("gitlab"));
const mcpRuntimeStatus = computed(() => getIntegrationEndpoint("mcp"));
const pendingConfigRequestCount = computed(
  () =>
    configChangeRequests.value.filter(
      (request) => request.status === "awaiting_policy_gate",
    ).length,
);
const angular17KeywordRule = computed(() => {
  const rules = savedConfigState.value.codeRetrieval.jiraKeywordRules;
  return (
    rules.find((rule) => /angular\s*17|angular17/i.test(rule.keyword)) ??
    rules[0] ??
    null
  );
});
const angular17SkillRule = computed(() => {
  const rules = savedConfigState.value.skillRules;
  return (
    rules.find((rule) => /angular\s*17|angular17/i.test(rule.businessKeyword)) ??
    rules[0] ??
    null
  );
});
const angular17MappingPreview = computed(() => ({
  keyword: angular17KeywordRule.value?.keyword ?? "Angular17",
  repository: angular17KeywordRule.value?.repository ?? angular17Repo,
  module: angular17KeywordRule.value?.module ?? "odcbs-frontend",
  branch: angular17KeywordRule.value?.branch ?? angular17Branch,
  recommendedSkill:
    angular17SkillRule.value?.recommendedSkill ?? "Angular17 升级回归",
  confidenceRule:
    angular17SkillRule.value?.confidenceRule ?? "命中 Angular17 => 中置信",
}));
const jiraCodeAnalysisFlow = computed<CodeAnalysisFlowStep[]>(() => [
  {
    label: "1. 读取 Jira 上下文",
    detail: "提取标题、描述、状态、优先级、版本、模块、负责人和标签。",
  },
  {
    label: "2. 匹配业务 Skill",
    detail: "用 Angular17、升级后、空白页、图标色差等信号选择专项 Skill。",
  },
  {
    label: "3. 定位代码范围",
    detail: `映射到 ${angular17MappingPreview.value.repository} / ${angular17MappingPreview.value.branch}，限定检索边界。`,
  },
  {
    label: "4. 执行代码分析",
    detail: "检索相关组件、路由、样式、历史 MR 和共享模块，生成影响面证据。",
  },
  {
    label: "5. 形成开发方案",
    detail: "输出修改点、风险、验证命令、回归用例和人工确认事项。",
  },
]);

const navItems = [
  "仪表盘",
  "Jira 调度",
  "工作流",
  "Skill 管理",
  "Agent 状态",
  "知识库",
  "配置",
];

const moduleNoticeMessages: Record<string, string> = {
  仪表盘: "总览看板、跨项目指标和趋势分析还未接入；当前请使用 Jira 调度驾驶舱查看队列与流水线。",
  工作流: "流程模板、审批流和自动化策略配置还未接入；当前可在单个 Jira 的 Skill 编排中完成触发前校验。",
  "Skill 管理": "独立 Skill 库、版本管理和发布流程还未接入；当前支持在 Jira 详情抽屉内为单个 Jira 编排 Skill。",
  "Agent 状态": "独立 Agent 监控页还未接入；当前可在右侧抽屉的执行步骤页签查看 Agent 状态。",
  知识库: "知识资产检索、经验沉淀和复用入口还未接入；当前证据链页签可查看单个 Jira 的 evidence 与 reasoning。",
};

const drawerTabs: Array<{ id: DrawerTab; label: string }> = [
  { id: "overview", label: "概览" },
  { id: "skills", label: "Skill 编排" },
  { id: "steps", label: "执行步骤" },
  { id: "evidence", label: "证据链" },
  { id: "mr", label: "MR" },
];

const jiraProjectOptions = computed(() => {
  const options = buildOptions(liveJiraIssues.map((issue) => issue.project))
    .filter((project) => project.length > 0)
    .map((project) => {
      const match = liveJiraIssues.find((issue) => issue.project === project);
      const projectName = match?.projectName ?? project;
      return {
        value: project,
        label:
          projectName === project ? project : `${projectName} (${project})`,
      };
    });
  return options.length > 0
    ? options
    : [{ value: "APMIS", label: "新手麻 (APMIS)" }];
});

const skillCandidates: SkillCandidate[] = [
  {
    id: "clarify",
    name: "需求澄清",
    agent: "PM Agent",
    mcp: "JiraReader",
    input: "Jira 描述/评论",
    estimate: 8,
    gate: "只读通过",
    tags: ["推荐", "必选"],
  },
  {
    id: "impact",
    name: "影响面分析",
    agent: "Impact Analyst",
    mcp: "CodeRetrieval",
    input: "Jira + 模块标签",
    estimate: 12,
    gate: "MCP 白名单",
    tags: ["推荐", "必选"],
  },
  {
    id: angular17SkillId,
    name: "Angular17 升级回归分析",
    agent: "Angular Expert",
    mcp: "CodeRetrieval + GitLabReader",
    input: "Angular17 Jira + odcbs-frontend",
    estimate: 16,
    gate: "develop_to_angular17 分支确认",
    tags: ["业务 Skill", "Angular17", "代码分析"],
  },
  {
    id: "code",
    name: "代码检索",
    agent: "Code Searcher",
    mcp: "GitLabReader",
    input: "GitLab 仓库",
    estimate: 10,
    gate: "只读通过",
    tags: ["推荐"],
  },
  {
    id: "plan",
    name: "方案生成",
    agent: "Solution Architect",
    mcp: "Planner",
    input: "需求 + 影响面",
    estimate: 15,
    gate: "需人工确认",
    tags: ["推荐"],
  },
  {
    id: "test",
    name: "测试用例生成",
    agent: "QA Agent",
    mcp: "TestCaseMCP",
    input: "方案文档",
    estimate: 18,
    gate: "预算校验",
    tags: ["可选"],
  },
  {
    id: "review",
    name: "MR Review",
    agent: "Reviewer Agent",
    mcp: "GitLabMR",
    input: "MR Diff",
    estimate: 20,
    gate: "写入需确认",
    tags: ["可选", "需人工确认"],
  },
  {
    id: "security",
    name: "安全扫描",
    agent: "Security Scanner",
    mcp: "PolicyMCP",
    input: "代码变更",
    estimate: 15,
    gate: "高危需确认",
    tags: ["可选"],
  },
];

const issues: EngineeringIssue[] = liveJiraIssues;

const decisionItems = computed<DecisionItem[]>(() =>
  filteredIssues.value
    .filter(
      (issue) =>
        issue.riskTone === "danger" ||
        ["处理中", "已打回", "待确认", "待处理"].includes(issue.status) ||
        issue.description.trim().length === 0,
    )
    .slice(0, 6)
    .map((issue) => ({
      id: `decision-${issue.key}`,
      kind: issue.riskTone === "danger" ? "高优先级确认" : "Jira 待跟进",
      issueKey: issue.key,
      title: issue.summary,
      impact: `状态：${issue.status} / 负责人：${issue.assignee}`,
      action: "去查看",
      tone: issue.riskTone,
    })),
);

const kpiCards = computed<KpiCard[]>(() => buildJiraKpiCards(issues));

const auditRecords = ref<AuditRecord[]>(
  buildAuditRecordsFromSnapshot(snapshotData, issues),
);

const fleetAuditTasks = computed<FleetAuditTask[]>(() =>
  snapshotData.tasks
    .filter((task) => task.fleet_session_id !== null)
    .map((task) => {
      const arena = task.arena ?? null;
      return {
        id: `${task.task_id}-${task.agent_role ?? "unknown"}-${task.candidate_id ?? "none"}`,
        role: formatIntegrationSignal(task.agent_role),
        mode: task.worktree_mode ?? "未接入",
        fanout: formatFleetFanout(task.budget_usage?.fleet_fanout ?? null),
        candidateId: task.candidate_id ?? "未接入",
        arenaCandidateCount: formatArenaCandidateCount(
          arena?.candidate_count,
        ),
        winner: arena?.winner ?? "winner 未接入",
        arenaScores: formatArenaScores(arena?.scores),
        consistencyDelta: formatArenaDelta(arena?.consistency_delta),
        archivePath: arena?.archive_path ?? "archive 未接入",
        scorer: formatArenaScorer(arena),
      };
    })
    .slice(0, 6),
);

const formattedDate = computed(() =>
  new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).format(currentTime.value),
);

const formattedTime = computed(() =>
  new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(currentTime.value),
);

const calendarTitle = computed(() =>
  new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
  }).format(currentTime.value),
);

const calendarDays = computed<CalendarDay[]>(() => {
  const today = currentTime.value;
  const year = today.getFullYear();
  const month = today.getMonth();
  const firstDay = new Date(year, month, 1);
  const startOffset = (firstDay.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - startOffset);

  return Array.from({ length: 35 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const sameDay =
      date.getFullYear() === today.getFullYear() &&
      date.getMonth() === today.getMonth() &&
      date.getDate() === today.getDate();
    return {
      key: date.toISOString(),
      label: date.getDate(),
      muted: date.getMonth() !== month,
      today: sameDay,
      hasPlan: [2, 6, 12, 18, 24].includes(date.getDate()) || sameDay,
    };
  });
});

const issueTypeOptions = computed(() =>
  buildOptions(issues.map((issue) => issue.issueType).filter(Boolean)),
);
const statusOptions = computed(() =>
  buildOptions(issues.map((issue) => issue.status).filter(Boolean)),
);
const assigneeOptions = computed(() =>
  buildOptions(issues.map((issue) => issue.assignee)),
);

const filteredIssues = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();

  return issues.filter((issue) => {
    if (projectFilter.value !== "all" && issue.project !== projectFilter.value)
      return false;
    if (
      issueTypeFilter.value !== "all" &&
      issue.issueType !== issueTypeFilter.value
    )
      return false;
    if (statusFilter.value === "open" && issue.status === "已完成")
      return false;
    if (
      statusFilter.value !== "all" &&
      statusFilter.value !== "open" &&
      issue.status !== statusFilter.value
    )
      return false;
    if (
      assigneeFilter.value !== "all" &&
      assigneeScopeFilter.value === "selected" &&
      issue.assignee !== assigneeFilter.value
    )
      return false;
    if (query.length === 0) return true;

    return [
      issue.key,
      issue.summary,
      issue.assignee,
      issue.description,
      issue.expectation,
    ]
      .join(" ")
      .toLowerCase()
      .includes(query);
  });
});

const selectedBulkIssues = computed(() =>
  selectedIssueKeys.value
    .map((issueKey) => issues.find((issue) => issue.key === issueKey))
    .filter((issue): issue is EngineeringIssue => issue !== undefined),
);

const selectedIssue = computed(() => {
  const fromFiltered = filteredIssues.value.find(
    (issue) => issue.key === selectedIssueKey.value,
  );
  return fromFiltered ?? filteredIssues.value[0] ?? issues[0];
});

const versionSummary = computed(() => {
  const totalSp = issues.reduce((sum, issue) => sum + issue.storyPoints, 0);
  const filteredSp = filteredIssues.value.reduce(
    (sum, issue) => sum + issue.storyPoints,
    0,
  );
  const highRiskCount = filteredIssues.value.filter(
    (issue) => issue.riskTone === "danger",
  ).length;
  return {
    total: issues.length,
    visible: filteredIssues.value.length,
    totalSp,
    visibleSp: filteredSp,
    highRiskCount,
  };
});

const activeFilterPills = computed(() => {
  const pills: string[] = [];
  if (issueTypeFilter.value !== "all") pills.push(`类型：${issueTypeFilter.value}`);
  if (statusFilter.value === "open") pills.push("状态：未完成");
  if (statusFilter.value !== "all" && statusFilter.value !== "open")
    pills.push(`状态：${statusFilter.value}`);
  if (assigneeScopeFilter.value === "currentUser") pills.push("经办人：当前用户");
  if (assigneeScopeFilter.value === "selected" && assigneeFilter.value !== "all")
    pills.push(`经办人：${assigneeFilter.value}`);
  if (searchQuery.value.trim().length > 0)
    pills.push(`文本：${searchQuery.value.trim()}`);
  return pills;
});

const selectedSkillIds = computed(
  () =>
    skillAssignments.value[selectedIssue.value.key] ??
    getRecommendedSkillIds(selectedIssue.value),
);

const selectedSkillRows = computed(() =>
  selectedSkillIds.value
    .map((skillId) => skillCandidates.find((skill) => skill.id === skillId))
    .filter((skill): skill is SkillCandidate => skill !== undefined),
);

const selectedBusinessSkillMatch = computed(() =>
  getBusinessSkillMatch(selectedIssue.value),
);

const selectedBusinessSkillApplied = computed(() =>
  businessSkillAppliedIssueKeys.value.includes(selectedIssue.value.key),
);

const totalSkillEstimate = computed(() =>
  selectedSkillRows.value.reduce((sum, skill) => sum + skill.estimate, 0),
);

const selectedDispatchStatus = computed(() =>
  getDispatchStatus(selectedIssue.value),
);

const selectedOrchestrationRuntime = computed<JiraOrchestrationRuntime>(() =>
  buildMockOrchestrationRuntime(
    selectedIssue.value,
    selectedDispatchStatus.value,
    currentTime.value,
  ),
);

const orchestrationStatusSummary = computed<OrchestrationStatusSummary[]>(() => {
  const counts = new Map<OrchestrationStatus, number>();
  orchestrationStatusOrder.forEach((status) => counts.set(status, 0));

  filteredIssues.value.forEach((issue) => {
    const status = resolveOrchestrationStatus(issue, getDispatchStatus(issue));
    counts.set(status, (counts.get(status) ?? 0) + 1);
  });

  return orchestrationStatusOrder.map((status) => ({
    status,
    count: counts.get(status) ?? 0,
    active: status === selectedOrchestrationRuntime.value.status,
  }));
});

const activeOrchestrationStage = computed<OrchestrationStageRuntime | null>(() => {
  const runtime = selectedOrchestrationRuntime.value;
  const preferredId =
    selectedRuntimeStageId.value ?? runtime.current_stage_id ?? null;
  if (preferredId !== null) {
    const matched = runtime.stages.find((stage) => stage.id === preferredId);
    if (matched !== undefined) return matched;
  }
  return runtime.stages[0] ?? null;
});

const runtimeElapsedLabel = computed(() =>
  formatSecondsLabel(selectedOrchestrationRuntime.value.elapsed_seconds),
);

const runtimeRemainingLabel = computed(() => {
  const etaSeconds = selectedOrchestrationRuntime.value.eta_seconds;
  return etaSeconds === null ? "—" : formatSecondsLabel(etaSeconds);
});

const runtimeEtaAtLabel = computed(() => {
  const etaAt = selectedOrchestrationRuntime.value.eta_at;
  return etaAt === null ? "未提供" : formatJiraDate(etaAt);
});

const preflightChecks = computed(() => [
  {
    label: "Jira 只读权限",
    value: "通过",
    tone: "ok" as Tone,
  },
  {
    label: "GitLab 写入",
    value: selectedIssue.value.gitlabScore === null ? "未接入" : "需确认",
    tone: selectedIssue.value.gitlabScore === null ? "warn" : "neutral",
  },
  {
    label: "MCP 白名单",
    value: "通过",
    tone: "ok" as Tone,
  },
  {
    label: "预算",
    value:
      totalSkillEstimate.value > 70
        ? `${totalSkillEstimate.value}m 超限`
        : `${totalSkillEstimate.value}m 未超限`,
    tone: totalSkillEstimate.value > 70 ? "danger" : "ok",
  },
]);

const agentStatuses = computed(() => {
  const runtime = selectedOrchestrationRuntime.value;
  const currentStage = runtime.stages.find(
    (stage) => stage.id === runtime.current_stage_id,
  );
  const developerActive =
    currentStage !== undefined &&
    ["code-search", "solution-plan", "mr-delivery"].includes(currentStage.id);
  const reviewActive =
    currentStage !== undefined && currentStage.id === "human-review";
  const testerActive =
    currentStage !== undefined && currentStage.id === "eval-regression";

  return [
    {
      role: "PM",
      status: runtime.status === "等待人工处理" ? "待处理" : "就绪",
      tone:
        runtime.status === "等待人工处理"
          ? ("warn" as Tone)
          : ("ok" as Tone),
    },
    {
      role: "Developer",
      status: developerActive ? "运行中" : "就绪",
      tone: developerActive ? ("warn" as Tone) : ("ok" as Tone),
    },
    {
      role: "Code Review",
      status: reviewActive
        ? runtime.status === "等待人工处理"
          ? "待确认"
          : "运行中"
        : "就绪",
      tone:
        reviewActive && runtime.status === "等待人工处理"
          ? ("warn" as Tone)
          : ("ok" as Tone),
    },
    {
      role: "Security",
      status:
        selectedIssue.value.riskTone === "danger"
          ? runtime.status === "已完成"
            ? "已通过"
            : "等待确认"
          : "就绪",
      tone:
        selectedIssue.value.riskTone === "danger" &&
        runtime.status !== "已完成"
          ? ("warn" as Tone)
          : ("ok" as Tone),
    },
    {
      role: "Tester",
      status: testerActive ? "运行中" : runtime.status === "已完成" ? "已完成" : "等待",
      tone:
        testerActive
          ? ("warn" as Tone)
          : runtime.status === "已完成"
            ? ("ok" as Tone)
            : ("neutral" as Tone),
    },
  ];
});

const executionSteps = computed(() =>
  selectedOrchestrationRuntime.value.stages.map((stage) => ({
    id: stage.id,
    name: stage.id,
    label: stage.name,
    agent: stage.agent,
    skill: stage.skill,
    description: stage.description,
    duration: formatStageElapsed(stage.started_at, stage.ended_at),
    startedAtLabel:
      stage.started_at === null ? "—" : formatJiraDate(stage.started_at),
    endedAtLabel: stage.ended_at === null ? "—" : formatJiraDate(stage.ended_at),
    reason: stage.reason,
    status: mapRuntimeStageStatus(stage.status),
  })),
);

const pipelineColumns = computed<PipelineColumn[]>(() => {
  const columns: PipelineColumn[] = [
    { id: "understand", title: "待理解", count: 0, cards: [] },
    { id: "assigned", title: "Skill 已分配", count: 0, cards: [] },
    { id: "running", title: "Agent 执行中", count: 0, cards: [] },
    { id: "review", title: "MR 待 Review", count: 0, cards: [] },
    { id: "manual", title: "等待人工确认", count: 0, cards: [] },
  ];

  filteredIssues.value.forEach((issue) => {
    const status = getDispatchStatus(issue);
    const target =
      status === "Skill 已分配" || status === "草稿"
        ? columns[1]
        : status === "Agent 执行中"
          ? columns[2]
          : status === "MR 待 Review" || status === "已完成"
            ? columns[3]
            : status === "等待人工确认" || status === "失败"
              ? columns[4]
              : columns[0];

    target.cards.push({
      key: issue.key,
      summary: issue.summary,
      skills: getAssignedSkillNames(issue).slice(0, 2),
      agent: resolveCurrentAgent(issue),
      status,
      duration: formatIssueDuration(issue),
      tone: issue.riskTone,
      preview:
        issue.key === selectedIssue.value.key &&
        status === "待编排" &&
        getAssignedSkillNames(issue).length > 0,
    });
  });

  return columns.map((column) => ({
    ...column,
    count: column.cards.length,
    cards: column.cards.slice(0, 5),
  }));
});

function buildJiraKpiCards(sourceIssues: EngineeringIssue[]): KpiCard[] {
  const total = sourceIssues.length;
  const inProgress = sourceIssues.filter((issue) =>
    ["处理中", "进行中"].includes(issue.status),
  ).length;
  const waiting = sourceIssues.filter((issue) =>
    ["待确认", "待处理"].includes(issue.status),
  ).length;
  const testing = sourceIssues.filter((issue) =>
    ["提交测试", "已开发完成"].includes(issue.status),
  ).length;
  const highPriority = sourceIssues.filter((issue) =>
    isHighPriority(issue.priority),
  ).length;
  const unresolved = sourceIssues.filter(
    (issue) => !isClosedStatus(issue.status),
  ).length;

  return [
    {
      id: "total",
      label: "Jira 总数",
      value: String(total),
      caption: "当前 JQL 返回",
      trend: "来自真实 Jira",
      tone: "neutral",
      bars: buildCountBars(total, Math.max(total, 1)),
    },
    {
      id: "waiting",
      label: "待确认/待处理",
      value: String(waiting),
      caption: "Jira 状态聚合",
      trend: `未关闭 ${unresolved} 条`,
      tone: waiting > 0 ? "warn" : "ok",
      bars: buildCountBars(waiting, Math.max(total, 1)),
    },
    {
      id: "progress",
      label: "处理中",
      value: String(inProgress),
      caption: "状态=处理中/进行中",
      trend: "按 Jira 状态计算",
      tone: inProgress > 0 ? "ok" : "neutral",
      bars: buildCountBars(inProgress, Math.max(total, 1)),
    },
    {
      id: "testing",
      label: "提交测试",
      value: String(testing),
      caption: "开发完成或测试中",
      trend: "按 Jira 状态计算",
      tone: testing > 0 ? "ok" : "neutral",
      bars: buildCountBars(testing, Math.max(total, 1)),
    },
    {
      id: "priority",
      label: "高优先级",
      value: String(highPriority),
      caption: "优先级高/加急/P0/P1",
      trend: "需产品经理关注",
      tone: highPriority > 0 ? "danger" : "neutral",
      bars: buildCountBars(highPriority, Math.max(total, 1)),
    },
  ];
}

function buildCountBars(value: number, max: number): number[] {
  const ratio = max === 0 ? 0 : value / max;
  const height = Math.max(6, Math.round(12 + ratio * 38));
  return Array.from({ length: 6 }, (_, index) =>
    Math.max(6, Math.round(height * ((index + 1) / 6))),
  );
}

function formatIssueDuration(issue: EngineeringIssue) {
  const seconds =
    issue.remainingEstimateSeconds ??
    issue.originalEstimateSeconds ??
    issue.timeSpentSeconds;
  if (seconds === undefined || seconds <= 0) return "未估算";
  const hours = seconds / 3600;
  if (hours >= 1) return `${stripTrailingZero(hours)}h`;
  return `${Math.max(1, Math.round(seconds / 60))}m`;
}

function stripTrailingZero(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function buildAuditRecordsFromSnapshot(
  snapshot: ShowcaseSnapshotV1,
  sourceIssues: EngineeringIssue[],
): AuditRecord[] {
  const issueByTaskId = new Map<string, EngineeringIssue>();
  for (const issue of sourceIssues) {
    if (!issueByTaskId.has(issue.taskId)) {
      issueByTaskId.set(issue.taskId, issue);
    }
  }
  const jiraTaskIds = new Set(issueByTaskId.keys());

  return snapshot.mcpCalls
    .filter(
      (call) =>
        jiraTaskIds.has(call.task_id) && call.mcp_server_name === "jira-reader",
    )
    .map((call, index) => {
      const issue = issueByTaskId.get(call.task_id);
      return {
        id: `jira-audit-${call.task_id}-${call.mcp_tool_name ?? "unknown"}-${index}`,
        issueKey: issue?.key ?? call.task_id,
        skill: `JiraReader.${call.mcp_tool_name ?? "unknown"}`,
        agent: "JiraReader MCP",
        workflow: "jira_readonly",
        duration:
          call.latency_ms === null
            ? "未记录"
            : `${Math.round(call.latency_ms)}ms`,
        status: call.success === false ? "失败" : "已完成",
        artifacts: ["Trace", "Jira"],
        time: "真实 trace",
      };
    });
}

function isHighPriority(priority: string) {
  const normalized = priority.toLowerCase();
  return (
    priority.includes("高") ||
    priority.includes("加急") ||
    normalized.includes("high") ||
    normalized.includes("critical") ||
    normalized.includes("blocker") ||
    normalized === "p0" ||
    normalized === "p1"
  );
}

function isClosedStatus(status: string) {
  return ["已关闭", "无效驳回"].includes(status);
}

function formatMessageTime() {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}

function nextAssistantMessageId(role: AssistantMessage["role"]) {
  assistantMessageSeq += 1;
  return `${role}-${Date.now()}-${assistantMessageSeq}`;
}

function disposeAssistantAvatar() {
  assistantAvatarCleanup?.();
  assistantAvatarCleanup = undefined;
}

function setupAssistantAvatar() {
  const canvas = assistantAvatarCanvas.value;
  if (!canvas) return;

  disposeAssistantAvatar();
  assistantAvatarReady.value = false;

  try {
    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
    });
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    const root = new THREE.Group();
    const orbit = new THREE.Group();
    const resources: Array<{ dispose: () => void }> = [];
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    let frameId: number | undefined;

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    camera.position.set(0, 0.15, 5.2);
    scene.add(root);
    scene.add(orbit);
    scene.add(new THREE.AmbientLight(0xffffff, 1.8));

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.6);
    keyLight.position.set(3, 4, 5);
    scene.add(keyLight);

    const rimLight = new THREE.PointLight(0x48c6ff, 4.2, 7);
    rimLight.position.set(-2.5, 1.4, 2.6);
    scene.add(rimLight);

    const texture = new THREE.TextureLoader().load(
      mascotVirtualAssistant,
      () => {
        assistantAvatarReady.value = true;
      },
    );
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    resources.push(texture);

    const avatarGeometry = new THREE.PlaneGeometry(2.52, 2.52);
    const avatarMaterial = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
    });
    resources.push(avatarGeometry, avatarMaterial);

    const glowGeometry = new THREE.PlaneGeometry(2.76, 2.76);
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: 0x3aa7ff,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
    });
    resources.push(glowGeometry, glowMaterial);

    const glow = new THREE.Mesh(glowGeometry, glowMaterial);
    glow.position.set(0, 0.05, -0.05);
    root.add(glow);

    const avatar = new THREE.Mesh(avatarGeometry, avatarMaterial);
    avatar.position.set(0, 0.08, 0);
    root.add(avatar);

    const platformGeometry = new THREE.CylinderGeometry(1.22, 1.42, 0.2, 64);
    const platformMaterial = new THREE.MeshStandardMaterial({
      color: 0x123f68,
      emissive: 0x0b3d68,
      emissiveIntensity: 0.52,
      metalness: 0.45,
      roughness: 0.24,
    });
    resources.push(platformGeometry, platformMaterial);

    const platform = new THREE.Mesh(platformGeometry, platformMaterial);
    platform.position.set(0, -1.18, -0.06);
    platform.scale.set(1, 0.55, 1);
    root.add(platform);

    const ringGeometry = new THREE.TorusGeometry(1.54, 0.018, 12, 112);
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0x53e6ff,
      transparent: true,
      opacity: 0.72,
    });
    resources.push(ringGeometry, ringMaterial);

    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = -1.05;
    orbit.add(ring);

    const dotGeometry = new THREE.SphereGeometry(0.045, 18, 18);
    const dotMaterial = new THREE.MeshBasicMaterial({ color: 0x6dffcf });
    resources.push(dotGeometry, dotMaterial);

    const dots = [0, 1, 2].map((index) => {
      const dot = new THREE.Mesh(dotGeometry, dotMaterial);
      const angle = (index / 3) * Math.PI * 2;
      dot.position.set(Math.cos(angle) * 1.32, -1.05, Math.sin(angle) * 1.32);
      orbit.add(dot);
      return dot;
    });

    const resize = () => {
      const parent = canvas.parentElement;
      const width = Math.max(parent?.clientWidth ?? 240, 180);
      const height = Math.max(parent?.clientHeight ?? 220, 180);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };

    resize();
    window.addEventListener("resize", resize);

    const animate = (time: number) => {
      const seconds = time / 1000;
      root.position.y = reducedMotion ? 0 : Math.sin(seconds * 1.8) * 0.045;
      root.rotation.y = reducedMotion ? 0 : Math.sin(seconds * 1.15) * 0.12;
      glow.scale.setScalar(1 + Math.sin(seconds * 2.1) * 0.035);
      orbit.rotation.y = reducedMotion ? 0 : seconds * 0.85;
      dots.forEach((dot, index) => {
        dot.position.y = -1.05 + Math.sin(seconds * 2 + index) * 0.055;
      });
      renderer.render(scene, camera);
      frameId = window.requestAnimationFrame(animate);
    };

    frameId = window.requestAnimationFrame(animate);
    assistantAvatarCleanup = () => {
      if (frameId !== undefined) {
        window.cancelAnimationFrame(frameId);
      }
      window.removeEventListener("resize", resize);
      resources.forEach((resource) => resource.dispose());
      renderer.dispose();
      assistantAvatarReady.value = false;
    };
  } catch {
    assistantAvatarReady.value = false;
  }
}

function resolveInitialThemeMode(): ThemeMode {
  if (typeof window === "undefined") {
    return "day";
  }

  const storedTheme = window.localStorage.getItem(themeStorageKey);
  return storedTheme === "day" || storedTheme === "night"
    ? storedTheme
    : "day";
}

function toggleThemeMode() {
  const nextTheme = themeMode.value === "day" ? "night" : "day";
  themeMode.value = nextTheme;

  if (typeof window !== "undefined") {
    window.localStorage.setItem(themeStorageKey, nextTheme);
  }
}

onMounted(() => {
  setupAssistantAvatar();
  void refreshIntegrationStatus();
  clockTimer = window.setInterval(() => {
    currentTime.value = new Date();
  }, 30_000);
});

onBeforeUnmount(() => {
  disposeAssistantAvatar();
  if (clockTimer !== undefined) {
    window.clearInterval(clockTimer);
  }
  if (configFeedbackTimer !== undefined) {
    window.clearTimeout(configFeedbackTimer);
  }
});

function buildOptions(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) =>
    left.localeCompare(right, "zh-CN"),
  );
}

function buildLiveJiraIssues(
  jiraIssues: ShowcaseJiraIssue[],
): EngineeringIssue[] {
  return jiraIssues
    .filter((issue) => issue.execution_mode === "live")
    .map((issue) => {
      const project = issue.project ?? "APMIS";
      const priority = issue.priority ?? "未设置";
      const riskTone = resolveJiraRiskTone(priority);
      const sourceRefs = [
        ...new Set([`jira:${issue.key}`, ...issue.source_refs]),
      ];
      const targetVersion =
        issue.target_version ?? issue.fix_versions?.[0] ?? "未设置";
      const affectedVersion = issue.affected_versions?.[0] ?? undefined;
      const productModule = issue.product_module ?? project;
      const angular17Signals = collectAngular17Signals({
        summary: issue.summary,
        description: issue.description ?? "",
        labels: issue.labels,
        productModule,
      });
      const angular17Matched = angular17Signals.some((signal) =>
        signal.includes("Angular17"),
      );
      const impactedRepos = angular17Matched
        ? [`${angular17Repo}@${angular17Branch}`]
        : [];
      const impactedModules = uniqueValues([
        productModule,
        ...issue.labels,
        ...(angular17Matched
          ? ["Angular17", "odcbs-frontend", angular17Branch]
          : []),
      ]);
      const mcpCalls = snapshotData.mcpCalls
        .filter(
          (call) =>
            call.task_id === issue.task_id &&
            call.mcp_server_name === "jira-reader",
        )
        .map(
          (call) => `JiraReader.${formatIntegrationSignal(call.mcp_tool_name)}`,
        );
      return {
        taskId: issue.task_id,
        key: issue.key,
        summary: issue.summary,
        project,
        projectName: issue.project_name ?? project,
        fixVersion: targetVersion,
        sprint: "",
        epic: "",
        issueType: issue.issue_type ?? "未设置",
        status: issue.status ?? "未知",
        priority,
        assignee: issue.assignee ?? "未分配",
        assigneeRole: "Jira 负责人",
        storyPoints: 0,
        component: productModule,
        affectedVersion,
        targetVersion,
        productModule,
        defectCategory: issue.defect_category ?? undefined,
        issueCategory: issue.issue_category ?? undefined,
        projectSource: issue.project_source ?? undefined,
        coreRecovery: issue.core_recovery ?? undefined,
        requirementReleased: issue.requirement_released ?? undefined,
        created: issue.created ?? undefined,
        updated: issue.updated ?? undefined,
        dueDate: issue.due_date ?? undefined,
        originalEstimateSeconds: issue.original_estimate_seconds ?? undefined,
        remainingEstimateSeconds: issue.remaining_estimate_seconds ?? undefined,
        timeSpentSeconds: issue.time_spent_seconds ?? undefined,
        labels: issue.labels,
        gitlabMr: "未接入 GitLab",
        gitlabScore: null,
        mrUrl: "#",
        riskLevel:
          riskTone === "danger"
            ? "高危"
            : riskTone === "warn"
              ? "待评估"
              : "常规",
        riskTone,
        observedTime: formatJiraDate(issue.updated ?? issue.created),
        description: issue.description ?? "",
        expectation:
          "基于 Jira 描述、状态、优先级、版本和自定义字段进行工程调度。",
        impactedRepos,
        impactedModules,
        aiUnderstanding: [
          `真实 Jira 来源：${issue.key}`,
          `当前状态：${issue.status ?? "未知"}，优先级：${priority}`,
          `目标版本：${targetVersion}，产品线和模块：${productModule}`,
          ...(angular17Matched
            ? [
                `业务 Skill 命中：Angular17 升级回归 -> ${angular17Repo}/${angular17Branch}`,
              ]
            : []),
        ],
        plan: [
          {
            step: "读取 Jira 描述与评论",
            owner: "JiraReader MCP",
            due: "已完成",
            done: true,
          },
          {
            step: "确认需求理解与影响范围",
            owner: issue.assignee ?? "未分配",
            due: issue.due_date ?? "未设置",
            done: false,
          },
          {
            step: "按需分配 Skill 并进入调度",
            owner: "产品经理",
            due: "待执行",
            done: false,
          },
        ],
        skills: angular17Matched ? ["Angular17 升级回归分析"] : [],
        mcpCalls,
        evidence: sourceRefs.map((sourceRef) => ({
          name: sourceRef,
          size: "live",
        })),
        reasoning: [
          `Jira 状态：${issue.status ?? "未知"}`,
          `负责人：${issue.assignee ?? "未分配"}`,
          `更新时间：${formatJiraDate(issue.updated ?? issue.created)}`,
          ...(angular17Matched
            ? [
                "命中 Angular17 前端升级规则，建议进入 odcbs-frontend/develop_to_angular17 做代码分析。",
                ...angular17Signals,
              ]
            : []),
        ],
        decision:
          riskTone === "danger"
            ? "高优先级 Jira 需要产品经理确认调度策略。"
            : "按当前 Jira 状态进入常规调度。",
      } satisfies EngineeringIssue;
    })
    .sort((left, right) => compareIssueUpdatedDesc(left, right));
}

function compareIssueUpdatedDesc(
  left: EngineeringIssue,
  right: EngineeringIssue,
) {
  const leftTime =
    left.updated === undefined ? 0 : new Date(left.updated).getTime();
  const rightTime =
    right.updated === undefined ? 0 : new Date(right.updated).getTime();
  return rightTime - leftTime;
}

function formatJiraDate(value: string | null | undefined) {
  if (value === undefined || value === null || value.length === 0)
    return "未记录";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function formatIntegrationSignal(value: string | null | undefined) {
  if (
    value === undefined ||
    value === null ||
    value.length === 0 ||
    value === "unknown"
  ) {
    return "未接入";
  }
  return value;
}

function formatFleetFanout(value: number | null | undefined) {
  if (value === undefined || value === null) return "fanout 未接入";
  return `fanout ${value}`;
}

function formatArenaCandidateCount(value: number | null | undefined) {
  if (value === undefined || value === null) return "arena 未接入";
  return `arena ${value}候选`;
}

function formatArenaScores(
  scores: ShowcaseArenaSummary["scores"] | null | undefined,
) {
  if (scores === undefined || scores === null) return "四维分 未接入";
  return [
    `C ${scores.correctness}`,
    `S ${scores.style}`,
    `T ${scores.testCoverage}`,
    `D ${scores.diffMinimality}`,
  ].join(" / ");
}

function formatArenaDelta(value: number | null | undefined) {
  if (value === undefined || value === null) return "delta 未接入";
  return `delta ${value}`;
}

function formatArenaScorer(arena: ShowcaseArenaSummary | null) {
  return `${arena?.scorer_mode ?? "mock"}/${arena?.real_scorer ?? "未接入"}`;
}

function resolveJiraRiskTone(priority: string): Tone {
  const normalized = priority.toLowerCase();
  if (
    normalized.includes("blocker") ||
    normalized.includes("critical") ||
    normalized.includes("high") ||
    priority.includes("高")
  ) {
    return "danger";
  }
  if (
    normalized.includes("medium") ||
    priority.includes("中") ||
    priority.includes("待")
  )
    return "warn";
  return "neutral";
}

function uniqueValues(values: string[]) {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function collectAngular17Signals(input: {
  summary: string;
  description?: string;
  labels?: string[];
  productModule?: string;
}) {
  const text = [
    input.summary,
    input.description ?? "",
    input.productModule ?? "",
    ...(input.labels ?? []),
  ]
    .join(" ")
    .toLowerCase();
  const signals: string[] = [];

  if (/angular\s*17|angular17/.test(text)) {
    signals.push("标题/描述包含 Angular17");
  }
  if (/升级后|upgrade regression|回归/.test(text)) {
    signals.push("升级后回归风险");
  }
  if (/空白|blank page|加载不出来/.test(text)) {
    signals.push("空白页或加载异常");
  }
  if (/图标|icon|twotone|颜色|底色/.test(text)) {
    signals.push("图标或样式漂移");
  }
  if (/布局|变形|行高|modal|dynamic-form|table|ng-zorro/.test(text)) {
    signals.push("组件布局/表单/表格异常");
  }

  return uniqueValues(signals);
}

function getBusinessSkillMatch(issue: EngineeringIssue): BusinessSkillMatch | null {
  const signals = collectAngular17Signals(issue);
  const isAngular17 = signals.some((signal) => signal.includes("Angular17"));
  if (!isAngular17) return null;

  return {
    id: "angular17-frontend-regression",
    label: angular17MappingPreview.value.recommendedSkill,
    skillId: angular17SkillId,
    confidence:
      signals.length >= 2
        ? "高置信"
        : angular17MappingPreview.value.confidenceRule,
    repo: angular17MappingPreview.value.repository,
    branch: angular17MappingPreview.value.branch,
    reason: `命中规则：${angular17MappingPreview.value.keyword} -> ${angular17MappingPreview.value.repository}@${angular17MappingPreview.value.branch}`,
    signals,
    analysisFocus: angular17AnalysisFocus,
  };
}

function getRecommendedSkillIds(issue: EngineeringIssue) {
  const base = getBusinessSkillMatch(issue)
    ? ["clarify", "impact", angular17SkillId, "code", "plan"]
    : ["clarify", "impact", "code", "plan"];
  if (issue.riskTone === "danger") return [...base, "security", "review"];
  if (issue.gitlabScore !== null) return [...base, "review"];
  return [...base, "test"];
}

function ensureSkillAssignment(issue = selectedIssue.value) {
  const existing = skillAssignments.value[issue.key];
  if (existing !== undefined) return existing;
  const defaults = getRecommendedSkillIds(issue);
  skillAssignments.value = {
    ...skillAssignments.value,
    [issue.key]: defaults,
  };
  return defaults;
}

function getAssignedSkillNames(issue: EngineeringIssue) {
  const skillIds = skillAssignments.value[issue.key];
  if (skillIds === undefined) return issue.skills.slice(0, 2);
  const candidateNames = skillIds
    .map((skillId) => skillCandidates.find((skill) => skill.id === skillId))
    .filter((skill): skill is SkillCandidate => skill !== undefined)
    .map((skill) => skill.name);
  return candidateNames.length > 0 ? candidateNames : issue.skills.slice(0, 2);
}

function getDispatchStatus(issue: EngineeringIssue): DispatchStatus {
  const override = dispatchOverrides.value[issue.key];
  if (override !== undefined) return override;
  if (issue.status.includes("失败") || issue.status === "无效驳回") return "失败";
  if (["待处理", "待确认", "已挂起"].includes(issue.status))
    return "等待人工确认";
  if (["已完成", "已关闭"].includes(issue.status)) return "已完成";
  if (issue.riskTone === "danger") return "等待人工确认";
  if (["处理中", "进行中"].includes(issue.status)) return "Agent 执行中";
  if (["已开发完成", "提交测试", "代码评审"].includes(issue.status))
    return "MR 待 Review";
  return "待编排";
}

function resolveOrchestrationStatus(
  issue: EngineeringIssue,
  dispatchStatus: DispatchStatus,
): OrchestrationStatus {
  if (dispatchStatus === "失败") return "失败";
  if (dispatchStatus === "已完成") return "已完成";
  if (dispatchStatus === "等待人工确认") return "等待人工处理";
  if (
    dispatchStatus === "Agent 执行中" ||
    dispatchStatus === "MR 待 Review" ||
    dispatchStatus === "Skill 已分配"
  ) {
    return "编排中";
  }
  if (
    dispatchStatus === "草稿" &&
    getAssignedSkillNames(issue).length > 0 &&
    issue.description.trim().length > 0
  ) {
    return "编排中";
  }
  return "待开始";
}

function buildMockOrchestrationRuntime(
  issue: EngineeringIssue,
  dispatchStatus: DispatchStatus,
  now: Date,
): JiraOrchestrationRuntime {
  const orchestrationStatus = resolveOrchestrationStatus(issue, dispatchStatus);
  const nowMs = now.getTime();
  const statusPresetByDispatch: Record<
    DispatchStatus,
    {
      completedUntil: number;
      activeIndex: number;
      activeStatus: StageRuntimeStatus;
      progress: number;
    }
  > = {
    待编排: {
      completedUntil: -1,
      activeIndex: 0,
      activeStatus: "pending",
      progress: 0,
    },
    草稿: {
      completedUntil: 0,
      activeIndex: 1,
      activeStatus: "pending",
      progress: 10,
    },
    "Skill 已分配": {
      completedUntil: 0,
      activeIndex: 1,
      activeStatus: "running",
      progress: 18,
    },
    "Agent 执行中": {
      completedUntil: 1,
      activeIndex: 2,
      activeStatus: "running",
      progress: 42,
    },
    "MR 待 Review": {
      completedUntil: 5,
      activeIndex: 6,
      activeStatus: "running",
      progress: 82,
    },
    等待人工确认: {
      completedUntil: 3,
      activeIndex: 4,
      activeStatus: "waiting",
      progress: 66,
    },
    已完成: {
      completedUntil: orchestrationStageBlueprint.length - 1,
      activeIndex: orchestrationStageBlueprint.length - 1,
      activeStatus: "done",
      progress: 100,
    },
    失败: {
      completedUntil: 1,
      activeIndex: 2,
      activeStatus: "failed",
      progress: 37,
    },
  };
  const preset = statusPresetByDispatch[dispatchStatus];
  const completedUntil = Math.min(
    preset.completedUntil,
    orchestrationStageBlueprint.length - 1,
  );
  const activeIndex = Math.min(
    Math.max(preset.activeIndex, 0),
    orchestrationStageBlueprint.length - 1,
  );

  const waitReason =
    orchestrationStatus === "等待人工处理"
      ? issue.riskTone === "danger"
        ? "高风险变更需主管确认后继续。"
        : "等待经办人补充 Jira 关键信息。"
      : null;
  const failureReason =
    orchestrationStatus === "失败"
      ? "代码检索阶段未找到可写分支或缺少必要上下文。"
      : null;

  const stageEstimateMinutes = orchestrationStageBlueprint.reduce(
    (sum, stage) => sum + stage.estimateMinutes,
    0,
  );
  const elapsedMinutes =
    orchestrationStatus === "已完成"
      ? stageEstimateMinutes
      : Math.max(1, Math.round((preset.progress / 100) * stageEstimateMinutes));
  const remainingMinutes =
    orchestrationStatus === "已完成"
      ? 0
      : orchestrationStatus === "失败"
        ? null
        : Math.max(3, stageEstimateMinutes - elapsedMinutes);
  const startedAtMs = nowMs - elapsedMinutes * 60_000;

  let stageCursor = startedAtMs;
  const stages: OrchestrationStageRuntime[] = orchestrationStageBlueprint.map(
    (stage, index) => {
      const startAtMs = stageCursor;
      const endAtMs = startAtMs + stage.estimateMinutes * 60_000;
      stageCursor = endAtMs;

      let status: StageRuntimeStatus = "pending";
      if (index <= completedUntil) {
        status = "done";
      } else if (index === activeIndex) {
        status = preset.activeStatus;
      }

      const reason =
        index === activeIndex && status === "waiting"
          ? waitReason
          : index === activeIndex && status === "failed"
            ? failureReason
            : null;

      return {
        id: stage.id,
        name: stage.name,
        description: stage.description,
        agent: stage.agent,
        skill: stage.skill,
        status,
        started_at:
          status === "pending" ? null : new Date(startAtMs).toISOString(),
        ended_at:
          status === "done" || status === "failed"
            ? new Date(status === "failed" ? nowMs : endAtMs).toISOString()
            : null,
        reason,
      };
    },
  );

  const currentStage =
    orchestrationStatus === "已完成"
      ? stages[stages.length - 1]
      : stages[activeIndex] ?? null;
  const progressPercent =
    orchestrationStatus === "已完成" ? 100 : clampPercent(preset.progress);
  const etaSeconds =
    remainingMinutes === null ? null : Math.max(0, remainingMinutes * 60);
  const etaAt =
    etaSeconds === null ? null : new Date(nowMs + etaSeconds * 1000).toISOString();

  const artifacts = buildMockArtifacts(
    completedUntil,
    activeIndex,
    orchestrationStatus,
  );
  const events = buildMockOrchestrationEvents(
    issue,
    stages,
    orchestrationStatus,
    waitReason,
    failureReason,
  );

  return {
    issue_key: issue.key,
    status: orchestrationStatus,
    progress_percent: progressPercent,
    current_stage_id: currentStage?.id ?? null,
    current_stage_name:
      orchestrationStatus === "已完成"
        ? "全部完成"
        : (currentStage?.name ?? "待开始"),
    current_agent:
      orchestrationStatus === "已完成"
        ? "Orchestrator"
        : (currentStage?.agent ?? "Orchestrator"),
    current_skill:
      orchestrationStatus === "已完成"
        ? "收尾归档"
        : (currentStage?.skill ?? "未分配"),
    started_at: new Date(startedAtMs).toISOString(),
    elapsed_seconds: elapsedMinutes * 60,
    eta_seconds: etaSeconds,
    eta_at: etaAt,
    wait_reason: waitReason,
    failure_reason: failureReason,
    stages,
    artifacts,
    events,
  };
}

function buildMockArtifacts(
  completedUntil: number,
  activeIndex: number,
  status: OrchestrationStatus,
): OrchestrationArtifactRuntime[] {
  const analysisReady = completedUntil >= 3;
  const reviewReady = completedUntil >= 4;
  const evidenceReady = completedUntil >= 5;
  const mrReady = completedUntil >= 6;
  const evalReady = completedUntil >= 7;
  const failed = status === "失败";

  return [
    {
      id: "analysis-summary",
      name: "方案摘要",
      status: failed && activeIndex <= 3 ? "failed" : analysisReady ? "ready" : "running",
      detail: analysisReady
        ? "已生成影响面与修复建议。"
        : "正在整理 Jira 理解与方案草稿。",
    },
    {
      id: "evidence-pack",
      name: "Evidence Pack",
      status: failed && activeIndex >= 5 ? "failed" : evidenceReady ? "ready" : "pending",
      detail: evidenceReady ? "Trace、MCP 调用与证据链接已归档。" : "等待生成。",
    },
    {
      id: "mr-draft",
      name: "MR/产物",
      status: failed && activeIndex >= 6 ? "failed" : mrReady ? "ready" : "pending",
      detail: mrReady ? "MR 草稿与产物清单已输出。" : "等待生成。",
    },
    {
      id: "eval-report",
      name: "Eval 回归报告",
      status: evalReady ? "ready" : failed ? "failed" : reviewReady ? "running" : "pending",
      detail: evalReady ? "回归通过并归档评分结果。" : "等待回归执行。",
    },
  ];
}

function buildMockOrchestrationEvents(
  issue: EngineeringIssue,
  stages: OrchestrationStageRuntime[],
  status: OrchestrationStatus,
  waitReason: string | null,
  failureReason: string | null,
): OrchestrationEventRuntime[] {
  const events: OrchestrationEventRuntime[] = [
    {
      id: `${issue.key}-start`,
      stage_id: null,
      level: "info",
      at: stages[0]?.started_at ?? new Date().toISOString(),
      title: "进入 Agent 编排",
      detail: `${issue.key} 已进入调度流水线。`,
    },
  ];

  stages.forEach((stage) => {
    if (stage.status === "done") {
      events.push({
        id: `${issue.key}-${stage.id}-done`,
        stage_id: stage.id,
        level: "success",
        at: stage.ended_at ?? stage.started_at ?? new Date().toISOString(),
        title: `${stage.name} 完成`,
        detail: `${stage.agent} 已完成 ${stage.skill}。`,
      });
    } else if (stage.status === "running") {
      events.push({
        id: `${issue.key}-${stage.id}-running`,
        stage_id: stage.id,
        level: "info",
        at: stage.started_at ?? new Date().toISOString(),
        title: `${stage.name} 执行中`,
        detail: `${stage.agent} 正在处理 ${stage.skill}。`,
      });
    } else if (stage.status === "waiting") {
      events.push({
        id: `${issue.key}-${stage.id}-waiting`,
        stage_id: stage.id,
        level: "warn",
        at: stage.started_at ?? new Date().toISOString(),
        title: `${stage.name} 等待人工处理`,
        detail: waitReason ?? "等待人工确认。",
      });
    } else if (stage.status === "failed") {
      events.push({
        id: `${issue.key}-${stage.id}-failed`,
        stage_id: stage.id,
        level: "error",
        at: stage.ended_at ?? new Date().toISOString(),
        title: `${stage.name} 失败`,
        detail: failureReason ?? "执行失败。",
      });
    }
  });

  return events.slice(-8);
}

function clampPercent(value: number) {
  return Math.min(100, Math.max(0, Math.round(value)));
}

function formatStageElapsed(startedAt: string | null, endedAt: string | null) {
  if (startedAt === null) return "未开始";
  const startMs = new Date(startedAt).getTime();
  if (Number.isNaN(startMs)) return "进行中";
  const endMs =
    endedAt === null ? currentTime.value.getTime() : new Date(endedAt).getTime();
  if (Number.isNaN(endMs)) return "进行中";
  return `${Math.max(1, Math.round((endMs - startMs) / 60_000))}m`;
}

function mapRuntimeStageStatus(stageStatus: StageRuntimeStatus) {
  if (stageStatus === "done") return "ok";
  if (stageStatus === "running") return "running";
  if (stageStatus === "waiting") return "waiting";
  if (stageStatus === "failed") return "failed";
  return "pending";
}

function formatSecondsLabel(seconds: number) {
  if (seconds <= 0) return "0m";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.max(0, Math.round((seconds % 3600) / 60));
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

function resolveCurrentAgent(issue: EngineeringIssue) {
  const status = getDispatchStatus(issue);
  if (status === "Agent 执行中") return "Impact Analyst";
  if (status === "MR 待 Review") return "Reviewer Agent";
  if (status === "等待人工确认") return "PM Agent";
  if (status === "Skill 已分配") return "Orchestrator";
  return "PM Agent";
}

function selectIssue(issueKey: string) {
  selectedIssueKey.value = issueKey;
  selectedRuntimeStageId.value = null;
  selectedDrawerTab.value = "overview";
  drawerVisible.value = true;
  descriptionExpanded.value = false;
  mcpDetailExpanded.value = false;
}

function isNavItemEnabled(item: string) {
  return enabledNavItems.includes(item as (typeof enabledNavItems)[number]);
}

function handleNavItemClick(item: string) {
  activeNavItem.value = item;
  if (item === "Jira 调度" || item === "配置") {
    moduleNotice.value = null;
    return;
  }

  moduleNotice.value = {
    module: item,
    title: `${item} 暂未开发`,
    detail:
      moduleNoticeMessages[item] ??
      "该模块还未接入当前 Showcase，当前仅开放 Jira 调度与 Skill 编排主流程。",
  };
}

function getIntegrationEndpoint(
  id: ShowcaseIntegrationEndpointStatus["id"],
): ShowcaseIntegrationEndpointStatus | null {
  return (
    integrationStatus.value.endpoints.find((endpoint) => endpoint.id === id) ??
    null
  );
}

async function refreshIntegrationStatus() {
  integrationStatusLoading.value = true;
  integrationStatusError.value = null;
  try {
    const response = await fetch(integrationStatusApiPath, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const payload = (await response.json()) as ShowcaseIntegrationStatus;
    integrationStatus.value = payload;
    hydrateDraftConfigFromRuntime(payload);
  } catch (error) {
    integrationStatusError.value =
      error instanceof Error ? error.message : "读取运行配置失败";
  } finally {
    integrationStatusLoading.value = false;
  }
}

function hydrateDraftConfigFromRuntime(status: ShowcaseIntegrationStatus) {
  const jira = status.endpoints.find((endpoint) => endpoint.id === "jira");
  const gitlab = status.endpoints.find((endpoint) => endpoint.id === "gitlab");
  const mcp = status.endpoints.find((endpoint) => endpoint.id === "mcp");
  const nextSaved = cloneConfigState(savedConfigState.value);

  if (jira?.displayUrl !== null && jira?.displayUrl !== undefined) {
    nextSaved.jira.baseUrl = jira.displayUrl;
    nextSaved.jira.token = credentialStateLabel(jira);
    nextSaved.jira.lastTestResult = runtimeStatusLabel(jira);
  }
  if (gitlab?.displayUrl !== null && gitlab?.displayUrl !== undefined) {
    nextSaved.gitlab.baseUrl = gitlab.displayUrl;
    nextSaved.gitlab.token = credentialStateLabel(gitlab);
    nextSaved.gitlab.lastTestResult = runtimeStatusLabel(gitlab);
  }
  if (mcp !== undefined) {
    nextSaved.mcp.notes = mcp.applyMode;
  }

  savedConfigState.value = nextSaved;
  draftConfigState.value = cloneConfigState(nextSaved);
}

function runtimeStatusLabel(endpoint: ShowcaseIntegrationEndpointStatus) {
  return `${endpoint.configured ? "运行配置已检测到" : "运行配置缺失"}（${formatMessageTime()}）`;
}

function credentialStateLabel(endpoint: ShowcaseIntegrationEndpointStatus) {
  if (endpoint.credentialState === "present") return "已由运行环境配置";
  if (endpoint.credentialState === "not_required") return "当前模式无需密钥";
  return "运行环境未检测到密钥";
}

function formatCredentialState(endpoint: ShowcaseIntegrationEndpointStatus) {
  if (endpoint.credentialState === "present") return "密钥已配置";
  if (endpoint.credentialState === "not_required") return "无需密钥";
  return "密钥缺失";
}

function formatIntegrationDisplayUrl(endpoint: ShowcaseIntegrationEndpointStatus) {
  return endpoint.displayUrl ?? "未配置";
}

function formatIntegrationGeneratedAt(value: string) {
  return formatJiraDate(value);
}

function setConfigFeedback(feedback: ConfigFeedback) {
  configFeedback.value = feedback;
  if (configFeedbackTimer !== undefined) {
    window.clearTimeout(configFeedbackTimer);
  }
  configFeedbackTimer = window.setTimeout(() => {
    configFeedback.value = null;
  }, 3800);
}

function persistConfigState() {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    configStorageKey,
    JSON.stringify(savedConfigState.value),
  );
}

function persistConfigChangeRequests() {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    configChangeRequestStorageKey,
    JSON.stringify(configChangeRequests.value.slice(0, 20)),
  );
}

function createConfigChangeRequest(section: ConfigSectionKey) {
  const endpoint = resolveSectionEndpoint(section);
  const request: ConfigChangeRequest = {
    id: `cfg-${Date.now()}-${section}`,
    section,
    sectionTitle: configSectionTitles[section],
    createdAt: formatMessageTime(),
    status: "awaiting_policy_gate",
    summary: summarizeConfigChange(section),
    applyMode:
      endpoint?.applyMode ??
      "页面只保存变更申请；真实生效需要后端配置服务、PolicyGate 审批和运行时重载",
  };
  configChangeRequests.value = [request, ...configChangeRequests.value].slice(
    0,
    20,
  );
  persistConfigChangeRequests();
  return request;
}

function resolveSectionEndpoint(
  section: ConfigSectionKey,
): ShowcaseIntegrationEndpointStatus | null {
  if (section === "jira") return jiraRuntimeStatus.value;
  if (section === "gitlab") return gitlabRuntimeStatus.value;
  if (section === "mcp") return mcpRuntimeStatus.value;
  if (section === "codeRetrieval") return getIntegrationEndpoint("codeRetrieval");
  return null;
}

function summarizeConfigChange(section: ConfigSectionKey) {
  if (section === "jira") {
    return `Jira Base URL=${draftConfigState.value.jira.baseUrl || "未填写"}，Project=${draftConfigState.value.jira.projectKey}`;
  }
  if (section === "gitlab") {
    return `GitLab=${draftConfigState.value.gitlab.baseUrl || "未填写"}，Project=${draftConfigState.value.gitlab.groupOrProject}，Branch=${draftConfigState.value.gitlab.defaultBranch}`;
  }
  if (section === "mcp") {
    return `MCP Allow List=${draftConfigState.value.mcp.allowList}，Timeout=${draftConfigState.value.mcp.defaultTimeoutMs}ms`;
  }
  if (section === "codeRetrieval") {
    return `仓库规则 ${draftConfigState.value.codeRetrieval.repoMappings.length} 条，Jira 关键词规则 ${draftConfigState.value.codeRetrieval.jiraKeywordRules.length} 条`;
  }
  if (section === "agent") {
    return `Planner=${draftConfigState.value.agent.plannerAgent}，Reviewer=${draftConfigState.value.agent.reviewerAgent}，并发=${draftConfigState.value.agent.maxParallelism}`;
  }
  if (section === "skillRules") {
    return `Skill 匹配规则 ${draftConfigState.value.skillRules.length} 条`;
  }
  return `审计留存=${draftConfigState.value.securityAudit.auditRetentionDays} 天，人工审批=${draftConfigState.value.securityAudit.requireHumanApproval ? "开启" : "关闭"}`;
}

function beginEditConfigSection(section: ConfigSectionKey) {
  editingConfigSections.value = {
    ...editingConfigSections.value,
    [section]: true,
  };
  setConfigFeedback({
    tone: "neutral",
    title: `${configSectionTitles[section]} 已进入编辑`,
    detail:
      "当前修改会形成本地变更申请；真实生效仍需要后端配置服务、PolicyGate 审批和 MCP 重启或热加载。",
  });
}

function saveConfigSection(section: ConfigSectionKey) {
  const nextSaved = {
    ...savedConfigState.value,
    [section]: cloneConfigState(draftConfigState.value[section]),
    updatedAt: formatMessageTime(),
  } as ConfigCenterState;
  savedConfigState.value = nextSaved;
  draftConfigState.value = cloneConfigState(nextSaved);
  editingConfigSections.value = {
    ...editingConfigSections.value,
    [section]: false,
  };
  persistConfigState();
  const request = createConfigChangeRequest(section);
  setConfigFeedback({
    tone: "warn",
    title: `${configSectionTitles[section]} 已提交变更申请`,
    detail: `${request.id} 已保存为本地待审批申请；当前框架运行配置尚未被自动修改。`,
  });
}

function cancelConfigSection(section: ConfigSectionKey) {
  draftConfigState.value = {
    ...draftConfigState.value,
    [section]: cloneConfigState(savedConfigState.value[section]),
  } as ConfigCenterState;
  editingConfigSections.value = {
    ...editingConfigSections.value,
    [section]: false,
  };
  setConfigFeedback({
    tone: "warn",
    title: `${configSectionTitles[section]} 已取消修改`,
    detail: "草稿已回滚到上次保存的本地变更申请状态。",
  });
}

function resetConfigSection(section: ConfigSectionKey) {
  draftConfigState.value = {
    ...draftConfigState.value,
    [section]: cloneConfigState(defaultConfigState[section]),
  } as ConfigCenterState;
  editingConfigSections.value = {
    ...editingConfigSections.value,
    [section]: true,
  };
  setConfigFeedback({
    tone: "warn",
    title: `${configSectionTitles[section]} 已重置`,
    detail: "已恢复默认值，提交后会形成新的本地变更申请。",
  });
}

function testIntegrationConnection(target: "jira" | "gitlab" | "mcp") {
  const endpoint = getIntegrationEndpoint(target);
  const result =
    endpoint === null
      ? `未读取到运行配置（${formatMessageTime()}）`
      : runtimeStatusLabel(endpoint);
  if (target === "jira") {
    draftConfigState.value = {
      ...draftConfigState.value,
      jira: {
        ...draftConfigState.value.jira,
        lastTestResult: result,
      },
    };
  } else if (target === "gitlab") {
    draftConfigState.value = {
      ...draftConfigState.value,
      gitlab: {
        ...draftConfigState.value.gitlab,
        lastTestResult: result,
      },
    };
  }

  setConfigFeedback({
    tone: endpoint?.configured === true ? "ok" : "warn",
    title: `${
      target === "jira" ? "Jira" : target === "gitlab" ? "GitLab" : "MCP"
    } 运行配置检查完成`,
    detail:
      endpoint?.details.join("；") ??
      "未读取到本地运行配置接口；请检查 dev server。",
  });
}

function addCodeRetrievalKeywordRule() {
  draftConfigState.value.codeRetrieval.jiraKeywordRules.push({
    id: `jira-rule-${Date.now()}`,
    keyword: "",
    repository: "",
    module: "",
    branch: "",
  });
}

function removeCodeRetrievalKeywordRule(ruleId: string) {
  draftConfigState.value.codeRetrieval.jiraKeywordRules =
    draftConfigState.value.codeRetrieval.jiraKeywordRules.filter(
      (rule) => rule.id !== ruleId,
    );
}

function addSkillMatchRule() {
  draftConfigState.value.skillRules.push({
    id: `skill-rule-${Date.now()}`,
    businessKeyword: "",
    repository: "",
    branch: "",
    recommendedSkill: "",
    confidenceRule: "",
  });
}

function removeSkillMatchRule(ruleId: string) {
  draftConfigState.value.skillRules = draftConfigState.value.skillRules.filter(
    (rule) => rule.id !== ruleId,
  );
}

function openSkillDrawer(issueKey: string) {
  selectedIssueKey.value = issueKey;
  selectedRuntimeStageId.value = null;
  selectedDrawerTab.value = "skills";
  drawerVisible.value = true;
  ensureSkillAssignment();
}

function openRuntimeStage(stageId: string) {
  selectedRuntimeStageId.value = stageId;
  selectedDrawerTab.value = "steps";
  drawerVisible.value = true;
}

function openRuntimeDetails() {
  selectedRuntimeStageId.value = null;
  selectedDrawerTab.value = "steps";
  drawerVisible.value = true;
}

function setDrawerTab(tab: DrawerTab) {
  selectedDrawerTab.value = tab;
}

function closeDrawer() {
  drawerVisible.value = false;
}

function toggleFilterCollapsed() {
  filterCollapsed.value = !filterCollapsed.value;
}

function isIssueSelected(issueKey: string) {
  return selectedIssueKeys.value.includes(issueKey);
}

function toggleIssueSelection(issueKey: string, event: Event) {
  const checked = (event.target as HTMLInputElement).checked;
  selectedIssueKeys.value = checked
    ? [...new Set([...selectedIssueKeys.value, issueKey])]
    : selectedIssueKeys.value.filter((key) => key !== issueKey);
}

function toggleSkill(skillId: string, event: Event) {
  const checked = (event.target as HTMLInputElement).checked;
  const current = ensureSkillAssignment();
  skillAssignments.value = {
    ...skillAssignments.value,
    [selectedIssue.value.key]: checked
      ? [...new Set([...current, skillId])]
      : current.filter((id) => id !== skillId),
  };
}

function moveSkill(skillId: string, direction: -1 | 1) {
  const current = [...ensureSkillAssignment()];
  const index = current.indexOf(skillId);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return;
  const [removed] = current.splice(index, 1);
  current.splice(nextIndex, 0, removed);
  skillAssignments.value = {
    ...skillAssignments.value,
    [selectedIssue.value.key]: current,
  };
}

function setDispatchStatus(status: DispatchStatus) {
  dispatchOverrides.value = {
    ...dispatchOverrides.value,
    [selectedIssue.value.key]: status,
  };
}

function addAuditRecord(
  status: AuditRecord["status"],
  skill = selectedSkillRows.value[0]?.name ?? "Skill 编排",
  issue = selectedIssue.value,
) {
  auditRecords.value = [
    {
      id: `audit-${Date.now()}`,
      issueKey: issue.key,
      skill,
      agent: selectedSkillRows.value[0]?.agent ?? "Orchestrator",
      workflow: "change_request",
      duration: `${totalSkillEstimate.value}m`,
      status,
      artifacts: status === "草稿" ? ["证据包"] : ["证据包", "Trace"],
      time: formatMessageTime(),
    },
    ...auditRecords.value,
  ];
}

function getBulkKeys() {
  return selectedIssueKeys.value.length > 0
    ? selectedIssueKeys.value
    : [selectedIssue.value.key];
}

function applySkillTemplate(issueKeys = getBulkKeys()) {
  const nextAssignments = { ...skillAssignments.value };
  const nextOverrides = { ...dispatchOverrides.value };
  issueKeys.forEach((issueKey) => {
    const issue = issues.find((item) => item.key === issueKey);
    if (!issue) return;
    nextAssignments[issueKey] = getRecommendedSkillIds(issue);
    nextOverrides[issueKey] = "草稿";
  });
  skillAssignments.value = nextAssignments;
  dispatchOverrides.value = nextOverrides;
  addAuditRecord("草稿", `应用模板 ${issueKeys.length} 条`);
}

function applyBatchSkillTemplate() {
  applySkillTemplate(getBulkKeys());
}

function batchEnterValidation() {
  const nextOverrides = { ...dispatchOverrides.value };
  getBulkKeys().forEach((issueKey) => {
    const issue = issues.find((item) => item.key === issueKey);
    if (!issue) return;
    nextOverrides[issueKey] =
      issue.riskTone === "danger" ? "等待人工确认" : "Skill 已分配";
  });
  dispatchOverrides.value = nextOverrides;
  addAuditRecord("等待", `批量进入校验 ${getBulkKeys().length} 条`);
}

function clearIssueSelection() {
  selectedIssueKeys.value = [];
}

function saveSkillDraft() {
  ensureSkillAssignment();
  setDispatchStatus("草稿");
  addAuditRecord("草稿", "Skill 草稿");
}

function saveSkillPlan() {
  ensureSkillAssignment();
  setDispatchStatus("Skill 已分配");
  addAuditRecord("等待", "Skill 编排");
}

function validateAndTrigger() {
  ensureSkillAssignment();
  if (selectedIssue.value.riskTone === "danger") {
    setDispatchStatus("等待人工确认");
    addAuditRecord("等待", "高危确认");
    return;
  }
  setDispatchStatus("Agent 执行中");
  addAuditRecord("运行中", selectedSkillRows.value[1]?.name);
}

function confirmHighRiskAndRun() {
  setDispatchStatus("Agent 执行中");
  addAuditRecord("运行中", "高危确认已通过");
}

function resetSkillRecommendation() {
  skillAssignments.value = {
    ...skillAssignments.value,
    [selectedIssue.value.key]: getRecommendedSkillIds(selectedIssue.value),
  };
}

function applyBusinessSkillMatch() {
  const match = selectedBusinessSkillMatch.value;
  if (match === null) return;

  const preferredOrder = ["clarify", "impact", match.skillId, "code", "plan"];
  const current = ensureSkillAssignment();
  const next = uniqueValues([
    ...preferredOrder,
    ...current.filter((skillId) => !preferredOrder.includes(skillId)),
  ]);
  skillAssignments.value = {
    ...skillAssignments.value,
    [selectedIssue.value.key]: next,
  };
  if (!businessSkillAppliedIssueKeys.value.includes(selectedIssue.value.key)) {
    businessSkillAppliedIssueKeys.value = [
      ...businessSkillAppliedIssueKeys.value,
      selectedIssue.value.key,
    ];
  }
  setDispatchStatus("草稿");
  addAuditRecord("草稿", match.label);
}

function openDecision(item: DecisionItem) {
  selectedIssueKey.value = item.issueKey;
  selectedDrawerTab.value = "overview";
  drawerVisible.value = true;
  if (!acknowledgedDecisionIds.value.includes(item.id)) {
    acknowledgedDecisionIds.value = [...acknowledgedDecisionIds.value, item.id];
  }
}

function openAuditRecord(record: AuditRecord) {
  selectedIssueKey.value = record.issueKey;
  selectedRuntimeStageId.value = null;
  selectedDrawerTab.value = record.artifacts.includes("MR") ? "mr" : "steps";
  drawerVisible.value = true;
}

function filterPipelineColumn(column: PipelineColumn) {
  const firstIssueKey = column.cards[0]?.key;
  if (firstIssueKey !== undefined) selectIssue(firstIssueKey);
}

function openJiraIssue(issue: EngineeringIssue) {
  window.open(
    `http://10.100.77.22:8888/browse/${encodeURIComponent(issue.key)}`,
    "_blank",
    "noreferrer",
  );
}

function refreshReadonly() {
  currentTime.value = new Date();
  addAuditRecord("已完成", "只读刷新");
}

function syncAndTrigger() {
  currentTime.value = new Date();
  validateAndTrigger();
}

function downloadEvidencePack() {
  const payload = JSON.stringify(
    {
      issue: selectedIssue.value.key,
      summary: selectedIssue.value.summary,
      mcpCalls: selectedIssue.value.mcpCalls,
      evidence: selectedIssue.value.evidence,
      reasoning: selectedIssue.value.reasoning,
    },
    null,
    2,
  );
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${selectedIssue.value.key}-evidence-pack.json`;
  link.click();
  URL.revokeObjectURL(url);
}

async function copyEvidenceLink() {
  const url = `${window.location.origin}${window.location.pathname}#evidence-${selectedIssue.value.key}`;
  await navigator.clipboard?.writeText(url);
  addAuditRecord("已完成", "复制证据链接");
}

function openAssistantDialog(question?: string) {
  assistantDialogOpen.value = true;
  if (question !== undefined) {
    assistantDialogQuestion.value = question;
  }
}

function closeAssistantDialog() {
  assistantDialogOpen.value = false;
}

function resetFilters() {
  searchQuery.value = "";
  projectFilter.value = defaultProjectFilter;
  issueTypeFilter.value = "all";
  statusFilter.value = "all";
  assigneeScopeFilter.value = "all";
  assigneeFilter.value = "all";
}

function composeAssistantReply(input: string) {
  const focus = selectedIssue.value;
  const decisionText =
    focus.riskTone === "danger"
      ? "涉及高危或写操作时，需要主管确认后再触发。"
      : "可以先保存编排并进入触发前校验。";
  const questionHint = input.length > 0 ? `针对“${input}”，` : "";
  const skills = selectedSkillRows.value.map((skill) => skill.name).join("、");
  const businessMatch = getBusinessSkillMatch(focus);
  const businessText =
    businessMatch === null
      ? ""
      : `已命中「${businessMatch.label}」，建议代码分析锁定 ${businessMatch.repo}/${businessMatch.branch}。`;

  return `${questionHint}建议为 ${focus.key} 分配 ${skills}。${businessText}当前调度状态为「${selectedDispatchStatus.value}」，预计预算 ${totalSkillEstimate.value} 分钟。${decisionText}后续可在右侧抽屉查看 MCP 权限、执行步骤、证据链与 MR。`;
}

function askStrategyAssistant(question?: string) {
  const input = (
    question ??
    assistantDialogQuestion.value ??
    assistantQuestion.value
  ).trim();
  if (input.length === 0) return;

  const reply = composeAssistantReply(input);
  assistantQuestion.value = input;
  assistantDialogQuestion.value = "";
  assistantAnswer.value = reply;
  assistantMessages.value = [
    ...assistantMessages.value,
    {
      id: nextAssistantMessageId("user"),
      role: "user",
      text: input,
      time: formatMessageTime(),
    },
    {
      id: nextAssistantMessageId("assistant"),
      role: "assistant",
      text: reply,
      time: "刚刚",
    },
  ];
  assistantDialogOpen.value = true;
}
</script>

<template>
  <section
    class="console-shell dispatch-console"
    :class="`theme-${themeMode}`"
    :data-theme="themeMode"
  >
    <aside class="global-nav" aria-label="全局导航">
      <div class="global-brand">
        <img :src="mascotStrategyAssistant" alt="东软小牛">
        <strong>AI 中枢</strong>
      </div>
      <nav>
        <button
          v-for="item in navItems"
          :key="item"
          type="button"
          :class="{
            active: item === activeNavItem,
            pending: !isNavItemEnabled(item),
          }"
          :aria-current="item === activeNavItem ? 'page' : undefined"
          @click="handleNavItemClick(item)"
        >
          <span aria-hidden="true">{{ item.slice(0, 1) }}</span>
          {{ item }}
          <em v-if="!isNavItemEnabled(item)">暂未开发</em>
        </button>
      </nav>
      <div class="global-user">
        <img :src="mascotStrategyAssistant" alt="">
        <strong>王博</strong>
        <span>研发主管</span>
      </div>
    </aside>

    <section class="dispatch-workspace">
      <section v-if="isConfigCenter" class="config-center">
        <header class="topbar config-topbar">
          <div class="brand-block">
            <div class="brand-mark">CF</div>
            <div>
              <span>Configuration Center</span>
              <strong>Jira + GitLab + MCP + Skill 配置中心</strong>
            </div>
            <em>Runtime Status</em>
          </div>
          <div class="command-actions">
            <button
              type="button"
              class="theme-toggle"
              :aria-label="themeToggleLabel"
              :aria-pressed="themeMode === 'day'"
              @click="toggleThemeMode"
            >
              <span aria-hidden="true">{{ themeMode === "day" ? "日" : "夜" }}</span>
              {{ themeModeLabel }}
            </button>
            <button type="button" class="time-chip" @click="currentTime = new Date()">
              <span>{{ formattedDate }}</span>
              <strong>{{ formattedTime }}</strong>
              <em>配置更新时间：{{ savedConfigState.updatedAt }}</em>
            </button>
          </div>
        </header>

        <section class="module-notice config-mock-banner" role="status">
          <div>
            <span>只读配置中心</span>
            <strong>当前显示运行环境配置，修改会提交为待审批变更申请</strong>
            <p>
              Jira/GitLab Token 不进入前端；真实生效仍由环境变量、后端配置服务、PolicyGate
              和 MCP 重启或热加载控制。
            </p>
          </div>
          <button type="button" @click="refreshIntegrationStatus">
            刷新运行状态
          </button>
        </section>

        <section class="panel config-runtime-panel">
          <header class="panel-heading">
            <div>
              <span>当前运行连接</span>
              <strong>Jira / GitLab / Code Retrieval / MCP</strong>
            </div>
            <em>
              {{
                integrationStatusLoading
                  ? "读取中"
                  : `更新时间 ${formatIntegrationGeneratedAt(integrationStatus.generatedAt)}`
              }}
            </em>
          </header>
          <p v-if="integrationStatusError !== null" class="config-inline-status">
            运行状态接口读取失败：{{ integrationStatusError }}。当前使用快照或兜底状态。
          </p>
          <div class="config-runtime-grid">
            <article
              v-for="endpoint in integrationEndpointCards"
              :key="endpoint.id"
              class="runtime-status-card"
              :class="`tone-${endpoint.tone}`"
            >
              <div>
                <span>{{ endpoint.label }}</span>
                <strong>{{ endpoint.configured ? "已配置" : "未配置" }}</strong>
              </div>
              <p>{{ formatIntegrationDisplayUrl(endpoint) }}</p>
              <em>{{ formatCredentialState(endpoint) }}</em>
              <ul>
                <li v-for="detail in endpoint.details" :key="detail">
                  {{ detail }}
                </li>
              </ul>
              <small>{{ endpoint.applyMode }}</small>
            </article>
          </div>
        </section>

        <section
          v-if="configChangeRequests.length > 0"
          class="panel config-request-panel"
        >
          <header class="panel-heading">
            <div>
              <span>配置变更申请</span>
              <strong>{{ pendingConfigRequestCount }} 个待 PolicyGate 审批</strong>
            </div>
          </header>
          <div class="config-request-list">
            <article v-for="request in configChangeRequests.slice(0, 4)" :key="request.id">
              <span>{{ request.sectionTitle }} · {{ request.createdAt }}</span>
              <strong>{{ request.summary }}</strong>
              <p>{{ request.applyMode }}</p>
            </article>
          </div>
        </section>

        <section
          v-if="configFeedback !== null"
          class="config-feedback"
          :class="`tone-${configFeedback.tone}`"
          role="status"
          aria-live="polite"
        >
          <strong>{{ configFeedback.title }}</strong>
          <p>{{ configFeedback.detail }}</p>
        </section>

        <section class="panel config-summary-panel">
          <header class="panel-heading">
            <div>
              <span>配置摘要</span>
              <strong>Jira → 代码检索 → Skill 规则预览</strong>
            </div>
          </header>
          <div class="config-summary-grid">
            <article>
              <span>Jira 关键词</span>
              <strong>{{ angular17MappingPreview.keyword }}</strong>
              <p>
                Angular17 Jira 匹配
                <code>{{
                  angular17MappingPreview.repository
                }}@{{ angular17MappingPreview.branch }}</code>
              </p>
            </article>
            <article>
              <span>推荐 Skill</span>
              <strong>{{ angular17MappingPreview.recommendedSkill }}</strong>
              <p>{{ angular17MappingPreview.confidenceRule }}</p>
            </article>
          </div>
        </section>

        <section class="panel config-card">
          <header class="config-card-head">
            <div>
              <span>Jira 配置</span>
              <strong>连接与默认筛选</strong>
            </div>
            <div class="config-actions">
              <button
                v-if="!editingConfigSections.jira"
                type="button"
                @click="beginEditConfigSection('jira')"
              >
                编辑
              </button>
              <button
                v-if="editingConfigSections.jira"
                type="button"
                @click="saveConfigSection('jira')"
              >
                提交申请
              </button>
              <button
                v-if="editingConfigSections.jira"
                type="button"
                @click="cancelConfigSection('jira')"
              >
                取消
              </button>
              <button type="button" @click="resetConfigSection('jira')">重置</button>
              <button type="button" @click="testIntegrationConnection('jira')">
                检查运行配置
              </button>
            </div>
          </header>
          <div class="config-form-grid two-columns">
            <label>
              Jira Base URL
              <input
                v-model="draftConfigState.jira.baseUrl"
                :disabled="!editingConfigSections.jira"
                type="text"
              >
            </label>
            <label>
              Project Key
              <input
                v-model="draftConfigState.jira.projectKey"
                :disabled="!editingConfigSections.jira"
                type="text"
              >
            </label>
            <label class="full-row">
              JQL 默认过滤条件
              <textarea
                v-model="draftConfigState.jira.defaultJql"
                :disabled="!editingConfigSections.jira"
                rows="3"
              />
            </label>
            <label>
              认证方式
              <select
                v-model="draftConfigState.jira.authMethod"
                :disabled="!editingConfigSections.jira"
              >
                <option value="Token">Token</option>
                <option value="Basic + API Token">Basic + API Token</option>
                <option value="OAuth2">OAuth2</option>
              </select>
            </label>
            <label>
              Token / API Key
              <input
                v-model="draftConfigState.jira.token"
                disabled
                type="text"
              >
            </label>
          </div>
          <p class="config-inline-status">
            最近测试结果：{{ draftConfigState.jira.lastTestResult }}
          </p>
        </section>

        <section class="panel config-card">
          <header class="config-card-head">
            <div>
              <span>GitLab 配置</span>
              <strong>仓库与分支入口</strong>
            </div>
            <div class="config-actions">
              <button
                v-if="!editingConfigSections.gitlab"
                type="button"
                @click="beginEditConfigSection('gitlab')"
              >
                编辑
              </button>
              <button
                v-if="editingConfigSections.gitlab"
                type="button"
                @click="saveConfigSection('gitlab')"
              >
                提交申请
              </button>
              <button
                v-if="editingConfigSections.gitlab"
                type="button"
                @click="cancelConfigSection('gitlab')"
              >
                取消
              </button>
              <button type="button" @click="resetConfigSection('gitlab')">
                重置
              </button>
              <button type="button" @click="testIntegrationConnection('gitlab')">
                检查运行配置
              </button>
            </div>
          </header>
          <div class="config-form-grid two-columns">
            <label>
              GitLab Base URL
              <input
                v-model="draftConfigState.gitlab.baseUrl"
                :disabled="!editingConfigSections.gitlab"
                type="text"
              >
            </label>
            <label>
              Group / Project
              <input
                v-model="draftConfigState.gitlab.groupOrProject"
                :disabled="!editingConfigSections.gitlab"
                type="text"
              >
            </label>
            <label>
              默认分支
              <input
                v-model="draftConfigState.gitlab.defaultBranch"
                :disabled="!editingConfigSections.gitlab"
                type="text"
              >
            </label>
            <label>
              Token
              <input
                v-model="draftConfigState.gitlab.token"
                disabled
                type="text"
              >
            </label>
          </div>
          <p class="config-inline-status">
            最近测试结果：{{ draftConfigState.gitlab.lastTestResult }}
          </p>
        </section>

        <section class="panel config-card">
          <header class="config-card-head">
            <div>
              <span>MCP 配置</span>
              <strong>网关与白名单</strong>
            </div>
            <div class="config-actions">
              <button
                v-if="!editingConfigSections.mcp"
                type="button"
                @click="beginEditConfigSection('mcp')"
              >
                编辑
              </button>
              <button
                v-if="editingConfigSections.mcp"
                type="button"
                @click="saveConfigSection('mcp')"
              >
                提交申请
              </button>
              <button
                v-if="editingConfigSections.mcp"
                type="button"
                @click="cancelConfigSection('mcp')"
              >
                取消
              </button>
              <button type="button" @click="resetConfigSection('mcp')">重置</button>
              <button type="button" @click="testIntegrationConnection('mcp')">
                检查运行配置
              </button>
            </div>
          </header>
          <div class="config-form-grid two-columns">
            <label class="full-row">
              MCP Allow List
              <textarea
                v-model="draftConfigState.mcp.allowList"
                :disabled="!editingConfigSections.mcp"
                rows="2"
              />
            </label>
            <label>
              默认超时 (ms)
              <input
                v-model.number="draftConfigState.mcp.defaultTimeoutMs"
                :disabled="!editingConfigSections.mcp"
                type="number"
                min="1000"
                step="1000"
              >
            </label>
            <label>
              MCP Gateway
              <input
                v-model="draftConfigState.mcp.gateway"
                :disabled="!editingConfigSections.mcp"
                type="text"
              >
            </label>
            <label class="full-row">
              说明
              <textarea
                v-model="draftConfigState.mcp.notes"
                :disabled="!editingConfigSections.mcp"
                rows="2"
              />
            </label>
          </div>
        </section>

        <section class="panel config-card">
          <header class="config-card-head">
            <div>
              <span>代码检索配置</span>
              <strong>仓库映射、分支映射与 Jira 关键词规则</strong>
            </div>
            <div class="config-actions">
              <button
                v-if="!editingConfigSections.codeRetrieval"
                type="button"
                @click="beginEditConfigSection('codeRetrieval')"
              >
                编辑
              </button>
              <button
                v-if="editingConfigSections.codeRetrieval"
                type="button"
                @click="saveConfigSection('codeRetrieval')"
              >
                提交申请
              </button>
              <button
                v-if="editingConfigSections.codeRetrieval"
                type="button"
                @click="cancelConfigSection('codeRetrieval')"
              >
                取消
              </button>
              <button type="button" @click="resetConfigSection('codeRetrieval')">
                重置
              </button>
            </div>
          </header>
          <div class="config-table-wrapper">
            <h4>仓库映射</h4>
            <table class="config-table">
              <thead>
                <tr>
                  <th>业务来源</th>
                  <th>仓库</th>
                  <th>模块</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="item in draftConfigState.codeRetrieval.repoMappings"
                  :key="item.id"
                >
                  <td>
                    <input
                      v-model="item.source"
                      :disabled="!editingConfigSections.codeRetrieval"
                      type="text"
                    >
                  </td>
                  <td>
                    <input
                      v-model="item.repository"
                      :disabled="!editingConfigSections.codeRetrieval"
                      type="text"
                    >
                  </td>
                  <td>
                    <input
                      v-model="item.module"
                      :disabled="!editingConfigSections.codeRetrieval"
                      type="text"
                    >
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="config-table-wrapper">
            <h4>分支映射</h4>
            <table class="config-table">
              <thead>
                <tr>
                  <th>业务来源</th>
                  <th>分支</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="item in draftConfigState.codeRetrieval.branchMappings"
                  :key="item.id"
                >
                  <td>
                    <input
                      v-model="item.source"
                      :disabled="!editingConfigSections.codeRetrieval"
                      type="text"
                    >
                  </td>
                  <td>
                    <input
                      v-model="item.branch"
                      :disabled="!editingConfigSections.codeRetrieval"
                      type="text"
                    >
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="config-table-wrapper">
            <h4>Jira 关键词匹配规则</h4>
            <table class="config-table">
              <thead>
                <tr>
                  <th>关键词</th>
                  <th>仓库</th>
                  <th>模块</th>
                  <th>分支</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="rule in draftConfigState.codeRetrieval.jiraKeywordRules"
                  :key="rule.id"
                >
                  <td>
                    <input
                      v-model="rule.keyword"
                      :disabled="!editingConfigSections.codeRetrieval"
                      type="text"
                    >
                  </td>
                  <td>
                    <input
                      v-model="rule.repository"
                      :disabled="!editingConfigSections.codeRetrieval"
                      type="text"
                    >
                  </td>
                  <td>
                    <input
                      v-model="rule.module"
                      :disabled="!editingConfigSections.codeRetrieval"
                      type="text"
                    >
                  </td>
                  <td>
                    <input
                      v-model="rule.branch"
                      :disabled="!editingConfigSections.codeRetrieval"
                      type="text"
                    >
                  </td>
                  <td>
                    <button
                      type="button"
                      :disabled="!editingConfigSections.codeRetrieval"
                      @click="removeCodeRetrievalKeywordRule(rule.id)"
                    >
                      删除
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
            <button
              type="button"
              :disabled="!editingConfigSections.codeRetrieval"
              @click="addCodeRetrievalKeywordRule"
            >
              新增规则
            </button>
            <p class="config-inline-status">
              示例：Angular17 Jira 匹配
              <code>{{
                angular17MappingPreview.repository
              }}@{{ angular17MappingPreview.branch }}</code>
            </p>
          </div>
        </section>

        <section class="panel config-card">
          <header class="config-card-head">
            <div>
              <span>Agent 配置</span>
              <strong>执行编排策略</strong>
            </div>
            <div class="config-actions">
              <button
                v-if="!editingConfigSections.agent"
                type="button"
                @click="beginEditConfigSection('agent')"
              >
                编辑
              </button>
              <button
                v-if="editingConfigSections.agent"
                type="button"
                @click="saveConfigSection('agent')"
              >
                提交申请
              </button>
              <button
                v-if="editingConfigSections.agent"
                type="button"
                @click="cancelConfigSection('agent')"
              >
                取消
              </button>
              <button type="button" @click="resetConfigSection('agent')">重置</button>
            </div>
          </header>
          <div class="config-form-grid two-columns">
            <label>
              Planner Agent
              <input
                v-model="draftConfigState.agent.plannerAgent"
                :disabled="!editingConfigSections.agent"
                type="text"
              >
            </label>
            <label>
              Reviewer Agent
              <input
                v-model="draftConfigState.agent.reviewerAgent"
                :disabled="!editingConfigSections.agent"
                type="text"
              >
            </label>
            <label>
              最大并行 Agent
              <input
                v-model.number="draftConfigState.agent.maxParallelism"
                :disabled="!editingConfigSections.agent"
                type="number"
                min="1"
                max="10"
              >
            </label>
            <label>
              回退策略
              <input
                v-model="draftConfigState.agent.fallbackPolicy"
                :disabled="!editingConfigSections.agent"
                type="text"
              >
            </label>
            <label class="full-row config-checkbox">
              <input
                v-model="draftConfigState.agent.autoDispatch"
                :disabled="!editingConfigSections.agent"
                type="checkbox"
              >
              自动触发调度（高风险仍需人工确认）
            </label>
          </div>
        </section>

        <section class="panel config-card">
          <header class="config-card-head">
            <div>
              <span>Skill 匹配规则</span>
              <strong>业务关键词到 Skill 的推荐策略</strong>
            </div>
            <div class="config-actions">
              <button
                v-if="!editingConfigSections.skillRules"
                type="button"
                @click="beginEditConfigSection('skillRules')"
              >
                编辑
              </button>
              <button
                v-if="editingConfigSections.skillRules"
                type="button"
                @click="saveConfigSection('skillRules')"
              >
                提交申请
              </button>
              <button
                v-if="editingConfigSections.skillRules"
                type="button"
                @click="cancelConfigSection('skillRules')"
              >
                取消
              </button>
              <button type="button" @click="resetConfigSection('skillRules')">
                重置
              </button>
            </div>
          </header>
          <div class="config-table-wrapper">
            <table class="config-table">
              <thead>
                <tr>
                  <th>业务关键词</th>
                  <th>适用仓库</th>
                  <th>适用分支</th>
                  <th>推荐 Skill</th>
                  <th>置信度规则</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="rule in draftConfigState.skillRules" :key="rule.id">
                  <td>
                    <input
                      v-model="rule.businessKeyword"
                      :disabled="!editingConfigSections.skillRules"
                      type="text"
                    >
                  </td>
                  <td>
                    <input
                      v-model="rule.repository"
                      :disabled="!editingConfigSections.skillRules"
                      type="text"
                    >
                  </td>
                  <td>
                    <input
                      v-model="rule.branch"
                      :disabled="!editingConfigSections.skillRules"
                      type="text"
                    >
                  </td>
                  <td>
                    <input
                      v-model="rule.recommendedSkill"
                      :disabled="!editingConfigSections.skillRules"
                      type="text"
                    >
                  </td>
                  <td>
                    <input
                      v-model="rule.confidenceRule"
                      :disabled="!editingConfigSections.skillRules"
                      type="text"
                    >
                  </td>
                  <td>
                    <button
                      type="button"
                      :disabled="!editingConfigSections.skillRules"
                      @click="removeSkillMatchRule(rule.id)"
                    >
                      删除
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
            <button
              type="button"
              :disabled="!editingConfigSections.skillRules"
              @click="addSkillMatchRule"
            >
              新增规则
            </button>
          </div>
        </section>

        <section class="panel config-card">
          <header class="config-card-head">
            <div>
              <span>安全与审计配置</span>
              <strong>权限控制与日志留存</strong>
            </div>
            <div class="config-actions">
              <button
                v-if="!editingConfigSections.securityAudit"
                type="button"
                @click="beginEditConfigSection('securityAudit')"
              >
                编辑
              </button>
              <button
                v-if="editingConfigSections.securityAudit"
                type="button"
                @click="saveConfigSection('securityAudit')"
              >
                提交申请
              </button>
              <button
                v-if="editingConfigSections.securityAudit"
                type="button"
                @click="cancelConfigSection('securityAudit')"
              >
                取消
              </button>
              <button
                type="button"
                @click="resetConfigSection('securityAudit')"
              >
                重置
              </button>
            </div>
          </header>
          <div class="config-form-grid two-columns">
            <label class="config-checkbox">
              <input
                v-model="draftConfigState.securityAudit.enableTokenMasking"
                :disabled="!editingConfigSections.securityAudit"
                type="checkbox"
              >
              Token 脱敏展示
            </label>
            <label class="config-checkbox">
              <input
                v-model="draftConfigState.securityAudit.requireHumanApproval"
                :disabled="!editingConfigSections.securityAudit"
                type="checkbox"
              >
              高风险操作需人工审批
            </label>
            <label class="config-checkbox">
              <input
                v-model="draftConfigState.securityAudit.enableAuditLog"
                :disabled="!editingConfigSections.securityAudit"
                type="checkbox"
              >
              开启审计日志
            </label>
            <label>
              审计留存天数
              <input
                v-model.number="draftConfigState.securityAudit.auditRetentionDays"
                :disabled="!editingConfigSections.securityAudit"
                type="number"
                min="7"
                max="365"
              >
            </label>
          </div>
        </section>
      </section>
      <template v-else>
        <section
          v-if="moduleNotice !== null"
          class="module-notice"
          role="status"
          aria-live="polite"
        >
          <div>
            <span>{{ moduleNotice.module }}</span>
            <strong>{{ moduleNotice.title }}</strong>
            <p>{{ moduleNotice.detail }}</p>
          </div>
          <button type="button" @click="moduleNotice = null">知道了</button>
        </section>

        <header class="topbar command-topbar">
          <div class="brand-block">
            <div class="brand-mark">AI</div>
            <div>
              <span>AI 开发中枢</span>
              <strong>Jira 调度与治理驾驶舱</strong>
            </div>
            <em>实时连接</em>
          </div>

          <div class="command-actions">
            <label class="auto-toggle">
              <input v-model="autoExecuteEnabled" type="checkbox">
              <span>自动执行：{{ autoExecuteEnabled ? "ON" : "OFF" }}</span>
            </label>
            <button
              type="button"
              class="theme-toggle"
              :aria-label="themeToggleLabel"
              :aria-pressed="themeMode === 'day'"
              @click="toggleThemeMode"
            >
              <span aria-hidden="true">{{ themeMode === "day" ? "日" : "夜" }}</span>
              {{ themeModeLabel }}
            </button>
            <div class="calendar-anchor">
              <button
                type="button"
                class="time-chip"
                aria-label="打开日历与今日工作安排"
                @click="calendarOpen = !calendarOpen"
              >
                <span>{{ formattedDate }}</span>
                <strong>{{ formattedTime }}</strong>
                <em>晴 24°C · 最近同步 22:40</em>
              </button>
              <section v-if="calendarOpen" class="calendar-popover">
                <header>
                  <span>{{ calendarTitle }}</span>
                  <strong>今日安排</strong>
                </header>
                <div class="calendar-week">
                  <span>一</span>
                  <span>二</span>
                  <span>三</span>
                  <span>四</span>
                  <span>五</span>
                  <span>六</span>
                  <span>日</span>
                </div>
                <div class="calendar-grid" aria-label="日历">
                  <button
                    v-for="day in calendarDays"
                    :key="day.key"
                    type="button"
                    :class="{
                      muted: day.muted,
                      today: day.today,
                      planned: day.hasPlan,
                    }"
                  >
                    {{ day.label }}
                  </button>
                </div>
                <footer>
                  <span>09:30 高危 Jira 拍板</span>
                  <span>11:00 MR Review 窗口</span>
                </footer>
              </section>
            </div>
            <button type="button" class="ghost-action" @click="refreshReadonly">
              刷新
            </button>
            <button type="button" class="primary-action" @click="syncAndTrigger">
              同步并触发
            </button>
          </div>
        </header>

        <section class="kpi-grid" aria-label="调度状态总览">
          <article
            v-for="card in kpiCards"
            :key="card.id"
            class="kpi-card"
            :class="`tone-${card.tone}`"
          >
            <div>
              <span>{{ card.label }}</span>
              <strong>{{ card.value }}</strong>
              <p>{{ card.caption }}</p>
              <em>{{ card.trend }}</em>
            </div>
            <div class="mini-bars" aria-hidden="true">
              <i
                v-for="(bar, index) in card.bars"
                :key="`${card.id}-${index}`"
                :style="{ height: `${bar}px` }"
              />
            </div>
          </article>
        </section>

        <main
          class="dispatch-grid"
          :class="{
            'filters-collapsed': filterCollapsed,
            'drawer-closed': !drawerVisible,
          }"
        >
          <aside class="panel filter-panel">
            <div class="panel-heading filter-heading">
              <div>
                <span>Jira 筛选器</span>
                <strong>{{ versionSummary.visible }} / {{ versionSummary.total }}</strong>
              </div>
              <div class="heading-actions">
                <button type="button" @click="resetFilters">重置</button>
                <button type="button" @click="toggleFilterCollapsed">
                  {{ filterCollapsed ? "展开" : "收起" }}
                </button>
              </div>
            </div>

            <template v-if="!filterCollapsed">
              <section class="filter-group">
                <span>基础条件</span>
                <div class="filter-grid">
                  <label class="filter-control">
                    项目
                    <select v-model="projectFilter" name="jira-project-filter">
                      <option
                        v-for="project in jiraProjectOptions"
                        :key="project.value"
                        :value="project.value"
                      >
                        {{ project.label }}
                      </option>
                    </select>
                  </label>

                  <label class="filter-control">
                    类型
                    <select v-model="issueTypeFilter" name="issue-type">
                      <option value="all">全部</option>
                      <option
                        v-for="item in issueTypeOptions"
                        :key="item"
                        :value="item"
                      >
                        {{ item }}
                      </option>
                    </select>
                  </label>

                  <label class="filter-control">
                    状态
                    <select v-model="statusFilter" name="issue-status">
                      <option value="all">全部</option>
                      <option value="open">未完成</option>
                      <option
                        v-for="item in statusOptions"
                        :key="item"
                        :value="item"
                      >
                        {{ item }}
                      </option>
                    </select>
                  </label>

                  <label class="filter-control">
                    经办人
                    <select v-model="assigneeScopeFilter" name="assignee-scope">
                      <option value="all">全部用户</option>
                      <option value="currentUser">当前用户</option>
                      <option value="selected">指定用户</option>
                    </select>
                  </label>

                  <label
                    v-if="assigneeScopeFilter === 'selected'"
                    class="filter-control"
                  >
                    指定经办人
                    <select v-model="assigneeFilter" name="assignee">
                      <option value="all">全部</option>
                      <option
                        v-for="item in assigneeOptions"
                        :key="item"
                        :value="item"
                      >
                        {{ item }}
                      </option>
                    </select>
                  </label>

                  <label class="filter-control">
                    文本搜索
                    <input
                      v-model="searchQuery"
                      name="issue-search"
                      type="search"
                      placeholder="Jira key / 标题 / 描述 / 负责人"
                    >
                  </label>
                </div>
              </section>

              <section
                v-if="activeFilterPills.length > 0"
                class="active-filter-pills"
                aria-label="当前已启用筛选条件"
              >
                <span v-for="pill in activeFilterPills" :key="pill">{{ pill }}</span>
              </section>
            </template>
          </aside>

          <section class="center-stack">
            <section class="panel issue-panel">
              <div class="panel-heading issue-heading">
                <div>
                  <span>Jira Issue Queue</span>
                  <strong>
                    共 {{ versionSummary.visible }} 条 ·
                    {{ selectedIssueKeys.length }} 条已选
                  </strong>
                </div>
                <div class="view-switch" aria-label="队列操作">
                  <button type="button" @click="applyBatchSkillTemplate">
                    批量套用模板
                  </button>
                  <button
                    type="button"
                    class="active"
                    @click="openSkillDrawer(selectedIssue.key)"
                  >
                    分配 Skill
                  </button>
                </div>
              </div>

              <section
                v-if="selectedIssueKeys.length > 0"
                class="bulk-action-bar"
                aria-label="批量操作"
              >
                <strong>{{ selectedBulkIssues.length }} 条 Jira 已选择</strong>
                <span>将按「需求分析标准链路」保存为草稿，可再进入校验。</span>
                <button type="button" @click="applyBatchSkillTemplate">
                  套用标准链路
                </button>
                <button type="button" @click="batchEnterValidation">
                  批量进入校验
                </button>
                <button type="button" @click="clearIssueSelection">
                  取消选择
                </button>
              </section>

              <div
                class="issue-table dispatch-table"
                role="table"
                aria-label="Jira 调度队列"
              >
                <div class="issue-row issue-row-head" role="row">
                  <span>选</span>
                  <span>Key</span>
                  <span>Summary</span>
                  <span>模块</span>
                  <span>优先级</span>
                  <span>负责人</span>
                  <span>调度状态</span>
                  <span>Skill</span>
                  <span>操作</span>
                </div>
                <article
                  v-for="issue in filteredIssues"
                  :key="issue.key"
                  class="issue-row"
                  :class="{ selected: selectedIssue.key === issue.key }"
                  role="row"
                >
                  <span>
                    <input
                      type="checkbox"
                      :checked="isIssueSelected(issue.key)"
                      :aria-label="`选择 ${issue.key}`"
                      @change="toggleIssueSelection(issue.key, $event)"
                    >
                  </span>
                  <span>
                    <button
                      type="button"
                      class="issue-key-button"
                      :title="`双击打开 Jira ${issue.key}`"
                      @click="selectIssue(issue.key)"
                      @dblclick="openJiraIssue(issue)"
                    >
                      {{ issue.key }}
                    </button>
                  </span>
                  <span class="summary-cell">
                    <button type="button" @click="selectIssue(issue.key)">
                      {{ issue.summary }}
                    </button>
                    <em>
                      <i v-for="label in issue.labels.slice(0, 2)" :key="label">{{
                        label
                      }}</i>
                    </em>
                  </span>
                  <span>{{ issue.component }}</span>
                  <span class="priority-cell">{{ issue.priority }}</span>
                  <span class="assignee-cell">{{ issue.assignee }}</span>
                  <span>
                    <mark>{{ getDispatchStatus(issue) }}</mark>
                  </span>
                  <span>
                    <b
                      v-if="getAssignedSkillNames(issue).length > 0"
                      class="skill-count"
                    >
                      {{ getAssignedSkillNames(issue).length }} 项
                    </b>
                    <em v-else>未分配</em>
                  </span>
                  <span>
                    <button
                      type="button"
                      class="row-action"
                      @click="openSkillDrawer(issue.key)"
                    >
                      分配 Skill
                    </button>
                  </span>
                </article>
              </div>
            </section>

            <section class="panel pipeline-panel">
              <div class="panel-heading">
                <div>
                  <span>Agent 编排 Pipeline</span>
                  <strong>Jira → Skill → Agent → Evidence → MR → Eval</strong>
                </div>
                <button
                  type="button"
                  class="ghost-action"
                  @click="openRuntimeDetails"
                >
                  查看执行明细
                </button>
              </div>

              <section class="runtime-overview" aria-label="当前 Jira 编排状态">
                <header>
                  <div>
                    <span>当前 Jira</span>
                    <strong>{{
                      selectedOrchestrationRuntime.issue_key
                    }} · {{ selectedIssue.summary }}</strong>
                  </div>
                  <mark :class="`status-${selectedOrchestrationRuntime.status}`">
                    {{ selectedOrchestrationRuntime.status }}
                  </mark>
                </header>

                <div class="runtime-metrics">
                  <article>
                    <span>总进度</span>
                    <strong>{{
                      selectedOrchestrationRuntime.progress_percent
                    }}%</strong>
                  </article>
                  <article>
                    <span>当前阶段</span>
                    <strong>{{ selectedOrchestrationRuntime.current_stage_name }}</strong>
                  </article>
                  <article>
                    <span>当前 Agent</span>
                    <strong>{{ selectedOrchestrationRuntime.current_agent }}</strong>
                  </article>
                  <article>
                    <span>当前 Skill</span>
                    <strong>{{ selectedOrchestrationRuntime.current_skill }}</strong>
                  </article>
                  <article>
                    <span>已耗时</span>
                    <strong>{{ runtimeElapsedLabel }}</strong>
                  </article>
                  <article>
                    <span>预计剩余</span>
                    <strong>{{ runtimeRemainingLabel }}</strong>
                    <em>预计完成：{{ runtimeEtaAtLabel }}</em>
                  </article>
                </div>

                <div class="runtime-status-strip" aria-label="编排状态分布">
                  <button
                    v-for="item in orchestrationStatusSummary"
                    :key="item.status"
                    type="button"
                    :class="{ active: item.active }"
                  >
                    <span>{{ item.status }}</span>
                    <strong>{{ item.count }}</strong>
                  </button>
                </div>

                <article
                  v-if="selectedOrchestrationRuntime.status === '等待人工处理'"
                  class="runtime-alert waiting"
                  role="status"
                >
                  <strong>等待人工处理</strong>
                  <p>{{ selectedOrchestrationRuntime.wait_reason }}</p>
                </article>
                <article
                  v-if="selectedOrchestrationRuntime.status === '失败'"
                  class="runtime-alert failed"
                  role="alert"
                >
                  <strong>执行失败</strong>
                  <p>{{ selectedOrchestrationRuntime.failure_reason }}</p>
                  <button type="button">重试（暂未开发）</button>
                </article>

                <div class="runtime-artifacts" aria-label="产物状态">
                  <article
                    v-for="artifact in selectedOrchestrationRuntime.artifacts"
                    :key="artifact.id"
                    :class="`artifact-${artifact.status}`"
                  >
                    <span>{{ artifact.name }}</span>
                    <strong>{{ artifact.status }}</strong>
                    <em>{{ artifact.detail }}</em>
                  </article>
                </div>
              </section>

              <section class="pipeline-stage-track" aria-label="阶段明细">
                <button
                  v-for="step in selectedOrchestrationRuntime.stages"
                  :key="step.id"
                  type="button"
                  class="stage-track-item"
                  :class="[
                    `status-${step.status}`,
                    {
                      active: activeOrchestrationStage?.id === step.id,
                    },
                  ]"
                  @click="openRuntimeStage(step.id)"
                >
                  <span class="stage-icon">{{
                    step.status === "done"
                      ? "OK"
                      : step.status === "running"
                        ? "RUN"
                        : step.status === "waiting"
                          ? "HUMAN"
                          : step.status === "failed"
                            ? "ERR"
                            : "--"
                  }}</span>
                  <div>
                    <strong>{{ step.name }}</strong>
                    <p>{{ step.description }}</p>
                    <em>
                      {{ step.agent }} / {{ step.skill }} ·
                      {{ step.started_at === null ? "—" : formatJiraDate(step.started_at) }}
                      ~
                      {{ step.ended_at === null ? "—" : formatJiraDate(step.ended_at) }}
                    </em>
                    <i v-if="step.reason">{{ step.reason }}</i>
                  </div>
                </button>
              </section>

              <section class="runtime-timeline" aria-label="关键事件时间线">
                <header>
                  <span>关键日志 / 时间线</span>
                  <strong>{{
                    selectedOrchestrationRuntime.events.length
                  }} 条事件</strong>
                </header>
                <article
                  v-for="event in selectedOrchestrationRuntime.events"
                  :key="event.id"
                  :class="`event-${event.level}`"
                >
                  <span>{{ formatJiraDate(event.at) }}</span>
                  <strong>{{ event.title }}</strong>
                  <p>{{ event.detail }}</p>
                </article>
              </section>

              <div class="pipeline-board" aria-label="AI 交付流水线">
                <section
                  v-for="column in pipelineColumns"
                  :key="column.id"
                  class="pipeline-column"
                >
                  <header>
                    <strong>{{ column.title }}</strong>
                    <button
                      type="button"
                      :aria-label="`筛选 ${column.title}`"
                      @click="filterPipelineColumn(column)"
                    >
                      {{ column.count }}
                    </button>
                  </header>
                  <button
                    v-for="card in column.cards"
                    :key="`${column.id}-${card.key}`"
                    type="button"
                    class="pipeline-card"
                    :class="[`tone-${card.tone}`, { preview: card.preview }]"
                    @click="selectIssue(card.key)"
                  >
                    <strong>{{ card.key }}</strong>
                    <span>{{ card.summary }}</span>
                    <em>{{ card.agent }} · {{ card.duration }}</em>
                    <p>
                      <i v-for="skill in card.skills" :key="skill">{{ skill }}</i>
                      <i v-if="card.skills.length === 0">未分配</i>
                    </p>
                  </button>
                </section>
              </div>
            </section>
          </section>

          <aside
            v-if="drawerVisible"
            class="panel skill-drawer"
            aria-label="Jira 详情与 Skill 编排"
          >
            <header class="drawer-head">
              <div>
                <span>{{ selectedDispatchStatus }}</span>
                <strong>{{ selectedIssue.key }} · {{ selectedIssue.summary }}</strong>
              </div>
              <button
                type="button"
                aria-label="关闭详情抽屉"
                @click="closeDrawer"
              >
                ×
              </button>
            </header>

            <nav class="drawer-tabs" aria-label="详情页签">
              <button
                v-for="tab in drawerTabs"
                :key="tab.id"
                type="button"
                :class="{ active: selectedDrawerTab === tab.id }"
                @click="setDrawerTab(tab.id)"
              >
                {{ tab.label }}
              </button>
            </nav>

            <section
              v-if="selectedDrawerTab === 'overview'"
              class="drawer-section"
            >
              <div class="detail-tags">
                <b :class="`risk-${selectedIssue.riskTone}`">{{
                  selectedIssue.riskLevel
                }}</b>
                <span>{{ selectedIssue.status }}</span>
                <span>{{ selectedIssue.assignee }}</span>
                <span>{{ selectedIssue.priority }}</span>
              </div>
              <div class="drawer-actions inline-actions">
                <button type="button" @click="openJiraIssue(selectedIssue)">
                  打开 Jira
                </button>
                <button
                  type="button"
                  @click="descriptionExpanded = !descriptionExpanded"
                >
                  {{ descriptionExpanded ? "收起原文" : "查看原文" }}
                </button>
                <button type="button" @click="openSkillDrawer(selectedIssue.key)">
                  分配 Skill
                </button>
              </div>
              <div class="drawer-summary">
                <h3>Jira 描述摘要</h3>
                <p>{{ selectedIssue.description }}</p>
                <p>{{ selectedIssue.expectation }}</p>
                <p v-if="descriptionExpanded" class="jira-raw-copy">
                  原文已脱敏：{{ selectedIssue.description }}
                  {{ selectedIssue.expectation }}；相关模块：
                  {{ selectedIssue.impactedModules.join("、") }}。
                </p>
              </div>
              <div
                v-if="selectedIssue.riskTone === 'danger'"
                class="risk-confirm-card"
              >
                <span>高危写操作确认</span>
                <strong>{{ selectedIssue.decision }}</strong>
                <button type="button" @click="confirmHighRiskAndRun">
                  主管确认并进入执行
                </button>
              </div>
              <div class="drawer-summary">
                <h3>今日人工确认</h3>
                <article
                  v-for="item in decisionItems"
                  :key="item.id"
                  class="mini-decision"
                >
                  <span>{{ item.kind }}</span>
                  <strong>{{ item.issueKey }} · {{ item.title }}</strong>
                  <button type="button" @click="openDecision(item)">
                    {{
                      acknowledgedDecisionIds.includes(item.id)
                        ? "已查看"
                        : item.action
                    }}
                  </button>
                </article>
              </div>
            </section>

            <section
              v-if="selectedDrawerTab === 'skills'"
              class="drawer-section skill-compose"
            >
              <div class="recommendation-card">
                <span>推荐原因</span>
                <p>
                  Jira 描述涉及{{ selectedIssue.component }}、字段联动与状态流转；
                  当前仅使用真实 Jira 字段，建议先做需求澄清、影响面分析和 Skill
                  分配。
                </p>
              </div>

              <div
                class="business-skill-card"
                :class="{ matched: selectedBusinessSkillMatch !== null }"
              >
                <header class="business-skill-head">
                  <div>
                    <span>业务 Skill 匹配</span>
                    <strong>{{
                      selectedBusinessSkillMatch?.label ?? "未命中专项 Skill"
                    }}</strong>
                  </div>
                  <em>{{
                    selectedBusinessSkillMatch?.confidence ?? "常规链路"
                  }}</em>
                </header>

                <template v-if="selectedBusinessSkillMatch !== null">
                  <p>{{ selectedBusinessSkillMatch.reason }}</p>
                  <div class="business-skill-map">
                    <span>
                      代码库
                      <strong>{{ selectedBusinessSkillMatch.repo }}</strong>
                    </span>
                    <span>
                      分支
                      <strong>{{ selectedBusinessSkillMatch.branch }}</strong>
                    </span>
                  </div>
                  <div class="business-signal-list" aria-label="匹配信号">
                    <span
                      v-for="signal in selectedBusinessSkillMatch.signals"
                      :key="signal"
                    >
                      {{ signal }}
                    </span>
                  </div>
                  <ul class="business-focus-list">
                    <li
                      v-for="focus in selectedBusinessSkillMatch.analysisFocus"
                      :key="focus"
                    >
                      {{ focus }}
                    </li>
                  </ul>
                  <div
                    class="code-analysis-flow"
                    aria-label="Jira 结合代码分析生成开发方案链路"
                  >
                    <span>Jira → 代码 → 开发方案</span>
                    <ol>
                      <li v-for="step in jiraCodeAnalysisFlow" :key="step.label">
                        <strong>{{ step.label }}</strong>
                        <em>{{ step.detail }}</em>
                      </li>
                    </ol>
                  </div>
                  <button
                    type="button"
                    :class="{ applied: selectedBusinessSkillApplied }"
                    :aria-pressed="selectedBusinessSkillApplied"
                    @click="applyBusinessSkillMatch"
                  >
                    {{
                      selectedBusinessSkillApplied
                        ? "已应用 Angular17 Skill"
                        : "应用 Angular17 Skill"
                    }}
                  </button>
                  <p
                    v-if="selectedBusinessSkillApplied"
                    class="business-skill-notice"
                    role="status"
                  >
                    已写入当前 Jira 的 Skill 编排并保存为草稿；下一步可保存编排、校验触发或查看证据链。
                  </p>
                </template>

                <p v-else>
                  当前 Jira 未识别为 Angular17 升级回归；可继续使用通用影响面分析、代码检索和方案生成链路。
                </p>
              </div>

              <div class="skill-list">
                <article
                  v-for="skill in skillCandidates"
                  :key="skill.id"
                  class="skill-row"
                  :class="{
                    enabled: selectedSkillIds.includes(skill.id),
                    matched: selectedBusinessSkillMatch?.skillId === skill.id,
                  }"
                >
                  <label>
                    <input
                      type="checkbox"
                      :checked="selectedSkillIds.includes(skill.id)"
                      @change="toggleSkill(skill.id, $event)"
                    >
                    <span class="drag-handle" aria-hidden="true">⋮⋮</span>
                    <strong>{{ skill.name }}</strong>
                  </label>
                  <div class="skill-row-grid">
                    <span>{{ skill.agent }}</span>
                    <span>{{ skill.mcp }}</span>
                    <span>{{ skill.input }}</span>
                    <span>{{ skill.estimate }}m</span>
                    <span>{{ skill.gate }}</span>
                  </div>
                  <footer>
                    <i v-for="tag in skill.tags" :key="tag">{{ tag }}</i>
                    <button type="button" @click="moveSkill(skill.id, -1)">
                      上移
                    </button>
                    <button type="button" @click="moveSkill(skill.id, 1)">
                      下移
                    </button>
                  </footer>
                </article>
              </div>

              <div class="preflight-panel">
                <strong>触发前校验</strong>
                <p
                  v-for="check in preflightChecks"
                  :key="check.label"
                  :class="`tone-${check.tone}`"
                >
                  <span>{{ check.label }}</span>
                  <em>{{ check.value }}</em>
                </p>
              </div>

              <footer class="drawer-actions">
                <button type="button" @click="resetSkillRecommendation">
                  重置推荐
                </button>
                <button
                  type="button"
                  @click="applySkillTemplate([selectedIssue.key])"
                >
                  应用模板
                </button>
                <button type="button" @click="saveSkillDraft">仅保存草稿</button>
                <button type="button" @click="saveSkillPlan">保存编排</button>
                <button
                  type="button"
                  class="primary-action"
                  @click="validateAndTrigger"
                >
                  校验并触发
                </button>
              </footer>
            </section>

            <section v-if="selectedDrawerTab === 'steps'" class="drawer-section">
              <div class="runtime-step-head">
                <span>当前状态：{{ selectedOrchestrationRuntime.status }}</span>
                <strong>{{
                  selectedOrchestrationRuntime.progress_percent
                }}% · {{ selectedOrchestrationRuntime.current_stage_name }}</strong>
                <em>
                  已耗时 {{ runtimeElapsedLabel }} / 预计剩余
                  {{ runtimeRemainingLabel }}
                </em>
              </div>

              <div class="step-list">
                <article
                  v-for="step in executionSteps"
                  :key="step.id"
                  :class="`status-${step.status}`"
                  @click="openRuntimeStage(step.id)"
                >
                  <span>{{ step.name }}</span>
                  <strong>{{ step.label }}</strong>
                  <em>{{ step.agent }} · {{ step.skill }} · {{ step.duration }}</em>
                  <small>{{ step.startedAtLabel }} ~ {{ step.endedAtLabel }}</small>
                  <p>{{ step.description }}</p>
                  <i v-if="step.reason">{{ step.reason }}</i>
                  <b>{{ step.status }}</b>
                </article>
              </div>

              <article
                v-if="activeOrchestrationStage !== null"
                class="runtime-stage-detail"
              >
                <span>阶段详情</span>
                <strong>{{
                  activeOrchestrationStage.name
                }} · {{ activeOrchestrationStage.status }}</strong>
                <p>{{ activeOrchestrationStage.description }}</p>
                <em>
                  {{ activeOrchestrationStage.agent }} / {{ activeOrchestrationStage.skill }}
                </em>
                <em>
                  开始：{{
                    activeOrchestrationStage.started_at === null
                      ? "—"
                      : formatJiraDate(activeOrchestrationStage.started_at)
                  }}，结束：{{
                    activeOrchestrationStage.ended_at === null
                      ? "—"
                      : formatJiraDate(activeOrchestrationStage.ended_at)
                  }}
                </em>
                <i v-if="activeOrchestrationStage.reason">{{
                  activeOrchestrationStage.reason
                }}</i>
              </article>

              <div class="runtime-timeline drawer-timeline">
                <header>
                  <span>关键日志</span>
                  <strong>{{
                    selectedOrchestrationRuntime.events.length
                  }} 条</strong>
                </header>
                <article
                  v-for="event in selectedOrchestrationRuntime.events"
                  :key="`drawer-${event.id}`"
                  :class="`event-${event.level}`"
                >
                  <span>{{ formatJiraDate(event.at) }}</span>
                  <strong>{{ event.title }}</strong>
                  <p>{{ event.detail }}</p>
                </article>
              </div>

              <div class="agent-status">
                <h3>Agent 状态</h3>
                <p v-for="agent in agentStatuses" :key="agent.role">
                  <span>{{ agent.role }}</span>
                  <em :class="`tone-${agent.tone}`">{{ agent.status }}</em>
                </p>
                <div v-if="fleetAuditTasks.length > 0" class="fleet-status-list">
                  <p v-for="task in fleetAuditTasks" :key="task.id">
                    <span>{{ task.role }} · {{ task.mode }} · {{ task.scorer }}</span>
                    <em>{{ task.fanout }} · {{ task.arenaCandidateCount }}</em>
                    <small>{{ task.winner }} · {{ task.arenaScores }}</small>
                    <small>{{ task.consistencyDelta }} · {{ task.archivePath }}</small>
                  </p>
                </div>
              </div>
            </section>

            <section
              v-if="selectedDrawerTab === 'evidence'"
              class="drawer-section"
            >
              <div class="drawer-actions inline-actions">
                <button type="button" @click="downloadEvidencePack">
                  下载证据包
                </button>
                <button type="button" @click="copyEvidenceLink">
                  复制证据链接
                </button>
                <button
                  type="button"
                  @click="mcpDetailExpanded = !mcpDetailExpanded"
                >
                  {{ mcpDetailExpanded ? "收起 MCP 调用" : "查看 MCP 调用" }}
                </button>
              </div>
              <div class="chip-list compact">
                <span v-for="call in selectedIssue.mcpCalls" :key="call">{{
                  call
                }}</span>
              </div>
              <div v-if="mcpDetailExpanded" class="mcp-detail-list">
                <p v-for="call in selectedIssue.mcpCalls" :key="`detail-${call}`">
                  <span>{{ call }}</span>
                  <em>只读 / 已审计 / trace 已归档</em>
                </p>
              </div>
              <div class="evidence-list">
                <p v-for="item in selectedIssue.evidence" :key="item.name">
                  <span>{{ item.name }}</span>
                  <em>{{ item.size }}</em>
                </p>
              </div>
              <ul class="reasoning-list">
                <li v-for="item in selectedIssue.reasoning" :key="item">
                  {{ item }}
                </li>
              </ul>
            </section>

            <section v-if="selectedDrawerTab === 'mr'" class="drawer-section">
              <div class="drawer-summary">
                <h3>GitLab 影响范围</h3>
                <p>
                  关联 MR：
                  <a :href="selectedIssue.mrUrl" target="_blank" rel="noreferrer">
                    {{ selectedIssue.gitlabMr }}
                  </a>
                </p>
                <div class="chip-list">
                  <span v-for="repo in selectedIssue.impactedRepos" :key="repo">{{
                    repo
                  }}</span>
                  <span
                    v-for="module in selectedIssue.impactedModules"
                    :key="module"
                  >
                    {{ module }}
                  </span>
                </div>
              </div>
              <footer class="drawer-actions">
                <a :href="selectedIssue.mrUrl" target="_blank" rel="noreferrer">打开 MR</a>
                <button type="button" @click="setDispatchStatus('MR 待 Review')">
                  发起 Review
                </button>
                <button type="button" @click="setDispatchStatus('等待人工确认')">
                  标记需人工确认
                </button>
              </footer>
            </section>
          </aside>
        </main>

        <section class="panel audit-drawer" :class="{ expanded: auditExpanded }">
          <header>
            <div>
              <span>Execution History / 审计日志</span>
              <strong>最近 {{ auditRecords.length }} 条调度记录</strong>
            </div>
            <button type="button" @click="auditExpanded = !auditExpanded">
              {{ auditExpanded ? "收起" : "展开" }}
            </button>
          </header>
          <div class="audit-table" role="table" aria-label="审计日志">
            <div class="audit-row audit-head" role="row">
              <span>Issue Key</span>
              <span>Skill</span>
              <span>Agent</span>
              <span>Workflow</span>
              <span>耗时</span>
              <span>状态</span>
              <span>产物</span>
              <span>操作</span>
            </div>
            <article
              v-for="record in auditRecords"
              :key="record.id"
              class="audit-row"
              role="row"
            >
              <span>{{ record.issueKey }}</span>
              <span>{{ record.skill }}</span>
              <span>{{ record.agent }}</span>
              <span>{{ record.workflow }}</span>
              <span>{{ record.duration }}</span>
              <span>{{ record.status }}</span>
              <span class="artifact-list">
                <button
                  v-for="artifact in record.artifacts"
                  :key="artifact"
                  type="button"
                >
                  {{ artifact }}
                </button>
              </span>
              <span>
                <button type="button" @click="openAuditRecord(record)">
                  查看
                </button>
              </span>
            </article>
          </div>
        </section>
      </template>
    </section>
  </section>

  <Teleport to="body">
    <button
      type="button"
      class="ai-assistant-launcher"
      :class="{ active: assistantDialogOpen }"
      aria-label="打开东软小牛策略思考助手"
      @click="
        assistantDialogOpen ? closeAssistantDialog() : openAssistantDialog()
      "
    >
      <span class="ai-assistant-launcher-avatar">
        <img :src="mascotStrategyAssistant" alt="">
      </span>
      <span class="ai-assistant-launcher-dot" aria-hidden="true" />
    </button>
    <div v-if="!assistantDialogOpen" class="assistant-hint">
      可问：这个 Jira 应该分配哪些 Skill？
    </div>
    <div v-if="assistantDialogOpen" class="ai-dialog-overlay">
      <section
        class="ai-dialog"
        role="dialog"
        aria-labelledby="ai-dialog-title"
      >
        <header class="ai-dialog-header">
          <div class="ai-dialog-title">
            <img :src="mascotStrategyAssistant" alt="东软小牛">
            <div>
              <span>AI 开发中枢</span>
              <strong id="ai-dialog-title">策略思考助手</strong>
            </div>
          </div>
          <button
            type="button"
            class="ai-dialog-close"
            aria-label="关闭策略助手"
            @click="closeAssistantDialog"
          >
            ×
          </button>
        </header>

        <div class="ai-dialog-context">
          <span>当前聚焦</span>
          <strong>{{ selectedIssue.key }} · {{ selectedIssue.summary }}</strong>
          <em>{{ selectedDispatchStatus }} / {{ selectedIssue.assignee }}</em>
        </div>

        <div class="ai-message-list" aria-live="polite">
          <article
            v-for="message in assistantMessages"
            :key="message.id"
            class="ai-message"
            :class="`role-${message.role}`"
          >
            <span>{{ message.role === "assistant" ? "东软小牛" : "我" }} ·
              {{ message.time }}</span>
            <p>{{ message.text }}</p>
          </article>
        </div>

        <div class="ai-suggestion-row">
          <button
            v-for="question in assistantQuickQuestions"
            :key="`dialog-${question}`"
            type="button"
            @click="askStrategyAssistant(question)"
          >
            {{ question }}
          </button>
        </div>

        <footer class="ai-dialog-composer">
          <textarea
            v-model="assistantDialogQuestion"
            name="strategy-dialog-question"
            rows="3"
            placeholder="向东软小牛提问，例如：这个 Jira 应该分配哪些 Skill？"
            @keydown.enter.exact.prevent="askStrategyAssistant()"
          />
          <button type="button" @click="askStrategyAssistant()">发送</button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
