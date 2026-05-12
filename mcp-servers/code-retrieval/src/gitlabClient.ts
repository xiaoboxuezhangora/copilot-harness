import { CodeRetrievalRequestError } from "./errors.js";
import {
  assertSafeRepositoryPath,
  isExcludedPath,
  normalizeLimit,
} from "./security.js";
import type {
  CommitV1,
  DiffFileV1,
  MergeRequestV1,
  PipelineV1,
  RepositoryTreeItemV1,
} from "./types.js";
import {
  buildCommitSourceRef,
  buildMrSourceRef,
  buildPipelineSourceRef,
} from "./sourceRef.js";

export interface GitLabClientConfig {
  readonly baseUrl: string;
  readonly token: string;
  readonly requestTimeoutMs: number;
  readonly fetchImpl?: typeof fetch | undefined;
}

export interface GitLabSearchHit {
  readonly project: string;
  readonly path: string;
  readonly ref: string;
  readonly startLine: number;
  readonly content: string;
}

export interface GitLabFileContent {
  readonly project: string;
  readonly path: string;
  readonly ref: string;
  readonly commit: string;
  readonly content: string;
}

export interface GitLabCompareDiff {
  readonly project: string;
  readonly from: string;
  readonly to: string;
  readonly commit: string;
  readonly files: readonly DiffFileV1[];
}

