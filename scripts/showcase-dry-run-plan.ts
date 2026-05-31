import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  JiraClient,
  createJiraReaderToolHandlers,
  loadConfigFromEnv as loadJiraConfigFromEnv,
  type JiraComment,
  type JiraIssue
} from '../mcp-servers/jira-reader/src/index.js';
import {
  GitLabClient,
  LocalRepository,
  createCodeRetrievalToolHandlers,
  loadConfigFromEnv as loadCodeRetrievalConfigFromEnv,
  type CodeFileSliceV1,
  type CodeSearchResultV1,
  type GitLabContextPackV1
} from '../mcp-servers/code-retrieval/src/index.js';
import { buildJiraContextPackV1 } from '../orchestrator/src/jira/context.js';
import { buildJiraEvidencePackV2 } from '../orchestrator/src/jira/evidence.js';
import { buildCodeImpactReportV0, type TargetCodeMapV0 } from '../orchestrator/src/requirements/codeImpact.js';
import { routeIssueProfile } from '../orchestrator/src/requirements/router.js';

export interface ShowcaseDryRunPlanRequest {
  readonly issueKey: string;
  readonly skillIds: readonly string[];
  readonly codeTargets?: readonly CodeTarget[] | undefined;
  readonly mode?: 'dry-run' | undefined;
}

export type ShowcaseDryRunPlanStatus = 'ready' | 'need_more_context' | 'degraded';

export interface ShowcaseDryRunPlanResponse {
  readonly status: ShowcaseDryRunPlanStatus;
  readonly runId: string;
  readonly issueKey: string;
  readonly message: string;
  readonly generatedAt: string;
  readonly dryRun: true;
  readonly codeEvidenceCount: number;
  readonly mcpCalls: readonly string[];
  readonly target: {
    readonly project: string;
    readonly ref: string;
    readonly reason: string;
  } | null;
  readonly artifacts: {
    readonly planMd: string;
    readonly planJson: string;
  } | null;
  readonly planPreview: ShowcaseDryRunPlanPreview;
  readonly changePreview: ShowcaseDryRunChangePreview;
  readonly warnings: readonly string[];
}

export interface ShowcaseDryRunPlanPreview {
  readonly summary: string;
  readonly bugCause: {
    readonly statement: string;
    readonly confidence: number;
    readonly evidence: readonly string[];
  };
  readonly modificationPlan: {
    readonly goal: string;
    readonly changes: readonly string[];
    readonly files: readonly string[];
  };
  readonly approvalExecution: {
    readonly summary: string;
    readonly actions: readonly string[];
    readonly safeguards: readonly string[];
  };
  readonly steps: readonly string[];
  readonly risks: readonly string[];
  readonly tests: readonly string[];
  readonly codeEvidenceFiles: readonly {
    readonly repo: string;
    readonly branch: string;
    readonly file: string;
    readonly startLine?: number | undefined;
    readonly endLine?: number | undefined;
    readonly sourceRef?: string | undefined;
  }[];
}

export interface ShowcaseDryRunChangePreview {
  readonly mode: 'suggested_patch' | 'needs_executor';
  readonly summary: string;
  readonly confidence: number;
  readonly files: readonly ShowcaseDryRunChangeFile[];
  readonly limitations: readonly string[];
}

export interface ShowcaseDryRunChangeFile {
  readonly repo: string;
  readonly branch: string;
  readonly file: string;
  readonly language: string;
  readonly sourceRef: string;
  readonly reason: string;
  readonly hunks: readonly ShowcaseDryRunChangeHunk[];
}

export interface ShowcaseDryRunChangeHunk {
  readonly header: string;
  readonly oldStart: number;
  readonly oldLines: number;
  readonly newStart: number;
  readonly newLines: number;
  readonly rationale: string;
  readonly diffLines: readonly ShowcaseDryRunDiffLine[];
}

export interface ShowcaseDryRunDiffLine {
  readonly type: 'context' | 'add' | 'remove';
  readonly oldLineNumber?: number | undefined;
  readonly newLineNumber?: number | undefined;
  readonly content: string;
}

interface EnvMap {
  readonly [key: string]: string | undefined;
}

interface McpCallTrace {
  readonly server: string;
  readonly tool: string;
  readonly success: boolean;
  readonly latencyMs: number;
}

export interface CodeTarget {
  readonly project: string;
  readonly ref: string;
  readonly reason: string;
}

interface CodeSearchPayload {
  readonly ok: boolean;
  readonly context_pack?: GitLabContextPackV1;
}

interface CodeReadFilePayload {
  readonly ok: boolean;
  readonly file?: CodeFileSliceV1;
}

interface JiraIssuePayload {
  readonly issue?: JiraIssue;
}

interface JiraCommentsPayload {
  readonly comments?: readonly JiraComment[];
}

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_SEARCH_QUERIES = 6;
const MAX_CODE_TARGETS = 10;

