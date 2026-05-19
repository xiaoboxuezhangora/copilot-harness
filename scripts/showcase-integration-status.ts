export type ShowcaseIntegrationTone = "ok" | "warn" | "danger" | "neutral";

export interface ShowcaseIntegrationEndpointStatus {
  readonly id: "jira" | "gitlab" | "codeRetrieval" | "mcp";
  readonly label: string;
  readonly configured: boolean;
  readonly tone: ShowcaseIntegrationTone;
  readonly displayUrl: string | null;
  readonly credentialState: "present" | "missing" | "not_required";
  readonly details: readonly string[];
  readonly requiredEnv: readonly string[];
  readonly applyMode: string;
}

export interface ShowcaseIntegrationStatus {
  readonly schemaVersion: "ShowcaseIntegrationStatusV1";
  readonly generatedAt: string;
  readonly source: "runtime-env";
  readonly directApplySupported: false;
  readonly restartRequired: true;
  readonly endpoints: readonly ShowcaseIntegrationEndpointStatus[];
}

type EnvMap = Readonly<Record<string, string | undefined>>;

export function buildShowcaseIntegrationStatus(
  env: EnvMap,
  now = new Date(),
): ShowcaseIntegrationStatus {
  const jiraBaseUrl = readEnv(env, "JIRA_BASE_URL");
  const jiraUsername = readEnv(env, "JIRA_USERNAME");
  const jiraToken = readEnv(env, "JIRA_API_TOKEN");
  const jiraProjectAllowlist = readEnv(env, "JIRA_PROJECT_ALLOWLIST");

  const gitlabBaseUrl = readEnv(env, "GITLAB_BASE_URL");
  const gitlabToken = readEnv(env, "GITLAB_TOKEN");
  const localRepoRoot = readEnv(env, "CODE_RETRIEVAL_LOCAL_REPO_ROOT");
  const localRepoName = readEnv(env, "CODE_RETRIEVAL_LOCAL_REPO_NAME");
  const codeRetrievalTimeout = readEnv(env, "CODE_RETRIEVAL_REQUEST_TIMEOUT_MS");

  const jiraConfigured = jiraBaseUrl !== null;
  const gitlabApiConfigured = gitlabBaseUrl !== null && gitlabToken !== null;
  const localRepoConfigured = localRepoRoot !== null;
  const codeRetrievalConfigured = gitlabApiConfigured || localRepoConfigured;

  return {
    schemaVersion: "ShowcaseIntegrationStatusV1",
    generatedAt: now.toISOString(),
    source: "runtime-env",
    directApplySupported: false,
    restartRequired: true,
    endpoints: [
      {
        id: "jira",
        label: "Jira Reader MCP",
        configured: jiraConfigured,
        tone: jiraConfigured ? "ok" : "danger",
        displayUrl: sanitizeUrlForDisplay(jiraBaseUrl),
        credentialState:
          jiraBaseUrl === null
            ? "missing"
            : jiraUsername !== null || jiraToken !== null
              ? jiraUsername !== null && jiraToken !== null
                ? "present"
                : "missing"
              : "not_required",
        details: [
          `项目白名单：${jiraProjectAllowlist ?? "未设置"}`,
          `用户名：${jiraUsername === null ? "未设置" : "已设置"}`,
          `API 凭据：${jiraToken === null ? "未设置" : "已设置"}`,
        ],
        requiredEnv: ["JIRA_BASE_URL", "JIRA_USERNAME", "JIRA_API_TOKEN", "JIRA_PROJECT_ALLOWLIST"],
        applyMode: "环境变量驱动；变更后需要重启 Jira Reader MCP",
      },
      {
        id: "gitlab",
        label: "GitLab API",
        configured: gitlabApiConfigured,
        tone: gitlabApiConfigured ? "ok" : localRepoConfigured ? "warn" : "danger",
        displayUrl: sanitizeUrlForDisplay(gitlabBaseUrl),
        credentialState: gitlabToken === null ? "missing" : "present",
        details: [
          `GitLab Token：${gitlabToken === null ? "未设置" : "已设置"}`,
          `API 模式：${gitlabApiConfigured ? "可用" : "未配置"}`,
        ],
        requiredEnv: ["GITLAB_BASE_URL", "GITLAB_TOKEN"],
        applyMode: "环境变量驱动；变更后需要重启 Code Retrieval MCP",
      },
      {
        id: "codeRetrieval",
        label: "Code Retrieval MCP",
        configured: codeRetrievalConfigured,
        tone: codeRetrievalConfigured ? "ok" : "danger",
        displayUrl: localRepoRoot,
        credentialState: localRepoConfigured ? "not_required" : gitlabToken === null ? "missing" : "present",
        details: [
          `检索模式：${gitlabApiConfigured ? "GitLab API" : localRepoConfigured ? "本地仓库 fallback" : "未配置"}`,
          `本地仓库名：${localRepoName ?? "未设置"}`,
          `请求超时：${codeRetrievalTimeout ?? "默认 10000ms"}`,
        ],
        requiredEnv: [
          "GITLAB_BASE_URL",
          "GITLAB_TOKEN",
          "CODE_RETRIEVAL_LOCAL_REPO_ROOT",
          "CODE_RETRIEVAL_REQUEST_TIMEOUT_MS",
        ],
        applyMode: "环境变量或本地仓库路径驱动；变更后需要重启 Code Retrieval MCP",
      },
      {
        id: "mcp",
        label: "MCP Runtime",
        configured: jiraConfigured || codeRetrievalConfigured,
        tone: jiraConfigured && codeRetrievalConfigured ? "ok" : "warn",
        displayUrl: null,
        credentialState: "not_required",
        details: [
          `JiraReader：${jiraConfigured ? "已配置" : "未配置"}`,
          `CodeRetrieval：${codeRetrievalConfigured ? "已配置" : "未配置"}`,
          "Showcase 仍为只读治理界面，不直接执行 Jira/GitLab 写操作",
        ],
        requiredEnv: ["JIRA_*", "GITLAB_*", "CODE_RETRIEVAL_*"],
        applyMode: "Showcase 只读取状态；真实生效由 MCP 启动环境决定",
      },
    ],
  };
}

function readEnv(env: EnvMap, name: string): string | null {
  const value = env[name]?.trim();
  return value === undefined || value.length === 0 ? null : value;
}

function sanitizeUrlForDisplay(value: string | null): string | null {
  if (value === null) return null;
  try {
    const parsed = new URL(value);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return "[invalid-url]";
  }
}
