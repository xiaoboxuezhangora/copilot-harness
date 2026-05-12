import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { toCodeRetrievalError } from "./errors.js";
import { GitLabClient } from "./gitlabClient.js";
import type { GitLabSearchHit } from "./gitlabClient.js";
import { LocalRepository } from "./localRepository.js";
import {
  DEFAULT_MAX_BYTES_PER_FILE,
  DEFAULT_MAX_DIFF_BYTES,
  DEFAULT_MAX_TOTAL_BYTES,
  assertSafeRepositoryPath,
  isExcludedPath,
  languageFromPath,
  normalizeByteLimit,
  normalizeLimit,
  sanitizeContent,
  sliceLines,
  truncateUtf8,
} from "./security.js";
import {
  buildCommitSourceRef,
  buildGitLabFileSourceRef,
  buildPipelineSourceRef,
  fileEvidenceRef,
} from "./sourceRef.js";
import type {
  CodeFileSliceV1,
  CodeSearchResultV1,
  DiffV1,
  GitLabContextPackV1,
} from "./types.js";

export const TOOL_NAMES = [
  "searchCode",
  "readFile",
  "listRepositoryTree",
  "listMergeRequests",
  "listCommits",
  "getDiff",
  "listPipelines",
] as const;

const modeSchema = z.enum(["auto", "gitlab", "local"]);
const rangeSchema = z.object({
  start: z.number().int().min(1),
  end: z.number().int().min(1),
});

export const searchCodeInputSchema = {
  query: z.string().min(1).max(512),
  scope: z.string().min(1).max(512),
  ref: z.string().min(1).max(256).optional(),
  limit: z.number().int().min(1).max(50).optional(),
  mode: modeSchema.optional(),
};

export const readFileInputSchema = {
  project: z.string().min(1).max(512),
  path: z.string().min(1).max(2048),
  ref: z.string().min(1).max(256),
  range: rangeSchema.optional(),
  maxBytesPerFile: z
    .number()
    .int()
    .min(1)
    .max(DEFAULT_MAX_TOTAL_BYTES)
    .optional(),
};

export const listRepositoryTreeInputSchema = {
  project: z.string().min(1).max(512),
  path: z.string().min(1).max(2048).optional(),
  ref: z.string().min(1).max(256).optional(),
  recursive: z.boolean().optional(),
  limit: z.number().int().min(1).max(50).optional(),
};

export const listMergeRequestsInputSchema = {
  project: z.string().min(1).max(512).optional(),
  query: z.string().min(1).max(512).optional(),
  state: z.enum(["opened", "closed", "locked", "merged", "all"]).optional(),
  updatedAfter: z.string().min(1).max(128).optional(),
  limit: z.number().int().min(1).max(50).optional(),
};

export const listCommitsInputSchema = {
  project: z.string().min(1).max(512),
  query: z.string().min(1).max(512).optional(),
  path: z.string().min(1).max(2048).optional(),
  since: z.string().min(1).max(128).optional(),
  until: z.string().min(1).max(128).optional(),
  limit: z.number().int().min(1).max(50).optional(),
};

export const getDiffInputSchema = {
  project: z.string().min(1).max(512),
  from: z.string().min(1).max(256),
  to: z.string().min(1).max(256),
  maxFiles: z.number().int().min(1).max(50).optional(),
  maxPatchBytes: z
    .number()
    .int()
    .min(1)
    .max(DEFAULT_MAX_TOTAL_BYTES)
    .optional(),
};

export const listPipelinesInputSchema = {
  project: z.string().min(1).max(512),
  ref: z.string().min(1).max(256).optional(),
  sha: z.string().min(1).max(128).optional(),
  status: z.string().min(1).max(64).optional(),
  limit: z.number().int().min(1).max(50).optional(),
};

const searchCodeValidator = z.object(searchCodeInputSchema);
const readFileValidator = z.object(readFileInputSchema);
const listRepositoryTreeValidator = z.object(listRepositoryTreeInputSchema);
const listMergeRequestsValidator = z.object(listMergeRequestsInputSchema);
const listCommitsValidator = z.object(listCommitsInputSchema);
const getDiffValidator = z.object(getDiffInputSchema);
const listPipelinesValidator = z.object(listPipelinesInputSchema);

export interface CodeRetrievalToolHandlers {
  readonly searchCode: (input: unknown) => Promise<CallToolResult>;
  readonly readFile: (input: unknown) => Promise<CallToolResult>;
  readonly listRepositoryTree: (input: unknown) => Promise<CallToolResult>;
  readonly listMergeRequests: (input: unknown) => Promise<CallToolResult>;
  readonly listCommits: (input: unknown) => Promise<CallToolResult>;
  readonly getDiff: (input: unknown) => Promise<CallToolResult>;
  readonly listPipelines: (input: unknown) => Promise<CallToolResult>;
}