export class GitLabClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly requestTimeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(config: GitLabClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.token = config.token;
    this.requestTimeoutMs = config.requestTimeoutMs;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async searchCode(input: {
    readonly project: string;
    readonly query: string;
    readonly ref?: string | undefined;
    readonly limit?: number | undefined;
  }): Promise<readonly GitLabSearchHit[]> {
    const limit = normalizeLimit(input.limit);
    const raw = await this.requestJson(
      `/api/v4/projects/${encodeProject(input.project)}/search`,
      {
        scope: "blobs",
        search: input.query,
        ...(input.ref !== undefined ? { ref: input.ref } : {}),
        per_page: String(limit),
      },
    );

    const items = Array.isArray(raw) ? raw : [];
    return items
      .slice(0, limit)
      .map((item) => mapSearchHit(item, input.project, input.ref));
  }

  async readFile(input: {
    readonly project: string;
    readonly path: string;
    readonly ref: string;
  }): Promise<GitLabFileContent> {
    const safePath = assertSafeRepositoryPath(input.path);
    const raw = await this.requestJson(
      `/api/v4/projects/${encodeProject(input.project)}/repository/files/${encodeURIComponent(
        safePath,
      )}`,
      {
        ref: input.ref,
      },
    );

    return mapFileContent(raw, input.project, safePath, input.ref);
  }

  async listRepositoryTree(input: {
    readonly project: string;
    readonly path?: string | undefined;
    readonly ref?: string | undefined;
    readonly recursive?: boolean | undefined;
    readonly limit?: number | undefined;
  }): Promise<readonly RepositoryTreeItemV1[]> {
    const limit = normalizeLimit(input.limit);
    const raw = await this.requestJson(
      `/api/v4/projects/${encodeProject(input.project)}/repository/tree`,
      {
        ...(input.path !== undefined
          ? { path: assertSafeRepositoryPath(input.path) }
          : {}),
        ...(input.ref !== undefined ? { ref: input.ref } : {}),
        recursive: input.recursive === true ? "true" : "false",
        per_page: String(limit),
      },
    );

    const items = Array.isArray(raw) ? raw : [];
    return items
      .slice(0, limit)
      .map((item) => mapTreeItem(item, input.project, input.ref ?? "HEAD"))
      .filter((item) => !isExcludedPath(item.path));
  }

  async listMergeRequests(input: {
    readonly project?: string | undefined;
    readonly query?: string | undefined;
    readonly state?: string | undefined;
    readonly updatedAfter?: string | undefined;
    readonly limit?: number | undefined;
  }): Promise<readonly MergeRequestV1[]> {
    const limit = normalizeLimit(input.limit);
    const path =
      input.project === undefined
        ? "/api/v4/merge_requests"
        : `/api/v4/projects/${encodeProject(input.project)}/merge_requests`;
    const raw = await this.requestJson(path, {
      ...(input.query !== undefined ? { search: input.query } : {}),
      ...(input.state !== undefined ? { state: input.state } : {}),
      ...(input.updatedAfter !== undefined
        ? { updated_after: input.updatedAfter }
        : {}),
      per_page: String(limit),
    });

    const items = Array.isArray(raw) ? raw : [];
    return items.slice(0, limit).map((item) => mapMr(item, input.project));
  }

  async listCommits(input: {
    readonly project: string;
    readonly query?: string | undefined;
    readonly path?: string | undefined;
    readonly since?: string | undefined;
    readonly until?: string | undefined;
    readonly limit?: number | undefined;
  }): Promise<readonly CommitV1[]> {
    const limit = normalizeLimit(input.limit);
    const raw = await this.requestJson(
      `/api/v4/projects/${encodeProject(input.project)}/repository/commits`,
      {
        ...(input.query !== undefined ? { search: input.query } : {}),
        ...(input.path !== undefined
          ? { path: assertSafeRepositoryPath(input.path) }
          : {}),
        ...(input.since !== undefined ? { since: input.since } : {}),
        ...(input.until !== undefined ? { until: input.until } : {}),
        per_page: String(limit),
      },
    );

    const items = Array.isArray(raw) ? raw : [];
    return items.slice(0, limit).map((item) => mapCommit(item, input.project));
  }

  async getHeadCommit(input: {
    readonly project: string;
    readonly ref: string;
  }): Promise<string> {
    const raw = await this.requestJson(
      `/api/v4/projects/${encodeProject(input.project)}/repository/commits/${encodeURIComponent(
        input.ref,
      )}`,
      {},
    );
    const record = readRecord(raw, "commit");
    return readString(record, "id") ?? input.ref;
  }

  async getDiff(input: {
    readonly project: string;
    readonly from: string;
    readonly to: string;
    readonly maxFiles: number;
    readonly maxPatchBytes: number;
  }): Promise<GitLabCompareDiff> {
    const raw = await this.requestJson(
      `/api/v4/projects/${encodeProject(input.project)}/repository/compare`,
      {
        from: input.from,
        to: input.to,
      },
    );
    const record = readRecord(raw, "compare");
    const commit =
      readString(readRecord(record.commit, "compare.commit"), "id") ?? input.to;
    const diffs = Array.isArray(record.diffs) ? record.diffs : [];
    const files = diffs
      .slice(0, input.maxFiles)
      .map((item) => mapDiffFile(item, input.maxPatchBytes));

    return {
      project: input.project,
      from: input.from,
      to: input.to,
      commit,
      files,
    };
  }

  async listPipelines(input: {
    readonly project: string;
    readonly ref?: string | undefined;
    readonly sha?: string | undefined;
    readonly status?: string | undefined;
    readonly limit?: number | undefined;
  }): Promise<readonly PipelineV1[]> {
    const limit = normalizeLimit(input.limit);
    const raw = await this.requestJson(
      `/api/v4/projects/${encodeProject(input.project)}/pipelines`,
      {
        ...(input.ref !== undefined ? { ref: input.ref } : {}),
        ...(input.sha !== undefined ? { sha: input.sha } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        per_page: String(limit),
      },
    );

    const items = Array.isArray(raw) ? raw : [];
    return items
      .slice(0, limit)
      .map((item) => mapPipeline(item, input.project));
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
      const response = await this.fetchImpl(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "PRIVATE-TOKEN": this.token,
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new CodeRetrievalRequestError(
          `GitLab responded with HTTP ${response.status}`,
          response.status,
        );
      }

      return (await response.json()) as unknown;
    } catch (error: unknown) {
      if (error instanceof CodeRetrievalRequestError) {
        throw error;
      }

      if (error instanceof Error && error.name === "AbortError") {
        throw new CodeRetrievalRequestError("GitLab request timed out");
      }

      throw new CodeRetrievalRequestError("GitLab request failed");
    } finally {
      clearTimeout(timeout);
    }
  }
}

function encodeProject(project: string): string {
  return encodeURIComponent(project);
}

