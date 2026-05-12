#!/usr/bin/env tsx
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';

import { JiraClient, loadConfigFromEnv } from '../mcp-servers/jira-reader/src/index.js';
import type { JiraIssue } from '../mcp-servers/jira-reader/src/index.js';

interface GitLabProject {
  readonly id: number;
  readonly name: string;
  readonly pathWithNamespace: string;
  readonly defaultBranch: string | null;
}

interface GitLabBranch {
  readonly name: string;
  readonly default: boolean;
}

interface GitLabHistoryHit {
  readonly kind: 'merge_request' | 'commit';
  readonly project: string;
  readonly sourceRef: string;
}

interface MappingSignal {
  readonly field: string;
  readonly value: string;
  readonly weight: number;
}

interface ProjectCandidate {
  readonly project: string;
  readonly default_branch: string | null;
  readonly confidence: number;
  readonly score: number;
  readonly matched_signals: readonly string[];
  readonly ref_candidates: readonly RefCandidate[];
  readonly evidence_refs: readonly string[];
  readonly rationale: string;
}

interface RefCandidate {
  readonly ref: string;
  readonly confidence: number;
  readonly source: 'default_branch' | 'version_match' | 'history_match' | 'confirmed_rule';
  readonly matched_value?: string;
}

interface ConfirmedProjectRule {
  readonly id: string;
  readonly label: string;
  readonly project: string;
  readonly matcher: (issue: JiraIssue) => boolean;
  readonly resolveRef: (issue: JiraIssue) => string;
  readonly branchPolicy: string;
  readonly note: string;
}

interface ConfirmedRuleCatalogItem {
  readonly id: string;
  readonly label: string;
  readonly project: string;
  readonly branch_policy: string;
  readonly note: string;
}

type MappingStatus = 'candidate' | 'confirmed' | 'rejected' | 'superseded';

interface IssueDraft {
  readonly jira_key: string;
  readonly signals: Record<string, string | readonly string[] | null>;
  readonly history_hits: readonly GitLabHistoryHit[];
  readonly candidates: readonly ProjectCandidate[];
  readonly confirmation_status: MappingStatus;
  readonly confirmation_note: string;
}

interface FieldValueRuleDraft {
  readonly id: string;
  readonly status: MappingStatus;
  readonly field: string;
  readonly value: string;
  readonly issue_count: number;
  readonly sample_jira_keys: readonly string[];
  readonly project_candidates: readonly AggregatedProjectCandidate[];
  readonly confirmation_instruction: string;
}

interface AggregatedProjectCandidate {
  readonly project: string;
  readonly hits: number;
  readonly average_confidence: number;
  readonly branch_candidates: readonly string[];
}

interface MappingDraft {
  readonly schema_version: 'phase-1b-w8-jira-gitlab-mapping-draft@1';
  readonly generated_at: string;
  readonly source_summary: {
    readonly jira_jql_ref: 'env:JIRA_SMOKE_JQL' | 'env:W8_MAPPING_JIRA_JQL';
    readonly jira_jql_hash: string;
    readonly jira_total: number;
    readonly jira_sample_count: number;
    readonly gitlab_project_count: number;
    readonly history_search_issue_count: number;
  };
  readonly update_protocol: {
    readonly rule_status_flow: readonly string[];
    readonly merge_strategy: string;
    readonly confirmation_policy: string;
  };
  readonly confirmed_rule_catalog: readonly ConfirmedRuleCatalogItem[];
  readonly field_value_rules: readonly FieldValueRuleDraft[];
  readonly issue_mappings: readonly IssueDraft[];
  readonly next_confirmation_actions: readonly string[];
}

interface GitLabSearchConfig {
  readonly baseUrl: string;
  readonly token: string;
  readonly requestTimeoutMs: number;
}

const ROOT_DIR =
  process.env.W8_MAPPING_REPO_ROOT ??
  (basename(process.cwd()) === 'orchestrator' ? resolve(process.cwd(), '..') : process.cwd());
