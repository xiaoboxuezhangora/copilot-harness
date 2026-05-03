# ADR-0002: W2-A Runtime Contracts and Jira MCP Ownership

Status: Accepted

Date: 2026-04-27

## Context

W1 created `orchestrator/`, `skills/`, and `playbooks/` as top-level workstreams, with the pnpm
workspace local to `orchestrator/`. W2 introduces a future Jira reader MCP server under a new
top-level `mcp-servers/` workstream.

W2-A is limited to contracts and structure. It must not connect the real Copilot SDK, the Copilot
CLI, or a real Jira instance.

## Decision

- `orchestrator/src/runtime/types.ts` owns the stable W2-A `AgentRuntime`, `RunOptions`, and
  `EvidencePack` contracts.
- `EvidencePack` stays minimal: task id, intent, evidence entries, assumptions, and confidence.
  Requirement-to-code resolution is explicitly deferred.
- `mcp-servers/jira-reader/` is a workspace package named
  `@copilot-harness/jira-reader-mcp`.
- The pnpm workspace root is the repository root and includes `orchestrator` plus
  `mcp-servers/*`.
- Root CI installs the root workspace once, then runs root scripts that dispatch package-local
  lint, typecheck, format, and test commands.

## Consequences

Positive:

- Runtime contracts are available to orchestrator code without pulling SDK/Jira dependencies.
- Jira MCP ownership is visible to CODEOWNERS and CI before business logic starts.
- Future MCP packages can join the same `mcp-servers/*` workspace pattern.

Tradeoffs:

- W1 package-local lockfile/workspace ownership moves to the repository root.
- `mcp-servers/jira-reader` has only an ownership shell until W2-B implements tools.

## W2-B Preconditions

- Keep R9 model lock to `gpt-5-mini`.
- Add MCP SDK dependencies only when tool schemas are implemented.
- Add mock Jira fixtures before introducing live Jira configuration.
- Define Validator range checks for `EvidencePack.confidence`.