export async function runShowcaseDryRunPlan(
  request: ShowcaseDryRunPlanRequest,
  env: EnvMap = process.env
): Promise<ShowcaseDryRunPlanResponse> {
  const issueKey = normalizeIssueKey(request.issueKey);
  const generatedAt = new Date().toISOString();
  const runId = `dry-run-${issueKey}-${compactTimestamp(generatedAt)}`;
  const traces: McpCallTrace[] = [];
  const warnings: string[] = [];

  const jiraConfig = loadJiraConfigFromEnv(env);
  const jiraClient = new JiraClient(jiraConfig);
  const jiraHandlers = createJiraReaderToolHandlers(jiraClient);

  let issue: JiraIssue;
  let comments: readonly JiraComment[] = [];
  const issuePayload = await callTool<JiraIssuePayload>(traces, {
    server: 'jira-reader',
    tool: 'getIssue',
    invoke: () => jiraHandlers.getIssue({ issueKey })
  });
  if (issuePayload.issue === undefined) {
    throw new Error('Jira MCP getIssue did not return issue');
  }
  issue = issuePayload.issue;

  const commentsPayload = await callTool<JiraCommentsPayload>(traces, {
    server: 'jira-reader',
    tool: 'getComments',
    invoke: () => jiraHandlers.getComments({ issueKey })
  });
  comments = commentsPayload.comments ?? [];

  const jiraContextPack = buildJiraContextPackV1(issue, comments);
  const evidencePack = buildJiraEvidencePackV2({ issue, comments, generatedAt });
  const profile = routeIssueProfile(evidencePack);

  let target: CodeTarget | null = null;
  let contextPack = buildEmptyGitLabContextPack(generatedAt);
  let codeEvidenceCount = 0;

  try {
    const codeConfig = loadCodeRetrievalConfigFromEnv(env);
    const searchTargets = resolveCodeTargets(request, issue, codeConfig.localRepoName, env);
    target = searchTargets[0] ?? null;

    const gitlabClient = codeConfig.gitlab
      ? new GitLabClient({
          baseUrl: codeConfig.gitlab.baseUrl,
          token: codeConfig.gitlab.token,
          requestTimeoutMs: codeConfig.gitlab.requestTimeoutMs
        })
      : undefined;
    const localRepository = codeConfig.localRepoRoot
      ? new LocalRepository({
          repoRoot: codeConfig.localRepoRoot,
          repoName: codeConfig.localRepoName
        })
      : undefined;

    const codeHandlers = createCodeRetrievalToolHandlers({ gitlabClient, localRepository });
    const packs: GitLabContextPackV1[] = [];
    for (const query of buildSearchQueries(issue)) {
      for (const searchTarget of searchTargets) {
        const payload = await callTool<CodeSearchPayload>(traces, {
          server: 'code-retrieval',
          tool: 'searchCode',
          invoke: () =>
            codeHandlers.searchCode({
              query,
              scope: searchTarget.project,
              ref: searchTarget.ref,
              limit: 5,
              mode: gitlabClient !== undefined ? 'gitlab' : 'local'
            })
        });
        if (payload.context_pack !== undefined) {
          packs.push(payload.context_pack);
        }
        if (collectSearchResults(packs).length >= MAX_CODE_TARGETS) {
          break;
        }
      }
      if (collectSearchResults(packs).length >= MAX_CODE_TARGETS) {
        break;
      }
    }
    contextPack = mergeGitLabContextPacks(packs, generatedAt);
    if (target !== null) {
      contextPack = await augmentContextPackForChangePreview({
        issue,
        contextPack,
        target,
        codeHandlers,
        traces
      });
    }
    codeEvidenceCount = contextPack.evidence_refs.length;
  } catch (error) {
    warnings.push(`Code Retrieval 未完成：${sanitizeRuntimeMessage(error)}`);
  }

  const targetCodeMap = buildTargetCodeMap(issueKey, contextPack, target);
  const codeImpact = buildCodeImpactReportV0({
    evidencePack,
    targetCodeMap,
    gitlabContextPack: contextPack
  });
  const plan = buildPlanJson({
    runId,
    generatedAt,
    issue,
    comments,
    skillIds: request.skillIds,
    jiraContextPack,
    evidencePack,
    profile,
    target,
    contextPack,
    targetCodeMap,
    codeImpact,
    traces,
    warnings
  });
  const outputDir = join(ROOT_DIR, 'reports', 'dry-run', issueKey);
  await mkdir(outputDir, { recursive: true });
  const planJsonPath = join(outputDir, 'plan.json');
  const planMdPath = join(outputDir, 'plan.md');
  await writeFile(planJsonPath, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
  await writeFile(planMdPath, buildPlanMarkdown(plan), 'utf8');

  const status: ShowcaseDryRunPlanStatus =
    codeEvidenceCount > 0 ? 'ready' : warnings.length > 0 ? 'degraded' : 'need_more_context';
  return {
    status,
    runId,
    issueKey,
    generatedAt,
    dryRun: true,
    codeEvidenceCount,
    message:
      status === 'ready'
        ? `已完成 ${issueKey} dry-run，生成 ${codeEvidenceCount} 条代码证据。`
        : `已生成 ${issueKey} dry-run 方案，但缺少可追溯代码证据。`,
    mcpCalls: traces.map(formatTrace),
    target,
    artifacts: {
      planMd: planMdPath,
      planJson: planJsonPath
    },
    planPreview: {
      summary: plan.plan.summary,
      bugCause: plan.plan.bugCause,
      modificationPlan: plan.plan.modificationPlan,
      approvalExecution: plan.plan.approvalExecution,
      steps: plan.plan.steps,
      risks: plan.plan.risks,
      tests: plan.plan.tests,
      codeEvidenceFiles: plan.codeEvidence.files
    },
    changePreview: plan.changePreview,
    warnings
  };
}

async function callTool<T>(
  traces: McpCallTrace[],
  input: {
    readonly server: string;
    readonly tool: string;
    readonly invoke: () => Promise<unknown>;
  }
): Promise<T> {
  const started = Date.now();
  try {
    const result = await input.invoke();
    traces.push({
      server: input.server,
      tool: input.tool,
      success: true,
      latencyMs: Date.now() - started
    });
    return parseTextPayload<T>(result);
  } catch (error) {
    traces.push({
      server: input.server,
      tool: input.tool,
      success: false,
      latencyMs: Date.now() - started
    });
    throw error;
  }
}

function parseTextPayload<T>(result: unknown): T {
  if (typeof result !== 'object' || result === null || !('content' in result)) {
    throw new Error('MCP tool result did not include content');
  }
  const content = (result as { readonly content?: unknown }).content;
  if (!Array.isArray(content)) {
    throw new Error('MCP tool result content was not an array');
  }
  const first = content[0];
  if (
    typeof first !== 'object' ||
    first === null ||
    !('type' in first) ||
    first.type !== 'text' ||
    !('text' in first) ||
    typeof first.text !== 'string'
  ) {
    throw new Error('MCP tool result did not include text content');
  }
  return JSON.parse(first.text) as T;
}

function resolveCodeTargets(
  request: ShowcaseDryRunPlanRequest,
  issue: JiraIssue,
  localRepoName: string | undefined,
  env: EnvMap
): readonly CodeTarget[] {
  const assignedTargets = uniqueCodeTargets(
    (request.codeTargets ?? []).filter(
      (target) => target.project.trim().length > 0 && target.ref.trim().length > 0
    )
  );
  return assignedTargets.length > 0
    ? assignedTargets
    : [resolveCodeTarget(issue, localRepoName, env)];
}

function resolveCodeTarget(
  issue: JiraIssue,
  localRepoName: string | undefined,
  env: EnvMap
): CodeTarget {
  const text = issueText(issue);
  const envProject = readEnv(env, 'CODE_RETRIEVAL_DEFAULT_PROJECT');
  const envRef = readEnv(env, 'CODE_RETRIEVAL_DEFAULT_REF');

  if (/\bangular\s*17\b/i.test(text)) {
    return {
      project: envProject ?? 'apmis/odcbs/odcbs-frontend',
      ref: envRef ?? 'develop_to_angular17',
      reason: '命中 Angular17 升级规则。'
    };
  }

  if (/(后端|服务端|接口|数据库|定时任务|java|backend)/i.test(text)) {
    return {
      project: envProject ?? localRepoName ?? 'apmis/odcbs/odcbs-backend',
      ref: envRef ?? 'develop',
      reason: '命中后端/接口类 Jira 规则。'
    };
  }

  if (/(前端|页面|界面|按钮|弹窗|菜单|样式|路由|组件|vue|ui|列表|表头|操作列)/i.test(text)) {
    return {
      project: envProject ?? localRepoName ?? 'apmis/odcbs/odcbs-frontend',
      ref: envRef ?? 'develop',
      reason: '命中前端/界面类 Jira 规则。'
    };
  }

  return {
    project: envProject ?? localRepoName ?? 'apmis/odcbs/odcbs-frontend',
    ref: envRef ?? 'develop',
    reason: '未命中专项规则，使用默认代码检索目标。'
  };
}

function uniqueCodeTargets(targets: readonly CodeTarget[]): readonly CodeTarget[] {
  const seen = new Set<string>();
  const deduped: CodeTarget[] = [];
  for (const target of targets) {
    const normalized: CodeTarget = {
      project: target.project.trim(),
      ref: target.ref.trim(),
      reason: target.reason.trim().length > 0 ? target.reason.trim() : 'Jira 单条分配'
    };
    const key = `${normalized.project}@${normalized.ref}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(normalized);
  }
  return deduped;
}

function buildSearchQueries(issue: JiraIssue): readonly string[] {
  const intentQueries = buildIntentSearchQueries(issue);
  const values = [
    ...intentQueries,
    issue.productModule,
    issue.defectCategory,
    issue.issueCategory,
    ...issue.labels,
    ...tokenizeSearchText(issue.summary),
    ...tokenizeSearchText(issue.description ?? ''),
    issue.key
  ];
  return uniqueStrings(values)
    .map((value) => value.trim())
    .filter((value) => value.length >= 2 && value.length <= 80)
    .slice(0, MAX_SEARCH_QUERIES);
}

function buildIntentSearchQueries(issue: JiraIssue): readonly string[] {
  const text = issueText(issue);
  const bracketSegments = extractBracketSegments(issue.summary)
    .flatMap((segment) => segment.split(/[-—/|｜:：]/u))
    .map((segment) => segment.trim())
    .filter((segment) => segment.length >= 2);
  const queries = [...bracketSegments];

  if (/备血申请管理/.test(text)) {
    queries.push('备血申请管理');
  }
  if (/盛京医院/.test(text)) {
    queries.push('sjyy');
    queries.push('盛京医院');
  }
  if (/操作列|表头|按钮|串位|错位|微调/.test(text)) {
    queries.push('操作列');
    queries.push('action-cell');
  }

  return queries;
}

function extractBracketSegments(value: string): readonly string[] {
  const segments: string[] = [];
  for (const match of value.matchAll(/[【\[]([^】\]]+)[】\]]/gu)) {
    if (match[1] !== undefined) {
      segments.push(match[1]);
    }
  }
  return segments;
}

function tokenizeSearchText(value: string): readonly string[] {
  return value
    .split(/[^\p{Letter}\p{Number}_-]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !isStopWord(token));
}

function isStopWord(value: string): boolean {
  return ['需要', '当前', '进行', '处理', '问题', '优化', '微调', 'the', 'and', 'for'].includes(
    value.toLowerCase()
  );
}

function buildEmptyGitLabContextPack(generatedAt: string): GitLabContextPackV1 {
  return {
    version: 'GitLabContextPackV1',
    generated_at: generatedAt,
    query: '',
    scope: 'blobs',
    search_results: [],
    file_slices: [],
    evidence_refs: [],
    need_more_context: true,
    warnings: []
  };
}

function mergeGitLabContextPacks(
  packs: readonly GitLabContextPackV1[],
  generatedAt: string
): GitLabContextPackV1 {
  const searchResults = dedupeBySourceRef(collectSearchResults(packs)).slice(0, MAX_CODE_TARGETS);
  const sourceRefs = new Set(searchResults.map((result) => result.source_ref));
  return {
    version: 'GitLabContextPackV1',
    generated_at: generatedAt,
    query: uniqueStrings(packs.map((pack) => pack.query)).join(' | '),
    scope: 'blobs',
    search_results: searchResults,
    file_slices: packs
      .flatMap((pack) => pack.file_slices)
      .filter((slice) => sourceRefs.has(slice.source_ref))
      .slice(0, MAX_CODE_TARGETS),
    evidence_refs: packs
      .flatMap((pack) => pack.evidence_refs)
      .filter((ref) => sourceRefs.has(ref.source_ref))
      .slice(0, MAX_CODE_TARGETS),
    need_more_context: searchResults.length === 0,
    warnings: uniqueStrings(packs.flatMap((pack) => pack.warnings))
  };
}

async function augmentContextPackForChangePreview(input: {
  readonly issue: JiraIssue;
  readonly contextPack: GitLabContextPackV1;
  readonly target: CodeTarget;
  readonly codeHandlers: ReturnType<typeof createCodeRetrievalToolHandlers>;
  readonly traces: McpCallTrace[];
}): Promise<GitLabContextPackV1> {
  const text = issueText(input.issue);
  const shouldReadBloodApplicationFiles =
    /备血申请管理/.test(text) && /(操作列|表头|按钮|串位|错位|微调)/.test(text);
  const shouldReadLoginFiles = isLoginStyleMismatchIssue(input.issue);

  if (!shouldReadBloodApplicationFiles && !shouldReadLoginFiles) {
    return input.contextPack;
  }

  const requiredFiles: Array<{
    readonly path: string;
    readonly range: { readonly start: number; readonly end: number };
    readonly marker: string;
  }> = [];

  if (shouldReadBloodApplicationFiles) {
    requiredFiles.push(
      {
        path: 'odcbs-all/src/app/business/anesthesia/blood-closed-loop/sjyy/sjyy-blood-application/sjyy-blood-application.component.html',
        range: { start: 1, end: 120 },
        marker: '<th nzWidth="120px">操作</th>'
      },
      {
        path: 'odcbs-all/src/app/business/anesthesia/blood-closed-loop/sjyy/sjyy-blood-application/sjyy-blood-application.component.less',
        range: { start: 1, end: 90 },
        marker: '.action-cell {'
      }
    );
  }

  if (shouldReadLoginFiles) {
    requiredFiles.push(
      {
        path: 'odcbs-all/src/app/layout/login/login.component.html',
        range: { start: 64, end: 108 },
        marker: 'id="userName"'
      },
      {
        path: 'odcbs-all/src/app/layout/login/login.component.less',
        range: { start: 170, end: 205 },
        marker: '#userName, #password,'
      }
    );
  }

  const fileSlices = [...input.contextPack.file_slices];

  for (const requiredFile of requiredFiles) {
    if (
      fileSlices.some(
        (slice) => slice.path === requiredFile.path && slice.content.includes(requiredFile.marker)
      )
    ) {
      continue;
    }
    const payload = await callTool<CodeReadFilePayload>(input.traces, {
      server: 'code-retrieval',
      tool: 'readFile',
      invoke: () =>
        input.codeHandlers.readFile({
          project: input.target.project,
          path: requiredFile.path,
          ref: input.target.ref,
          range: requiredFile.range,
          maxBytesPerFile: 24000
        })
    });
    if (payload.file !== undefined) {
      fileSlices.push(payload.file);
    }
  }

  return {
    ...input.contextPack,
    file_slices: dedupeFileSlices(fileSlices),
    need_more_context: input.contextPack.search_results.length === 0 && fileSlices.length === 0
  };
}

function dedupeFileSlices(slices: readonly CodeFileSliceV1[]): readonly CodeFileSliceV1[] {
  const seen = new Set<string>();
  const deduped: CodeFileSliceV1[] = [];
  for (const slice of slices) {
    const key = `${slice.project}:${slice.ref}:${slice.path}:${slice.start_line}-${slice.end_line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(slice);
  }
  return deduped;
}

function collectSearchResults(packs: readonly GitLabContextPackV1[]): readonly CodeSearchResultV1[] {
  return packs.flatMap((pack) => pack.search_results);
}

function buildTargetCodeMap(
  issueKey: string,
  contextPack: GitLabContextPackV1,
  target: CodeTarget | null
): TargetCodeMapV0 {
  const targets = contextPack.search_results.slice(0, MAX_CODE_TARGETS).map((result) => ({
    repo: result.project,
    branch: result.ref,
    file: result.path,
    ...(result.symbol_name !== undefined ? { symbol: result.symbol_name } : {}),
    ...(result.symbol_kind !== undefined ? { symbolKind: result.symbol_kind } : {}),
    startLine: result.start_line,
    endLine: result.end_line,
    changeKind: 'modify' as const,
    sourceRef: result.source_ref
  }));

  return {
    schemaVersion: 'TargetCodeMapV0',
    issueKey,
    targets,
    sourceRefs:
      targets.length > 0
        ? targets.map((item) => item.sourceRef)
        : target === null
          ? []
          : []
  };
}

function buildPlanJson(input: {
  readonly runId: string;
  readonly generatedAt: string;
  readonly issue: JiraIssue;
  readonly comments: readonly JiraComment[];
  readonly skillIds: readonly string[];
  readonly jiraContextPack: ReturnType<typeof buildJiraContextPackV1>;
  readonly evidencePack: ReturnType<typeof buildJiraEvidencePackV2>;
  readonly profile: ReturnType<typeof routeIssueProfile>;
  readonly target: CodeTarget | null;
  readonly contextPack: GitLabContextPackV1;
  readonly targetCodeMap: TargetCodeMapV0;
  readonly codeImpact: ReturnType<typeof buildCodeImpactReportV0>;
  readonly traces: readonly McpCallTrace[];
  readonly warnings: readonly string[];
}) {
  const codeTargets = input.targetCodeMap.targets;
  const status = codeTargets.length > 0 ? 'draft_plan' : 'need_more_context';
  const changePreview = buildChangePreview({
    issue: input.issue,
    contextPack: input.contextPack
  });
  return {
    schemaVersion: 'ShowcaseDryRunPlanV1',
    runId: input.runId,
    generatedAt: input.generatedAt,
    dryRun: true,
    status,
    issue: {
      key: input.issue.key,
      summary: input.issue.summary,
      status: input.issue.status,
      priority: input.issue.priority,
      assignee: input.issue.assignee?.displayName ?? input.issue.assignee?.name ?? null,
      comments: input.comments.length
    },
    selectedSkills: input.skillIds,
    route: {
      profile: input.profile.profile,
      confidence: input.profile.confidence,
      rationale: input.profile.rationale
    },
    codeTarget: input.target,
    codeEvidence: {
      count: input.contextPack.evidence_refs.length,
      sourceRefs: input.contextPack.evidence_refs.map((ref) => ref.source_ref),
      files: codeTargets.map((target) => ({
        repo: target.repo,
        branch: target.branch,
        file: target.file,
        startLine: target.startLine,
        endLine: target.endLine,
        sourceRef: target.sourceRef
      }))
    },
    plan: {
      summary: buildPlanSummary(input.issue, codeTargets.length),
      bugCause: buildBugCause(input.issue, input.contextPack, changePreview),
      modificationPlan: buildModificationPlan(input.issue, changePreview),
      approvalExecution: buildApprovalExecution(changePreview),
      steps: buildPlanSteps(input.issue, codeTargets.length),
      risks: buildPlanRisks(input.warnings, codeTargets.length),
      tests: buildTestHints(input.issue, codeTargets.length)
    },
    changePreview,
    codeImpact: input.codeImpact,
    jiraContextPack: input.jiraContextPack,
    evidencePack: input.evidencePack,
    mcpCalls: input.traces.map(formatTrace),
    warnings: input.warnings
  };
}

function buildChangePreview(input: {
  readonly issue: JiraIssue;
  readonly contextPack: GitLabContextPackV1;
}): ShowcaseDryRunChangePreview {
  const text = issueText(input.issue);
  const isLoginStyleMismatch = isLoginStyleMismatchIssue(input.issue);
  const isBloodOperationAlignment =
    /备血申请管理/.test(text) && /(操作列|表头|按钮|串位|错位|微调)/.test(text);

  if (isLoginStyleMismatch) {
    return buildLoginStyleChangePreview(input.contextPack);
  }

  if (!isBloodOperationAlignment) {
    return buildNeedsExecutorChangePreview('当前 Jira 未命中内置变更预览规则，需要执行器生成真实 patch。');
  }

  const htmlSlice = findSliceByPath(
    input.contextPack,
    'odcbs-all/src/app/business/anesthesia/blood-closed-loop/sjyy/sjyy-blood-application/sjyy-blood-application.component.html',
    '<th nzWidth="120px">操作</th>'
  );
  const styleSlice = findSliceByPath(
    input.contextPack,
    'odcbs-all/src/app/business/anesthesia/blood-closed-loop/sjyy/sjyy-blood-application/sjyy-blood-application.component.less',
    '.action-cell {'
  );
  const files: ShowcaseDryRunChangeFile[] = [];

  if (htmlSlice !== undefined) {
    const hunk = buildReplacementHunk({
      content: htmlSlice.content,
      startLine: htmlSlice.start_line,
      match: '<th nzWidth="120px">操作</th>',
      replacement: '            <th nzWidth="120px" nzAlign="center" class="action-header">操作</th>',
      rationale: '让操作列表头使用显式居中策略，并提供样式钩子，避免与下方操作按钮视觉串位。'
    });
    if (hunk !== null) {
      files.push({
        repo: htmlSlice.project,
        branch: htmlSlice.ref,
        file: htmlSlice.path,
        language: htmlSlice.path.split('.').pop() ?? 'text',
        sourceRef: htmlSlice.source_ref,
        reason: '定位到盛京医院备血申请管理表格的“操作”表头。',
        hunks: [hunk]
      });
    }
  }

  if (styleSlice !== undefined) {
    const hunk = buildReplacementHunk({
      content: styleSlice.content,
      startLine: styleSlice.start_line,
      match: '.action-cell {',
      replacement: [
        '.action-header,',
        '.action-cell {',
        '  text-align: center;',
        '  white-space: nowrap;'
      ].join('\n'),
      rationale: '让操作列表头和按钮单元格使用同一套居中与不换行规则，控制列头和按钮横向对齐。'
    });
    if (hunk !== null) {
      files.push({
        repo: styleSlice.project,
        branch: styleSlice.ref,
        file: styleSlice.path,
        language: styleSlice.path.split('.').pop() ?? 'text',
        sourceRef: styleSlice.source_ref,
        reason: '定位到盛京医院备血申请管理组件的操作列样式。',
        hunks: [hunk]
      });
    }
  }

  if (files.length === 0) {
    return buildNeedsExecutorChangePreview(
      '已识别 UI 对齐问题，但当前代码检索结果未包含可生成 patch 的目标 HTML/LESS 片段。'
    );
  }

  return {
    mode: 'suggested_patch',
    summary: `预计修改 ${files.length} 个文件：为备血申请管理操作列表头和按钮单元格补齐居中、不换行对齐规则。`,
    confidence: files.length >= 2 ? 0.78 : 0.62,
    files,
    limitations: [
      '这是 dry-run 生成的代码改动预览，尚未写入 GitLab 分支。',
      '正式执行前仍需在临时 worktree 运行 lint/typecheck，并对页面截图做回归比对。'
    ]
  };
}

function buildLoginStyleChangePreview(contextPack: GitLabContextPackV1): ShowcaseDryRunChangePreview {
  const htmlSlice = findSliceByPath(
    contextPack,
    'odcbs-all/src/app/layout/login/login.component.html',
    'id="userName"'
  );
  const styleSlice = findSliceByPath(
    contextPack,
    'odcbs-all/src/app/layout/login/login.component.less',
    '#userName, #password,'
  );
  const files: ShowcaseDryRunChangeFile[] = [];

  if (htmlSlice !== undefined) {
    const hunks = [
      buildReplacementHunk({
        content: htmlSlice.content,
        startLine: htmlSlice.start_line,
        match: '<input id="userName" type="text" nz-input #usernameInput formControlName="username" autocomplete="off"',
        replacement:
          '                <input id="userName" class="login-control login-username-input" type="text" nz-input #usernameInput formControlName="username" autocomplete="off"',
        rationale: '给用户名输入框增加稳定样式类，避免继续依赖 id 选择器承接 ng-zorro 默认样式。'
      }),
      buildReplacementHunk({
        content: htmlSlice.content,
        startLine: htmlSlice.start_line,
        match: '<nz-input-group id="password" [nzSuffix]="suffixTemplate">',
        replacement: '                <nz-input-group id="password" class="login-control login-password-group" [nzSuffix]="suffixTemplate">',
        rationale: '给密码输入组增加稳定样式类，使外层输入组和内层 input 可分别对齐旧系统样式。'
      })
    ].filter((hunk): hunk is ShowcaseDryRunChangeHunk => hunk !== null);

    if (hunks.length > 0) {
      files.push({
        repo: htmlSlice.project,
        branch: htmlSlice.ref,
        file: htmlSlice.path,
        language: 'html',
        sourceRef: htmlSlice.source_ref,
        reason: '登录页用户名、密码输入控件缺少专用样式钩子，升级后依赖 ng-zorro 默认结构导致视觉不一致。',
        hunks
      });
    }
  }

  if (styleSlice !== undefined) {
    const hunks = [
      buildSequenceReplacementHunk({
        content: styleSlice.content,
        startLine: styleSlice.start_line,
        matchLines: ['#userName, #password,', '.login-panel button {'],
        replacementLines: ['.login-control,', '.login-form-button {'],
        rationale: '把用户名/密码/登录按钮统一样式从 id 与宽泛 button 选择器迁移到明确 class，减少 Angular17/ng-zorro DOM 变化影响。'
      }),
      buildSequenceReplacementHunk({
        content: styleSlice.content,
        startLine: styleSlice.start_line,
        matchLines: ['#password input {', '  font-size: 16px;', '}'],
        replacementLines: [
          '.login-password-group {',
          '  display: flex;',
          '  align-items: center;',
          '}',
          '',
          '.login-password-group input {',
          '  height: 38px;',
          '  padding-left: 0;',
          '  font-size: 16px;',
          '}'
        ],
        rationale: '密码框是 nz-input-group，外层容器和内部 input 需要分别控制高度、对齐和字体，才能与用户名输入框一致。'
      }),
      buildSequenceReplacementHunk({
        content: styleSlice.content,
        startLine: styleSlice.start_line,
        matchLines: ['.login-panel button {', '  margin-top: 24px;'],
        replacementLines: ['.login-form-button {', '  margin-top: 24px;'],
        rationale: '登录按钮样式只作用于提交按钮，避免影响修改密码、扫码登录等其他按钮。'
      }),
      buildReplacementHunk({
        content: styleSlice.content,
        startLine: styleSlice.start_line,
        match: '.login-panel button:hover {',
        replacement: '.login-form-button:hover {',
        rationale: '登录按钮 hover 样式同步收窄到提交按钮。'
      })
    ].filter((hunk): hunk is ShowcaseDryRunChangeHunk => hunk !== null);

    if (hunks.length > 0) {
      files.push({
        repo: styleSlice.project,
        branch: styleSlice.ref,
        file: styleSlice.path,
        language: 'less',
        sourceRef: styleSlice.source_ref,
        reason: '登录页 LESS 使用 id 选择器和 `.login-panel button` 宽泛选择器，Angular17/ng-zorro 升级后无法保证用户名、密码、按钮一致性。',
        hunks
      });
    }
  }

  if (files.length === 0) {
    return buildNeedsExecutorChangePreview(
      '已识别登录页样式不一致问题，但当前代码检索结果未包含可生成 patch 的 login.component.html/less 片段。'
    );
  }

  return {
    mode: 'suggested_patch',
    summary: `预计修改 ${files.length} 个文件：为登录页用户名、密码输入组和登录按钮补齐稳定样式类，并收窄按钮选择器。`,
    confidence: files.length >= 2 ? 0.76 : 0.58,
    files,
    limitations: [
      '这是 dry-run 生成的代码改动预览，尚未写入 GitLab 分支。',
      '因 Jira 未提供原系统截图或精确尺寸，颜色、字号、高度按现有 LESS 中的旧样式意图收敛；正式执行后需截图对比原系统。'
    ]
  };
}

function buildNeedsExecutorChangePreview(reason: string): ShowcaseDryRunChangePreview {
  return {
    mode: 'needs_executor',
    summary: reason,
    confidence: 0,
    files: [],
    limitations: [
      '当前只完成 Jira 理解和代码检索，尚未运行代码执行器。',
      '需要在隔离 worktree 中生成真实 diff 后才能许可应用。'
    ]
  };
}

function findSliceByPath(
  contextPack: GitLabContextPackV1,
  path: string,
  marker?: string | undefined
): CodeFileSliceV1 | undefined {
  const slices = contextPack.file_slices.filter((slice) => slice.path === path);
  if (marker !== undefined) {
    return slices.find((slice) => slice.content.includes(marker)) ?? slices[0];
  }
  return slices[0];
}

function buildReplacementHunk(input: {
  readonly content: string;
  readonly startLine: number;
  readonly match: string;
  readonly replacement: string;
  readonly rationale: string;
}): ShowcaseDryRunChangeHunk | null {
  const lines = input.content.split(/\r?\n/);
  const matchIndex = lines.findIndex((line) => line.trim() === input.match.trim());
  if (matchIndex < 0) return null;

  const replacementLines = input.replacement.split('\n');
  const contextStartIndex = Math.max(0, matchIndex - 2);
  const contextEndIndex = Math.min(lines.length - 1, matchIndex + 2);
  const oldStart = input.startLine + contextStartIndex;
  const oldLines = contextEndIndex - contextStartIndex + 1;
  const newLines = oldLines - 1 + replacementLines.length;
  const diffLines: ShowcaseDryRunDiffLine[] = [];
  let oldCursor = oldStart;
  let newCursor = oldStart;

  for (let index = contextStartIndex; index < matchIndex; index += 1) {
    diffLines.push({
      type: 'context',
      oldLineNumber: oldCursor,
      newLineNumber: newCursor,
      content: lines[index] ?? ''
    });
    oldCursor += 1;
    newCursor += 1;
  }

  diffLines.push({
    type: 'remove',
    oldLineNumber: oldCursor,
    content: lines[matchIndex] ?? ''
  });
  oldCursor += 1;

  for (const line of replacementLines) {
    diffLines.push({
      type: 'add',
      newLineNumber: newCursor,
      content: line
    });
    newCursor += 1;
  }

  for (let index = matchIndex + 1; index <= contextEndIndex; index += 1) {
    diffLines.push({
      type: 'context',
      oldLineNumber: oldCursor,
      newLineNumber: newCursor,
      content: lines[index] ?? ''
    });
    oldCursor += 1;
    newCursor += 1;
  }

  return {
    header: `@@ -${oldStart},${oldLines} +${oldStart},${newLines} @@`,
    oldStart,
    oldLines,
    newStart: oldStart,
    newLines,
    rationale: input.rationale,
    diffLines
  };
}

function buildSequenceReplacementHunk(input: {
  readonly content: string;
  readonly startLine: number;
  readonly matchLines: readonly string[];
  readonly replacementLines: readonly string[];
  readonly rationale: string;
}): ShowcaseDryRunChangeHunk | null {
  const lines = input.content.split(/\r?\n/);
  const matchIndex = findLineSequence(lines, input.matchLines);
  if (matchIndex < 0) return null;

  const contextStartIndex = Math.max(0, matchIndex - 2);
  const contextEndIndex = Math.min(lines.length - 1, matchIndex + input.matchLines.length + 1);
  const oldStart = input.startLine + contextStartIndex;
  const oldLines = contextEndIndex - contextStartIndex + 1;
  const newLines = oldLines - input.matchLines.length + input.replacementLines.length;
  const diffLines: ShowcaseDryRunDiffLine[] = [];
  let oldCursor = oldStart;
  let newCursor = oldStart;

  for (let index = contextStartIndex; index < matchIndex; index += 1) {
    diffLines.push({
      type: 'context',
      oldLineNumber: oldCursor,
      newLineNumber: newCursor,
      content: lines[index] ?? ''
    });
    oldCursor += 1;
    newCursor += 1;
  }

  for (let offset = 0; offset < input.matchLines.length; offset += 1) {
    diffLines.push({
      type: 'remove',
      oldLineNumber: oldCursor,
      content: lines[matchIndex + offset] ?? ''
    });
    oldCursor += 1;
  }

  for (const line of input.replacementLines) {
    diffLines.push({
      type: 'add',
      newLineNumber: newCursor,
      content: line
    });
    newCursor += 1;
  }

  for (let index = matchIndex + input.matchLines.length; index <= contextEndIndex; index += 1) {
    diffLines.push({
      type: 'context',
      oldLineNumber: oldCursor,
      newLineNumber: newCursor,
      content: lines[index] ?? ''
    });
    oldCursor += 1;
    newCursor += 1;
  }

  return {
    header: `@@ -${oldStart},${oldLines} +${oldStart},${newLines} @@`,
    oldStart,
    oldLines,
    newStart: oldStart,
    newLines,
    rationale: input.rationale,
    diffLines
  };
}

function findLineSequence(lines: readonly string[], matchLines: readonly string[]): number {
  return lines.findIndex((_line, index) =>
    matchLines.every((matchLine, offset) => lines[index + offset]?.trim() === matchLine.trim())
  );
}

function buildBugCause(
  issue: JiraIssue,
  contextPack: GitLabContextPackV1,
  changePreview: ShowcaseDryRunChangePreview
): ShowcaseDryRunPlanPreview['bugCause'] {
  if (isLoginStyleMismatchIssue(issue)) {
    return {
      statement:
        '登录页用户名输入框、密码输入组和登录按钮依赖 id 选择器及 `.login-panel button` 宽泛选择器统一样式；Angular17/ng-zorro 升级后输入组 DOM 与默认样式发生变化，导致三类控件无法稳定继承同一视觉规格。',
      confidence: changePreview.files.length > 0 ? 0.76 : 0.48,
      evidence: [
        'Jira 描述明确指向 Angular17 登录页，问题对象是用户名、密码和登录按钮样式与原系统不一致。',
        '代码证据显示用户名使用普通 `nz-input`，密码使用 `nz-input-group`，二者 DOM 结构不同。',
        'LESS 证据显示 `#userName, #password, .login-panel button` 试图用同一个规则覆盖输入框和按钮，并且 `.login-panel button` 会影响登录面板内所有按钮。'
      ]
    };
  }

  if (/备血申请管理/.test(issueText(issue)) && /(操作列|表头|按钮|串位|错位|微调)/.test(issueText(issue))) {
    return {
      statement:
        '备血申请管理表格的“操作”表头缺少显式对齐策略，而按钮单元格只有局部按钮样式，表头与下方按钮没有共享的列对齐规则，导致视觉串位。',
      confidence: changePreview.files.length > 0 ? 0.78 : 0.5,
      evidence: [
        'Jira 描述明确指向备血申请管理列表操作列的表头与下方按钮串位。',
        'HTML 证据显示“操作”表头只设置了宽度，没有设置居中或样式类。',
        'LESS 证据显示 `.action-cell` 只约束按钮尺寸，未约束表头与单元格的共同对齐。'
      ]
    };
  }

  return {
    statement:
      changePreview.mode === 'suggested_patch'
        ? '已基于 Jira 描述和代码证据生成初步原因判断，仍需执行器结合真实 diff 与运行结果复核。'
        : '当前代码证据不足以给出可许可执行的 Bug 原因，需要补充目标文件或运行代码执行器。',
    confidence: changePreview.mode === 'suggested_patch' ? 0.5 : 0.2,
    evidence: contextPack.file_slices.slice(0, 3).map((slice) => `${slice.path}:${slice.start_line}-${slice.end_line}`)
  };
}

function buildModificationPlan(
  issue: JiraIssue,
  changePreview: ShowcaseDryRunChangePreview
): ShowcaseDryRunPlanPreview['modificationPlan'] {
  if (isLoginStyleMismatchIssue(issue)) {
    return {
      goal: '让登录页用户名输入框、密码输入框和登录按钮在 Angular17 分支中恢复一致的旧系统视觉规格。',
      changes: [
        '在 `login.component.html` 中给用户名输入框和密码输入组增加明确 class，作为稳定样式钩子。',
        '在 `login.component.less` 中把统一尺寸规则从 id/宽泛 button 选择器迁移到 `.login-control` 与 `.login-form-button`。',
        '为 `nz-input-group` 内部 input 单独设置高度、padding 和字号，避免密码框受 ng-zorro 默认结构影响。',
        '将登录按钮颜色和 hover 样式收窄到 `.login-form-button`，避免误影响修改密码、扫码登录等其他按钮。'
      ],
      files: changePreview.files.map((file) => file.file)
    };
  }

  if (/备血申请管理/.test(issueText(issue)) && /(操作列|表头|按钮|串位|错位|微调)/.test(issueText(issue))) {
    return {
      goal: '让备血申请管理表格操作列表头与下方操作按钮保持同列居中对齐。',
      changes: [
        '给“操作”表头增加 `nzAlign="center"` 与 `action-header` 样式类。',
        '让 `.action-header` 与 `.action-cell` 共用居中、不换行规则。',
        '保留原按钮尺寸，仅补齐列级对齐规则，控制改动范围。'
      ],
      files: changePreview.files.map((file) => file.file)
    };
  }

  return {
    goal: changePreview.summary,
    changes:
      changePreview.files.length === 0
        ? ['当前尚无可审阅代码改动，不能进入真实应用。']
        : changePreview.files.map((file) => `修改 ${file.file}：${file.reason}`),
    files: changePreview.files.map((file) => file.file)
  };
}

function buildApprovalExecution(
  changePreview: ShowcaseDryRunChangePreview
): ShowcaseDryRunPlanPreview['approvalExecution'] {
  if (changePreview.files.length === 0) {
    return {
      summary: '许可后不会直接改代码；当前必须先运行执行器生成真实 patch。',
      actions: [
        '创建隔离 worktree 或临时分支。',
        '基于 Jira 和代码证据重新生成真实 diff。',
        '回填新的代码改动预览，等待人工再次确认。'
      ],
      safeguards: ['不写 Jira 状态。', '不推送 GitLab。', '不创建 MR。']
    };
  }

  return {
    summary: `许可后 AI 将按当前 diff 预览处理 ${changePreview.files.length} 个文件，但仍应先在隔离 worktree 中执行。`,
    actions: [
      '创建隔离 worktree 或临时分支，避免污染当前分支。',
      '按页面展示的 diff 应用代码修改。',
      '运行对应项目的 lint/typecheck/build 或可用的局部验证命令。',
      '生成真实 git diff、验证结果和风险摘要，回到页面等待最终提交/MR 许可。'
    ],
    safeguards: [
      '许可执行不等于直接合并。',
      '验证失败时停止，不推送 GitLab。',
      '真实写 Jira、创建 MR 或推送分支需要单独的二次确认。'
    ]
  };
}

function buildPlanSummary(issue: JiraIssue, codeTargetCount: number): string {
  if (codeTargetCount === 0) {
    return `${issue.key} 已完成 Jira 理解，但尚未找到可追溯代码证据，不能给出确定性修改点。`;
  }
  return `${issue.key} 已完成 Jira 理解和代码检索，建议围绕命中的 ${codeTargetCount} 个代码位置制定最小变更。`;
}

function buildPlanSteps(issue: JiraIssue, codeTargetCount: number): readonly string[] {
  const base = [
    `确认 Jira 描述和验收口径：${issue.summary}`,
    '基于 Code Retrieval 命中的 source_ref 定位影响文件。'
  ];
  if (codeTargetCount === 0) {
    return [
      ...base,
      '补充 GitLab 项目/分支映射或调整检索关键词后重新 dry-run。',
      '在缺少代码证据前，不建议创建 MR 或修改 Jira 状态。'
    ];
  }
  return [
    ...base,
    '按命中文件逐项确认 UI/接口/数据影响边界。',
    '实施最小代码修改，并保留 Jira key 与 source_ref 到提交说明。',
    '补充单元测试或页面回归验证，再进入人工 Review。'
  ];
}

function buildPlanRisks(warnings: readonly string[], codeTargetCount: number): readonly string[] {
  const risks = [...warnings];
  if (codeTargetCount === 0) {
    risks.push('缺少可追溯代码证据，当前方案只能作为需求理解草案。');
  }
  return risks.length > 0 ? risks : ['未发现阻断风险；仍需人工确认业务验收口径。'];
}

function buildTestHints(issue: JiraIssue, codeTargetCount: number): readonly string[] {
  const hints = ['围绕 Jira 复现路径做手工回归。'];
  if (/(页面|界面|按钮|样式|列表|表头|操作列)/i.test(issueText(issue))) {
    hints.push('补充页面截图对比或组件级回归验证。');
  }
  if (codeTargetCount > 0) {
    hints.push('针对命中文件运行对应前端/后端单测、lint 和类型检查。');
  }
  return hints;
}

function buildPlanMarkdown(plan: ReturnType<typeof buildPlanJson>): string {
  const files = plan.codeEvidence.files.length === 0
    ? ['- 暂无可追溯代码文件。']
    : plan.codeEvidence.files.map(
        (file) => `- ${file.repo}@${file.branch} ${file.file}:${file.startLine ?? '?'} (${file.sourceRef})`
      );
  return [
    `# ${plan.issue.key} Dry-run 更改方案`,
    '',
    `- Run ID: ${plan.runId}`,
    `- Generated At: ${plan.generatedAt}`,
    `- Status: ${plan.status}`,
    `- Jira: ${plan.issue.summary}`,
    `- Profile: ${plan.route.profile} (${Math.round(plan.route.confidence * 100)}%)`,
    '',
    '## 方案摘要',
    '',
    plan.plan.summary,
    '',
    '## Bug 原因判断',
    '',
    `- 判断：${plan.plan.bugCause.statement}`,
    `- 置信度：${Math.round(plan.plan.bugCause.confidence * 100)}%`,
    ...plan.plan.bugCause.evidence.map((item) => `- 证据：${item}`),
    '',
    '## 具体修改方案',
    '',
    `- 目标：${plan.plan.modificationPlan.goal}`,
    ...plan.plan.modificationPlan.changes.map((item) => `- ${item}`),
    '',
    '## 许可后 AI 将执行',
    '',
    plan.plan.approvalExecution.summary,
    '',
    ...plan.plan.approvalExecution.actions.map((item, index) => `${index + 1}. ${item}`),
    '',
    ...plan.plan.approvalExecution.safeguards.map((item) => `- 安全约束：${item}`),
    '',
    '## 代码证据',
    '',
    ...files,
    '',
    '## 执行步骤',
    '',
    ...plan.plan.steps.map((step, index) => `${index + 1}. ${step}`),
    '',
    '## 风险',
    '',
    ...plan.plan.risks.map((risk) => `- ${risk}`),
    '',
    '## 测试建议',
    '',
    ...plan.plan.tests.map((test) => `- ${test}`),
    '',
    '## 代码改动预览',
    '',
    plan.changePreview.summary,
    '',
    ...formatChangePreviewMarkdown(plan.changePreview),
    '',
    '## MCP 调用',
    '',
    ...plan.mcpCalls.map((call) => `- ${call}`),
    ''
  ].join('\n');
}

function formatChangePreviewMarkdown(
  changePreview: ShowcaseDryRunChangePreview
): readonly string[] {
  if (changePreview.files.length === 0) {
    return changePreview.limitations.map((item) => `- ${item}`);
  }

  return changePreview.files.flatMap((file) => [
    `### ${file.file}`,
    '',
    `- Repo: ${file.repo}@${file.branch}`,
    `- Reason: ${file.reason}`,
    '',
    '```diff',
    ...file.hunks.flatMap((hunk) => [
      hunk.header,
      ...hunk.diffLines.map((line) => {
        const prefix = line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' ';
        return `${prefix}${line.content}`;
      })
    ]),
    '```',
    ''
  ]);
}

function issueText(issue: JiraIssue): string {
  return [
    issue.key,
    issue.summary,
    issue.description ?? '',
    issue.productModule ?? '',
    issue.defectCategory ?? '',
    issue.issueCategory ?? '',
    issue.labels.join(' ')
  ].join(' ');
}

function isLoginStyleMismatchIssue(issue: JiraIssue): boolean {
  const text = issueText(issue);
  return /登录页/.test(text) && /(Angular17|用户名|密码|登录按钮|样式|不一致)/i.test(text);
}

function normalizeIssueKey(value: string): string {
  const issueKey = value.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9]+-\d+$/.test(issueKey)) {
    throw new Error('issueKey 格式不合法');
  }
  return issueKey;
}

