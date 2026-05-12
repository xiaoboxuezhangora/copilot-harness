import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SqliteMemoryStore, createMemoryServer } from "../src/index.js";

interface TextContent {
  readonly type: "text";
  readonly text: string;
}

describe("memory MCP tools", () => {
  let tmpPath: string;
  let client: Client;
  let store: SqliteMemoryStore;

  beforeEach(async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "memory-mcp-"));
    tmpPath = join(tmpDir, "memory.sqlite");
    store = new SqliteMemoryStore({
      sqlitePath: tmpPath,
    });

    const mcpServer = createMemoryServer(store);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    client = new Client({
      name: "memory-test-client",
      version: "0.1.0",
    });

    await Promise.all([mcpServer.connect(serverTransport), client.connect(clientTransport)]);
  });

  afterEach(async () => {
    await client.close();
    store.close();
    rmSync(tmpPath, { force: true });
    rmSync(join(tmpPath, ".."), { force: true, recursive: true });
  });

  it("supports put -> get for decisions records", async () => {
    const put = await client.callTool(
      {
        name: "put",
        arguments: {
          namespace: "decisions",
          key: "blood-transfusion.double-check.required",
          value: "Double-check gate must remain explicit.",
          source_ref: "skills/.github/skills/blood-transfusion/SKILL.md",
          producer_agent: "investigator",
          confidence: 0.9,
          ttl_seconds: 600,
        },
      },
      CallToolResultSchema,
    );
    expect(put.isError).toBeFalsy();

    const get = await client.callTool(
      {
        name: "get",
        arguments: {
          namespace: "decisions",
          key: "blood-transfusion.double-check.required",
        },
      },
      CallToolResultSchema,
    );
    const payload = parseTextPayload(get.content);
    const record = getRecord(payload, "record");

    expect(record?.namespace).toBe("decisions");
    expect(record?.key).toBe("blood-transfusion.double-check.required");
    expect(record?.producer_agent).toBe("investigator");
  });

  it("supports put -> search for knowledge_index records", async () => {
    const put = await client.callTool(
      {
        name: "put",
        arguments: {
          namespace: "knowledge_index",
          key: "angular.table.width-source",
          value: "Header and body widths should be sourced from one column config.",
          trigger_description: "table header/body desync",
          source_ref: "skills/.github/skills/angular-delivery/SKILL.md",
        },
      },
      CallToolResultSchema,
    );
    expect(put.isError).toBeFalsy();

    const search = await client.callTool(
      {
        name: "search",
        arguments: {
          namespace: "knowledge_index",
          query: "column config",
          limit: 10,
        },
      },
      CallToolResultSchema,
    );
    const payload = parseTextPayload(search.content);
    const records = getArray(payload, "records");

    expect(records).toHaveLength(1);
    expect(records[0]?.key).toBe("angular.table.width-source");
  });

  it("supports manual alias put -> get", async () => {
    const put = await client.callTool(
      {
        name: "put",
        arguments: {
          namespace: "aliases",
          key: "btmis",
          value: "blood-transfusion-management-system",
          source_ref: "manual://review/2026-05-07/001",
          producer_agent: "human-reviewer",
          manual_entry: true,
        },
      },
      CallToolResultSchema,
    );
    expect(put.isError).toBeFalsy();

    const get = await client.callTool(
      {
        name: "get",
        arguments: {
          namespace: "aliases",
          key: "btmis",
        },
      },
      CallToolResultSchema,
    );
    const payload = parseTextPayload(get.content);
    const record = getRecord(payload, "record");

    expect(record?.namespace).toBe("aliases");
    expect(record?.value).toBe("blood-transfusion-management-system");
    expect(record?.producer_agent).toBe("human-reviewer");
  });

  it("rejects aliases put when manual_entry is missing", async () => {
    const result = await client.callTool(
      {
        name: "put",
        arguments: {
          namespace: "aliases",
          key: "iam",
          value: "identity-access-management",
          source_ref: "manual://review/2026-05-07/002",
          producer_agent: "human-reviewer",
        },
      },
      CallToolResultSchema,
    );

    expect(result.isError).toBe(true);
    const payload = parseTextPayload(result.content);
    const error = getRecord(payload, "error");
    expect(error?.code).toBe("VALIDATION_ERROR");
  });

  it("rejects redline content in put", async () => {
    const result = await client.callTool(
      {
        name: "put",
        arguments: {
          namespace: "knowledge_index",
          key: "forbidden-secret",
          value: "Authorization: Bearer top-secret-token",
          trigger_description: "token leak",
          source_ref: "unit-test",
        },
      },
      CallToolResultSchema,
    );

    expect(result.isError).toBe(true);
    const payload = parseTextPayload(result.content);
    const error = getRecord(payload, "error");
    const audit = getRecord(error, "audit");
    const ruleIds = getStringArray(audit, "rule_ids");

    expect(error?.code).toBe("REDLINE_VIOLATION");
    expect(ruleIds).toContain("authorization_bearer");
  });

  it("does not crash on empty list/search", async () => {
    const list = await client.callTool(
      {
        name: "list",
        arguments: {
          limit: 20,
          offset: 0,
        },
      },
      CallToolResultSchema,
    );
    const listPayload = parseTextPayload(list.content);
    expect(getArray(listPayload, "records")).toEqual([]);

    const search = await client.callTool(
      {
        name: "search",
        arguments: {
          query: "nothing",
          limit: 20,
        },
      },
      CallToolResultSchema,
    );
    const searchPayload = parseTextPayload(search.content);
    expect(getArray(searchPayload, "records")).toEqual([]);
  });

  it("finds same-namespace conflicts with deterministic lexical fallback", async () => {
    await client.callTool(
      {
        name: "put",
        arguments: {
          namespace: "decisions",
          key: "archive.status.standard",
          value: "Archive status labels must stay consistent across review screens.",
          source_ref: "manual://review/2026-05-09/001",
          producer_agent: "human-reviewer",
          confidence: 0.9,
        },
      },
      CallToolResultSchema,
    );

    const result = await client.callTool(
      {
        name: "findSimilarMemoryRecords",
        arguments: {
          namespace: "decisions",
          key: "archive.status.standard",
          value: "Archive status labels must stay consistent across review screens.",
          source_ref: "jira:CASE-1",
          producer_agent: "investigator",
          threshold: 0.85,
          embedding_provider: "deterministic_test",
        },
      },
      CallToolResultSchema,
    );

    expect(result.isError).toBeFalsy();
    const payload = parseTextPayload(result.content);
    const candidates = getArray(payload, "candidates");
    const candidateEmbedding = getRecord(payload, "candidate_embedding");
    const warnings = getStringArray(payload, "warnings");

    expect(payload.embedding_backend).toBe("fallback_lexical");
    expect(payload.embedding_provider).toBe("deterministic_test");
    expect(candidateEmbedding?.embedding_backend).toBe("fallback_lexical");
    expect(warnings).toContain("embedding_backend=fallback_lexical");
    expect(candidates[0]?.key).toBe("archive.status.standard");
    expect(candidates[0]?.similarity).toBeGreaterThanOrEqual(0.85);
  });

  it("rejects redline content before conflict embedding", async () => {
    const result = await client.callTool(
      {
        name: "findSimilarMemoryRecords",
        arguments: {
          namespace: "knowledge_index",
          key: "forbidden",
          value: "Authorization: Bearer top-secret-token",
          source_ref: "jira:CASE-2",
          trigger_description: "token leak",
        },
      },
      CallToolResultSchema,
    );

    expect(result.isError).toBe(true);
    const payload = parseTextPayload(result.content);
    const error = getRecord(payload, "error");
    expect(error?.code).toBe("REDLINE_VIOLATION");
  });

  it("returns hotIndex top N and excludes expired or redline records", async () => {
    store.put({
      namespace: "decisions",
      key: "hot-1",
      value: "High priority memory for review prompt.",
      source_ref: "gitlab:ops/app#file:src/hot.ts@abc#L1-L2",
      producer_agent: "human-reviewer",
      confidence: 0.95,
      ts: "2026-05-09T00:00:00.000Z",
    });
    store.put({
      namespace: "decisions",
      key: "expired",
      value: "Expired memory should not enter hot index.",
      source_ref: "manual://expired",
      producer_agent: "human-reviewer",
      confidence: 0.99,
      ts: "2026-01-01T00:00:00.000Z",
      expires_at: "2026-01-02T00:00:00.000Z",
    });
    store.put({
      namespace: "knowledge_index",
      key: "redline",
      value: "Authorization: Bearer top-secret-token",
      trigger_description: "redline",
      source_ref: "manual://redline",
      ts: "2026-05-09T00:00:00.000Z",
    });

    const hotIndex = await client.callTool(
      {
        name: "hotIndex",
        arguments: {
          limit: 1,
          max_summary_bytes: 80,
        },
      },
      CallToolResultSchema,
    );

    expect(hotIndex.isError).toBeFalsy();
    const payload = parseTextPayload(hotIndex.content);
    const records = getArray(payload, "records");
    const warnings = getStringArray(payload, "warnings");

    expect(records).toHaveLength(1);
    expect(records[0]?.key).toBe("hot-1");
    expect(records[0]?.summary).toBe("High priority memory for review prompt.");
    expect(records.map((record) => record.key)).not.toContain("expired");
    expect(warnings.some((warning) => warning.includes("redline"))).toBe(true);
  });

  it("updates hit_count, last_hit_at, and last_injected_at telemetry", async () => {
    store.put({
      namespace: "knowledge_index",
      key: "hit-me",
      value: "Searchable memory for hit telemetry.",
      trigger_description: "hit telemetry",
      source_ref: "manual://hit",
      ts: "2026-05-09T00:00:00.000Z",
    });

    await client.callTool(
      {
        name: "search",
        arguments: {
          namespace: "knowledge_index",
          query: "Searchable",
          limit: 5,
        },
      },
      CallToolResultSchema,
    );
    await client.callTool(
      {
        name: "hotIndex",
        arguments: {
          namespace: "knowledge_index",
          limit: 1,
        },
      },
      CallToolResultSchema,
    );
    const secondHotIndex = await client.callTool(
      {
        name: "hotIndex",
        arguments: {
          namespace: "knowledge_index",
          limit: 1,
        },
      },
      CallToolResultSchema,
    );

    const payload = parseTextPayload(secondHotIndex.content);
    const records = getArray(payload, "records");

    expect(records[0]?.hit_count).toBe(1);
    expect(typeof records[0]?.last_hit_at).toBe("string");
    expect(typeof records[0]?.last_injected_at).toBe("string");
  });
});

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
  return isRecord(value) && value.type === "text" && typeof value.text === "string";
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
): readonly Record<string, unknown>[] {
  if (record === undefined) {
    return [];
  }

  const value = record[key];
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is Record<string, unknown> => isRecord(item));
}

function getStringArray(
  record: Record<string, unknown> | undefined,
  key: string,
): readonly string[] {
  if (record === undefined) {
    return [];
  }

  const value = record[key];
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
