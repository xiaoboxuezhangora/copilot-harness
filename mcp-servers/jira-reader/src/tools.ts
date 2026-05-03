import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { toJiraReaderError } from "./errors.js";
import { MAX_SEARCH_LIMIT } from "./security.js";
import type { JiraClient } from "./jiraClient.js";

export const TOOL_NAMES = ["getIssue", "searchIssues", "getComments"] as const;

const issueKeySchema = z
  .string()
  .regex(/^[A-Z][A-Z0-9_]+-\d+$/, "Issue key must match PROJECT-123 format");

export const getIssueInputSchema = {
  issueKey: issueKeySchema,
};

export const searchIssuesInputSchema = {
  jql: z.string().min(1).max(512),
  maxResults: z.number().int().min(1).max(MAX_SEARCH_LIMIT).optional(),
};

export const getCommentsInputSchema = {
  issueKey: issueKeySchema,
};

export interface JiraReaderToolHandlers {
  readonly getIssue: (input: {
    readonly issueKey: string;
  }) => Promise<CallToolResult>;
  readonly searchIssues: (input: {
    readonly jql: string;
    readonly maxResults?: number | undefined;
  }) => Promise<CallToolResult>;
  readonly getComments: (input: {
    readonly issueKey: string;
  }) => Promise<CallToolResult>;
}

export function createJiraReaderToolHandlers(
  client: JiraClient,
): JiraReaderToolHandlers {
  return {
    getIssue: async ({ issueKey }) =>
      toToolResult("issue", async () => ({
        issue: await client.getIssue(issueKey),
      })),
    searchIssues: async ({ jql, maxResults }) =>
      toToolResult("search", async () => ({
        search: await client.searchIssues(jql, maxResults),
      })),
    getComments: async ({ issueKey }) =>
      toToolResult("comments", async () => ({
        comments: await client.getComments(issueKey),
      })),
  };
}

export function createJiraReaderServer(client: JiraClient): McpServer {
  const server = new McpServer({
    name: "jira-reader",
    version: "0.1.0",
  });
  const handlers = createJiraReaderToolHandlers(client);

  server.registerTool(
    "getIssue",
    {
      title: "Get Jira issue",
      description: "Read one Jira issue by key with a fixed field whitelist.",
      inputSchema: getIssueInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => handlers.getIssue(input),
  );

  server.registerTool(
    "searchIssues",
    {
      title: "Search Jira issues",
      description: `Read Jira issues using restricted JQL. maxResults is capped at ${MAX_SEARCH_LIMIT}.`,
      inputSchema: searchIssuesInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => handlers.searchIssues(input),
  );

  server.registerTool(
    "getComments",
    {
      title: "Get Jira comments",
      description: "Read comments for one Jira issue by key.",
      inputSchema: getCommentsInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => handlers.getComments(input),
  );

  return server;
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
    const readerError = toJiraReaderError(error);
    const payload = {
      error: {
        label,
        code: readerError.code,
        message: readerError.message,
        status: readerError.status,
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
