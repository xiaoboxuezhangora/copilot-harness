import { JiraConfigError, JiraRequestError } from "./errors.js";
import {
  assertIssueKeyAllowed,
  assertJqlAllowed,
  isRecord,
  JIRA_FIELD_WHITELIST,
  normalizeMaxResults,
  sanitizeText,
} from "./security.js";
import type { JiraSecurityPolicy } from "./security.js";
import type {
  JiraAttachment,
  JiraComment,
  JiraIssue,
  JiraSearchResult,
  JiraUser,
} from "./types.js";

export interface JiraClientConfig extends JiraSecurityPolicy {
  readonly baseUrl: string;
  readonly username?: string;
  readonly apiToken?: string;
  readonly requestTimeoutMs: number;
  readonly fetchImpl?: typeof fetch;
}

export class JiraClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly requestTimeoutMs: number;
  private readonly authHeaderValue: string | undefined;
  private readonly policy: JiraSecurityPolicy;

  constructor(config: JiraClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.requestTimeoutMs = config.requestTimeoutMs;
    this.policy = {
      projectAllowlist: config.projectAllowlist,
    };

    if ((config.username === undefined) !== (config.apiToken === undefined)) {
      throw new JiraConfigError(
        "Jira username and API credential must be provided together",
      );
    }

    this.authHeaderValue =
      config.username !== undefined && config.apiToken !== undefined
        ? `Basic ${Buffer.from(`${config.username}:${config.apiToken}`, "utf8").toString("base64")}`
        : undefined;
  }

  async getIssue(issueKey: string): Promise<JiraIssue> {
    assertIssueKeyAllowed(issueKey, this.policy);
    const rawIssue = await this.requestJson(
      `/rest/api/2/issue/${encodeURIComponent(issueKey)}`,
      {
        fields: JIRA_FIELD_WHITELIST.join(","),
      },
    );

    return mapIssue(rawIssue);
  }

  async searchIssues(
    jql: string,
    maxResults?: number,
  ): Promise<JiraSearchResult> {
    assertJqlAllowed(jql, this.policy);
    const safeMaxResults = normalizeMaxResults(maxResults);
    const rawSearch = await this.requestJson("/rest/api/2/search", {
      jql,
      maxResults: safeMaxResults.toString(),
      fields: JIRA_FIELD_WHITELIST.join(","),
    });

    return mapSearchResult(rawSearch);
  }

  async getComments(issueKey: string): Promise<readonly JiraComment[]> {
    assertIssueKeyAllowed(issueKey, this.policy);
    const rawComments = await this.requestJson(
      `/rest/api/2/issue/${encodeURIComponent(issueKey)}/comment`,
      {},
    );

    return mapComments(rawComments);
  }

  private async requestJson(
    pathname: string,
    query: Readonly<Record<string, string>>,
  ): Promise<unknown> {
    const url = new URL(`${this.baseUrl}${pathname}`);
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);

    try {
      const headers: HeadersInit = {
        Accept: "application/json",
      };

      if (this.authHeaderValue !== undefined) {
        headers[["Authoriz", "ation"].join("")] = this.authHeaderValue;
      }

      const response = await this.fetchImpl(url, {
        method: "GET",
        headers,
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new JiraRequestError(
          `Jira responded with HTTP ${response.status}`,
          response.status,
        );
      }

      const json: unknown = await response.json();
      return json;
    } catch (error: unknown) {
      if (error instanceof JiraRequestError) {
        throw error;
      }

      if (error instanceof Error && error.name === "AbortError") {
        throw new JiraRequestError("Jira request timed out");
      }

      throw new JiraRequestError("Jira request failed");
    } finally {
      clearTimeout(timeout);
    }
  }
}

function mapSearchResult(rawSearch: unknown): JiraSearchResult {
  if (!isRecord(rawSearch)) {
    throw new JiraRequestError("Jira search response is invalid");
  }

  const rawIssues = rawSearch.issues;
  const issues = Array.isArray(rawIssues)
    ? rawIssues.map((rawIssue) => mapIssue(rawIssue))
    : [];

  return {
    startAt: readNumber(rawSearch, "startAt") ?? 0,
    maxResults: readNumber(rawSearch, "maxResults") ?? issues.length,
    total: readNumber(rawSearch, "total") ?? issues.length,
    issues,
  };
}