const DEFAULT_OUTPUT_JSON = join(
  ROOT_DIR,
  'orchestrator',
  'eval',
  'w8-jira-gitlab-mapping-draft.json'
);
const DEFAULT_OUTPUT_MD = join(
  ROOT_DIR,
  'orchestrator',
  'eval',
  'w8-jira-gitlab-mapping-draft.md'
);
const DEFAULT_JIRA_MAX_RESULTS = 50;
const DEFAULT_GITLAB_PROJECT_LIMIT = 300;
const DEFAULT_HISTORY_SEARCH_ISSUE_LIMIT = 50;
const ANGULAR17_RULE_ID = 'text.angular17.frontend';
const CONFIRMED_PROJECT_RULES: readonly ConfirmedProjectRule[] = [
  {
    id: ANGULAR17_RULE_ID,
    label: '标题或描述包含 Angular17',
    project: 'apmis/odcbs/odcbs-frontend',
    matcher: (issue) => /\bangular\s*17\b/i.test(issueText(issue)),
    resolveRef: () => 'develop_to_angular17',
    branchPolicy: '固定 develop_to_angular17',
    note: 'Angular17 相关工单固定进入前端 Angular17 升级分支。',
  },
  {
    id: 'integration.sso.dc-sso',
    label: '单点登录系统厂商对接',
    project: 'apmis/dc-sso',
    matcher: (issue) => /(?:dc-sso|\bsso\b|单点登录|统一认证|登录系统厂商)/i.test(issueText(issue)),
    resolveRef: () => 'master',
    branchPolicy: '固定 master',
    note: 'dc-sso 用于对接各单点登录系统厂商。',
  },
  {
    id: 'integration.signature.odcbs-ca',
    label: '电子签名厂商对接',
    project: 'apmis/ca-sso/odcbs-ca',
    matcher: (issue) => /(?:odcbs-ca|电子签名|电子签章|签名厂商|数字签名|\bca\b)/i.test(issueText(issue)),
    resolveRef: () => 'master',
    branchPolicy: '固定 master',
    note: 'odcbs-ca 用于对接各个电子签名厂商；GitLab 已验证路径为 apmis/ca-sso/odcbs-ca。',
  },
  {
    id: 'client.mobile.aims-mobile-vue',
    label: '移动端代码',
    project: 'apmis/mobile/aims-mobile-vue',
    matcher: (issue) => /(?:aims-mobile-vue|移动端|移动护理|移动应用|手机端|\bapp\b)/i.test(issueText(issue)),
    resolveRef: resolveMobileRef,
    branchPolicy: '主版本 master；西安交通大学 xajd；广东省人民 gdsrm',
    note: 'aims-mobile-vue 是移动端代码。',
  },
  {
    id: 'client.pda.aims-pda-vue',
    label: 'PDA 代码',
    project: 'apmis/mobile/aims-pda-vue',
    matcher: (issue) => /(?:aims-pda-vue|\bpda\b|手持|扫码枪|条码扫描)/i.test(issueText(issue)),
    resolveRef: resolvePdaRef,
    branchPolicy: '主版本 main；广东省人民 gdsrm',
    note: 'aims-pda-vue 是 PDA 代码。',
  },
  {
    id: 'server.backend.odcbs-backend',
    label: '后端代码',
    project: 'apmis/odcbs/odcbs-backend',
    matcher: (issue) => /(?:odcbs-backend|后端|服务端|后台服务|接口异常|数据库|定时任务|java)/i.test(issueText(issue)),
    resolveRef: resolveDevelopRef,
    branchPolicy: '开发分支 develop；广东省人民 gdsrm_develop',
    note: 'odcbs-backend 是后端代码。',
  },
  {
    id: 'client.frontend.odcbs-frontend',
    label: '前端代码',
    project: 'apmis/odcbs/odcbs-frontend',
    matcher: (issue) => /(?:odcbs-frontend|前端|页面|界面|按钮|弹窗|菜单|样式|路由|组件|\bvue\b|\bui\b)/i.test(issueText(issue)),
    resolveRef: resolveDevelopRef,
    branchPolicy: '开发分支 develop；广东省人民 gdsrm_develop；Angular17 由更高优先级规则进入 develop_to_angular17',
    note: 'odcbs-frontend 是前端代码。',
  },
  {
    id: 'integration.platform.odbip-custom-backend',
    label: '手麻平台三方交互接口',
    project: 'apmis/odbip/odbip-custom-backend',
    matcher: matchesCustomBackendRule,
    resolveRef: () => 'develop',
    branchPolicy: '固定 develop',
    note: 'odbip-custom-backend 是当前手麻平台项目，用于处理手麻系统一切跟三方系统交互接口的处理；GitLab 验证实际分支为 develop，未发现 deveop。',
  },
];

