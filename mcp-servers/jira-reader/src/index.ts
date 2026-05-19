import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { loadConfigFromEnv } from "./config.js";
import { JiraClient } from "./jiraClient.js";
import { createJiraReaderServer } from "./tools.js";

export {
  emptyInputSchema,
  getFieldsInputSchema,
  getCommentsInputSchema,
  getIssueInputSchema,
  getIssueAttachmentContentInputSchema,
  getIssueAttachmentInputSchema,
  getIssueDetailsInputSchema,
  getProjectMetadataInputSchema,
  searchIssuesInputSchema,
  TOOL_NAMES,
  createJiraReaderServer,
  createJiraReaderToolHandlers,
} from "./tools.js";
export { JiraClient } from "./jiraClient.js";
export { loadConfigFromEnv } from "./config.js";
export { startMockJiraServer } from "./mockJiraServer.js";
export { JIRA_FIELD_WHITELIST, MAX_SEARCH_LIMIT } from "./security.js";
export type { MockJiraServer } from "./mockJiraServer.js";
export type {
  JiraAttachment,
  JiraAttachmentContent,
  JiraAttachmentMeta,
  JiraComment,
  JiraField,
  JiraIssueLink,
  JiraIssueRef,
  JiraIssueDetails,
  JiraIssueRelations,
  JiraIssue,
  JiraProjectMetadata,
  JiraRemoteLink,
  JiraSearchResult,
  JiraServerInfo,
  JiraTransition,
} from "./types.js";

export async function startStdioServer(): Promise<void> {
  const config = loadConfigFromEnv();
  const client = new JiraClient(config);
  const server = createJiraReaderServer(client);
  const transport = new StdioServerTransport();

  await server.connect(transport);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startStdioServer().catch((error: unknown) => {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to start Jira reader MCP";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
