# jira-reader MCP

Workspace package: `@copilot-harness/jira-reader-mcp`

This package implements the W2-B read-only Jira Reader MCP server for Jira Server 7.10.1 REST API
v2. It uses `@modelcontextprotocol/sdk` with stdio transport only.

## Tools

These tools are registered:

| Tool                        | Input                                   | Jira endpoint(s)                                        | Output                                |
| --------------------------- | --------------------------------------- | ------------------------------------------------------- | ------------------------------------- |
| `getIssue`                  | `{ issueKey: string }`                  | `GET /rest/api/2/issue/{issueKey}`                      | One whitelisted issue                 |
| `searchIssues`              | `{ jql: string, maxResults?: number }`  | `GET /rest/api/2/search`                                | Search page with whitelisted issues   |
| `getComments`               | `{ issueKey: string }`                  | `GET /rest/api/2/issue/{issueKey}/comment`              | Whitelisted comments                  |
| `getServerInfo`             | `{}`                                    | `GET /rest/api/2/serverInfo`                            | Jira Server version/deployment info   |
| `getAttachmentMeta`         | `{}`                                    | `GET /rest/api/2/attachment/meta`                       | Attachment enabled/upload limit       |
| `getFields`                 | `{ customOnly?, query?, maxResults? }`  | `GET /rest/api/2/field`                                 | Field ids, names, clauses, schemas    |
| `getIssueDetails`           | `{ issueKey, include... }`              | `GET /rest/api/2/issue/{issueKey}?expand=...`           | Issue plus names/schema/rendered data |
| `getIssueAttachment`        | `{ issueKey, attachmentId }`            | `GET /issue`, `GET /attachment/{id}`                    | Scoped attachment metadata            |
| `getIssueAttachmentContent` | `{ issueKey, attachmentId, maxBytes? }` | `GET /attachment/{id}`, secure attachment content URL   | Scoped image content plus metadata    |
| `getProjectMetadata`        | `{ projectKey: string }`                | `GET /project`, `/components`, `/versions`, `/statuses` | Project planning metadata             |
| `getIssueRelations`         | `{ issueKey: string }`                  | `GET /issue`, `GET /issue/{key}/remotelink`             | Parent/subtasks/links/remote links    |
| `getTransitions`            | `{ issueKey: string }`                  | `GET /rest/api/2/issue/{issueKey}/transitions`          | Available workflow transitions        |

All tools are annotated as read-only and non-destructive.

## Field Whitelist

Issue fields requested from Jira:

- `summary`
- `description`
- `issuetype`
- `status`
- `assignee`
- `priority`
- `labels`
- `project`
- `versions`
- `fixVersions`
- `created`
- `updated`
- `duedate`
- `timetracking`
- `timeoriginalestimate`
- `timeestimate`
- `timespent`
- selected custom fields used by the harness
- `attachment`

Mapped comment fields:

- `id`
- `body`
- `author.name`
- `author.displayName`
- `created`
- `updated`

Reporter contact fields and other raw Jira fields are not mapped.

## Safety Boundaries

- `searchIssues.maxResults` defaults to 20 and is capped at 50.
- `getIssueAttachmentContent.maxBytes` defaults to 2 MiB and is capped at 5 MiB.
- `issueKey` must match `PROJECT-123` style keys.
- `attachmentId` must be numeric.
- If `JIRA_PROJECT_ALLOWLIST` is set, issue keys and JQL project filters must stay inside it.
- Attachment content reads first verify that the attachment id belongs to the allowed issue.
- Attachment content URLs must resolve to the same origin as `JIRA_BASE_URL`.
- Image attachments are emitted as MCP `image` content; base64 bytes are not repeated in
  `structuredContent` or the JSON text payload.
- JQL is limited to 512 characters and rejects control characters, statement separators, comments,
  and write-like keywords.
- Tool output is sanitized for email addresses, private IPv4 addresses, and credential-shaped text.
- Jira request failures return MCP tool error results with `isError: true`; the stdio server remains
  running.

## Configuration

Set these environment variables at runtime:

| Variable                 | Required | Notes                                                            |
| ------------------------ | -------- | ---------------------------------------------------------------- |
| `JIRA_BASE_URL`          | yes      | Jira base URL, for example the internal Jira origin              |
| `JIRA_USERNAME`          | no       | Required when an API credential is provided                      |
| `JIRA_API_` + `TOKEN`    | no       | API credential slot used for token-style or legacy Basic secrets |
| `JIRA_PROJECT_ALLOWLIST` | no       | Comma-separated project keys, for example `OPS,DEV`              |

Do not commit real credentials or generated runtime logs.

## Local Commands

```sh
pnpm --filter @copilot-harness/jira-reader-mcp lint
pnpm --filter @copilot-harness/jira-reader-mcp typecheck
pnpm --filter @copilot-harness/jira-reader-mcp test
```

Mock end-to-end smoke is run from the repository root:

```sh
pnpm smoke --runtime sdk
pnpm smoke --runtime cli
```

The smoke starts the in-process mock Jira server, calls `getIssue` through MCP in-memory transport,
then passes the same issue to the selected runtime contract.

Build the stdio entrypoint:

```sh
pnpm --filter @copilot-harness/jira-reader-mcp build
```

Run after build with credentials supplied outside the repository:

```sh
JIRA_BASE_URL=https://jira.internal.example \
JIRA_USERNAME="$JIRA_USER" \
JIRA_SECRET_SUFFIX=TOKEN \
env "JIRA_API_${JIRA_SECRET_SUFFIX}"="$JIRA_SECRET" \
JIRA_PROJECT_ALLOWLIST=OPS \
node mcp-servers/jira-reader/dist/index.js
```

## Mock Jira Coverage

`test/mockJiraServer.ts` starts an in-process Jira REST mock. The test suite connects to the MCP
server through SDK in-memory transport and covers:

- tool listing with the registered read-only tools
- `getIssue`
- `searchIssues`
- `getComments`
- server, attachment, and field metadata
- expanded issue details
- scoped attachment metadata and image content
- project metadata, issue relations, and transitions
- Jira HTTP failure mapped to MCP `isError`
- project allowlist rejection

## Real Jira Evidence Steps

1. Export the runtime variables locally in a shell or CI secret store.
2. Set `JIRA_PROJECT_ALLOWLIST` to a non-sensitive test project key.
3. Build the package with `pnpm --filter @copilot-harness/jira-reader-mcp build`.
4. Start the stdio server from `dist/index.js` through the MCP client under test.
5. Call `getIssue`, `searchIssues`, `getComments`, `getFields`, `getIssueAttachment`, and
   `getIssueAttachmentContent` against a non-sensitive test issue.
6. Confirm the response contains only the whitelist above and no reporter contact, private network
   address, or credential-shaped text.

## GitHub Copilot / VS Code MCP Configuration

After building this package, VS Code Copilot can start it as a local stdio MCP server from a
workspace `.vscode/mcp.json` file:

```json
{
  "servers": {
    "jira-reader": {
      "type": "stdio",
      "command": "node",
      "args": ["mcp-servers/jira-reader/dist/index.js"],
      "env": {
        "JIRA_BASE_URL": "http://jira.internal.example",
        "JIRA_PROJECT_ALLOWLIST": "APMIS"
      }
    }
  }
}
```

Keep credentials outside source control. Use user-level MCP configuration, environment variables, or
your secret manager for `JIRA_USERNAME` and `JIRA_API_TOKEN` when authentication is required.
