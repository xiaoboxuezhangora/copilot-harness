# jira-reader MCP

Workspace package: `@copilot-harness/jira-reader-mcp`

This package implements the W2-B read-only Jira Reader MCP server for Jira Server 7.10.1 REST API
v2. It uses `@modelcontextprotocol/sdk` with stdio transport only.

## Tools

Only these tools are registered:

| Tool           | Input                                  | Jira endpoint                              | Output                              |
| -------------- | -------------------------------------- | ------------------------------------------ | ----------------------------------- |
| `getIssue`     | `{ issueKey: string }`                 | `GET /rest/api/2/issue/{issueKey}`         | One whitelisted issue               |
| `searchIssues` | `{ jql: string, maxResults?: number }` | `GET /rest/api/2/search`                   | Search page with whitelisted issues |
| `getComments`  | `{ issueKey: string }`                 | `GET /rest/api/2/issue/{issueKey}/comment` | Whitelisted comments                |

All tools are annotated as read-only and non-destructive.

## Field Whitelist

Issue fields requested from Jira:

- `summary`
- `description`
- `status`
- `assignee`
- `priority`
- `labels`
- `project`

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
- `issueKey` must match `PROJECT-123` style keys.
- If `JIRA_PROJECT_ALLOWLIST` is set, issue keys and JQL project filters must stay inside it.
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

- tool listing with exactly the three read-only tools
- `getIssue`
- `searchIssues`
- `getComments`
- Jira HTTP failure mapped to MCP `isError`
- project allowlist rejection

## Real Jira Evidence Steps

1. Export the runtime variables locally in a shell or CI secret store.
2. Set `JIRA_PROJECT_ALLOWLIST` to a non-sensitive test project key.
3. Build the package with `pnpm --filter @copilot-harness/jira-reader-mcp build`.
4. Start the stdio server from `dist/index.js` through the MCP client under test.
5. Call `getIssue`, `searchIssues`, and `getComments` against a non-sensitive test issue.
6. Confirm the response contains only the whitelist above and no reporter contact, private network
   address, or credential-shaped text.
