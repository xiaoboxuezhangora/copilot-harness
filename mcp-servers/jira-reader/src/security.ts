import { JiraPolicyError } from "./errors.js";

export const JIRA_FIELD_WHITELIST = [
  "summary",
  "description",
  "issuetype",
  "status",
  "assignee",
  "priority",
  "labels",
  "project",
  "versions",
  "fixVersions",
  "created",
  "updated",
  "duedate",
  "timetracking",
  "timeoriginalestimate",
  "timeestimate",
  "timespent",
  "customfield_13301",
  "customfield_10302",
  "customfield_10126",
  "customfield_10116",
  "customfield_10121",
  "customfield_12400",
  "customfield_15603",
  "attachment",
] as const;

export const DEFAULT_SEARCH_LIMIT = 20;
export const MAX_SEARCH_LIMIT = 50;

const ISSUE_KEY_PATTERN = /^[A-Z][A-Z0-9_]+-\d+$/;
const PROJECT_KEY_PATTERN = /^[A-Z][A-Z0-9_]+$/;
const PRIVATE_IPV4_PATTERN =
  /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})\b/g;
const IPV4_PATTERN = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const SECRET_ASSIGNMENT_PATTERN =
  /\b(?:token|secret|api[_-]?key)\s*[:=]\s*["']?[^"'\s,;]+/gi;
const CHINESE_CREDENTIAL_PATTERN =
  /(?:用户名密码|账号密码|用户密码|密码)\s*[：:]\s*[^，。；;\s\r\n]+/g;
const BEARER_OR_BASIC_PATTERN = /\b(?:bearer|basic)\s+[A-Za-z0-9+/._~=-]{8,}/gi;
const JQL_BLOCKED_PATTERN =
  /(?:;|--|\/\*|\*\/|\b(?:insert|delete|update|drop|alter|transition|comment|issueFunction)\b)/i;

export interface JiraSecurityPolicy {
  readonly projectAllowlist: readonly string[];
}

export function sanitizeText(value: string): string {
  return value
    .replace(EMAIL_PATTERN, "[redacted-email]")
    .replace(PRIVATE_IPV4_PATTERN, "[redacted-private-ip]")
    .replace(IPV4_PATTERN, "[redacted-ip]")
    .replace(SECRET_ASSIGNMENT_PATTERN, "[redacted-secret]")
    .replace(CHINESE_CREDENTIAL_PATTERN, "[redacted-credential]")
    .replace(BEARER_OR_BASIC_PATTERN, "[redacted-credential]");
}

export function sanitizeUnknown(value: unknown): unknown {
  if (typeof value === "string") {
    return sanitizeText(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeUnknown(item));
  }

  if (isRecord(value)) {
    const sanitized: Record<string, unknown> = {};

    for (const [key, item] of Object.entries(value)) {
      sanitized[key] = sanitizeUnknown(item);
    }

    return sanitized;
  }

  return value;
}

export function assertIssueKeyAllowed(
  issueKey: string,
  policy: JiraSecurityPolicy,
): void {
  if (!ISSUE_KEY_PATTERN.test(issueKey)) {
    throw new JiraPolicyError("Issue key must match PROJECT-123 format");
  }

  const projectKey = issueKey.split("-")[0];
  if (projectKey === undefined || !PROJECT_KEY_PATTERN.test(projectKey)) {
    throw new JiraPolicyError("Issue key project is invalid");
  }

  assertProjectAllowed(projectKey, policy);
}

export function normalizeMaxResults(maxResults: number | undefined): number {
  if (maxResults === undefined) {
    return DEFAULT_SEARCH_LIMIT;
  }

  if (
    !Number.isInteger(maxResults) ||
    maxResults < 1 ||
    maxResults > MAX_SEARCH_LIMIT
  ) {
    throw new JiraPolicyError(
      `maxResults must be between 1 and ${MAX_SEARCH_LIMIT}`,
    );
  }

  return maxResults;
}

export function assertJqlAllowed(
  jql: string,
  policy: JiraSecurityPolicy,
): void {
  const normalized = jql.trim();

  if (normalized.length === 0 || normalized.length > 512) {
    throw new JiraPolicyError("JQL must be between 1 and 512 characters");
  }

  if (hasControlCharacter(normalized) || JQL_BLOCKED_PATTERN.test(normalized)) {
    throw new JiraPolicyError("JQL contains unsupported syntax");
  }

  if (policy.projectAllowlist.length === 0) {
    return;
  }

  const projects = extractProjectKeys(normalized);
  if (projects.length === 0) {
    throw new JiraPolicyError("JQL must include an explicit project filter");
  }

  for (const projectKey of projects) {
    assertProjectAllowed(projectKey, policy);
  }
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.charCodeAt(index);
    if (codePoint <= 31 || codePoint === 127) {
      return true;
    }
  }

  return false;
}

export function extractProjectKeys(jql: string): readonly string[] {
  const projects = new Set<string>();
  const equalsPattern = /\bproject\s*=\s*"?([A-Z][A-Z0-9_]*)"?/gi;
  const inPattern = /\bproject\s+in\s*\(([^)]*)\)/gi;

  for (const match of jql.matchAll(equalsPattern)) {
    const projectKey = match[1];
    if (projectKey !== undefined) {
      projects.add(projectKey.toUpperCase());
    }
  }

  for (const match of jql.matchAll(inPattern)) {
    const rawGroup = match[1];
    if (rawGroup === undefined) {
      continue;
    }

    for (const rawProject of rawGroup.split(",")) {
      const projectKey = rawProject.trim().replaceAll('"', "").toUpperCase();
      if (PROJECT_KEY_PATTERN.test(projectKey)) {
        projects.add(projectKey);
      }
    }
  }

  return [...projects];
}

function assertProjectAllowed(
  projectKey: string,
  policy: JiraSecurityPolicy,
): void {
  const normalizedProject = projectKey.toUpperCase();
  const allowlist = policy.projectAllowlist.map((allowed) =>
    allowed.toUpperCase(),
  );

  if (allowlist.length > 0 && !allowlist.includes(normalizedProject)) {
    throw new JiraPolicyError("Project is not allowed");
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
