# memory MCP

Workspace package: `@copilot-harness/memory-mcp`

This package implements the W6-B local Memory MCP server with stdio transport.

## Tools

- `put`
- `get`
- `search`
- `list`

All tool input and output payloads are validated by zod.

## Storage

- Default SQLite path: `reports/memory.sqlite`
- Override with environment variable: `MEMORY_SQLITE_PATH`

The runtime SQLite file must not be committed.

## Safety

- `put` enforces memory redline checks and rejects forbidden content with
  MCP `isError: true` and auditable error codes/fields.

## Local Commands

```sh
pnpm --filter @copilot-harness/memory-mcp lint
pnpm --filter @copilot-harness/memory-mcp typecheck
pnpm --filter @copilot-harness/memory-mcp test
pnpm --filter @copilot-harness/memory-mcp build
```