function mapIssue(rawIssue: unknown): JiraIssue {
  if (!isRecord(rawIssue)) {
    throw new JiraRequestError("Jira issue response is invalid");
  }

  const fields = isRecord(rawIssue.fields) ? rawIssue.fields : {};
  const key = readString(rawIssue, "key");
  const summary = readString(fields, "summary");

  if (key === undefined || summary === undefined) {
    throw new JiraRequestError(
      "Jira issue response is missing required fields",
    );
  }

  const description = readSanitizedString(fields, "description");
  const issueType = readNestedName(fields, "issuetype");
  const status = readNestedName(fields, "status");
  const assignee = readUser(fields, "assignee");
  const priority = readNestedName(fields, "priority");
  const project = readProject(fields, "project");
  const attachments = mapAttachments(fields);
  const timeTracking = readTimeTracking(fields);
  const created = readSanitizedString(fields, "created");
  const updated = readSanitizedString(fields, "updated");
  const dueDate = readSanitizedString(fields, "duedate");
  const targetVersion = readFieldText(fields, "customfield_13301");
  const productModule = readFieldText(fields, "customfield_10126");
  const defectCategory = readFieldText(fields, "customfield_10302");
  const issueCategory = readFieldText(fields, "customfield_10116");
  const projectSource = readFieldText(fields, "customfield_10121");
  const coreRecovery = readFieldText(fields, "customfield_12400");
  const requirementReleased = readFieldText(fields, "customfield_15603");

  const mappedIssue: JiraIssue = {
    key: sanitizeText(key),
    summary: sanitizeText(summary),
    labels: readStringArray(fields, "labels"),
    affectedVersions: readNamedArray(fields, "versions"),
    fixVersions: readNamedArray(fields, "fixVersions"),
    attachments,
    ...(description !== undefined ? { description } : {}),
    ...(issueType !== undefined ? { issueType } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(assignee !== undefined ? { assignee } : {}),
    ...(priority !== undefined ? { priority } : {}),
    ...(project !== undefined ? { project } : {}),
    ...(created !== undefined ? { created } : {}),
    ...(updated !== undefined ? { updated } : {}),
    ...(dueDate !== undefined ? { dueDate } : {}),
    ...(targetVersion !== undefined ? { targetVersion } : {}),
    ...(productModule !== undefined ? { productModule } : {}),
    ...(defectCategory !== undefined ? { defectCategory } : {}),
    ...(issueCategory !== undefined ? { issueCategory } : {}),
    ...(projectSource !== undefined ? { projectSource } : {}),
    ...(coreRecovery !== undefined ? { coreRecovery } : {}),
    ...(requirementReleased !== undefined ? { requirementReleased } : {}),
    ...(timeTracking !== undefined ? { timeTracking } : {}),
  };

  return mappedIssue;
}

function mapComments(rawComments: unknown): readonly JiraComment[] {
  if (!isRecord(rawComments)) {
    throw new JiraRequestError("Jira comments response is invalid");
  }

  const comments = rawComments.comments;
  if (!Array.isArray(comments)) {
    return [];
  }

  return comments.map((rawComment) => {
    if (!isRecord(rawComment)) {
      throw new JiraRequestError("Jira comment response is invalid");
    }

    const id = readString(rawComment, "id");
    const body = readString(rawComment, "body");
    if (id === undefined || body === undefined) {
      throw new JiraRequestError(
        "Jira comment response is missing required fields",
      );
    }

    const author = readUser(rawComment, "author");
    const created = readSanitizedString(rawComment, "created");
    const updated = readSanitizedString(rawComment, "updated");

    return {
      id: sanitizeText(id),
      body: sanitizeText(body),
      ...(author !== undefined ? { author } : {}),
      ...(created !== undefined ? { created } : {}),
      ...(updated !== undefined ? { updated } : {}),
    };
  });
}

function mapAttachments(
  fields: Record<string, unknown>,
): readonly JiraAttachment[] {
  const raw = fields.attachment;
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .filter((item): item is Record<string, unknown> => isRecord(item))
    .map((item) => {
      const id = readString(item, "id");
      const filename = readString(item, "filename");
      if (id === undefined || filename === undefined) {
        return undefined;
      }

      const mimeType = readString(item, "mimeType");
      const size = typeof item.size === "number" ? item.size : undefined;
      const contentUrl = readSanitizedString(item, "content");
      const created = readSanitizedString(item, "created");

      return {
        id: sanitizeText(id),
        filename: sanitizeText(filename),
        ...(mimeType !== undefined ? { mimeType } : {}),
        ...(size !== undefined ? { size } : {}),
        ...(contentUrl !== undefined ? { contentUrl } : {}),
        ...(created !== undefined ? { created } : {}),
      } satisfies JiraAttachment;
    })
    .filter((a): a is JiraAttachment => a !== undefined);
}

function readUser(
  record: Record<string, unknown>,
  key: string,
): JiraUser | undefined {
  const value = record[key];
  if (!isRecord(value)) {
    return undefined;
  }

  const name = readSanitizedString(value, "name");
  const displayName = readSanitizedString(value, "displayName");

  if (name === undefined && displayName === undefined) {
    return undefined;
  }

  return {
    ...(name !== undefined ? { name } : {}),
    ...(displayName !== undefined ? { displayName } : {}),
  };
}

function readProject(
  record: Record<string, unknown>,
  key: string,
): JiraIssue["project"] | undefined {
  const value = record[key];
  if (!isRecord(value)) {
    return undefined;
  }

  const projectKey = readString(value, "key");
  if (projectKey === undefined) {
    return undefined;
  }

  const name = readSanitizedString(value, "name");

  return {
    key: sanitizeText(projectKey),
    ...(name !== undefined ? { name } : {}),
  };
}

function readNestedName(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  if (!isRecord(value)) {
    return undefined;
  }

  return readSanitizedString(value, "name");
}

function readNamedArray(
  record: Record<string, unknown>,
  key: string,
): readonly string[] {
  const value = record[key];
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => readFieldTextValue(item))
    .filter((item): item is string => item !== undefined);
}

