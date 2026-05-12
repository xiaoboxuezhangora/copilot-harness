<script setup lang="ts">
import * as THREE from "three";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import mascotVirtualAssistant from "./assets/mascot/cow-hook-guide.png";
import mascotStrategyAssistant from "./assets/mascot/cow-chief-presenter.png";
import rawSnapshot from "./generated/snapshot.json";
import type { ShowcaseJiraIssue, ShowcaseSnapshotV1 } from "./types";

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

type DrawerTab = "overview" | "skills" | "steps" | "evidence" | "mr";
type JqlMode = "builder" | "manual";
type DispatchStatus =
  | "待编排"
  | "草稿"
  | "Skill 已分配"
  | "Agent 执行中"
  | "MR 待 Review"
  | "等待人工确认"
  | "已完成"
  | "失败";

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

interface FleetAuditTask {
  id: string;
  role: string;
  mode: string;
  fanout: string;
  candidateId: string;
}

const snapshotData = rawSnapshot as unknown as ShowcaseSnapshotV1;
const liveJiraIssues = buildLiveJiraIssues(snapshotData.jiraIssues ?? []);
const defaultProjectFilter = "APMIS";
const defaultVersionFilter = "all";

const currentTime = ref(new Date());
const selectedIssueKey = ref(liveJiraIssues[0]?.key ?? "");
const acknowledgedDecisionIds = ref<string[]>([]);
const searchQuery = ref("");
const projectFilter = ref(defaultProjectFilter);
const versionFilter = ref(defaultVersionFilter);
const issueTypeFilter = ref("all");
const statusFilter = ref("all");
const dispatchStatusFilter = ref<DispatchStatus | "all">("all");
const priorityFilter = ref("all");
const assigneeScopeFilter = ref<"all" | "currentUser" | "selected">("all");
const assigneeFilter = ref("all");
const labelFilter = ref("all");
const affectedVersionFilter = ref("all");
const productModuleFilter = ref("all");
const defectCategoryFilter = ref("all");
const issueCategoryFilter = ref("all");
const projectSourceFilter = ref("all");
const coreRecoveryFilter = ref("all");
const requirementReleasedFilter = ref("all");
const sortFilter = ref("updated-desc");
const jqlMode = ref<JqlMode>("builder");
const manualJql = ref(
  "project = APMIS AND status = 处理中 AND assignee in (currentUser()) ORDER BY updated DESC",
);
const appliedJql = ref("");
const jqlSearchMessage = ref(
  "已预置 Jira filter 86004：主版本jira列表；可一键套用，也可切换为手动 JQL。",
);
const jiraSavedFilterId = ref("86004");
const filterCollapsed = ref(false);
const drawerVisible = ref(true);
const selectedDrawerTab = ref<DrawerTab>("skills");
const selectedIssueKeys = ref<string[]>([]);
const autoExecuteEnabled = ref(false);
const auditExpanded = ref(false);
const calendarOpen = ref(false);
const descriptionExpanded = ref(false);
const mcpDetailExpanded = ref(false);
const skillAssignments = ref<Record<string, string[]>>({});
const dispatchOverrides = ref<Record<string, DispatchStatus>>({});
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
let clockTimer: number | undefined;
let assistantAvatarCleanup: (() => void) | undefined;
let assistantMessageSeq = 0;

const assistantQuickQuestions = [
  "这个 Jira 应该分配哪些 Skill？",
  "当前流水线瓶颈在哪里？",
  "哪些任务需要主管先确认？",
];

const navItems = [
  "仪表盘",
  "Jira 调度",
  "工作流",
  "Skill 管理",
  "Agent 状态",
  "知识库",
  "配置",
];

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

const sortOptions = [
  { value: "updated-desc", label: "按已更新倒序", jql: "updated DESC" },
  {
    value: "target-version-asc",
    label: "按目标版本升序",
    jql: "cf[13301] ASC",
  },
  { value: "priority-desc", label: "按优先级倒序", jql: "priority DESC" },
  { value: "created-desc", label: "按创建日期倒序", jql: "created DESC" },
];

const jiraSavedFilterOptions = [
  {
    id: "86004",
    name: "主版本jira列表",
    jql: "project = APMIS AND status = 处理中 AND assignee in (currentUser()) ORDER BY updated DESC",
  },
];

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

