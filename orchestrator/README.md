# orchestrator

TypeScript orchestration package for the `copilot-harness` monorepo.

## Commands

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm format:check
```

W1 only defines skeleton interfaces under `src/runtime`, `src/gates`, `src/context`, `src/memory`,
and `src/audit`. Runtime and MCP implementations start in W2.