async function main(): Promise<void> {
  const jqlOverride = process.env.W8_MAPPING_JIRA_JQL?.trim();
  const jql =
    jqlOverride !== undefined && jqlOverride.length > 0
      ? jqlOverride
      : readRequiredEnv('JIRA_SMOKE_JQL');
  const jqlRef =
    jqlOverride !== undefined && jqlOverride.length > 0
      ? 'env:W8_MAPPING_JIRA_JQL'
      : 'env:JIRA_SMOKE_JQL';
  const jiraMaxResults = readNumberEnv('W8_MAPPING_JIRA_MAX_RESULTS', DEFAULT_JIRA_MAX_RESULTS);
  const gitlabProjectLimit = readNumberEnv(
    'W8_MAPPING_GITLAB_PROJECT_LIMIT',
    DEFAULT_GITLAB_PROJECT_LIMIT
  );
  const historyIssueLimit = readNumberEnv(
    'W8_MAPPING_HISTORY_SEARCH_ISSUE_LIMIT',
    DEFAULT_HISTORY_SEARCH_ISSUE_LIMIT
  );
  const outputJson = process.env.W8_MAPPING_OUTPUT_JSON ?? DEFAULT_OUTPUT_JSON;
  const outputMd = process.env.W8_MAPPING_OUTPUT_MD ?? DEFAULT_OUTPUT_MD;

  const jiraConfig = loadConfigFromEnv(process.env);
  const jiraClient = new JiraClient(jiraConfig);
  const gitlabConfig = readGitLabConfig();

  const jiraSearch = await jiraClient.searchIssues(jql, jiraMaxResults);
  const projects = await fetchGitLabProjects(gitlabConfig, gitlabProjectLimit);
  const branchCache = new Map<string, Promise<readonly GitLabBranch[]>>();
  const historyHitsByIssue = await fetchHistoryHitsForIssues({
    config: gitlabConfig,
    issues: jiraSearch.issues.slice(0, historyIssueLimit),
    projectsById: new Map(projects.map((project) => [project.id, project])),
  });

  const issueMappings: IssueDraft[] = [];
  for (const issue of jiraSearch.issues) {
    const historyHits = historyHitsByIssue.get(issue.key) ?? [];
    issueMappings.push(
      await buildIssueDraft({
        issue,
        projects,
        historyHits,
        branchCache,
        gitlabConfig,
      })
    );
  }

  const generatedDraft: MappingDraft = {
    schema_version: 'phase-1b-w8-jira-gitlab-mapping-draft@1',
    generated_at: new Date().toISOString(),
    source_summary: {
      jira_jql_ref: jqlRef,
      jira_jql_hash: sha256(jql),
      jira_total: jiraSearch.total,
      jira_sample_count: jiraSearch.issues.length,
      gitlab_project_count: projects.length,
      history_search_issue_count: Math.min(historyIssueLimit, jiraSearch.issues.length),
    },
    update_protocol: {
      rule_status_flow: ['candidate', 'confirmed', 'rejected', 'superseded'],
      merge_strategy:
        '可以反复重新生成候选规则，但不得覆盖人工标记为 confirmed/rejected 的规则；只有经过人工确认后，才能提升为 eval 真值数据。',
      confirmation_policy:
        '只有工程和分支都经过人工确认，或存在 GitLab issue-key 历史证据支撑时，规则才可标记为 confirmed。',
    },
    confirmed_rule_catalog: CONFIRMED_PROJECT_RULES.map(ruleToCatalogItem),
    field_value_rules: buildFieldValueRules(issueMappings),
    issue_mappings: issueMappings,
    next_confirmation_actions: [
      '优先确认或驳回工单数量较多的 field_value_rules。',
      '每条 confirmed 规则都需要明确 GitLab 分支策略：默认分支、版本分支或功能分支。',
      '从 confirmed 的 issue_mappings 中挑选至少 20 条作为 W8 真实联合 eval 种子样本。',
      '不要把 candidate 规则直接复制为 W8 真值，必须先经过人工确认。',
    ],
  };
  const draft = await mergeExistingConfirmations(outputJson, generatedDraft);

  await mkdir(dirname(outputJson), { recursive: true });
  await writeFile(outputJson, `${JSON.stringify(draft, null, 2)}\n`, 'utf8');
  await writeFile(outputMd, renderMarkdown(draft), 'utf8');

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        output_json: outputJson,
        output_md: outputMd,
        jira_sample_count: draft.source_summary.jira_sample_count,
        gitlab_project_count: draft.source_summary.gitlab_project_count,
        field_value_rule_count: draft.field_value_rules.length,
        high_confidence_issue_count: draft.issue_mappings.filter(
          (issue) => (issue.candidates[0]?.confidence ?? 0) >= 0.75
        ).length,
      },
      null,
      2
    )}\n`
  );
}

async function buildIssueDraft(input: {
  readonly issue: JiraIssue;
  readonly projects: readonly GitLabProject[];
  readonly historyHits: readonly GitLabHistoryHit[];
  readonly branchCache: Map<string, Promise<readonly GitLabBranch[]>>;
  readonly gitlabConfig: GitLabSearchConfig;
}): Promise<IssueDraft> {
  const signals = buildSignals(input.issue);
  const confirmedRules = findConfirmedProjectRules(input.issue);
  const historyProjects = new Set(input.historyHits.map((hit) => hit.project));
  const rankedProjects = input.projects
    .map((project) => scoreProject(project, signals, input.issue, historyProjects))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const candidates: ProjectCandidate[] = [];
  candidates.push(...buildConfirmedRuleCandidates(input, confirmedRules));
  const confirmedProjects = new Set(candidates.map((candidate) => candidate.project));

  for (const scored of rankedProjects) {
    const project = scored.project;
    if (confirmedProjects.has(project.pathWithNamespace)) {
      continue;
    }
    const branches = await getBranches(
      input.branchCache,
      input.gitlabConfig,
      project.pathWithNamespace
    );
    const refCandidates = buildRefCandidates({
      issue: input.issue,
      project,
      branches,
      hasHistory: historyProjects.has(project.pathWithNamespace),
    });
    const historyRefs = input.historyHits
      .filter((hit) => hit.project === project.pathWithNamespace)
      .map((hit) => hit.sourceRef);
    candidates.push({
      project: project.pathWithNamespace,
      default_branch: project.defaultBranch,
      confidence: clamp(round(scored.score)),
      score: round(scored.score),
      matched_signals: scored.matchedSignals,
      ref_candidates: refCandidates,
      evidence_refs: historyRefs,
      rationale: buildRationale(scored.matchedSignals, historyRefs.length),
    });
  }

  return {
    jira_key: input.issue.key,
    signals: issueSignalsForOutput(input.issue),
    history_hits: input.historyHits,
    candidates,
    confirmation_status: confirmedRules.length > 0 ? 'confirmed' : 'candidate',
    confirmation_note: confirmedRules.length > 0
      ? `命中人工确认规则：${confirmedRules.map((rule) => rule.label).join('；')}。`
      : '由 Jira 字段、GitLab 工程/分支/历史信号生成；在确认前仅作为候选草稿。',
  };
}

function buildConfirmedRuleCandidates(
  input: {
    readonly issue: JiraIssue;
    readonly projects: readonly GitLabProject[];
    readonly historyHits: readonly GitLabHistoryHit[];
  },
  rules: readonly ConfirmedProjectRule[]
): readonly ProjectCandidate[] {
  return rules.map((rule) => buildConfirmedRuleCandidate(input, rule));
}

function buildConfirmedRuleCandidate(input: {
  readonly issue: JiraIssue;
  readonly projects: readonly GitLabProject[];
  readonly historyHits: readonly GitLabHistoryHit[];
}, rule: ConfirmedProjectRule): ProjectCandidate {
  const project = input.projects.find(
    (item) => item.pathWithNamespace === rule.project
  );
  const historyRefs = input.historyHits
    .filter((hit) => hit.project === rule.project)
    .map((hit) => hit.sourceRef);
  const ref = rule.resolveRef(input.issue);

  return {
    project: rule.project,
    default_branch: project?.defaultBranch ?? null,
    confidence: 1,
    score: 1,
    matched_signals: [`confirmed_rule:${rule.id}`],
    ref_candidates: [
      {
        ref,
        confidence: 1,
        source: 'confirmed_rule',
        matched_value: rule.label,
      },
    ],
    evidence_refs: historyRefs,
    rationale: `命中人工确认规则：${rule.label}，映射到 ${rule.project}@${ref}。`,
  };
}

async function mergeExistingConfirmations(
  outputJson: string,
  generated: MappingDraft
): Promise<MappingDraft> {
  const existing = await readExistingDraft(outputJson);
  if (existing === null) return generated;

  return {
    ...generated,
    field_value_rules: mergeLockedItems({
      generated: generated.field_value_rules,
      existing: existing.field_value_rules,
      keyOf: (item) => item.id,
      locked: (item) => item.status !== 'candidate' && !isMigratedFieldRule(item),
    }),
    issue_mappings: mergeLockedItems({
      generated: generated.issue_mappings,
      existing: existing.issue_mappings,
      keyOf: (item) => item.jira_key,
      locked: (item) =>
        item.confirmation_status !== 'candidate' && !isAutoGeneratedConfirmation(item),
    }),
  };
}

async function readExistingDraft(outputJson: string): Promise<MappingDraft | null> {
  try {
    const raw = await readFile(outputJson, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.schema_version !== 'phase-1b-w8-jira-gitlab-mapping-draft@1') {
      return null;
    }
    return parsed as unknown as MappingDraft;
  } catch {
    return null;
  }
}

function mergeLockedItems<T>(input: {
  readonly generated: readonly T[];
  readonly existing: readonly T[];
  readonly keyOf: (item: T) => string;
  readonly locked: (item: T) => boolean;
}): readonly T[] {
  const lockedByKey = new Map<string, T>();
  for (const item of input.existing) {
    if (input.locked(item)) lockedByKey.set(input.keyOf(item), item);
  }

  const seen = new Set<string>();
  const merged = input.generated.map((item) => {
    const key = input.keyOf(item);
    seen.add(key);
    return lockedByKey.get(key) ?? item;
  });

  for (const [key, item] of lockedByKey.entries()) {
    if (!seen.has(key)) merged.push(item);
  }

  return merged;
}

function isMigratedFieldRule(rule: FieldValueRuleDraft): boolean {
  return rule.field === 'text_rule' && rule.value === 'Angular17';
}

function isAutoGeneratedConfirmation(issue: IssueDraft): boolean {
  return issue.confirmation_note.startsWith('命中人工确认规则：');
}

function buildSignals(issue: JiraIssue): readonly MappingSignal[] {
  const signals: MappingSignal[] = [];
  pushSignal(signals, 'jira_project', issue.project?.key, 0.14);
  if (isNewHandAnesthesiaIssue(issue)) {
    pushSignal(signals, 'domain_rule', '新手麻代码在 APMIS', 0.5);
  }
  pushSignal(signals, 'project_source', issue.projectSource, 0.34);
  pushSignal(signals, 'product_module', issue.productModule, 0.3);
  for (const rule of findConfirmedProjectRules(issue)) {
    pushSignal(signals, 'manual_rule', rule.id, 1);
  }
  pushSignal(signals, 'target_version', issue.targetVersion, 0.08);
  for (const version of issue.fixVersions ?? []) pushSignal(signals, 'fix_version', version, 0.08);
  for (const version of issue.affectedVersions ?? []) {
    pushSignal(signals, 'affected_version', version, 0.05);
  }
  for (const label of issue.labels) pushSignal(signals, 'label', label, 0.08);
  for (const token of tokenize(`${issue.summary} ${issue.description ?? ''}`).slice(0, 12)) {
    pushSignal(signals, 'text_token', token, 0.03);
  }
  return signals;
}

function pushSignal(
  signals: MappingSignal[],
  field: string,
  rawValue: string | undefined,
  weight: number
): void {
  const value = normalizeDisplay(rawValue);
  if (value.length > 0) {
    signals.push({ field, value, weight });
  }
}

function scoreProject(
  project: GitLabProject,
  signals: readonly MappingSignal[],
  issue: JiraIssue,
  historyProjects: ReadonlySet<string>
): { readonly project: GitLabProject; readonly score: number; readonly matchedSignals: readonly string[] } {
  const haystack = normalizeSearch(`${project.pathWithNamespace} ${project.name}`);
  const projectTokens = new Set(tokenize(`${project.pathWithNamespace} ${project.name}`));
  let score = historyProjects.has(project.pathWithNamespace) ? 0.72 : 0;
  const matchedSignals: string[] = historyProjects.has(project.pathWithNamespace)
    ? ['gitlab_history:issue_key']
    : [];

  for (const signal of signals) {
    const normalized = normalizeSearch(signal.value);
    if (normalized.length < 2) continue;
    const signalTokens = tokenize(signal.value);
    const exactMatch = haystack.includes(normalized);
    const tokenHits = signalTokens.filter((token) => projectTokens.has(token)).length;

    if (exactMatch) {
      score += signal.weight;
      matchedSignals.push(`${signal.field}:${signal.value}`);
      continue;
    }

    if (signalTokens.length > 0 && tokenHits > 0) {
      score += signal.weight * Math.min(tokenHits / signalTokens.length, 0.75);
      matchedSignals.push(`${signal.field}:${signal.value}`);
    }
  }

  const layerBoost = scoreLayer(issue, project.pathWithNamespace);
  if (layerBoost > 0) {
    score += layerBoost;
    matchedSignals.push(`layer_keyword:${layerBoost.toFixed(2)}`);
  }

  return {
    project,
    score: Math.min(score, 1),
    matchedSignals: dedupe(matchedSignals),
  };
}

function scoreLayer(issue: JiraIssue, projectPath: string): number {
  const text = `${issue.summary} ${issue.description ?? ''} ${issue.labels.join(' ')}`.toLowerCase();
  const path = projectPath.toLowerCase();
  const frontendSignals = ['前端', '页面', '界面', '按钮', 'vue', 'ui', '移动端', 'pda', 'app'];
  const backendSignals = ['后端', '接口', '服务', '数据库', 'oracle', 'java', 'api', '定时任务'];
  const mobileSignals = ['移动', 'pda', 'app', '扫码', '手持'];

  if (frontendSignals.some((signal) => text.includes(signal)) && /front|vue|web|ui/.test(path)) {
    return 0.12;
  }
  if (backendSignals.some((signal) => text.includes(signal)) && /back|server|api|service/.test(path)) {
    return 0.12;
  }
  if (mobileSignals.some((signal) => text.includes(signal)) && /mobile|pda|app|vue/.test(path)) {
    return 0.1;
  }
  return 0;
}

function buildRefCandidates(input: {
  readonly issue: JiraIssue;
  readonly project: GitLabProject;
  readonly branches: readonly GitLabBranch[];
  readonly hasHistory: boolean;
}): readonly RefCandidate[] {
  const versionValues = [
    input.issue.targetVersion,
    ...(input.issue.fixVersions ?? []),
    ...(input.issue.affectedVersions ?? []),
  ]
    .map((value) => normalizeDisplay(value))
    .filter((value) => value.length > 0);
  const refs: RefCandidate[] = [];

  for (const version of versionValues) {
    const normalizedVersion = normalizeVersion(version);
    const matched = input.branches.find((branch) =>
      normalizeVersion(branch.name).includes(normalizedVersion)
    );
    if (matched !== undefined) {
      refs.push({
        ref: matched.name,
        confidence: input.hasHistory ? 0.9 : 0.72,
        source: input.hasHistory ? 'history_match' : 'version_match',
        matched_value: version,
      });
    }
  }

  if (input.project.defaultBranch !== null) {
    refs.push({
      ref: input.project.defaultBranch,
      confidence: input.hasHistory ? 0.75 : 0.55,
      source: 'default_branch',
    });
  }

  return [...uniqueRefs(refs)]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 3);
}

function buildFieldValueRules(issueMappings: readonly IssueDraft[]): readonly FieldValueRuleDraft[] {
  const buckets = new Map<string, IssueDraft[]>();
  for (const issue of issueMappings) {
    for (const field of ['manual_rules', 'domain_rule', 'project_source', 'product_module', 'jira_project'] as const) {
      const value = issue.signals[field];
      const values = Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string' && item.length > 0)
        : typeof value === 'string' && value.length > 0
          ? [value]
          : [];
      for (const item of values) {
        const key = `${field}:${item}`;
        buckets.set(key, [...(buckets.get(key) ?? []), issue]);
      }
    }
  }

  return [...buckets.entries()]
    .map(([key, issues]) => buildFieldValueRule(key, issues))
    .sort((a, b) => b.issue_count - a.issue_count || a.id.localeCompare(b.id))
    .slice(0, 50);
}

function buildFieldValueRule(key: string, issues: readonly IssueDraft[]): FieldValueRuleDraft {
  const [field = 'unknown', value = 'unknown'] = key.split(/:(.*)/s);
  const projects = new Map<string, { hits: number; confidence: number; branches: Set<string> }>();

  for (const issue of issues) {
    const top = issue.candidates[0];
    if (top === undefined) continue;
    const entry = projects.get(top.project) ?? {
      hits: 0,
      confidence: 0,
      branches: new Set<string>(),
    };
    entry.hits += 1;
    entry.confidence += top.confidence;
    for (const ref of top.ref_candidates) entry.branches.add(ref.ref);
    projects.set(top.project, entry);
  }

  const projectCandidates = [...projects.entries()]
    .map(([project, stats]) => ({
      project,
      hits: stats.hits,
      average_confidence: round(stats.confidence / Math.max(stats.hits, 1)),
      branch_candidates: [...stats.branches].slice(0, 5),
    }))
    .sort((a, b) => b.hits - a.hits || b.average_confidence - a.average_confidence)
    .slice(0, 5);

  return {
    id: stableId(`${field}:${value}`),
    status: isConfirmedManualFieldRule(field, value) ? 'confirmed' : 'candidate',
    field,
    value,
    issue_count: issues.length,
    sample_jira_keys: issues.map((issue) => issue.jira_key).slice(0, 10),
    project_candidates: projectCandidates,
    confirmation_instruction: isConfirmedManualFieldRule(field, value)
      ? `该规则来自人工确认：${renderManualRuleInstruction(value)}。`
      : '使用该规则作为 W8 真值前，请先将 status 标记为 confirmed/rejected，并保留一个明确的工程/分支策略。',
  };
}

function issueSignalsForOutput(issue: JiraIssue): Record<string, string | readonly string[] | null> {
  const confirmedRules = findConfirmedProjectRules(issue);
  return {
    manual_rules: confirmedRules.map((rule) => rule.id),
    domain_rule: isNewHandAnesthesiaIssue(issue) ? '新手麻代码在 APMIS' : null,
    jira_project: issue.project?.key ?? null,
    issue_type: issue.issueType ?? null,
    status: issue.status ?? null,
    project_source: issue.projectSource ?? null,
    product_module: issue.productModule ?? null,
    target_version: issue.targetVersion ?? null,
    fix_versions: issue.fixVersions ?? [],
    affected_versions: issue.affectedVersions ?? [],
    labels: issue.labels,
  };
}

async function fetchHistoryHitsForIssues(input: {
  readonly config: GitLabSearchConfig;
  readonly issues: readonly JiraIssue[];
  readonly projectsById: ReadonlyMap<number, GitLabProject>;
}): Promise<Map<string, readonly GitLabHistoryHit[]>> {
  const result = new Map<string, readonly GitLabHistoryHit[]>();
  for (const issue of input.issues) {
    const mergeRequests = await searchGitLabHistory({
      config: input.config,
      issueKey: issue.key,
      scope: 'merge_requests',
      projectsById: input.projectsById,
    });
    const commits = await searchGitLabHistory({
      config: input.config,
      issueKey: issue.key,
      scope: 'commits',
      projectsById: input.projectsById,
    });
    result.set(issue.key, [...mergeRequests, ...commits].slice(0, 10));
  }
  return result;
}

async function searchGitLabHistory(input: {
  readonly config: GitLabSearchConfig;
  readonly issueKey: string;
  readonly scope: 'merge_requests' | 'commits';
  readonly projectsById: ReadonlyMap<number, GitLabProject>;
}): Promise<readonly GitLabHistoryHit[]> {
  try {
    const raw = await gitlabGetJson(
      input.config,
      `/api/v4/search?scope=${encodeURIComponent(input.scope)}&search=${encodeURIComponent(
        input.issueKey
      )}&per_page=10`
    );
    if (!Array.isArray(raw)) return [];
    return raw
      .map((item) => mapHistoryHit(item, input.scope, input.projectsById))
      .filter((item): item is GitLabHistoryHit => item !== null);
  } catch {
    return [];
  }
}

function mapHistoryHit(
  value: unknown,
  scope: 'merge_requests' | 'commits',
  projectsById: ReadonlyMap<number, GitLabProject>
): GitLabHistoryHit | null {
  if (!isRecord(value)) return null;
  const projectId = readNumber(value, 'project_id');
  const project = projectId === undefined ? undefined : projectsById.get(projectId);
  if (project === undefined) return null;

  if (scope === 'merge_requests') {
    const iid = readNumber(value, 'iid');
    if (iid === undefined) return null;
    return {
      kind: 'merge_request',
      project: project.pathWithNamespace,
      sourceRef: `gitlab:${project.pathWithNamespace}#mr:${iid}`,
    };
  }

  const sha = readString(value, 'id') ?? readString(value, 'short_id');
  if (sha === undefined) return null;
  return {
    kind: 'commit',
    project: project.pathWithNamespace,
    sourceRef: `gitlab:${project.pathWithNamespace}#commit:${sha}`,
  };
}