export interface CodeRetrievalHandlerOptions {
  readonly gitlabClient?: GitLabClient | undefined;
  readonly localRepository?: LocalRepository | undefined;
  readonly now?: () => Date;
}

export function createCodeRetrievalToolHandlers(
  options: CodeRetrievalHandlerOptions,
): CodeRetrievalToolHandlers {
  const now = options.now ?? (() => new Date());

  return {
    searchCode: async (input) =>
      toToolResult("searchCode", async () => {
        const parsed = searchCodeValidator.parse(input);
        const limit = normalizeLimit(parsed.limit);
        const mode = parsed.mode ?? "auto";
        const warnings: string[] = [];
        let results: readonly CodeSearchResultV1[] = [];
        let fileSlices: readonly CodeFileSliceV1[] = [];

        if (mode !== "local" && options.gitlabClient !== undefined) {
          try {
            results = await searchGitLabCode({
              client: options.gitlabClient,
              project: parsed.scope,
              query: parsed.query,
              ref: parsed.ref,
              limit,
            });
          } catch (error: unknown) {
            if (mode === "gitlab") {
              throw error;
            }
            warnings.push("gitlab_search_unavailable");
          }
        }

        if (
          results.length === 0 &&
          mode !== "gitlab" &&
          options.localRepository !== undefined
        ) {
          results = await options.localRepository.searchCode({
            query: parsed.query,
            ref: parsed.ref,
            limit,
          });
        }

        results = enforceTotalBytes(results, DEFAULT_MAX_TOTAL_BYTES);
        fileSlices = results.map((result) => searchResultToFileSlice(result));

        const contextPack: GitLabContextPackV1 = {
          version: "GitLabContextPackV1",
          generated_at: now().toISOString(),
          query: parsed.query,
          scope: "blobs",
          ...(parsed.ref !== undefined ? { ref: parsed.ref } : {}),
          search_results: results,
          file_slices: fileSlices,
          evidence_refs: results.map((result) =>
            fileEvidenceRef({
              provider: result.provider,
              project: result.project,
              path: result.path,
              commit: result.commit,
              startLine: result.start_line,
              endLine: result.end_line,
              sourceRef: result.source_ref,
            }),
          ),
          need_more_context: results.length === 0,
          warnings,
        };

        return {
          ok: true,
          context_pack: contextPack,
        };
      }),
    readFile: async (input) =>
      toToolResult("readFile", async () => {
        const parsed = readFileValidator.parse(input);
        const maxBytesPerFile = normalizeByteLimit(
          parsed.maxBytesPerFile,
          DEFAULT_MAX_BYTES_PER_FILE,
          "maxBytesPerFile",
        );
        const file =
          options.gitlabClient !== undefined
            ? await readGitLabFile({
                client: options.gitlabClient,
                project: parsed.project,
                path: parsed.path,
                ref: parsed.ref,
                range: parsed.range,
                maxBytesPerFile,
              })
            : await readLocalFile({
                localRepository: requireLocalRepository(
                  options.localRepository,
                ),
                project: parsed.project,
                path: parsed.path,
                ref: parsed.ref,
                range: parsed.range,
                maxBytesPerFile,
              });

        return {
          ok: true,
          file,
        };
      }),
    listRepositoryTree: async (input) =>
      toToolResult("listRepositoryTree", async () => {
        const parsed = listRepositoryTreeValidator.parse(input);
        const client = requireGitLabClient(options.gitlabClient);
        return {
          ok: true,
          tree: await client.listRepositoryTree({
            project: parsed.project,
            path: parsed.path,
            ref: parsed.ref,
            recursive: parsed.recursive,
            limit: parsed.limit,
          }),
        };
      }),
    listMergeRequests: async (input) =>
      toToolResult("listMergeRequests", async () => {
        const parsed = listMergeRequestsValidator.parse(input);
        const client = requireGitLabClient(options.gitlabClient);
        return {
          ok: true,
          merge_requests: await client.listMergeRequests(parsed),
        };
      }),
    listCommits: async (input) =>
      toToolResult("listCommits", async () => {
        const parsed = listCommitsValidator.parse(input);
        const client = requireGitLabClient(options.gitlabClient);
        return {
          ok: true,
          commits: await client.listCommits(parsed),
        };
      }),
    getDiff: async (input) =>
      toToolResult("getDiff", async () => {
        const parsed = getDiffValidator.parse(input);
        const client = requireGitLabClient(options.gitlabClient);
        const maxPatchBytes = normalizeByteLimit(
          parsed.maxPatchBytes,
          DEFAULT_MAX_DIFF_BYTES,
          "maxPatchBytes",
        );
        const maxFiles = normalizeLimit(parsed.maxFiles);
        const diff = await client.getDiff({
          project: parsed.project,
          from: parsed.from,
          to: parsed.to,
          maxFiles,
          maxPatchBytes,
        });

        return {
          ok: true,
          diff: sanitizeDiff({
            source_ref: buildCommitSourceRef(parsed.project, diff.commit),
            project: parsed.project,
            from: parsed.from,
            to: parsed.to,
            files: diff.files,
            truncated: diff.files.length >= maxFiles,
          }),
        };
      }),
    listPipelines: async (input) =>
      toToolResult("listPipelines", async () => {
        const parsed = listPipelinesValidator.parse(input);
        const client = requireGitLabClient(options.gitlabClient);
        const pipelines = await client.listPipelines(parsed);
        return {
          ok: true,
          pipelines: pipelines.map((pipeline) => ({
            ...pipeline,
            source_ref: buildPipelineSourceRef({
              project: pipeline.project,
              id: pipeline.id,
              sha: pipeline.sha,
            }),
          })),
        };
      }),
  };
}

