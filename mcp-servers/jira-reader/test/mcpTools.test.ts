import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  JiraClient,
  TOOL_NAMES,
  createJiraReaderServer,
  createJiraReaderToolHandlers,
} from "../src/index.js";
import type { MockJiraServer } from "./mockJiraServer.js";
import { startMockJiraServer } from "./mockJiraServer.js";

interface TextContent {
  readonly type: "text";
  readonly text: string;
}

describe("jira-reader MCP tools", () => {
  let mockServer: MockJiraServer;
  let client: Client;

  beforeEach(async () => {
    mockServer = await startMockJiraServer();
    const jiraClient = new JiraClient({
      baseUrl: mockServer.baseUrl,
      projectAllowlist: ["OPS"],
      requestTimeoutMs: 1_000,
    });
    const mcpServer = createJiraReaderServer(jiraClient);
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    client = new Client({
      name: "jira-reader-test-client",
      version: "0.1.0",
    });

    await Promise.all([
      mcpServer.connect(serverTransport),
      client.connect(clientTransport),
    ]);
  });

  afterEach(async () => {
    await client.close();
    await mockServer.close();
  });

  it("exposes only the three read-only tools", async () => {
    const tools = await client.listTools();

    expect(tools.tools.map((tool) => tool.name).sort()).toEqual(
      [...TOOL_NAMES].sort(),
    );
    expect(
      tools.tools.every((tool) => tool.annotations?.readOnlyHint === true),
    ).toBe(true);
    expect(
      tools.tools.every((tool) => tool.annotations?.destructiveHint === false),
    ).toBe(true);
  });

  it("reads one issue through getIssue with whitelisted and redacted fields", async () => {
    const result = await client.callTool(
      {
        name: "getIssue",
        arguments: {
          issueKey: "OPS-1",
        },
      },
      CallToolResultSchema,
    );
    const payload = parseTextPayload(result.content);

    expect(JSON.stringify(payload)).not.toContain("@example.com");
    expect(JSON.stringify(payload)).not.toContain("10.20.30.40");
    expect(JSON.stringify(payload)).not.toContain("abc123");
    expect(payload).toMatchObject({
      issue: {
        key: "OPS-1",
        summary: "OPS-1 summary",
        status: "Open",
        priority: "High",
        project: {
          key: "OPS",
        },
      },
    });
    expect(getRecord(getRecord(payload, "issue"), "reporter")).toBeUndefined();
  });

  it("searches issues through restricted JQL", async () => {
    const result = await client.callTool(
      {
        name: "searchIssues",
        arguments: {
          jql: "project = OPS ORDER BY created DESC",
          maxResults: 2,
        },
      },
      CallToolResultSchema,
    );
    const payload = parseTextPayload(result.content);
    const search = getRecord(payload, "search");
    const issues = search?.issues;

    expect(Array.isArray(issues)).toBe(true);
    expect(issues).toHaveLength(2);
  });

  it("reads comments through getComments with sensitive content redacted", async () => {
    const result = await client.callTool(
      {
        name: "getComments",
        arguments: {
          issueKey: "OPS-1",
        },
      },
      CallToolResultSchema,
    );
    const payload = parseTextPayload(result.content);

    expect(JSON.stringify(payload)).not.toContain("@example.com");
    expect(JSON.stringify(payload)).not.toContain("10.20.30.40");
    expect(JSON.stringify(payload)).not.toContain("abc123");
    expect(payload).toMatchObject({
      comments: [
        {
          id: "10000",
          author: {
            name: "alice",
            displayName: "Alice Reviewer",
          },
        },
      ],
    });
  });

  it("returns MCP tool errors for Jira failures without closing the server", async () => {
    const result = await client.callTool(
      {
        name: "searchIssues",
        arguments: {
          jql: "project = OPS AND text ~ UNAVAILABLE",
          maxResults: 1,
        },
      },
      CallToolResultSchema,
    );

    expect(result.isError).toBe(true);
    expect(parseTextPayload(result.content)).toMatchObject({
      error: {
        code: "JIRA_REQUEST_ERROR",
        status: 503,
      },
    });

    const tools = await client.listTools();
    expect(tools.tools).toHaveLength(3);
  });

  it("maps unreachable Jira requests to tool errors", async () => {
    const closedMock = await startMockJiraServer();
    await closedMock.close();
    const handlers = createJiraReaderToolHandlers(
      new JiraClient({
        baseUrl: closedMock.baseUrl,
        projectAllowlist: ["OPS"],
        requestTimeoutMs: 100,
      }),
    );

    const result = await handlers.getIssue({
      issueKey: "OPS-1",
    });

    expect(result.isError).toBe(true);
    expect(parseTextPayload(result.content)).toMatchObject({
      error: {
        code: "JIRA_REQUEST_ERROR",
      },
    });
  });

  it("rejects JQL that escapes the project allowlist", async () => {
    const result = await client.callTool(
      {
        name: "searchIssues",
        arguments: {
          jql: "project = HR ORDER BY created DESC",
          maxResults: 1,
        },
      },
      CallToolResultSchema,
    );

    expect(result.isError).toBe(true);
    expect(parseTextPayload(result.content)).toMatchObject({
      error: {
        code: "POLICY_ERROR",
      },
    });
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