async function fetchGitLabProjects(
  config: GitLabSearchConfig,
  limit: number
): Promise<readonly GitLabProject[]> {
  const projects: GitLabProject[] = [];
  for (let page = 1; projects.length < limit; page += 1) {
    const raw = await gitlabGetJson(
      config,
      `/api/v4/projects?membership=true&per_page=100&page=${page}&order_by=last_activity_at&sort=desc`
    );
    if (!Array.isArray(raw) || raw.length === 0) break;
    for (const item of raw) {
      const project = mapProject(item);
      if (project !== null) projects.push(project);
      if (projects.length >= limit) break;
    }
  }
  return projects;
}

async function getBranches(
  cache: Map<string, Promise<readonly GitLabBranch[]>>,
  config: GitLabSearchConfig,
  projectPath: string
): Promise<readonly GitLabBranch[]> {
  const existing = cache.get(projectPath);
  if (existing !== undefined) return existing;
  const promise = fetchGitLabBranches(config, projectPath);
  cache.set(projectPath, promise);
  return promise;
}

async function fetchGitLabBranches(
  config: GitLabSearchConfig,
  projectPath: string
): Promise<readonly GitLabBranch[]> {
  try {
    const raw = await gitlabGetJson(
      config,
      `/api/v4/projects/${encodeURIComponent(projectPath)}/repository/branches?per_page=100`
    );
    if (!Array.isArray(raw)) return [];
    return raw
      .map((item) => mapBranch(item))
      .filter((branch): branch is GitLabBranch => branch !== null);
  } catch {
    return [];
  }
}