export function createCodeRetrievalServer(
  options: CodeRetrievalHandlerOptions,
): McpServer {
  const server = new McpServer({
    name: "code-retrieval",
    version: "0.1.0",
  });
  const handlers = createCodeRetrievalToolHandlers(options);
  const annotations = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  } as const;

  server.registerTool(
    "searchCode",
    {
      title: "Search code",
      description:
        "Read-only code search across GitLab blobs with local rg fallback.",
      inputSchema: searchCodeInputSchema,
      annotations,
    },
    async (input) => handlers.searchCode(input),
  );
  server.registerTool(
    "readFile",
    {
      title: "Read file slice",
      description: "Read a bounded source file slice with redline filtering.",
      inputSchema: readFileInputSchema,
      annotations,
    },
    async (input) => handlers.readFile(input),
  );
  server.registerTool(
    "listRepositoryTree",
    {
      title: "List repository tree",
      description: "List GitLab repository tree entries.",
      inputSchema: listRepositoryTreeInputSchema,
      annotations,
    },
    async (input) => handlers.listRepositoryTree(input),
  );
  server.registerTool(
    "listMergeRequests",
    {
      title: "List merge requests",
      description: "List GitLab merge requests with bounded filters.",
      inputSchema: listMergeRequestsInputSchema,
      annotations,
    },
    async (input) => handlers.listMergeRequests(input),
  );
  server.registerTool(
    "listCommits",
    {
      title: "List commits",
      description: "List GitLab commits with bounded filters.",
      inputSchema: listCommitsInputSchema,
      annotations,
    },
    async (input) => handlers.listCommits(input),
  );
  server.registerTool(
    "getDiff",
    {
      title: "Get compare diff",
      description: "Read a bounded GitLab compare diff.",
      inputSchema: getDiffInputSchema,
      annotations,
    },
    async (input) => handlers.getDiff(input),
  );
  server.registerTool(
    "listPipelines",
    {
      title: "List pipelines",
      description: "List GitLab pipelines with bounded filters.",
      inputSchema: listPipelinesInputSchema,
      annotations,
    },
    async (input) => handlers.listPipelines(input),
  );

  return server;
}

async function searchGitLabCode(input: {
  readonly client: GitLabClient;
  readonly project: string;
  readonly query: string;
  readonly ref?: string | undefined;
  readonly limit: number;
}): Promise<readonly CodeSearchResultV1[]> {
  const hits = await input.client.searchCode({
    project: input.project,
    query: input.query,
    ref: input.ref,
    limit: input.limit,
  });
  const commit = await input.client.getHeadCommit({
    project: input.project,
    ref: input.ref ?? "HEAD",
  });

  return hits
    .filter((hit) => !isExcludedPath(hit.path))
    .map((hit, index) =>
      gitLabHitToSearchResult(hit, commit, input.ref ?? hit.ref, index),
    );
}

function gitLabHitToSearchResult(
  hit: GitLabSearchHit,
  commit: string,
  ref: string,
  index: number,
): CodeSearchResultV1 {
  const content = truncateUtf8(hit.content, DEFAULT_MAX_BYTES_PER_FILE);
  const sanitized = sanitizeContent(content);
  const lineCount = content.split(/\r?\n/).length;
  const startLine = Math.max(1, hit.startLine);
  const endLine = startLine + Math.max(0, lineCount - 1);
  const sourceRef = buildGitLabFileSourceRef({
    project: hit.project,
    path: hit.path,
    commit,
    startLine,
    endLine,
  });

  return {
    source_ref: sourceRef,
    provider: "gitlab",
    project: hit.project,
    path: hit.path,
    ref,
    commit,
    start_line: startLine,
    end_line: endLine,
    language: languageFromPath(hit.path),
    score: 1 - index / 100,
    symbol_kind: "line_slice",
    content: sanitized.content,
    redacted: sanitized.redacted,
    ...(sanitized.reason !== undefined
      ? { redaction_reason: sanitized.reason }
      : {}),
  };
}

