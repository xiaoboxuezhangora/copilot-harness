import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { toJiraReaderError } from "./errors.js";
import { MAX_ATTACHMENT_MAX_BYTES, MAX_SEARCH_LIMIT } from "./security.js";
import type { JiraClient } from "./jiraClient.js";
import type { JiraAttachmentContent } from "./types.js";

type ToolContent = NonNullable<CallToolResult["content"]>[number];

export const TOOL_NAMES = [
  "getIssue",
  "searchIssues",
  "getComments",
  "getServerInfo",
  "getAttachmentMeta",
  "getFields",
  "getIssueDetails",
  "getIssueAttachment",
  "getIssueAttachmentContent",
  "getProjectMetadata",
  "getIssueRelations",
  "getTransitions",
] as const;

const issueKeySchema = z
  .string()
  .regex(/^[A-Z][A-Z0-9_]+-\d+$/, "Issue key must match PROJECT-123 format");
const projectKeySchema = z
  .string()
  .regex(/^[A-Z][A-Z0-9_]+$/, "Project key must be uppercase");
const attachmentIdSchema = z
  .string()
  .regex(/^\d+$/, "Attachment id must be numeric");

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

export const emptyInputSchema = {};

export const getFieldsInputSchema = {
  customOnly: z.boolean().optional(),
  query: z.string().min(1).max(80).optional(),
  maxResults: z.number().int().min(1).max(MAX_SEARCH_LIMIT).optional(),
};

export const getIssueDetailsInputSchema = {
  issueKey: issueKeySchema,
  includeRenderedFields: z.boolean().optional(),
  includeChangelog: z.boolean().optional(),
  maxChangelogEntries: z.number().int().min(1).max(MAX_SEARCH_LIMIT).optional(),
};

export const getIssueAttachmentInputSchema = {
  issueKey: issueKeySchema,
  attachmentId: attachmentIdSchema,
};

export const getIssueAttachmentContentInputSchema = {
  issueKey: issueKeySchema,
  attachmentId: attachmentIdSchema,
  maxBytes: z.number().int().min(1).max(MAX_ATTACHMENT_MAX_BYTES).optional(),
};