const savedFilters = [
  "主版本 Jira 列表",
  "我的待确认",
  "高危待处理",
  "未分配 Skill",
  "MR 待评审",
  "高优先级",
];

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
    .map((task) => ({
      id: `${task.task_id}-${task.agent_role ?? "unknown"}-${task.candidate_id ?? "none"}`,
      role: formatIntegrationSignal(task.agent_role),
      mode: task.worktree_mode ?? "未接入",
      fanout: formatFleetFanout(task.budget_usage?.fleet_fanout ?? null),
      candidateId: task.candidate_id ?? "未接入",
    }))
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

const allLabels = computed(() =>
  buildOptions(issues.flatMap((issue) => issue.labels)),
);
const issueTypeOptions = computed(() =>
  buildOptions(issues.map((issue) => issue.issueType).filter(Boolean)),
);
const statusOptions = computed(() =>
  buildOptions(issues.map((issue) => issue.status).filter(Boolean)),
);
const priorityOptions = computed(() =>
  buildOptions(issues.map((issue) => issue.priority).filter(Boolean)),
);
const assigneeOptions = computed(() =>
  buildOptions(issues.map((issue) => issue.assignee)),
);
const targetVersionOptions = computed(() =>
  buildOptions(
    issues
      .map((issue) => getTargetVersion(issue))
      .filter((value) => value.length > 0 && value !== "未设置"),
  ),
);
const componentOptions = computed(() =>
  buildOptions(issues.map((issue) => getProductModule(issue)).filter(Boolean)),
);
const affectedVersionOptions = computed(() =>
  buildOptions(
    issues
      .map((issue) => issue.affectedVersion ?? issue.fixVersion)
      .filter((value) => value.length > 0),
  ),
);
const defectCategoryOptions = computed(() =>
  buildOptions(
    issues
      .map((issue) => issue.defectCategory ?? "")
      .filter((value) => value.length > 0),
  ),
);
const issueCategoryOptions = computed(() =>
  buildOptions(
    issues
      .map((issue) => issue.issueCategory ?? "")
      .filter((value) => value.length > 0),
  ),
);
const projectSourceOptions = computed(() =>
  buildOptions(
    issues
      .map((issue) => issue.projectSource ?? "")
      .filter((value) => value.length > 0),
  ),
);
const coreRecoveryOptions = computed(() =>
  buildOptions(
    issues
      .map((issue) => issue.coreRecovery ?? "")
      .filter((value) => value.length > 0),
  ),
);
const requirementReleasedOptions = computed(() =>
  buildOptions(
    issues
      .map((issue) => issue.requirementReleased ?? "")
      .filter((value) => value.length > 0),
  ),
);

function getProductModule(issue: EngineeringIssue) {
  return issue.productModule ?? issue.component;
}

function getTargetVersion(issue: EngineeringIssue) {
  return issue.targetVersion ?? issue.fixVersion;
}

