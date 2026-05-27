import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import type { IncomingMessage } from 'node:http';

import { runShowcaseDryRunPlan } from '../../scripts/showcase-dry-run-plan';
import { buildShowcaseIntegrationStatus } from '../../scripts/showcase-integration-status';
import { JiraClient, loadConfigFromEnv } from '../../mcp-servers/jira-reader/src/index';
import type { JiraIssue } from '../../mcp-servers/jira-reader/src/types';
import type { ShowcaseJiraIssue } from './src/types';

export default defineConfig({
  base: './',
  plugins: [
    vue(),
    {
      name: 'showcase-integration-status',
      configureServer(server) {
        server.middlewares.use('/api/showcase/integration-status', (_request, response) => {
          response.statusCode = 200;
          response.setHeader('Content-Type', 'application/json; charset=utf-8');
          response.end(JSON.stringify(buildShowcaseIntegrationStatus(process.env), null, 2));
        });

        server.middlewares.use('/api/showcase/jira-issues', async (_request, response) => {
          response.statusCode = 200;
          response.setHeader('Content-Type', 'application/json; charset=utf-8');

          try {
            const config = loadConfigFromEnv(process.env);
            const jiraClient = new JiraClient(config);
            const jql = resolveDefaultJql(process.env, config.projectAllowlist);
            const searchResult = await jiraClient.searchIssues(jql, 50);

            response.end(
              JSON.stringify(
                {
                  status: 'ready',
                  issues: searchResult.issues.map((issue) => mapJiraIssue(issue)),
                  message: `已读取 Jira 队列，共 ${searchResult.issues.length}/${searchResult.total} 条。`,
                  source: 'jira-api'
                },
                null,
                2
              )
            );
          } catch (error) {
            response.end(
              JSON.stringify(
                {
                  status: 'degraded',
                  issues: [],
                  message: `Jira 队列未加载：${sanitizeRuntimeMessage(error)}`,
                  source: 'runtime-fallback'
                },
                null,
                2
              )
            );
          }
        });

        server.middlewares.use('/api/showcase/jira-current-user', async (_request, response) => {
          response.statusCode = 200;
          response.setHeader('Content-Type', 'application/json; charset=utf-8');

          try {
            const config = loadConfigFromEnv(process.env);
            const jiraClient = new JiraClient(config);
            const currentUser = await jiraClient.getCurrentUser();
            const mayBeServiceAccount = isLikelyServiceAccount(process.env.JIRA_USERNAME ?? '');

            response.end(
              JSON.stringify(
                {
                  status: 'ready',
                  currentUser,
                  message: mayBeServiceAccount
                    ? '已通过 Jira /myself 识别身份，但当前凭据可能是服务账号。'
                    : '已通过 Jira /myself 识别当前身份。',
                  identityScope: 'authenticated_principal',
                  mayBeServiceAccount
                },
                null,
                2
              )
            );
          } catch (error) {
            const errorMessage = sanitizeRuntimeMessage(error);
            response.end(
              JSON.stringify(
                {
                  status: 'degraded',
                  message: `当前用户身份未确认：${errorMessage}`,
                  identityScope: 'unknown',
                  mayBeServiceAccount: false
                },
                null,
                2
              )
            );
          }
        });

        server.middlewares.use('/api/showcase/dry-run-plan', async (request, response) => {
          response.setHeader('Content-Type', 'application/json; charset=utf-8');

          if (request.method !== 'POST') {
            response.statusCode = 405;
            response.end(
              JSON.stringify(
                {
                  status: 'degraded',
                  message: 'Only POST is supported'
                },
                null,
                2
              )
            );
            return;
          }

          try {
            const body = await readJsonBody(request);
            const result = await runShowcaseDryRunPlan(
              {
                issueKey: readRequiredString(body, 'issueKey'),
                skillIds: readStringArray(body, 'skillIds'),
                mode: 'dry-run'
              },
              process.env
            );

            response.statusCode = 200;
            response.end(JSON.stringify(result, null, 2));
          } catch (error) {
            const errorMessage = sanitizeRuntimeMessage(error);
            response.statusCode = 200;
            response.end(
              JSON.stringify(
                {
                  status: 'degraded',
                  runId: null,
                  issueKey: null,
                  message: `Dry-run 触发失败：${errorMessage}`,
                  generatedAt: new Date().toISOString(),
                  dryRun: true,
                  codeEvidenceCount: 0,
                  mcpCalls: [],
                  target: null,
                  artifacts: null,
                  planPreview: {
                    summary: 'Dry-run 触发失败，未生成推荐开发方案。',
                    bugCause: {
                      statement: 'Dry-run 触发失败，无法判断 Bug 原因。',
                      confidence: 0,
                      evidence: [errorMessage]
                    },
                    modificationPlan: {
                      goal: '修复 dry-run 调用后重新生成方案。',
                      changes: [],
                      files: []
                    },
                    approvalExecution: {
                      summary: '当前不能许可执行。',
                      actions: [],
                      safeguards: ['未生成可审阅方案前不允许真实执行。']
                    },
                    steps: [],
                    risks: [errorMessage],
                    tests: [],
                    codeEvidenceFiles: []
                  },
                  changePreview: {
                    mode: 'needs_executor',
                    summary: 'Dry-run 触发失败，未生成代码改动预览。',
                    confidence: 0,
                    files: [],
                    limitations: [errorMessage]
                  },
                  warnings: [errorMessage]
                },
                null,
                2
              )
            );
          }
        });
      }
    }
  ]
});

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }

  if (chunks.length === 0) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }
  return {};
}