function compactTimestamp(value: string): string {
  return value.replace(/[-:.TZ]/g, '').slice(0, 14);
}

function readEnv(env: EnvMap, key: string): string | undefined {
  const value = env[key]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}

function sanitizeRuntimeMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/\b(?:bearer|basic)\s+[A-Za-z0-9+/._~=-]{8,}/gi, '[redacted-credential]')
    .replace(/\b(?:token|secret|api[_-]?key)\s*[:=]\s*["']?[^"'\s,;]+/gi, '[redacted-secret]')
    .replace(/\s+/g, ' ')
    .trim();
}

function uniqueStrings(values: readonly (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => value !== undefined && value !== null))];
}

function dedupeBySourceRef(results: readonly CodeSearchResultV1[]): CodeSearchResultV1[] {
  const seen = new Set<string>();
  const deduped: CodeSearchResultV1[] = [];
  for (const result of results) {
    if (seen.has(result.source_ref)) continue;
    seen.add(result.source_ref);
    deduped.push(result);
  }
  return deduped;
}

function formatTrace(trace: McpCallTrace): string {
  return `${trace.server}.${trace.tool} ${trace.success ? 'ok' : 'failed'} ${trace.latencyMs}ms`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const issueKeyArg = process.argv.find((arg) => arg.startsWith('--issue-key='));
  const issueKey = issueKeyArg?.split('=')[1];
  if (issueKey === undefined) {
    process.stderr.write('Usage: tsx scripts/showcase-dry-run-plan.ts --issue-key=APMIS-1234\n');
    process.exitCode = 1;
  } else {
    runShowcaseDryRunPlan({ issueKey, skillIds: [], mode: 'dry-run' })
      .then((result) => {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      })
      .catch((error: unknown) => {
        process.stderr.write(`${sanitizeRuntimeMessage(error)}\n`);
        process.exitCode = 1;
      });
  }
}
