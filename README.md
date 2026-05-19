# copilot-harness

GitLab repository: <http://10.100.77.238/b.w_neu/copilot-harness>

This repository is the monorepo for the Copilot automation harness. The original W1 plan
expected three GitLab repositories. The accepted W1 adjustment is to manage all Phase 0
artifacts in one repository and keep `orchestrator`, `skills`, and `playbooks` as top-level
workstreams.

## Repository Layout

| Path                         | Purpose                                                        | W1 status               |
| ---------------------------- | -------------------------------------------------------------- | ----------------------- |
| `orchestrator/`              | TypeScript orchestration service skeleton                      | Active package          |
| `mcp-servers/jira-reader/`   | Read-only Jira MCP server                                      | W2 implementation       |
| `skills/`                    | Agent Skill assets under `.github/skills/`                     | Bootstrap placeholders  |
| `playbooks/`                 | Ordered workflow playbooks under `.github/playbooks/`          | Bootstrap placeholder   |
| `docs/framework/`            | Curated framework docs from Notion planning and local evidence | Current framework index |
| `docs/adr/`                  | Architecture decisions for repository and delivery shape       | Monorepo ADRs           |
| `docs/phase-0-w1-closure.md` | W1 completion evidence and remaining GitLab proof              | W1 closure note         |

## W1 Acceptance Shape

W1 is accepted as a monorepo delivery:

- One GitLab repository: `copilot-harness`
- Three top-level workstreams: `orchestrator/`, `skills/`, `playbooks/`
- Root CI dispatches validation into `orchestrator/`
- Root `CODEOWNERS` owns each workstream explicitly
- ADR documents the reason to defer repository splitting

Repository splitting remains available later if Skill publishing, independent permissions, or
cross-project release cadence requires it.

## Local Validation

Run the current quality gate from the repository root:

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm format:check
```

The W2-A acceptance gate can still target the orchestrator package directly:

```sh
pnpm --dir orchestrator lint
pnpm --dir orchestrator typecheck
pnpm --dir orchestrator test
```

The root GitLab CI installs the root pnpm workspace and dispatches package quality gates through
root scripts. Until a GitLab Runner is assigned to the project, the pipeline is opt-in through
`ENABLE_GITLAB_CI=1` so W2 feature work is not blocked by pending jobs.

## Key Documents

- [Documentation index](docs/README.md)
- [Framework documentation](docs/framework/README.md)
- [Notion source map](docs/framework/01-notion-source-map.md)
- [Market benchmark and adopted decisions](docs/framework/02-market-benchmark-and-adopted-decisions.md)
- [Current architecture blueprint](docs/framework/03-architecture-blueprint.md)
- [Roadmap and phase plan](docs/framework/04-roadmap-and-phase-plan.md)
- [Implementation artifacts](docs/framework/05-implementation-artifacts.md)
- [Operating boundaries and next steps](docs/framework/06-operating-boundaries-and-next-steps.md)
- [Monorepo ADR](docs/adr/0001-w1-monorepo.md)
- [W2-A runtime and MCP ownership ADR](docs/adr/0002-w2a-runtime-and-mcp-ownership.md)
- [W1 closure note](docs/phase-0-w1-closure.md)
- [Orchestrator AGENTS.md](orchestrator/AGENTS.md)
- [W1 MR description draft](orchestrator/.gitlab/W1-MR-description.md)