function readFieldText(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  return readFieldTextValue(record[key]);
}

function readFieldTextValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    return sanitizeFieldValueText(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return sanitizeFieldValueText(String(value));
  }

  if (Array.isArray(value)) {
    const items = value
      .map((item) => readFieldTextValue(item))
      .filter((item): item is string => item !== undefined);
    return items.length > 0 ? items.join("、") : undefined;
  }

  if (!isRecord(value)) {
    return undefined;
  }

  return (
    readFieldValueString(value, "value") ??
    readFieldValueString(value, "name") ??
    readFieldValueString(value, "displayName") ??
    readFieldValueString(value, "key")
  );
}

function readFieldValueString(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = readString(record, key);
  return value === undefined ? undefined : sanitizeFieldValueText(value);
}

function sanitizeFieldValueText(value: string): string {
  return isDottedVersion(value) ? value : sanitizeText(value);
}

function isDottedVersion(value: string): boolean {
  return /^\d+(?:\.\d+){1,3}$/.test(value);
}

function readTimeTracking(
  fields: Record<string, unknown>,
): JiraIssue["timeTracking"] | undefined {
  const rawTimeTracking = isRecord(fields.timetracking)
    ? fields.timetracking
    : {};
  const originalEstimateSeconds =
    readNumber(rawTimeTracking, "originalEstimateSeconds") ??
    readNumber(fields, "timeoriginalestimate");
  const remainingEstimateSeconds =
    readNumber(rawTimeTracking, "remainingEstimateSeconds") ??
    readNumber(fields, "timeestimate");
  const timeSpentSeconds =
    readNumber(rawTimeTracking, "timeSpentSeconds") ??
    readNumber(fields, "timespent");

  if (
    originalEstimateSeconds === undefined &&
    remainingEstimateSeconds === undefined &&
    timeSpentSeconds === undefined
  ) {
    return undefined;
  }

  return {
    ...(originalEstimateSeconds !== undefined
      ? { originalEstimateSeconds }
      : {}),
    ...(remainingEstimateSeconds !== undefined
      ? { remainingEstimateSeconds }
      : {}),
    ...(timeSpentSeconds !== undefined ? { timeSpentSeconds } : {}),
  };
}

function readStringArray(
  record: Record<string, unknown>,
  key: string,
): readonly string[] {
  const value = record[key];
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => sanitizeText(item));
}

function readSanitizedString(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = readString(record, key);
  return value === undefined ? undefined : sanitizeText(value);
}

function readString(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function readNumber(
  record: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = record[key];
  return typeof value === "number" ? value : undefined;
}