const filteredIssues = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();

  return issues.filter((issue) => {
    if (projectFilter.value !== "all" && issue.project !== projectFilter.value)
      return false;
    if (
      versionFilter.value !== "all" &&
      getTargetVersion(issue) !== versionFilter.value
    )
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
      priorityFilter.value !== "all" &&
      issue.priority !== priorityFilter.value
    )
      return false;
    if (
      assigneeFilter.value !== "all" &&
      assigneeScopeFilter.value === "selected" &&
      issue.assignee !== assigneeFilter.value
    )
      return false;
    if (
      affectedVersionFilter.value !== "all" &&
      (issue.affectedVersion ?? issue.fixVersion) !==
        affectedVersionFilter.value
    )
      return false;
    if (
      productModuleFilter.value !== "all" &&
      getProductModule(issue) !== productModuleFilter.value
    )
      return false;
    if (
      defectCategoryFilter.value !== "all" &&
      issue.defectCategory !== defectCategoryFilter.value
    )
      return false;
    if (
      issueCategoryFilter.value !== "all" &&
      issue.issueCategory !== issueCategoryFilter.value
    )
      return false;
    if (
      projectSourceFilter.value !== "all" &&
      issue.projectSource !== projectSourceFilter.value
    )
      return false;
    if (
      coreRecoveryFilter.value !== "all" &&
      issue.coreRecovery !== coreRecoveryFilter.value
    )
      return false;
    if (
      requirementReleasedFilter.value !== "all" &&
      issue.requirementReleased !== requirementReleasedFilter.value
    )
      return false;
    if (
      labelFilter.value !== "all" &&
      !issue.labels.includes(labelFilter.value)
    )
      return false;
    if (
      dispatchStatusFilter.value !== "all" &&
      getDispatchStatus(issue) !== dispatchStatusFilter.value
    )
      return false;
    if (query.length === 0) return true;

    return [
      issue.key,
      issue.summary,
      getProductModule(issue),
      issue.assignee,
      issue.priority,
      issue.status,
      getTargetVersion(issue),
      issue.affectedVersion ?? "",
      issue.defectCategory ?? "",
      issue.issueCategory ?? "",
      issue.projectSource ?? "",
      issue.coreRecovery ?? "",
      issue.requirementReleased ?? "",
      issue.description,
      issue.expectation,
      ...issue.labels,
      ...issue.impactedModules,
      ...issue.impactedRepos,
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

function quoteJql(value: string) {
  return `"${value.replaceAll('"', '\\"')}"`;
}

const jqlPreview = computed(() => {
  const parts = [`project = ${projectFilter.value}`];
  if (issueTypeFilter.value !== "all")
    parts.push(`issuetype = ${quoteJql(issueTypeFilter.value)}`);
  if (statusFilter.value === "open") parts.push("resolution = Unresolved");
  if (statusFilter.value !== "all" && statusFilter.value !== "open")
    parts.push(`status = ${quoteJql(statusFilter.value)}`);
  if (assigneeScopeFilter.value === "currentUser")
    parts.push("assignee in (currentUser())");
  if (
    assigneeScopeFilter.value === "selected" &&
    assigneeFilter.value !== "all"
  )
    parts.push(`assignee = ${quoteJql(assigneeFilter.value)}`);
  if (searchQuery.value.trim().length > 0)
    parts.push(`text ~ ${quoteJql(searchQuery.value.trim())}`);
  if (dispatchStatusFilter.value !== "all")
    parts.push(
      `"AI Dispatch Status" = ${quoteJql(dispatchStatusFilter.value)}`,
    );
  if (priorityFilter.value !== "all")
    parts.push(`priority = ${quoteJql(priorityFilter.value)}`);
  if (affectedVersionFilter.value !== "all")
    parts.push(`affectedVersion = ${quoteJql(affectedVersionFilter.value)}`);
  if (productModuleFilter.value !== "all")
    parts.push(`"产品线和模块" = ${quoteJql(productModuleFilter.value)}`);
  if (defectCategoryFilter.value !== "all")
    parts.push(`"缺陷分类" = ${quoteJql(defectCategoryFilter.value)}`);
  if (issueCategoryFilter.value !== "all")
    parts.push(`"问题分类" = ${quoteJql(issueCategoryFilter.value)}`);
  if (projectSourceFilter.value !== "all")
    parts.push(`"项目来源" = ${quoteJql(projectSourceFilter.value)}`);
  if (coreRecoveryFilter.value !== "all")
    parts.push(`"核心回收分析" = ${quoteJql(coreRecoveryFilter.value)}`);
  if (requirementReleasedFilter.value !== "all")
    parts.push(
      `"关联需求是否释放" = ${quoteJql(requirementReleasedFilter.value)}`,
    );
  if (versionFilter.value !== "all" && versionFilter.value !== "实时 Jira")
    parts.push(`cf[13301] = ${quoteJql(versionFilter.value)}`);
  if (labelFilter.value !== "all")
    parts.push(`labels = ${quoteJql(labelFilter.value)}`);

  const sort = sortOptions.find((item) => item.value === sortFilter.value);
  return `${parts.join(" AND ")} ORDER BY ${sort?.jql ?? "updated DESC"}`;
});

const effectiveJql = computed(() =>
  jqlMode.value === "manual" ? manualJql.value.trim() : jqlPreview.value,
);

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

const totalSkillEstimate = computed(() =>
  selectedSkillRows.value.reduce((sum, skill) => sum + skill.estimate, 0),
);

const selectedDispatchStatus = computed(() =>
  getDispatchStatus(selectedIssue.value),
);

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

const agentStatuses = computed(() => [
  { role: "PM", status: "就绪", tone: "ok" as Tone },
  {
    role: "Developer",
    status: selectedDispatchStatus.value === "Agent 执行中" ? "运行中" : "就绪",
    tone:
      selectedDispatchStatus.value === "Agent 执行中"
        ? ("warn" as Tone)
        : ("ok" as Tone),
  },
  { role: "Code Review", status: "就绪", tone: "ok" as Tone },
  {
    role: "Security",
    status: selectedIssue.value.riskTone === "danger" ? "等待确认" : "就绪",
    tone:
      selectedIssue.value.riskTone === "danger"
        ? ("warn" as Tone)
        : ("ok" as Tone),
  },
  { role: "Tester", status: "等待", tone: "neutral" as Tone },
]);

const executionSteps = computed(() =>
  selectedSkillRows.value.map((skill, index) => {
    const status =
      selectedDispatchStatus.value === "Agent 执行中" && index === 1
        ? "running"
        : selectedDispatchStatus.value === "已完成" ||
            selectedDispatchStatus.value === "MR 待 Review" ||
            index === 0
          ? "ok"
          : "pending";
    return {
      id: skill.id,
      name: skill.id,
      label: skill.name,
      agent: skill.agent,
      duration: `${skill.estimate}m`,
      status,
    };
  }),
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

onMounted(() => {
  setupAssistantAvatar();
  clockTimer = window.setInterval(() => {
    currentTime.value = new Date();
  }, 30_000);
});

onBeforeUnmount(() => {
  disposeAssistantAvatar();
  if (clockTimer !== undefined) {
    window.clearInterval(clockTimer);
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
        impactedRepos: [],
        impactedModules: [productModule, ...issue.labels].filter(
          (value, index, array) =>
            value.length > 0 && array.indexOf(value) === index,
        ),
        aiUnderstanding: [
          `真实 Jira 来源：${issue.key}`,
          `当前状态：${issue.status ?? "未知"}，优先级：${priority}`,
          `目标版本：${targetVersion}，产品线和模块：${productModule}`,
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
        skills: [],
        mcpCalls,
        evidence: sourceRefs.map((sourceRef) => ({
          name: sourceRef,
          size: "live",
        })),
        reasoning: [
          `Jira 状态：${issue.status ?? "未知"}`,
          `负责人：${issue.assignee ?? "未分配"}`,
          `更新时间：${formatJiraDate(issue.updated ?? issue.created)}`,
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

function getRecommendedSkillIds(issue: EngineeringIssue) {
  const base = ["clarify", "impact", "code", "plan"];
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
  if (issue.riskTone === "danger") return "等待人工确认";
  if (["处理中", "进行中"].includes(issue.status)) return "Agent 执行中";
  if (["已开发完成", "提交测试", "代码评审"].includes(issue.status))
    return "MR 待 Review";
  if (["已完成", "已关闭"].includes(issue.status)) return "已完成";
  return "待编排";
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
  selectedDrawerTab.value = "overview";
  drawerVisible.value = true;
  descriptionExpanded.value = false;
  mcpDetailExpanded.value = false;
}

function openSkillDrawer(issueKey: string) {
  selectedIssueKey.value = issueKey;
  selectedDrawerTab.value = "skills";
  drawerVisible.value = true;
  ensureSkillAssignment();
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

function applySavedFilter(filter: string) {
  if (filter === "主版本 Jira 列表") {
    projectFilter.value = "APMIS";
    versionFilter.value = "all";
    issueTypeFilter.value = "all";
    statusFilter.value = "处理中";
    assigneeScopeFilter.value = "currentUser";
    assigneeFilter.value = "all";
    priorityFilter.value = "all";
    labelFilter.value = "all";
    productModuleFilter.value = "all";
    affectedVersionFilter.value = "all";
    defectCategoryFilter.value = "all";
    issueCategoryFilter.value = "all";
    projectSourceFilter.value = "all";
    coreRecoveryFilter.value = "all";
    requirementReleasedFilter.value = "all";
    sortFilter.value = "updated-desc";
    manualJql.value =
      "project = APMIS AND status = 处理中 AND assignee in (currentUser()) ORDER BY updated DESC";
    jqlSearchMessage.value = "已套用 Jira filter 86004：主版本jira列表。";
  }
  if (filter === "未分配 Skill") {
    statusFilter.value = "all";
    dispatchStatusFilter.value = "待编排";
    searchQuery.value = "";
  }
  if (filter === "高危待处理") {
    priorityFilter.value =
      priorityOptions.value.find((priority) => isHighPriority(priority)) ??
      "all";
    dispatchStatusFilter.value = "等待人工确认";
  }
  if (filter === "我的待确认") {
    assigneeScopeFilter.value = "selected";
    assigneeFilter.value = selectedIssue.value.assignee;
    dispatchStatusFilter.value = "等待人工确认";
  }
  if (filter === "MR 待评审") {
    statusFilter.value = "代码评审";
    dispatchStatusFilter.value = "MR 待 Review";
  }
  if (filter === "高优先级") {
    priorityFilter.value =
      priorityOptions.value.find((priority) => isHighPriority(priority)) ??
      "all";
  }
}

function applySelectedJiraFilter(filterId: string) {
  const matchedFilter = jiraSavedFilterOptions.find(
    (filter) => filter.id === filterId,
  );
  if (!matchedFilter) return;
  applySavedFilter("主版本 Jira 列表");
  manualJql.value = matchedFilter.jql;
}

function useGeneratedJql() {
  jqlMode.value = "builder";
  manualJql.value = jqlPreview.value;
  jqlSearchMessage.value = "已切换为筛选器生成 JQL。";
}

function useManualJql() {
  jqlMode.value = "manual";
  if (manualJql.value.trim().length === 0) {
    manualJql.value = jqlPreview.value;
  }
  jqlSearchMessage.value = "高级 JQL 模式已开启，可直接编辑并搜索。";
}

function applyJqlSearch() {
  appliedJql.value = effectiveJql.value;
  jqlSearchMessage.value =
    jqlMode.value === "manual"
      ? "已应用手动 JQL；接入扩展 MCP 后会直接调用 JiraReader.searchIssues。"
      : "已按当前筛选器生成 JQL；接入扩展 MCP 后会直接提交到 Jira。";
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
  selectedDrawerTab.value = record.artifacts.includes("MR") ? "mr" : "steps";
  drawerVisible.value = true;
}

function filterPipelineColumn(column: PipelineColumn) {
  const statusByColumn: Record<string, DispatchStatus> = {
    understand: "待编排",
    assigned: "Skill 已分配",
    running: "Agent 执行中",
    review: "MR 待 Review",
    manual: "等待人工确认",
  };
  dispatchStatusFilter.value = statusByColumn[column.id] ?? "待编排";
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
  versionFilter.value = defaultVersionFilter;
  issueTypeFilter.value = "all";
  statusFilter.value = "all";
  dispatchStatusFilter.value = "all";
  priorityFilter.value = "all";
  assigneeScopeFilter.value = "all";
  assigneeFilter.value = "all";
  labelFilter.value = "all";
  affectedVersionFilter.value = "all";
  productModuleFilter.value = "all";
  defectCategoryFilter.value = "all";
  issueCategoryFilter.value = "all";
  projectSourceFilter.value = "all";
  coreRecoveryFilter.value = "all";
  requirementReleasedFilter.value = "all";
  sortFilter.value = "updated-desc";
  jqlMode.value = "builder";
  jiraSavedFilterId.value = "86004";
  appliedJql.value = "";
  jqlSearchMessage.value =
    "已重置为 APMIS 默认视图；可重新套用 filter 86004 或手动输入 JQL。";
}

function composeAssistantReply(input: string) {
  const focus = selectedIssue.value;
  const decisionText =
    focus.riskTone === "danger"
      ? "涉及高危或写操作时，需要主管确认后再触发。"
      : "可以先保存编排并进入触发前校验。";
  const questionHint = input.length > 0 ? `针对“${input}”，` : "";
  const skills = selectedSkillRows.value.map((skill) => skill.name).join("、");

  return `${questionHint}建议为 ${focus.key} 分配 ${skills}。当前调度状态为「${selectedDispatchStatus.value}」，预计预算 ${totalSkillEstimate.value} 分钟。${decisionText}后续可在右侧抽屉查看 MCP 权限、执行步骤、证据链与 MR。`;
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
  <section class="console-shell dispatch-console">
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
          :class="{ active: item === 'Jira 调度' }"
        >
          <span aria-hidden="true">{{ item.slice(0, 1) }}</span>
          {{ item }}
        </button>
      </nav>
      <div class="global-user">
        <img :src="mascotStrategyAssistant" alt="">
        <strong>王博</strong>
        <span>研发主管</span>
      </div>
    </aside>

    <section class="dispatch-workspace">
      <header class="topbar command-topbar">
        <div class="brand-block">
          <div class="brand-mark">AI</div>
          <div>
            <span>AI 开发中枢</span>
            <strong>Jira 调度与治理驾驶舱</strong>
          </div>
          <em>实时连接</em>
        </div>

        <div class="top-selectors" aria-label="调度控制条">
          <label>
            项目
            <select
              v-model="projectFilter"
              name="project"
              aria-label="选择项目"
            >
              <option
                v-for="project in jiraProjectOptions"
                :key="project.value"
                :value="project.value"
              >
                {{ project.label }}
              </option>
            </select>
          </label>
          <label>
            目标版本
            <select
              v-model="versionFilter"
              name="fix-version"
              aria-label="选择目标版本"
            >
              <option value="all">全部目标版本</option>
              <option
                v-for="version in targetVersionOptions"
                :key="version"
                :value="version"
              >
                {{ version }}
              </option>
            </select>
          </label>
          <label>
            Jira 筛选器
            <select
              v-model="jiraSavedFilterId"
              name="jira-saved-filter"
              aria-label="选择 Jira 保存筛选器"
              @change="applySelectedJiraFilter(jiraSavedFilterId)"
            >
              <option
                v-for="filter in jiraSavedFilterOptions"
                :key="filter.id"
                :value="filter.id"
              >
                {{ filter.name }} ({{ filter.id }})
              </option>
            </select>
          </label>
        </div>

        <div class="command-actions">
          <label class="auto-toggle">
            <input v-model="autoExecuteEnabled" type="checkbox">
            <span>自动执行：{{ autoExecuteEnabled ? "ON" : "OFF" }}</span>
          </label>
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
          <div class="panel-heading">
            <span>Jira 筛选器</span>
            <div class="heading-actions">
              <button type="button" @click="resetFilters">重置</button>
              <button type="button" @click="toggleFilterCollapsed">
                {{ filterCollapsed ? "展开" : "收起" }}
              </button>
            </div>
          </div>

          <template v-if="!filterCollapsed">
            <section class="jira-filter-source">
              <span>当前 Jira 筛选</span>
              <strong>主版本jira列表 · filter=86004</strong>
              <em>Jira Server 7.10.1 / REST v2</em>
            </section>

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
                <option v-for="item in statusOptions" :key="item" :value="item">
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
              包含文本
              <input
                v-model="searchQuery"
                name="issue-search"
                type="search"
                placeholder="Jira key / 标题 / 描述 / 负责人"
              >
            </label>

            <section class="more-jira-fields">
              <span>更多字段</span>
              <label class="filter-control">
                目标版本 cf[13301]
                <select v-model="versionFilter" name="target-version">
                  <option value="all">全部目标版本</option>
                  <option
                    v-for="item in targetVersionOptions"
                    :key="item"
                    :value="item"
                  >
                    {{ item }}
                  </option>
                </select>
              </label>
              <label class="filter-control">
                影响版本
                <select v-model="affectedVersionFilter" name="affected-version">
                  <option value="all">全部影响版本</option>
                  <option
                    v-for="item in affectedVersionOptions"
                    :key="item"
                    :value="item"
                  >
                    {{ item }}
                  </option>
                </select>
              </label>
              <label class="filter-control">
                产品线和模块 cf[10126]
                <select v-model="productModuleFilter" name="product-module">
                  <option value="all">全部产品线和模块</option>
                  <option
                    v-for="item in componentOptions"
                    :key="item"
                    :value="item"
                  >
                    {{ item }}
                  </option>
                </select>
              </label>
              <label class="filter-control">
                缺陷分类 cf[10302]
                <select v-model="defectCategoryFilter" name="defect-category">
                  <option value="all">全部缺陷分类</option>
                  <option
                    v-for="item in defectCategoryOptions"
                    :key="item"
                    :value="item"
                  >
                    {{ item }}
                  </option>
                </select>
              </label>
              <label class="filter-control">
                问题分类 cf[10116]
                <select v-model="issueCategoryFilter" name="issue-category">
                  <option value="all">全部问题分类</option>
                  <option
                    v-for="item in issueCategoryOptions"
                    :key="item"
                    :value="item"
                  >
                    {{ item }}
                  </option>
                </select>
              </label>
              <label class="filter-control">
                项目来源 cf[10121]
                <select v-model="projectSourceFilter" name="project-source">
                  <option value="all">全部项目来源</option>
                  <option
                    v-for="item in projectSourceOptions"
                    :key="item"
                    :value="item"
                  >
                    {{ item }}
                  </option>
                </select>
              </label>
              <label class="filter-control">
                核心回收分析 cf[12400]
                <select v-model="coreRecoveryFilter" name="core-recovery">
                  <option value="all">全部</option>
                  <option
                    v-for="item in coreRecoveryOptions"
                    :key="item"
                    :value="item"
                  >
                    {{ item }}
                  </option>
                </select>
              </label>
              <label class="filter-control">
                关联需求是否释放 cf[15603]
                <select
                  v-model="requirementReleasedFilter"
                  name="requirement-released"
                >
                  <option value="all">全部</option>
                  <option
                    v-for="item in requirementReleasedOptions"
                    :key="item"
                    :value="item"
                  >
                    {{ item }}
                  </option>
                </select>
              </label>
              <label class="filter-control">
                优先级
                <select v-model="priorityFilter" name="priority">
                  <option value="all">全部</option>
                  <option
                    v-for="item in priorityOptions"
                    :key="item"
                    :value="item"
                  >
                    {{ item }}
                  </option>
                </select>
              </label>
              <label class="filter-control">
                标签
                <select v-model="labelFilter" name="label">
                  <option value="all">全部标签</option>
                  <option v-for="item in allLabels" :key="item" :value="item">
                    {{ item }}
                  </option>
                </select>
              </label>
              <label class="filter-control">
                排序
                <select v-model="sortFilter" name="sort">
                  <option
                    v-for="item in sortOptions"
                    :key="item.value"
                    :value="item.value"
                  >
                    {{ item.label }}
                  </option>
                </select>
              </label>
            </section>

            <section class="saved-filters">
              <span>Jira 保存的筛选器</span>
              <button
                v-for="filter in savedFilters"
                :key="filter"
                type="button"
                @click="applySavedFilter(filter)"
              >
                {{ filter }}
              </button>
            </section>

            <section class="jql-box">
              <div>
                <span>{{
                  jqlMode === "manual" ? "高级 JQL" : "生成 JQL"
                }}</span>
                <strong>{{ versionSummary.visible }} /
                  {{ versionSummary.total }}</strong>
              </div>
              <div class="jql-mode-switch">
                <button
                  type="button"
                  :class="{ active: jqlMode === 'builder' }"
                  @click="useGeneratedJql"
                >
                  筛选器生成
                </button>
                <button
                  type="button"
                  :class="{ active: jqlMode === 'manual' }"
                  @click="useManualJql"
                >
                  手动输入 JQL
                </button>
              </div>
              <textarea
                v-if="jqlMode === 'manual'"
                v-model="manualJql"
                name="manual-jql"
                rows="5"
                placeholder="例如：project = APMIS AND status = 处理中 AND assignee in (currentUser()) ORDER BY updated DESC"
                aria-label="手动输入 JQL"
              />
              <p v-else>{{ jqlPreview }}</p>
              <em>{{ jqlSearchMessage }}</em>
              <small v-if="appliedJql.length > 0">已应用：{{ appliedJql }}</small>
              <button type="button" @click="applyJqlSearch">搜索</button>
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
                <span>Active Pipeline</span>
                <strong>Jira → Skill → Agent → MR → 人工确认</strong>
              </div>
              <button type="button" class="ghost-action">查看瓶颈</button>
            </div>

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

            <div class="skill-list">
              <article
                v-for="skill in skillCandidates"
                :key="skill.id"
                class="skill-row"
                :class="{ enabled: selectedSkillIds.includes(skill.id) }"
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
            <div class="step-list">
              <article
                v-for="step in executionSteps"
                :key="step.id"
                :class="`status-${step.status}`"
              >
                <span>{{ step.name }}</span>
                <strong>{{ step.label }}</strong>
                <em>{{ step.agent }} · {{ step.duration }}</em>
                <b>{{ step.status }}</b>
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
                  <span>{{ task.role }} · {{ task.mode }}</span>
                  <em>{{ task.fanout }} · {{ task.candidateId }}</em>
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
