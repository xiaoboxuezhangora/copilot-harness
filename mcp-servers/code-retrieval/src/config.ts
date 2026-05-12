import { CodeRetrievalConfigError } from "./errors.js";

const BASE_URL_ENV = ["GITLAB", "BASE", "URL"].join("_");
const TOKEN_ENV = ["GITLAB", "TOKEN"].join("_");
const LOCAL_ROOT_ENV = ["CODE", "RETRIEVAL", "LOCAL", "REPO", "ROOT"].join("_");
const LOCAL_NAME_ENV = ["CODE", "RETRIEVAL", "LOCAL", "REPO", "NAME"].join("_");
const TIMEOUT_ENV = ["CODE", "RETRIEVAL", "REQUEST", "TIMEOUT", "MS"].join("_");

type EnvMap = Readonly<Record<string, string | undefined>>;

export interface CodeRetrievalConfig {
  readonly gitlab?: {
    readonly baseUrl: string;
    readonly token: string;
    readonly requestTimeoutMs: number;
  };
  readonly localRepoRoot?: string | undefined;
  readonly localRepoName?: string | undefined;
}

export function loadConfigFromEnv(
  env: EnvMap = process.env,
): CodeRetrievalConfig {
  const baseUrl = readOptionalEnv(env, BASE_URL_ENV);
  const token = readOptionalEnv(env, TOKEN_ENV);
  const localRepoRoot = readOptionalEnv(env, LOCAL_ROOT_ENV);
  const localRepoName = readOptionalEnv(env, LOCAL_NAME_ENV);
  const requestTimeoutMs = readTimeout(readOptionalEnv(env, TIMEOUT_ENV));

  if ((baseUrl === undefined) !== (token === undefined)) {
    throw new CodeRetrievalConfigError(
      "GITLAB_BASE_URL and GITLAB_TOKEN must be provided together",
    );
  }

  if (baseUrl === undefined && localRepoRoot === undefined) {
    throw new CodeRetrievalConfigError(
      "GitLab credentials or CODE_RETRIEVAL_LOCAL_REPO_ROOT is required",
    );
  }

  return {
    ...(baseUrl !== undefined && token !== undefined
      ? {
          gitlab: {
            baseUrl: normalizeBaseUrl(baseUrl),
            token,
            requestTimeoutMs,
          },
        }
      : {}),
    ...(localRepoRoot !== undefined ? { localRepoRoot } : {}),
    ...(localRepoName !== undefined ? { localRepoName } : {}),
  };
}

export function normalizeBaseUrl(baseUrl: string): string {
  try {
    const parsed = new URL(baseUrl);
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    throw new CodeRetrievalConfigError("GitLab base URL is invalid");
  }
}

function readOptionalEnv(env: EnvMap, name: string): string | undefined {
  const value = env[name]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}

function readTimeout(value: string | undefined): number {
  if (value === undefined) {
    return 10_000;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 100 || parsed > 60_000) {
    throw new CodeRetrievalConfigError(
      "CODE_RETRIEVAL_REQUEST_TIMEOUT_MS must be between 100 and 60000",
    );
  }

  return parsed;
}
