# W2 Acceptance Report

Date: 2026-04-28
Branch: w2
Commit: (fill after commit)

## Mock Smoke Results

Mock smoke is mandatory for W2 acceptance.

```sh
pnpm smoke --runtime sdk
pnpm smoke --runtime cli
```

Attach both JSON outputs. Each output must include:

- `taskId`
- `turnState`
- `jiraIssue`
- `auditTraceId`
- `model`
- `runtime`
- `reasoningEffort`
- `capabilities`

## Jira Reader MCP

Fields admitted from Jira:

- Issue: `summary`, `description`, `status`, `assignee`, `priority`, `labels`, `project`
- Comments: `id`, `body`, `author.name`, `author.displayName`, `created`, `updated`

Tools:

- `getIssue(issueKey)`
- `searchIssues(jql, maxResults?)`
- `getComments(issueKey)`

## Runtime Capability Evidence

Record current SDK/CLI capability differences:

- SDK package version:
- SDK session support:
- SDK MCP support:
- SDK hook support:
- SDK reasoning effort support:
- CLI path/version:
- CLI headless prompt support:
- CLI MCP config support:
- CLI reasoning effort support:

## Real Jira Evidence

Real Jira output is internal supplemental evidence. It must not block W2 if mock smoke passes.

Run the one-shot verification script (credentials stay in shell env, never written to disk):

```sh
cd orchestrator
pnpm tsx ../scripts/w2-jira-verify.ts
```

The script exercises all 3 MCP tools against project APMIS with JQL:

```
project = APMIS AND status = 处理中 AND assignee in (currentUser()) ORDER BY cf[13301] ASC, updated DESC
```

Verification steps (automated by script):

1. Load config from env, restrict `JIRA_PROJECT_ALLOWLIST` to `APMIS`.
2. `searchIssues` — direct JiraClient call with real JQL (max 5).
3. `getIssue` — fetch first result by key.
4. `getComments` — fetch comments for same issue.
5. MCP round-trip — repeat steps 2-4 through `createJiraReaderServer` + InMemoryTransport.
6. Sanitization spot-check — confirm emails and private IPs are redacted in all outputs.

Paste the script's JSON output below (it is already sanitized):

```json
{
  "verdict": "PASS",
  "timestamp": "2026-04-28T02:40:41.606Z",
  "steps": [
    { "step": "1-config", "ok": true, "detail": { "baseUrl": "[redacted-jira-url]", "projectAllowlist": ["APMIS"] } },
    { "step": "2-searchIssues-direct", "ok": true, "detail": { "total": 10, "returned": 5, "firstIssueKey": "APMIS-1004", "firstIssueStatus": "处理中" } },
    { "step": "3-getIssue-direct", "ok": true, "detail": { "key": "APMIS-1004", "status": "处理中", "priority": "低", "project": { "key": "APMIS" }, "descriptionLength": 65 } },
    { "step": "4-getComments-direct", "ok": true, "detail": { "issueKey": "APMIS-1004", "commentCount": 0 } },
    { "step": "5-mcp-searchIssues", "ok": true, "detail": { "total": 10, "returned": 3 } },
    { "step": "6-mcp-getIssue", "ok": true, "detail": { "key": "APMIS-1004", "status": "处理中", "priority": "低" } },
    { "step": "7-mcp-getComments", "ok": true, "detail": { "commentCount": 0 } },
    { "step": "8-sanitization-check", "ok": true, "detail": "All outputs passed sanitizeText/sanitizeUnknown" }
  ]
}
```

Evidence notes:

- Jira instance: internal (Jira 7.10.1), Basic Auth, read-only account
- Project: APMIS (新手麻), 10 issues matched JQL filter
- 3 MCP tools verified: `getIssue`, `searchIssues`, `getComments`
- Direct JiraClient path and MCP InMemoryTransport path both returned consistent results
- No email, private IP, or credential-shaped text in output (sanitization confirmed)
- GitLab pipeline proof: deferred until runner enabled

## Quality Gates

```sh
pnpm --dir orchestrator lint
pnpm --dir orchestrator typecheck
pnpm --dir orchestrator test
pnpm smoke --runtime sdk
pnpm smoke --runtime cli
rg ": any|catch \\(.*: any" orchestrator mcp-servers
rg "JIRA_API_TOKEN|JIRA_PASSWORD|password|Authorization" orchestrator mcp-servers
rg "gpt-5-mini" orchestrator mcp-servers
```

## Open Items

- Item: GitLab CI pipeline green screenshot
- Reason: GitLab Runner not yet assigned to project
- Blocks W2 acceptance: no (deferred, CI opt-in via `ENABLE_GITLAB_CI=1`)

- Item: Copilot SDK/CLI real execution evidence
- Reason: Requires local Copilot login + external execution permission
- Blocks W2 acceptance: no (mock smoke covers contract compliance)