export const getProjectMetadataInputSchema = {
  projectKey: projectKeySchema,
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
  readonly getServerInfo: () => Promise<CallToolResult>;
  readonly getAttachmentMeta: () => Promise<CallToolResult>;
  readonly getFields: (input: {
    readonly customOnly?: boolean | undefined;
    readonly query?: string | undefined;
    readonly maxResults?: number | undefined;
  }) => Promise<CallToolResult>;
  readonly getIssueDetails: (input: {
    readonly issueKey: string;
    readonly includeRenderedFields?: boolean | undefined;
    readonly includeChangelog?: boolean | undefined;
    readonly maxChangelogEntries?: number | undefined;
  }) => Promise<CallToolResult>;
  readonly getIssueAttachment: (input: {
    readonly issueKey: string;
    readonly attachmentId: string;
  }) => Promise<CallToolResult>;
  readonly getIssueAttachmentContent: (input: {
    readonly issueKey: string;
    readonly attachmentId: string;
    readonly maxBytes?: number | undefined;
  }) => Promise<CallToolResult>;
  readonly getProjectMetadata: (input: {
    readonly projectKey: string;
  }) => Promise<CallToolResult>;
  readonly getIssueRelations: (input: {
    readonly issueKey: string;
  }) => Promise<CallToolResult>;
  readonly getTransitions: (input: {
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
    getServerInfo: async () =>
      toToolResult("serverInfo", async () => ({
        serverInfo: await client.getServerInfo(),
      })),
    getAttachmentMeta: async () =>
      toToolResult("attachmentMeta", async () => ({
        attachmentMeta: await client.getAttachmentMeta(),
      })),
    getFields: async ({ customOnly, query, maxResults }) =>
      toToolResult("fields", async () => ({
        fields: await client.getFields({ customOnly, query, maxResults }),
      })),
    getIssueDetails: async ({
      issueKey,
      includeRenderedFields,
      includeChangelog,
      maxChangelogEntries,
    }) =>
      toToolResult("issueDetails", async () => ({
        issueDetails: await client.getIssueDetails({
          issueKey,
          includeRenderedFields,
          includeChangelog,
          maxChangelogEntries,
        }),
      })),
    getIssueAttachment: async ({ issueKey, attachmentId }) =>
      toToolResult("issueAttachment", async () => ({
        attachment: await client.getIssueAttachment(issueKey, attachmentId),
      })),
    getIssueAttachmentContent: async ({ issueKey, attachmentId, maxBytes }) =>
      toToolResultWithAttachmentContent("issueAttachmentContent", async () => ({
        attachmentContent: await client.getIssueAttachmentContent(
          issueKey,
          attachmentId,
          maxBytes,
        ),
      })),
    getProjectMetadata: async ({ projectKey }) =>
      toToolResult("projectMetadata", async () => ({
        projectMetadata: await client.getProjectMetadata(projectKey),
      })),
    getIssueRelations: async ({ issueKey }) =>
      toToolResult("issueRelations", async () => ({
        issueRelations: await client.getIssueRelations(issueKey),
      })),
    getTransitions: async ({ issueKey }) =>
      toToolResult("transitions", async () => ({
        transitions: await client.getTransitions(issueKey),
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

  server.registerTool(
    "getServerInfo",
    {
      title: "Get Jira server info",
      description: "Read Jira Server version and deployment metadata.",
      inputSchema: emptyInputSchema,
      annotations: readOnlyAnnotations(),
    },
    async () => handlers.getServerInfo(),
  );

  server.registerTool(
    "getAttachmentMeta",
    {
      title: "Get Jira attachment settings",
      description: "Read whether attachments are enabled and the upload limit.",
      inputSchema: emptyInputSchema,
      annotations: readOnlyAnnotations(),
    },
    async () => handlers.getAttachmentMeta(),
  );

  server.registerTool(
    "getFields",
    {
      title: "Get Jira fields",
      description:
        "Read Jira field metadata, including custom field ids and names.",
      inputSchema: getFieldsInputSchema,
      annotations: readOnlyAnnotations(),
    },
    async (input) => handlers.getFields(input),
  );

  server.registerTool(
    "getIssueDetails",
    {
      title: "Get Jira issue details",
      description:
        "Read one issue with field names/schema and optional rendered fields or changelog.",
      inputSchema: getIssueDetailsInputSchema,
      annotations: readOnlyAnnotations(),
    },
    async (input) => handlers.getIssueDetails(input),
  );

  server.registerTool(
    "getIssueAttachment",
    {
      title: "Get Jira issue attachment",
      description:
        "Read attachment metadata after verifying the attachment belongs to the issue.",
      inputSchema: getIssueAttachmentInputSchema,
      annotations: readOnlyAnnotations(),
    },
    async (input) => handlers.getIssueAttachment(input),
  );

  server.registerTool(
    "getIssueAttachmentContent",
    {
      title: "Get Jira issue attachment content",
      description:
        "Read image attachment bytes after verifying the attachment belongs to the issue.",
      inputSchema: getIssueAttachmentContentInputSchema,
      annotations: readOnlyAnnotations(),
    },
    async (input) => handlers.getIssueAttachmentContent(input),
  );

  server.registerTool(
    "getProjectMetadata",
    {
      title: "Get Jira project metadata",
      description:
        "Read project, component, version, and status metadata for an allowed project.",
      inputSchema: getProjectMetadataInputSchema,
      annotations: readOnlyAnnotations(),
    },
    async (input) => handlers.getProjectMetadata(input),
  );

  server.registerTool(
    "getIssueRelations",
    {
      title: "Get Jira issue relations",
      description:
        "Read parent, subtasks, issue links, and remote links for one issue.",
      inputSchema: getIssueInputSchema,
      annotations: readOnlyAnnotations(),
    },
    async (input) => handlers.getIssueRelations(input),
  );

  server.registerTool(
    "getTransitions",
    {
      title: "Get Jira issue transitions",
      description: "Read available workflow transitions for one issue.",
      inputSchema: getIssueInputSchema,
      annotations: readOnlyAnnotations(),
    },
    async (input) => handlers.getTransitions(input),
  );

  return server;
}

function readOnlyAnnotations(): {
  readonly readOnlyHint: true;
  readonly destructiveHint: false;
  readonly idempotentHint: true;
  readonly openWorldHint: true;
} {
  return {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  };
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

async function toToolResultWithAttachmentContent(
  label: string,
  operation: () => Promise<{
    readonly attachmentContent: JiraAttachmentContent;
  }>,
): Promise<CallToolResult> {
  try {
    const payload = await operation();
    const { base64, ...metadata } = payload.attachmentContent;
    const textPayload = {
      attachmentContent: metadata,
    };
    const content: ToolContent[] = [
      {
        type: "text",
        text: JSON.stringify(textPayload),
      },
    ];

    if (metadata.mimeType.startsWith("image/")) {
      content.push({
        type: "image",
        data: base64,
        mimeType: metadata.mimeType,
      });
    }

    return {
      content,
      structuredContent: textPayload,
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