async function readGitLabFile(input: {
  readonly client: GitLabClient;
  readonly project: string;
  readonly path: string;
  readonly ref: string;
  readonly range?: { readonly start: number; readonly end: number } | undefined;
  readonly maxBytesPerFile: number;
}): Promise<CodeFileSliceV1> {
  const file = await input.client.readFile({
    project: input.project,
    path: input.path,
    ref: input.ref,
  });
  const sliced = sliceLines(file.content, input.range);
  const limited = truncateUtf8(sliced.content, input.maxBytesPerFile);
  const sanitized = sanitizeContent(limited);
  const sourceRef = buildGitLabFileSourceRef({
    project: input.project,
    path: file.path,
    commit: file.commit,
    startLine: sliced.startLine,
    endLine: sliced.endLine,
  });

  return {
    source_ref: sourceRef,
    provider: "gitlab",
    project: input.project,
    path: file.path,
    ref: file.ref,
    commit: file.commit,
    start_line: sliced.startLine,
    end_line: sliced.endLine,
    content: sanitized.content,
    bytes: Buffer.byteLength(sanitized.content, "utf8"),
    redacted: sanitized.redacted,
    ...(sanitized.reason !== undefined
      ? { redaction_reason: sanitized.reason }
      : {}),
  };
}

async function readLocalFile(input: {
  readonly localRepository: LocalRepository;
  readonly project: string;
  readonly path: string;
  readonly ref: string;
  readonly range?: { readonly start: number; readonly end: number } | undefined;
  readonly maxBytesPerFile: number;
}): Promise<CodeFileSliceV1> {
  if (input.project !== input.localRepository.repoName) {
    throw new Error(
      "local repository project does not match configured repo name",
    );
  }

  return input.localRepository.readFile({
    path: assertSafeRepositoryPath(input.path),
    ref: input.ref,
    maxBytesPerFile: input.maxBytesPerFile,
    ...(input.range !== undefined ? { range: input.range } : {}),
  });
}

function searchResultToFileSlice(result: CodeSearchResultV1): CodeFileSliceV1 {
  return {
    source_ref: result.source_ref,
    provider: result.provider,
    project: result.project,
    path: result.path,
    ref: result.ref,
    commit: result.commit,
    start_line: result.start_line,
    end_line: result.end_line,
    content: result.content,
    bytes: Buffer.byteLength(result.content, "utf8"),
    redacted: result.redacted,
    ...(result.redaction_reason !== undefined
      ? { redaction_reason: result.redaction_reason }
      : {}),
  };
}

function enforceTotalBytes(
  results: readonly CodeSearchResultV1[],
  maxTotalBytes: number,
): readonly CodeSearchResultV1[] {
  const kept: CodeSearchResultV1[] = [];
  let totalBytes = 0;

  for (const result of results) {
    const bytes = Buffer.byteLength(result.content, "utf8");
    if (totalBytes + bytes > maxTotalBytes) {
      break;
    }

    kept.push(result);
    totalBytes += bytes;
  }

  return kept;
}

function sanitizeDiff(diff: DiffV1): DiffV1 {
  return {
    ...diff,
    files: diff.files.map((file) => {
      const sanitized = sanitizeContent(file.patch);
      return {
        ...file,
        patch: sanitized.content,
        bytes: Buffer.byteLength(sanitized.content, "utf8"),
        redacted: sanitized.redacted,
        ...(sanitized.reason !== undefined
          ? { redaction_reason: sanitized.reason }
          : {}),
      };
    }),
  };
}

function requireGitLabClient(client: GitLabClient | undefined): GitLabClient {
  if (client === undefined) {
    throw new Error("GitLab client is not configured");
  }

  return client;
}

function requireLocalRepository(
  localRepository: LocalRepository | undefined,
): LocalRepository {
  if (localRepository === undefined) {
    throw new Error("Local repository is not configured");
  }

  return localRepository;
}

async function toToolResult(
  label: string,
  operation: () => Promise<Record<string, unknown>>,
): Promise<CallToolResult> {
  try {
    const payload = await operation();
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(payload),
        },
      ],
      structuredContent: payload,
    };
  } catch (error: unknown) {
    const retrievalError = toCodeRetrievalError(error);
    const payload = {
      error: {
        label,
        code: retrievalError.code,
        message: retrievalError.message,
        ...(retrievalError.status !== undefined
          ? { status: retrievalError.status }
          : {}),
      },
    };

    return {
      isError: true,
      content: [
        {
          type: "text",
          text: JSON.stringify(payload),
        },
      ],
      structuredContent: payload,
    };
  }
}
