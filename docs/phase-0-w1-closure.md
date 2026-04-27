# Phase 0 W1 Closure Note

Date: 2026-04-27

GitLab repository: <http://10.100.77.238/b.w_neu/copilot-harness>

## Adjusted Acceptance

W1 is closed as a monorepo rather than three separate repositories. See
`docs/adr/0001-w1-monorepo.md`.

Accepted delivery shape:

- One GitLab repository: `copilot-harness`
- Top-level workstreams: `orchestrator/`, `skills/`, `playbooks/`
- Root CI entrypoint: `.gitlab-ci.yml`
- Root ownership file: `CODEOWNERS`
- Package-local TypeScript project: `orchestrator/`

## Local Evidence

Run from `orchestrator/`:

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm format:check
```

Expected W1 result:

- ESLint: pass
- TypeScript: pass
- Vitest smoke: pass
- Prettier check: pass
- `AGENTS.md`: 60 lines or fewer
- `src/runtime`, `src/gates`, `src/context`, `src/memory`, `src/audit`: present

## GitLab Evidence To Attach

These cannot be truthfully generated from the local workspace alone:

- First MR URL after pushing the W1 branch.
- Green GitLab pipeline URL or screenshot after Runner execution.
- Branch protection screenshot after GitLab Settings are updated.

Attach those links or screenshots to the W1 MR before marking the Notion checklist fully done.
