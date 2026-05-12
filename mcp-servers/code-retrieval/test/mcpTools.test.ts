import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";

import {
  GitLabClient,
  LocalRepository,
  TOOL_NAMES,
  buildGitLabFileSourceRef,
  buildLocalFileSourceRef,
  createCodeRetrievalServer,
  createCodeRetrievalToolHandlers,
} from "../src/index.js";

const execFileAsync = promisify(execFile);

interface TextContent {
  readonly type: "text";
  readonly text: string;
}

describe("code-retrieval MCP tools", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    for (const tempDir of tempDirs.splice(0)) {
      await rm(tempDir, {
        recursive: true,
        force: true,
      });
    }
  });

  it("exposes only read-only code retrieval tools", async () => {
    const server = createCodeRetrievalServer({
      gitlabClient: mockGitLabClient(),
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client({
      name: "code-retrieval-test-client",
      version: "0.1.0",
    });

    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);
      const tools = await client.listTools();

      expect(tools.tools.map((tool) => tool.name).sort()).toEqual(
        [...TOOL_NAMES].sort(),
      );
      expect(
        tools.tools.every((tool) => tool.annotations?.readOnlyHint === true),
      ).toBe(true);
      expect(
        tools.tools.every(
          (tool) => tool.annotations?.destructiveHint === false,
        ),
      ).toBe(true);
    } finally {
      await client.close();
    }
  });

  it("returns GitLab search context pack and stable source refs from a mock API", async () => {
    const handlers = createCodeRetrievalToolHandlers({
      gitlabClient: mockGitLabClient(),
      now: () => new Date("2026-05-08T10:00:00.000Z"),
    });

    const result = await handlers.searchCode({
      query: "needle",
      scope: "group/project",
      ref: "main",
      mode: "gitlab",
      limit: 3,
    });
    const payload = parseTextPayload(result.content);
    const contextPack = getRecord(payload, "context_pack");
    const results = getArray(contextPack, "search_results");

    expect(result.isError).toBeFalsy();
    expect(contextPack?.need_more_context).toBe(false);
    expect(results[0]).toMatchObject({
      provider: "gitlab",
      project: "group/project",
      path: "src/foo.ts",
      source_ref: buildGitLabFileSourceRef({
        project: "group/project",
        path: "src/foo.ts",
        commit: "abc123def456",
        startLine: 4,
        endLine: 6,
      }),
    });
  });

  it("reads bounded GitLab file slices and redacts sensitive content", async () => {
    const handlers = createCodeRetrievalToolHandlers({
      gitlabClient: mockGitLabClient(),
    });

    const result = await handlers.readFile({
      project: "group/project",
      path: "src/secret.ts",
      ref: "main",
      range: {
        start: 1,
        end: 3,
      },
    });
    const payload = parseTextPayload(result.content);
    const file = getRecord(payload, "file");

    expect(result.isError).toBeFalsy();
    expect(file?.redacted).toBe(true);
    expect(JSON.stringify(file)).not.toContain("top-secret-token");
    expect(file?.source_ref).toBe(
      buildGitLabFileSourceRef({
        project: "group/project",
        path: "src/secret.ts",
        commit: "abc123def456",
        startLine: 1,
        endLine: 3,
      }),
    );
  });

  it("uses local rg fallback while honoring gitignore and source refs", async () => {
    const repoRoot = await createLocalRepo();
    tempDirs.push(repoRoot);
    const handlers = createCodeRetrievalToolHandlers({
      localRepository: new LocalRepository({
        repoRoot,
        repoName: "local-repo",
      }),
      now: () => new Date("2026-05-08T10:00:00.000Z"),
    });

    const result = await handlers.searchCode({
      query: "needle",
      scope: "local-repo",
      mode: "local",
      limit: 10,
    });
    const payload = parseTextPayload(result.content);
    const contextPack = getRecord(payload, "context_pack");
    const results = getArray(contextPack, "search_results");
    const first = getRecordFromArray(results, 0);

    expect(result.isError).toBeFalsy();
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(first?.path).toBe("src/foo.ts");
    expect(first?.source_ref).toContain("local:local-repo#file:src/foo.ts@");
    expect(JSON.stringify(results)).not.toContain("ignored.ts");
  });

  it("redacts local rg fallback content before returning tool output", async () => {
    const repoRoot = await createLocalRepo();
    tempDirs.push(repoRoot);
    const handlers = createCodeRetrievalToolHandlers({
      localRepository: new LocalRepository({
        repoRoot,
        repoName: "local-repo",
      }),
    });

    const result = await handlers.searchCode({
      query: "top-secret-token",
      scope: "local-repo",
      mode: "local",
      limit: 10,
    });
    const payload = parseTextPayload(result.content);
    const contextPack = getRecord(payload, "context_pack");
    const first = getRecordFromArray(
      getArray(contextPack, "search_results"),
      0,
    );

    expect(first?.redacted).toBe(true);
    expect(JSON.stringify(first)).not.toContain("top-secret-token");
  });

  it("builds source ref examples for GitLab and local files", () => {
    expect(
      buildGitLabFileSourceRef({
        project: "group/project",
        path: "src/foo.ts",
        commit: "abc123",
        startLine: 10,
        endLine: 20,
      }),
    ).toBe("gitlab:group/project#file:src/foo.ts@abc123#L10-L20");
    expect(
      buildLocalFileSourceRef({
        repo: "local-repo",
        path: "src/foo.ts",
        sha: "def456",
        startLine: 1,
        endLine: 2,
      }),
    ).toBe("local:local-repo#file:src/foo.ts@def456#L1-L2");
  });
});