function mapSearchHit(
  value: unknown,
  project: string,
  ref: string | undefined,
): GitLabSearchHit {
  const record = readRecord(value, "search hit");
  const path =
    readString(record, "path") ?? readString(record, "filename") ?? "unknown";
  return {
    project,
    path,
    ref: ref ?? readString(record, "ref") ?? "HEAD",
    startLine: readNumber(record, "startline") ?? 1,
    content: readString(record, "data") ?? "",
  };
}

function mapFileContent(
  value: unknown,
  project: string,
  path: string,
  ref: string,
): GitLabFileContent {
  const record = readRecord(value, "file content");
  const encoded = readString(record, "content") ?? "";
  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  return {
    project,
    path,
    ref,
    commit:
      readString(record, "commit_id") ??
      readString(record, "last_commit_id") ??
      ref,
    content: decoded,
  };
}

function mapTreeItem(
  value: unknown,
  project: string,
  ref: string,
): RepositoryTreeItemV1 {
  const record = readRecord(value, "tree item");
  const path = readString(record, "path") ?? "";
  const type = readString(record, "type") === "tree" ? "tree" : "blob";
  return {
    project,
    path,
    name: readString(record, "name") ?? path,
    type,
    ref,
  };
}

function mapMr(
  value: unknown,
  fallbackProject: string | undefined,
): MergeRequestV1 {
  const record = readRecord(value, "merge request");
  const project =
    fallbackProject ?? String(readNumber(record, "project_id") ?? "unknown");
  const iid = readNumber(record, "iid") ?? 0;
  return {
    source_ref: buildMrSourceRef(project, iid),
    project,
    iid,
    title: readString(record, "title") ?? "",
    state: readString(record, "state") ?? "",
    ...(readString(record, "updated_at") !== undefined
      ? { updated_at: readString(record, "updated_at") }
      : {}),
    ...(readString(record, "source_branch") !== undefined
      ? { source_branch: readString(record, "source_branch") }
      : {}),
    ...(readString(record, "target_branch") !== undefined
      ? { target_branch: readString(record, "target_branch") }
      : {}),
    ...(readString(record, "web_url") !== undefined
      ? { web_url: readString(record, "web_url") }
      : {}),
  };
}

function mapCommit(value: unknown, project: string): CommitV1 {
  const record = readRecord(value, "commit");
  const sha =
    readString(record, "id") ?? readString(record, "short_id") ?? "unknown";
  return {
    source_ref: buildCommitSourceRef(project, sha),
    project,
    sha,
    title: readString(record, "title") ?? "",
    ...(readString(record, "committed_date") !== undefined
      ? { committed_date: readString(record, "committed_date") }
      : {}),
    ...(readString(record, "web_url") !== undefined
      ? { web_url: readString(record, "web_url") }
      : {}),
  };
}

function mapDiffFile(value: unknown, maxPatchBytes: number): DiffFileV1 {
  const record = readRecord(value, "diff file");
  const patch = readString(record, "diff") ?? "";
  const truncatedPatch =
    Buffer.byteLength(patch, "utf8") <= maxPatchBytes
      ? patch
      : `${patch.slice(0, maxPatchBytes)}\n[truncated]`;
  return {
    old_path: readString(record, "old_path") ?? "",
    new_path: readString(record, "new_path") ?? "",
    patch: truncatedPatch,
    bytes: Buffer.byteLength(truncatedPatch, "utf8"),
    redacted: false,
  };
}

function mapPipeline(value: unknown, project: string): PipelineV1 {
  const record = readRecord(value, "pipeline");
  const id = readNumber(record, "id") ?? 0;
  const sha = readString(record, "sha") ?? "unknown";
  return {
    source_ref: buildPipelineSourceRef({ project, id, sha }),
    project,
    id,
    sha,
    ...(readString(record, "ref") !== undefined
      ? { ref: readString(record, "ref") }
      : {}),
    ...(readString(record, "status") !== undefined
      ? { status: readString(record, "status") }
      : {}),
    ...(readString(record, "updated_at") !== undefined
      ? { updated_at: readString(record, "updated_at") }
      : {}),
    ...(readString(record, "web_url") !== undefined
      ? { web_url: readString(record, "web_url") }
      : {}),
  };
}

function readRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new CodeRetrievalRequestError(`${label} response is invalid`);
  }

  return value as Record<string, unknown>;
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
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}