async function gitlabGetJson(config: GitLabSearchConfig, pathAndQuery: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);
  try {
    const response = await fetch(`${config.baseUrl.replace(/\/$/, '')}${pathAndQuery}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'PRIVATE-TOKEN': config.token,
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`GitLab responded with HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function mapProject(value: unknown): GitLabProject | null {
  if (!isRecord(value)) return null;
  const id = readNumber(value, 'id');
  const name = readString(value, 'name');
  const pathWithNamespace = readString(value, 'path_with_namespace');
  const defaultBranch = readString(value, 'default_branch') ?? null;
  if (id === undefined || name === undefined || pathWithNamespace === undefined) return null;
  return {
    id,
    name: sanitizeForOutput(name),
    pathWithNamespace: sanitizeForOutput(pathWithNamespace),
    defaultBranch: defaultBranch === null ? null : sanitizeForOutput(defaultBranch),
  };
}

function mapBranch(value: unknown): GitLabBranch | null {
  if (!isRecord(value)) return null;
  const name = readString(value, 'name');
  if (name === undefined) return null;
  return {
    name: sanitizeForOutput(name),
    default: readBoolean(value, 'default') ?? false,
  };
}

function readGitLabConfig(): GitLabSearchConfig {
  return {
    baseUrl: readRequiredEnv('GITLAB_BASE_URL'),
    token: readRequiredEnv('GITLAB_TOKEN'),
    requestTimeoutMs: readNumberEnv(
      'W8_MAPPING_GITLAB_REQUEST_TIMEOUT_MS',
      readNumberEnv('CODE_RETRIEVAL_REQUEST_TIMEOUT_MS', 30_000)
    ),
  };
}

function renderMarkdown(draft: MappingDraft): string {
  const highConfidenceIssues = draft.issue_mappings.filter(
    (issue) => (issue.candidates[0]?.confidence ?? 0) >= 0.75
  );
  const topRules = draft.field_value_rules.slice(0, 20);
  const lines = [
    '# W8 Jira 到 GitLab 映射草稿',
    '',
    `- 生成时间：${draft.generated_at}`,
    `- Jira 查询来源：${draft.source_summary.jira_jql_ref}`,
    `- Jira JQL 哈希：${draft.source_summary.jira_jql_hash}`,
    `- Jira 样本数：${draft.source_summary.jira_sample_count} / 总数 ${draft.source_summary.jira_total}`,
    `- 已扫描 GitLab 成员工程数：${draft.source_summary.gitlab_project_count}`,
    `- 已搜索 GitLab issue-key 历史的工单数：${draft.source_summary.history_search_issue_count}`,
    `- 高置信工单候选数：${highConfidenceIssues.length}`,
    '',
    '## 更新协议',
    '',
    `- 状态流转：${draft.update_protocol.rule_status_flow.map(renderStatus).join(' -> ')}`,
    `- 合并策略：${draft.update_protocol.merge_strategy}`,
    `- 确认策略：${draft.update_protocol.confirmation_policy}`,
    '',
    '## 人工确认规则库',
    '',
    '| 规则 | GitLab 工程 | 分支策略 | 说明 |',
    '| --- | --- | --- | --- |',
    ...draft.confirmed_rule_catalog.map((rule) =>
      markdownRow([rule.label, rule.project, rule.branch_policy, rule.note])
    ),
    '',
    '## 候选字段规则',
    '',
    '| 字段 | 字段值 | 工单数 | 推荐 GitLab 工程候选 | 示例 Jira 编号 |',
    '| --- | --- | ---: | --- | --- |',
    ...topRules.map((rule) =>
      markdownRow([
        rule.field,
        rule.value,
        String(rule.issue_count),
        rule.project_candidates
          .map(
            (candidate) =>
              `${candidate.project}（命中 ${candidate.hits}，平均置信度 ${candidate.average_confidence}）`
          )
          .join('<br>') || '无',
        rule.sample_jira_keys.join(', '),
      ])
    ),
    '',
    '## 高置信工单候选',
    '',
    '| Jira 编号 | 候选 GitLab 工程 | 置信度 | 分支候选 | 证据 |',
    '| --- | --- | ---: | --- | --- |',
    ...highConfidenceIssues.slice(0, 30).map((issue) => {
      const top = issue.candidates[0];
      return markdownRow([
        issue.jira_key,
        top?.project ?? '无',
        String(top?.confidence ?? 0),
        top?.ref_candidates.map(renderRefCandidate).join('<br>') ?? '无',
        renderCandidateEvidence(top),
      ]);
    }),
    '',
    '## 待确认动作',
    '',
    ...draft.next_confirmation_actions.map((action) => `- ${action}`),
    '',
  ];

  return `${lines.join('\n')}\n`;
}

function markdownRow(cells: readonly string[]): string {
  return `| ${cells.map((cell) => cell.replaceAll('|', '\\|')).join(' | ')} |`;
}

function buildRationale(matchedSignals: readonly string[], historyRefCount: number): string {
  const confirmedSignal = findConfirmedSignal(matchedSignals);
  if (confirmedSignal !== null) {
    const rule = CONFIRMED_PROJECT_RULES.find((item) => item.id === confirmedSignal);
    const historySuffix =
      historyRefCount > 0 ? `；同时命中 ${historyRefCount} 个 GitLab 历史引用` : '';
    return `命中人工确认规则：${rule?.label ?? confirmedSignal}${historySuffix}。`;
  }
  if (historyRefCount > 0) {
    return `Jira 编号命中 GitLab 历史记录（${historyRefCount} 个引用），同时匹配 ${matchedSignals.length} 个字段/路径信号。`;
  }
  return `${matchedSignals.length} 个 Jira 字段/文本信号匹配 GitLab 工程路径或名称。`;
}

function renderStatus(status: string): string {
  const labels: Readonly<Record<string, string>> = {
    candidate: '候选(candidate)',
    confirmed: '已确认(confirmed)',
    rejected: '已驳回(rejected)',
    superseded: '已替代(superseded)',
  };
  return labels[status] ?? status;
}

function renderRefCandidate(ref: RefCandidate): string {
  const labels: Readonly<Record<RefCandidate['source'], string>> = {
    default_branch: '默认分支',
    version_match: '版本匹配',
    history_match: '历史证据匹配',
    confirmed_rule: '人工确认规则',
  };
  return `${ref.ref}：${labels[ref.source]}`;
}

function renderCandidateEvidence(candidate: ProjectCandidate | undefined): string {
  if (candidate === undefined) return '无';
  const lines: string[] = [];
  const confirmedSignal = findConfirmedSignal(candidate.matched_signals);
  if (confirmedSignal !== null) {
    const rule = CONFIRMED_PROJECT_RULES.find((item) => item.id === confirmedSignal);
    lines.push(`命中人工确认规则：${rule?.label ?? confirmedSignal}`);
  }
  lines.push(...candidate.evidence_refs);
  if (lines.length === 0) return '仅字段/工程名信号，无 GitLab 历史证据';
  return lines.join('<br>');
}

function issueText(issue: JiraIssue): string {
  return [
    issue.summary,
    issue.description ?? '',
    issue.projectSource ?? '',
    issue.productModule ?? '',
    issue.labels.join(' '),
  ].join(' ');
}

function findConfirmedProjectRules(issue: JiraIssue): readonly ConfirmedProjectRule[] {
  return CONFIRMED_PROJECT_RULES.filter((rule) => rule.matcher(issue));
}

function isConfirmedManualFieldRule(field: string, value: string): boolean {
  return field === 'manual_rules' && CONFIRMED_PROJECT_RULES.some((rule) => rule.id === value);
}

function renderManualRuleInstruction(ruleId: string): string {
  const rule = CONFIRMED_PROJECT_RULES.find((item) => item.id === ruleId);
  if (rule === undefined) return ruleId;
  return `${rule.label} 时，映射到 ${rule.project}，分支策略：${rule.branchPolicy}`;
}

function findConfirmedSignal(signals: readonly string[]): string | null {
  const prefix = 'confirmed_rule:';
  const signal = signals.find((item) => item.startsWith(prefix));
  return signal === undefined ? null : signal.slice(prefix.length);
}

function ruleToCatalogItem(rule: ConfirmedProjectRule): ConfirmedRuleCatalogItem {
  return {
    id: rule.id,
    label: rule.label,
    project: rule.project,
    branch_policy: rule.branchPolicy,
    note: rule.note,
  };
}

function isNewHandAnesthesiaIssue(issue: JiraIssue): boolean {
  return /新手麻|手麻/.test(issueText(issue)) && issue.project?.key === 'APMIS';
}

function resolveMobileRef(issue: JiraIssue): string {
  const text = issueText(issue);
  if (/广东省人民|gdsrm/i.test(text)) return 'gdsrm';
  if (/西安交通大学|西安交大|xajd/i.test(text)) return 'xajd';
  return 'master';
}

function resolvePdaRef(issue: JiraIssue): string {
  return /广东省人民|gdsrm/i.test(issueText(issue)) ? 'gdsrm' : 'main';
}

function resolveDevelopRef(issue: JiraIssue): string {
  return /广东省人民|gdsrm/i.test(issueText(issue)) ? 'gdsrm_develop' : 'develop';
}

function matchesCustomBackendRule(issue: JiraIssue): boolean {
  const text = issueText(issue);
  if (CONFIRMED_PROJECT_RULES.some((rule) => rule.id !== 'integration.platform.odbip-custom-backend' && rule.matcher(issue))) {
    return false;
  }
  return /(?:odbip-custom-backend|三方|第三方|厂商|接口对接|系统对接|集成接口|his|lis|pacs|emr|院内系统|平台交互)/i.test(text);
}

function uniqueRefs(refs: readonly RefCandidate[]): readonly RefCandidate[] {
  const seen = new Set<string>();
  const result: RefCandidate[] = [];
  for (const ref of refs) {
    if (seen.has(ref.ref)) continue;
    seen.add(ref.ref);
    result.push(ref);
  }
  return result;
}

function dedupe(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function normalizeDisplay(value: string | undefined): string {
  return sanitizeForOutput(value ?? '').trim();
}

function normalizeSearch(value: string): string {
  return value.toLowerCase().replace(/[\s_./:-]+/g, '');
}

function normalizeVersion(value: string): string {
  return normalizeSearch(value).replace(/^v/, '');
}

function tokenize(value: string): readonly string[] {
  const normalized = sanitizeForOutput(value).toLowerCase();
  const asciiTokens = normalized
    .split(/[^a-z0-9]+/g)
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
  const chineseTokens = normalized.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
  return dedupe([...asciiTokens, ...chineseTokens]).slice(0, 30);
}

const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'this',
  'that',
  'issue',
  'bug',
  'fix',
  '需求',
  '问题',
]);

function sanitizeForOutput(value: string): string {
  return value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted-email]')
    .replace(
      /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})\b/g,
      '[redacted-private-ip]'
    )
    .replace(/\b(?:token|secret|api[_-]?key)\s*[:=]\s*["']?[^"'\s,;]+/gi, '[redacted-secret]')
    .replace(/\b(?:bearer|basic)\s+[A-Za-z0-9+/._~=-]{8,}/gi, '[redacted-credential]');
}

function stableId(value: string): string {
  return `${value.split(':')[0] ?? 'rule'}-${sha256(value).slice(0, 12)}`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function clamp(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function readRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function readNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (raw === undefined || raw.length === 0) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

function readNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === 'number' ? value : undefined;
}

function readBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  return typeof value === 'boolean' ? value : undefined;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Failed to generate W8 mapping draft';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