function mockGitLabClient(): GitLabClient {
  return new GitLabClient({
    baseUrl: "https://gitlab.example.test",
    token: "mock-readonly-token",
    requestTimeoutMs: 1_000,
    fetchImpl: async (url, init) => {
      if (init?.method !== "GET") {
        return jsonResponse({ message: "unsupported method" }, 405);
      }

      const parsed = new URL(
        typeof url === "string" || url instanceof URL ? url : url.url,
      );
      if (parsed.pathname.endsWith("/search")) {
        return jsonResponse([
          {
            path: "src/foo.ts",
            filename: "src/foo.ts",
            startline: 4,
            data: "export function findNeedle() {\n  return 'needle';\n}",
          },
        ]);
      }

      if (
        parsed.pathname.endsWith("/repository/commits/HEAD") ||
        parsed.pathname.endsWith("/repository/commits/main")
      ) {
        return jsonResponse({
          id: "abc123def456",
          title: "main head",
        });
      }

      if (parsed.pathname.includes("/repository/files/src%2Fsecret.ts")) {
        return jsonResponse({
          file_path: "src/secret.ts",
          commit_id: "abc123def456",
          content: Buffer.from(
            "const header = 'Authorization: Bearer top-secret-token';\nexport const value = header;\n",
            "utf8",
          ).toString("base64"),
        });
      }

      if (parsed.pathname.includes("/repository/files/src%2Ffoo.ts")) {
        return jsonResponse({
          file_path: "src/foo.ts",
          commit_id: "abc123def456",
          content: Buffer.from(
            "export const needle = true;\n",
            "utf8",
          ).toString("base64"),
        });
      }

      if (parsed.pathname.endsWith("/repository/tree")) {
        return jsonResponse([
          {
            name: "foo.ts",
            path: "src/foo.ts",
            type: "blob",
          },
        ]);
      }

      if (parsed.pathname.endsWith("/merge_requests")) {
        return jsonResponse([
          {
            iid: 7,
            title: "Read path",
            state: "opened",
            updated_at: "2026-05-08T10:00:00.000Z",
          },
        ]);
      }

      if (parsed.pathname.endsWith("/repository/commits")) {
        return jsonResponse([
          {
            id: "abc123def456",
            title: "Read commit",
          },
        ]);
      }

      if (parsed.pathname.endsWith("/repository/compare")) {
        return jsonResponse({
          commit: {
            id: "abc123def456",
          },
          diffs: [
            {
              old_path: "src/foo.ts",
              new_path: "src/foo.ts",
              diff: "@@ -1 +1 @@\n-export const a = 1;\n+export const a = 2;",
            },
          ],
        });
      }

      if (parsed.pathname.endsWith("/pipelines")) {
        return jsonResponse([
          {
            id: 10,
            sha: "abc123def456",
            ref: "main",
            status: "success",
          },
        ]);
      }

      return jsonResponse({ message: "not found" }, 404);
    },
  });
}

async function createLocalRepo(): Promise<string> {
  const repoRoot = await mkdtemp(join(tmpdir(), "code-retrieval-local-"));
  await mkdir(join(repoRoot, "src"), { recursive: true });
  await writeFile(join(repoRoot, ".gitignore"), "ignored.ts\n", "utf8");
  await writeFile(
    join(repoRoot, "src", "foo.ts"),
    [
      "export function localNeedle() {",
      "  const value = 'needle';",
      "  return value;",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    join(repoRoot, "ignored.ts"),
    "export const ignored = 'needle';\n",
    "utf8",
  );
  await writeFile(
    join(repoRoot, "src", "secret.ts"),
    "export const header = 'Authorization: Bearer top-secret-token';\n",
    "utf8",
  );
  await execFileAsync("git", ["init"], { cwd: repoRoot });
  await execFileAsync("git", ["config", "user.email", "test@example.invalid"], {
    cwd: repoRoot,
  });
  await execFileAsync("git", ["config", "user.name", "Test User"], {
    cwd: repoRoot,
  });
  await execFileAsync("git", ["add", "."], { cwd: repoRoot });
  await execFileAsync("git", ["commit", "-m", "initial"], { cwd: repoRoot });
  return repoRoot;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function parseTextPayload(content: unknown): Record<string, unknown> {
  if (!Array.isArray(content)) {
    throw new Error("Tool result did not include array content");
  }

  const first = content[0];
  if (!isTextContent(first)) {
    throw new Error("Tool result did not include text content");
  }

  const parsed: unknown = JSON.parse(first.text);
  if (!isRecord(parsed)) {
    throw new Error("Tool result text was not an object");
  }

  return parsed;
}

function isTextContent(value: unknown): value is TextContent {
  return (
    isRecord(value) && value.type === "text" && typeof value.text === "string"
  );
}

function getRecord(
  record: Record<string, unknown> | undefined,
  key: string,
): Record<string, unknown> | undefined {
  if (record === undefined) {
    return undefined;
  }

  const value = record[key];
  return isRecord(value) ? value : undefined;
}

function getArray(
  record: Record<string, unknown> | undefined,
  key: string,
): readonly unknown[] {
  if (record === undefined) {
    return [];
  }

  const value = record[key];
  return Array.isArray(value) ? value : [];
}

function getRecordFromArray(
  values: readonly unknown[],
  index: number,
): Record<string, unknown> | undefined {
  const value = values[index];
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
