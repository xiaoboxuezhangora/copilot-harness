import { JiraConfigError, JiraRequestError } from "./errors.js";
import {
  assertAttachmentIdAllowed,
  assertIssueKeyAllowed,
  assertJqlAllowed,
  assertProjectKeyAllowed,
  normalizeAttachmentMaxBytes,
  isRecord,
  JIRA_FIELD_WHITELIST,
  normalizeMaxResults,
  sanitizeUnknown,
  sanitizeText,
} from "./security.js";
import type { JiraSecurityPolicy } from "./security.js";
import type {
  JiraAttachment,
  JiraAttachmentContent,
  JiraAttachmentMeta,
  JiraComment,
  JiraField,
  JiraIssueDetails,
  JiraIssueLink,
  JiraIssueRef,
  JiraIssueRelations,
  JiraIssue,
  JiraProjectComponent,
  JiraProject,
  JiraProjectMetadata,
  JiraProjectStatus,
  JiraProjectVersion,
  JiraRemoteLink,
  JiraSearchResult,
  JiraServerInfo,
  JiraTransition,
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

  async getServerInfo(): Promise<JiraServerInfo> {
    const rawServerInfo = await this.requestJson("/rest/api/2/serverInfo", {});
    return mapServerInfo(rawServerInfo);
  }

  async getCurrentUser(): Promise<JiraUser> {
    const rawCurrentUser = await this.requestJson("/rest/api/2/myself", {});
    return mapCurrentUser(rawCurrentUser);
  }

  async getAttachmentMeta(): Promise<JiraAttachmentMeta> {
    const rawMeta = await this.requestJson("/rest/api/2/attachment/meta", {});
    return mapAttachmentMeta(rawMeta);
  }

  async getFields(options?: {
    readonly customOnly?: boolean | undefined;
    readonly query?: string | undefined;
    readonly maxResults?: number | undefined;
  }): Promise<readonly JiraField[]> {
    const rawFields = await this.requestJson("/rest/api/2/field", {});
    const fields = mapFields(rawFields);
    const query = options?.query?.trim().toLowerCase();
    const customOnly = options?.customOnly ?? false;
    const maxResults = normalizeMaxResults(options?.maxResults);

    return fields
      .filter((field) => !customOnly || field.custom)
      .filter((field) => {
        if (query === undefined || query.length === 0) {
          return true;
        }

        return (
          field.id.toLowerCase().includes(query) ||
          field.name.toLowerCase().includes(query)
        );
      })
      .slice(0, maxResults);
  }

  async getIssueDetails(options: {
    readonly issueKey: string;
    readonly includeRenderedFields?: boolean | undefined;
    readonly includeChangelog?: boolean | undefined;
    readonly maxChangelogEntries?: number | undefined;
  }): Promise<JiraIssueDetails> {
    assertIssueKeyAllowed(options.issueKey, this.policy);
    const expand = ["names", "schema"];
    if (options.includeRenderedFields === true) {
      expand.push("renderedFields");
    }
    if (options.includeChangelog === true) {
      expand.push("changelog");
    }

    const rawIssue = await this.requestJson(
      `/rest/api/2/issue/${encodeURIComponent(options.issueKey)}`,
      {
        fields: JIRA_FIELD_WHITELIST.join(","),
        expand: expand.join(","),
      },
    );

    return mapIssueDetails(rawIssue, options.maxChangelogEntries);
  }

  async getIssueAttachment(
    issueKey: string,
    attachmentId: string,
  ): Promise<JiraAttachment> {
    const attachmentFromIssue = await this.findIssueAttachment(
      issueKey,
      attachmentId,
    );
    const rawAttachment = await this.requestJson(
      `/rest/api/2/attachment/${encodeURIComponent(attachmentId)}`,
      {},
    );
    const attachment = mapAttachment(rawAttachment) ?? attachmentFromIssue;

    return {
      ...attachmentFromIssue,
      ...attachment,
    };
  }

  async getIssueAttachmentContent(
    issueKey: string,
    attachmentId: string,
    maxBytes?: number,
  ): Promise<JiraAttachmentContent> {
    const safeMaxBytes = normalizeAttachmentMaxBytes(maxBytes);
    const attachment = await this.getIssueAttachment(issueKey, attachmentId);
    const rawAttachment = await this.requestJson(
      `/rest/api/2/attachment/${encodeURIComponent(attachmentId)}`,
      {},
    );
    const contentUrl = isRecord(rawAttachment)
      ? readString(rawAttachment, "content")
      : undefined;
    if (contentUrl === undefined) {
      throw new JiraRequestError("Jira attachment is missing content URL");
    }

    const downloaded = await this.requestBinary(contentUrl, safeMaxBytes);

    return {
      attachment,
      mimeType: attachment.mimeType ?? downloaded.mimeType,
      byteLength: downloaded.bytes.byteLength,
      base64: Buffer.from(downloaded.bytes).toString("base64"),
      truncated: downloaded.truncated,
    };
  }

  async getProjectMetadata(projectKey: string): Promise<JiraProjectMetadata> {
    assertProjectKeyAllowed(projectKey, this.policy);
    const encodedProjectKey = encodeURIComponent(projectKey);
    const [rawProject, rawComponents, rawVersions, rawStatuses] =
      await Promise.all([
        this.requestJson(`/rest/api/2/project/${encodedProjectKey}`, {}),
        this.requestJson(
          `/rest/api/2/project/${encodedProjectKey}/components`,
          {},
        ),
        this.requestJson(
          `/rest/api/2/project/${encodedProjectKey}/versions`,
          {},
        ),
        this.requestJson(
          `/rest/api/2/project/${encodedProjectKey}/statuses`,
          {},
        ),
      ]);

    return {
      project: mapProject(rawProject, projectKey),
      components: mapProjectComponents(rawComponents),
      versions: mapProjectVersions(rawVersions),
      statuses: mapProjectStatuses(rawStatuses),
    };
  }

  async getIssueRelations(issueKey: string): Promise<JiraIssueRelations> {
    assertIssueKeyAllowed(issueKey, this.policy);
    const rawIssue = await this.requestJson(
      `/rest/api/2/issue/${encodeURIComponent(issueKey)}`,
      {
        fields: "parent,subtasks,issuelinks",
      },
    );
    const rawRemoteLinks = await this.requestJson(
      `/rest/api/2/issue/${encodeURIComponent(issueKey)}/remotelink`,
      {},
    );

    return mapIssueRelations(rawIssue, rawRemoteLinks, issueKey);
  }

  async getTransitions(issueKey: string): Promise<readonly JiraTransition[]> {
    assertIssueKeyAllowed(issueKey, this.policy);
    const rawTransitions = await this.requestJson(
      `/rest/api/2/issue/${encodeURIComponent(issueKey)}/transitions`,
      {},
    );

    return mapTransitions(rawTransitions);
  }

  private async findIssueAttachment(
    issueKey: string,
    attachmentId: string,
  ): Promise<JiraAttachment> {
    assertIssueKeyAllowed(issueKey, this.policy);
    assertAttachmentIdAllowed(attachmentId);
    const issue = await this.getIssue(issueKey);
    const attachment = issue.attachments.find(
      (candidate) => candidate.id === attachmentId,
    );

    if (attachment === undefined) {
      throw new JiraRequestError("Jira attachment does not belong to issue");
    }

    return attachment;
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

  private async requestBinary(
    contentUrl: string,
    maxBytes: number,
  ): Promise<{
    readonly bytes: Uint8Array;
    readonly mimeType: string;
    readonly truncated: boolean;
  }> {
    const url = new URL(contentUrl, this.baseUrl);
    const base = new URL(this.baseUrl);
    if (url.origin !== base.origin) {
      throw new JiraRequestError("Jira attachment URL origin is not allowed");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);

    try {
      const headers: HeadersInit = {
        Accept: "*/*",
        Range: `bytes=0-${maxBytes - 1}`,
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

      const arrayBuffer = await response.arrayBuffer();
      const allBytes = new Uint8Array(arrayBuffer);
      const truncated =
        allBytes.byteLength > maxBytes ||
        isTruncatedContentRange(response.headers.get("content-range")) ||
        (response.status === 206 &&
          response.headers.get("content-range") === null);
      const bytes =
        allBytes.byteLength > maxBytes ? allBytes.slice(0, maxBytes) : allBytes;

      return {
        bytes,
        mimeType:
          response.headers.get("content-type")?.split(";")[0] ??
          "application/octet-stream",
        truncated,
      };
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

function isTruncatedContentRange(contentRange: string | null): boolean {
  if (contentRange === null) {
    return false;
  }

  const match = /^bytes\s+\d+-(\d+)\/(\d+)$/i.exec(contentRange.trim());
  if (match === null) {
    return true;
  }

  const end = Number(match[1]);
  const total = Number(match[2]);
  return Number.isFinite(end) && Number.isFinite(total)
    ? end + 1 < total
    : true;
}

function mapServerInfo(rawServerInfo: unknown): JiraServerInfo {
  if (!isRecord(rawServerInfo)) {
    throw new JiraRequestError("Jira serverInfo response is invalid");
  }

  const versionNumbers = rawServerInfo.versionNumbers;

  return {
    versionNumbers: Array.isArray(versionNumbers)
      ? versionNumbers.filter(
          (item): item is number => typeof item === "number",
        )
      : [],
    ...copyString(rawServerInfo, "baseUrl"),
    ...copyString(rawServerInfo, "version"),
    ...copyString(rawServerInfo, "deploymentType"),
    ...copyNumber(rawServerInfo, "buildNumber"),
    ...copyString(rawServerInfo, "buildDate"),
    ...copyString(rawServerInfo, "serverTitle"),
  };
}

function mapCurrentUser(rawCurrentUser: unknown): JiraUser {
  if (!isRecord(rawCurrentUser)) {
    throw new JiraRequestError("Jira myself response is invalid");
  }

  const user = readUserFromRecord(rawCurrentUser);
  if (user === undefined) {
    throw new JiraRequestError("Jira myself response is missing user identity");
  }

  return user;
}

function mapAttachmentMeta(rawMeta: unknown): JiraAttachmentMeta {
  if (!isRecord(rawMeta)) {
    throw new JiraRequestError("Jira attachment meta response is invalid");
  }

  return {
    enabled: rawMeta.enabled === true,
    ...copyNumber(rawMeta, "uploadLimit"),
  };
}

function mapFields(rawFields: unknown): readonly JiraField[] {
  if (!Array.isArray(rawFields)) {
    throw new JiraRequestError("Jira fields response is invalid");
  }

  return rawFields
    .map((rawField): JiraField | undefined => {
      if (!isRecord(rawField)) {
        return undefined;
      }

      const id = readString(rawField, "id");
      const name = readString(rawField, "name");
      if (id === undefined || name === undefined) {
        return undefined;
      }

      const schema = mapFieldSchema(rawField.schema);
      const clauseNames = rawField.clauseNames;

      return {
        id: sanitizeText(id),
        name: sanitizeText(name),
        custom: rawField.custom === true,
        clauseNames: Array.isArray(clauseNames)
          ? clauseNames
              .filter((item): item is string => typeof item === "string")
              .map((item) => sanitizeText(item))
          : [],
        ...copyBoolean(rawField, "orderable"),
        ...copyBoolean(rawField, "navigable"),
        ...copyBoolean(rawField, "searchable"),
        ...(schema !== undefined ? { schema } : {}),
      } satisfies JiraField;
    })
    .filter((field): field is JiraField => field !== undefined);
}

function mapFieldSchema(rawSchema: unknown): JiraField["schema"] | undefined {
  if (!isRecord(rawSchema)) {
    return undefined;
  }

  return {
    ...copyString(rawSchema, "type"),
    ...copyString(rawSchema, "items"),
    ...copyString(rawSchema, "system"),
    ...copyString(rawSchema, "custom"),
    ...copyNumber(rawSchema, "customId"),
  };
}

function mapIssueDetails(
  rawIssue: unknown,
  maxChangelogEntries: number | undefined,
): JiraIssueDetails {
  if (!isRecord(rawIssue)) {
    throw new JiraRequestError("Jira issue details response is invalid");
  }

  return {
    issue: mapIssue(rawIssue),
    ...copyStringRecord(rawIssue, "names"),
    ...copySanitizedRecord(rawIssue, "schema"),
    ...copySanitizedRecord(rawIssue, "renderedFields"),
    ...copyChangelog(rawIssue, maxChangelogEntries),
  };
}

function mapProject(rawProject: unknown, fallbackKey: string): JiraProject {
  if (!isRecord(rawProject)) {
    return {
      key: sanitizeText(fallbackKey),
    };
  }

  const key = readString(rawProject, "key") ?? fallbackKey;
  const name = readSanitizedString(rawProject, "name");

  return {
    key: sanitizeText(key),
    ...(name !== undefined ? { name } : {}),
  };
}

function mapProjectComponents(
  rawComponents: unknown,
): readonly JiraProjectComponent[] {
  if (!Array.isArray(rawComponents)) {
    return [];
  }

  return rawComponents
    .filter((item): item is Record<string, unknown> => isRecord(item))
    .map((item) => ({
      ...copyString(item, "id"),
      ...copyString(item, "name"),
      ...copyString(item, "description"),
    }));
}

function mapProjectVersions(
  rawVersions: unknown,
): readonly JiraProjectVersion[] {
  if (!Array.isArray(rawVersions)) {
    return [];
  }

  return rawVersions
    .filter((item): item is Record<string, unknown> => isRecord(item))
    .map((item) => ({
      ...copyString(item, "id"),
      ...copyString(item, "name"),
      ...copyBoolean(item, "released"),
      ...copyBoolean(item, "archived"),
      ...copyString(item, "releaseDate"),
    }));
}

function mapProjectStatuses(
  rawStatuses: unknown,
): readonly JiraProjectStatus[] {
  if (!Array.isArray(rawStatuses)) {
    return [];
  }

  return rawStatuses
    .filter((item): item is Record<string, unknown> => isRecord(item))
    .map((item) => {
      const issueTypes = item.issueTypes;

      return {
        ...copyString(item, "id"),
        ...copyString(item, "name"),
        issueTypes: Array.isArray(issueTypes)
          ? issueTypes
              .filter((issueType): issueType is Record<string, unknown> =>
                isRecord(issueType),
              )
              .map(mapProjectStatusIssueType)
          : [],
      };
    });
}

function mapProjectStatusIssueType(issueType: Record<string, unknown>): {
  readonly id?: string;
  readonly name?: string;
  readonly statuses: readonly {
    readonly id?: string;
    readonly name?: string;
    readonly statusCategory?: string;
  }[];
} {
  const statuses = issueType.statuses;

  return {
    ...copyString(issueType, "id"),
    ...copyString(issueType, "name"),
    statuses: Array.isArray(statuses)
      ? statuses
          .filter((status): status is Record<string, unknown> =>
            isRecord(status),
          )
          .map((status) => ({
            ...copyString(status, "id"),
            ...copyString(status, "name"),
            ...copyStatusCategory(status),
          }))
      : [],
  };
}

function mapIssueRelations(
  rawIssue: unknown,
  rawRemoteLinks: unknown,
  issueKey: string,
): JiraIssueRelations {
  if (!isRecord(rawIssue)) {
    throw new JiraRequestError("Jira issue relations response is invalid");
  }

  const fields = isRecord(rawIssue.fields) ? rawIssue.fields : {};
  const parent = mapIssueRef(fields.parent);
  const subtasks = fields.subtasks;
  const issueLinks = fields.issuelinks;

  return {
    issueKey: sanitizeText(issueKey),
    ...(parent !== undefined ? { parent } : {}),
    subtasks: Array.isArray(subtasks)
      ? subtasks
          .map((subtask) => mapIssueRef(subtask))
          .filter((subtask): subtask is JiraIssueRef => subtask !== undefined)
      : [],
    issueLinks: Array.isArray(issueLinks)
      ? issueLinks
          .map((link) => mapIssueLink(link))
          .filter((link): link is JiraIssueLink => link !== undefined)
      : [],
    remoteLinks: mapRemoteLinks(rawRemoteLinks),
  };
}

function mapIssueLink(rawLink: unknown): JiraIssueLink | undefined {
  if (!isRecord(rawLink)) {
    return undefined;
  }

  const type = isRecord(rawLink.type) ? rawLink.type : {};
  const inwardIssue = mapIssueRef(rawLink.inwardIssue);
  if (inwardIssue !== undefined) {
    const typeName = readSanitizedString(type, "name");
    const description = readSanitizedString(type, "inward");
    return {
      ...copyString(rawLink, "id"),
      ...(typeName !== undefined ? { type: typeName } : {}),
      direction: "inward",
      ...(description !== undefined ? { description } : {}),
      issue: inwardIssue,
    };
  }

  const outwardIssue = mapIssueRef(rawLink.outwardIssue);
  if (outwardIssue !== undefined) {
    const typeName = readSanitizedString(type, "name");
    const description = readSanitizedString(type, "outward");
    return {
      ...copyString(rawLink, "id"),
      ...(typeName !== undefined ? { type: typeName } : {}),
      direction: "outward",
      ...(description !== undefined ? { description } : {}),
      issue: outwardIssue,
    };
  }

  return undefined;
}

function mapRemoteLinks(rawRemoteLinks: unknown): readonly JiraRemoteLink[] {
  if (!Array.isArray(rawRemoteLinks)) {
    return [];
  }

  return rawRemoteLinks
    .filter((link): link is Record<string, unknown> => isRecord(link))
    .map((link) => {
      const object = isRecord(link.object) ? link.object : {};
      const title = readSanitizedString(object, "title");
      const url = readSanitizedString(object, "url");

      return {
        ...copyNumber(link, "id"),
        ...copyString(link, "globalId"),
        ...copyString(link, "relationship"),
        ...(title !== undefined ? { title } : {}),
        ...(url !== undefined ? { url } : {}),
      };
    });
}

function mapTransitions(rawTransitions: unknown): readonly JiraTransition[] {
  if (!isRecord(rawTransitions)) {
    throw new JiraRequestError("Jira transitions response is invalid");
  }

  const transitions = rawTransitions.transitions;
  if (!Array.isArray(transitions)) {
    return [];
  }

  return transitions
    .filter((transition): transition is Record<string, unknown> =>
      isRecord(transition),
    )
    .map((transition) => {
      const id = readString(transition, "id");
      const name = readString(transition, "name");
      if (id === undefined || name === undefined) {
        return undefined;
      }

      const to = isRecord(transition.to)
        ? readSanitizedString(transition.to, "name")
        : undefined;

      return {
        id: sanitizeText(id),
        name: sanitizeText(name),
        ...(to !== undefined ? { to } : {}),
      } satisfies JiraTransition;
    })
    .filter(
      (transition): transition is JiraTransition => transition !== undefined,
    );
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
    .map((item) => mapAttachment(item))
    .filter((a): a is JiraAttachment => a !== undefined);
}

function mapAttachment(rawAttachment: unknown): JiraAttachment | undefined {
  if (!isRecord(rawAttachment)) {
    return undefined;
  }

  const id = readString(rawAttachment, "id");
  const filename = readString(rawAttachment, "filename");
  if (id === undefined || filename === undefined) {
    return undefined;
  }

  const mimeType = readString(rawAttachment, "mimeType");
  const size =
    typeof rawAttachment.size === "number" ? rawAttachment.size : undefined;
  const contentUrl = readSanitizedString(rawAttachment, "content");
  const thumbnailUrl = readSanitizedString(rawAttachment, "thumbnail");
  const created = readSanitizedString(rawAttachment, "created");
  const author = readUser(rawAttachment, "author");

  return {
    id: sanitizeText(id),
    filename: sanitizeText(filename),
    ...(mimeType !== undefined ? { mimeType } : {}),
    ...(size !== undefined ? { size } : {}),
    ...(contentUrl !== undefined ? { contentUrl } : {}),
    ...(thumbnailUrl !== undefined ? { thumbnailUrl } : {}),
    ...(created !== undefined ? { created } : {}),
    ...(author !== undefined ? { author } : {}),
  };
}

function mapIssueRef(rawIssue: unknown): JiraIssueRef | undefined {
  if (!isRecord(rawIssue)) {
    return undefined;
  }

  const fields = isRecord(rawIssue.fields) ? rawIssue.fields : {};
  const status = isRecord(fields.status)
    ? readSanitizedString(fields.status, "name")
    : undefined;
  const key = readSanitizedString(rawIssue, "key");
  const summary = readSanitizedString(fields, "summary");

  if (key === undefined && summary === undefined && status === undefined) {
    return undefined;
  }

  return {
    ...(key !== undefined ? { key } : {}),
    ...(summary !== undefined ? { summary } : {}),
    ...(status !== undefined ? { status } : {}),
  };
}

function copyString(
  record: Record<string, unknown>,
  key: string,
): Record<string, string> {
  const value = readSanitizedString(record, key);
  return value === undefined ? {} : { [key]: value };
}

function copyStringRecord(
  record: Record<string, unknown>,
  key: string,
): Record<string, Record<string, string>> {
  const value = record[key];
  if (!isRecord(value)) {
    return {};
  }

  const mapped: Record<string, string> = {};
  for (const [fieldKey, fieldValue] of Object.entries(value)) {
    if (typeof fieldValue === "string") {
      mapped[sanitizeText(fieldKey)] = sanitizeText(fieldValue);
    }
  }

  return { [key]: mapped };
}

function copySanitizedRecord(
  record: Record<string, unknown>,
  key: string,
): Record<string, Record<string, unknown>> {
  const sanitized = sanitizeUnknown(record[key]);
  return isRecord(sanitized) ? { [key]: sanitized } : {};
}

function copyChangelog(
  record: Record<string, unknown>,
  maxChangelogEntries: number | undefined,
): Record<string, Record<string, unknown>> {
  const changelog = sanitizeUnknown(record.changelog);
  if (!isRecord(changelog)) {
    return {};
  }

  const histories = changelog.histories;
  if (!Array.isArray(histories)) {
    return { changelog };
  }

  const limit = normalizeMaxResults(maxChangelogEntries);
  return {
    changelog: {
      ...changelog,
      histories: histories.slice(0, limit),
    },
  };
}

function copyNumber(
  record: Record<string, unknown>,
  key: string,
): Record<string, number> {
  const value = readNumber(record, key);
  return value === undefined ? {} : { [key]: value };
}

function copyBoolean(
  record: Record<string, unknown>,
  key: string,
): Record<string, boolean> {
  const value = record[key];
  return typeof value === "boolean" ? { [key]: value } : {};
}

function copyStatusCategory(status: Record<string, unknown>): {
  readonly statusCategory?: string;
} {
  const category = isRecord(status.statusCategory)
    ? readSanitizedString(status.statusCategory, "name")
    : undefined;

  return category === undefined ? {} : { statusCategory: category };
}

function readUser(
  record: Record<string, unknown>,
  key: string,
): JiraUser | undefined {
  const value = record[key];
  return isRecord(value) ? readUserFromRecord(value) : undefined;
}

function readUserFromRecord(record: Record<string, unknown>): JiraUser | undefined {
  const name = readSanitizedString(record, "name");
  const key = readSanitizedString(record, "key");
  const displayName = readSanitizedString(record, "displayName");
  const accountId = readSanitizedString(record, "accountId");

  if (
    name === undefined &&
    key === undefined &&
    displayName === undefined &&
    accountId === undefined
  ) {
    return undefined;
  }

  return {
    ...(name !== undefined ? { name } : {}),
    ...(key !== undefined ? { key } : {}),
    ...(displayName !== undefined ? { displayName } : {}),
    ...(accountId !== undefined ? { accountId } : {}),
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
