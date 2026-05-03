import { JiraConfigError } from "./errors.js";

const API_TOKEN_ENV = ["JIRA", "API", "TOKEN"].join("_");
const BASE_URL_ENV = ["JIRA", "BASE", "URL"].join("_");
const PROJECT_ALLOWLIST_ENV = ["JIRA", "PROJECT", "ALLOWLIST"].join("_");
const USERNAME_ENV = ["JIRA", "USERNAME"].join("_");

type EnvMap = Readonly<Record<string, string | undefined>>;

export interface JiraReaderConfig {
  readonly baseUrl: string;
  readonly username?: string;
  readonly apiToken?: string;
  readonly projectAllowlist: readonly string[];
  readonly requestTimeoutMs: number;
}

export function loadConfigFromEnv(env: EnvMap = process.env): JiraReaderConfig {
  const baseUrl = readRequiredEnv(env, BASE_URL_ENV);
  const username = readOptionalEnv(env, USERNAME_ENV);
  const apiToken = readOptionalEnv(env, API_TOKEN_ENV);
  const projectAllowlist = readProjectAllowlist(
    readOptionalEnv(env, PROJECT_ALLOWLIST_ENV),
  );

  if ((username === undefined) !== (apiToken === undefined)) {
    throw new JiraConfigError(
      "Jira username and API credential must be provided together",
    );
  }

  return {
    baseUrl: normalizeBaseUrl(baseUrl),
    projectAllowlist,
    requestTimeoutMs: 10_000,
    ...(username !== undefined ? { username } : {}),
    ...(apiToken !== undefined ? { apiToken } : {}),
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
    throw new JiraConfigError("Jira base URL is invalid");
  }
}

function readRequiredEnv(env: EnvMap, name: string): string {
  const value = readOptionalEnv(env, name);
  if (value === undefined) {
    throw new JiraConfigError(`${name} is required`);
  }

  return value;
}

function readOptionalEnv(env: EnvMap, name: string): string | undefined {
  const value = env[name]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}

function readProjectAllowlist(value: string | undefined): readonly string[] {
  if (value === undefined) {
    return [];
  }

  return value
    .split(",")
    .map((projectKey) => projectKey.trim().toUpperCase())
    .filter((projectKey) => projectKey.length > 0);
}