function readRequiredString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${key} is required`);
  }
  return value;
}

function readStringArray(body: Record<string, unknown>, key: string): string[] {
  const value = body[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function resolveDefaultJql(
  env: Readonly<Record<string, string | undefined>>,
  projectAllowlist: readonly string[]
): string {
  const fromEnv = env.JIRA_SMOKE_JQL?.trim();
  if (fromEnv !== undefined && fromEnv.length > 0) {
    return fromEnv;
  }

  const fallbackProject = projectAllowlist[0] ?? 'APMIS';
  return `project = ${fallbackProject} ORDER BY updated DESC`;
}

function mapJiraIssue(issue: JiraIssue): ShowcaseJiraIssue {
  return {
    task_id: issue.key,
    key: issue.key,
    summary: issue.summary,
    description: issue.description ?? null,
    issue_type: issue.issueType ?? null,
    status: issue.status ?? null,
    priority: issue.priority ?? null,
    assignee:
      issue.assignee?.displayName ?? issue.assignee?.name ?? issue.assignee?.key ?? null,
    project: issue.project?.key ?? null,
    project_name: issue.project?.name ?? null,
    affected_versions: issue.affectedVersions === undefined ? [] : [...issue.affectedVersions],
    fix_versions: issue.fixVersions === undefined ? [] : [...issue.fixVersions],
    created: issue.created ?? null,
    updated: issue.updated ?? null,
    due_date: issue.dueDate ?? null,
    target_version: issue.targetVersion ?? null,
    product_module: issue.productModule ?? null,
    defect_category: issue.defectCategory ?? null,
    issue_category: issue.issueCategory ?? null,
    project_source: issue.projectSource ?? null,
    core_recovery: issue.coreRecovery ?? null,
    requirement_released: issue.requirementReleased ?? null,
    original_estimate_seconds: issue.timeTracking?.originalEstimateSeconds ?? null,
    remaining_estimate_seconds: issue.timeTracking?.remainingEstimateSeconds ?? null,
    time_spent_seconds: issue.timeTracking?.timeSpentSeconds ?? null,
    labels: [...issue.labels],
    execution_mode: 'live',
    source_refs: [`jira:${issue.key}`],
    confidence: null
  };
}

function sanitizeRuntimeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : '读取 Jira 运行时数据失败';
  return message
    .replace(/\b(?:bearer|basic)\s+[A-Za-z0-9+/._~=-]{8,}/gi, '[redacted-credential]')
    .replace(/\b(?:token|secret|api[_-]?key)\s*[:=]\s*["']?[^"'\s,;]+/gi, '[redacted-secret]')
    .replace(/\s+/g, ' ')
    .trim();
}

function isLikelyServiceAccount(username: string): boolean {
  const normalized = username.trim().toLowerCase();
  if (normalized.length === 0) return false;
  return /(svc|service|bot|robot|automation|readonly|reader|mcp)/.test(normalized);
}
