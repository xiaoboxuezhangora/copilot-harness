# copilot-harness

GitLab repository: <http://10.100.77.238/b.w_neu/copilot-harness>

This repository is the monorepo for the Copilot automation harness. The original W1 plan
expected three GitLab repositories. The accepted W1 adjustment is to manage all Phase 0
artifacts in one repository and keep `orchestrator`, `skills`, and `playbooks` as top-level
workstreams.

## Repository Layout

| Path                         | Purpose                                                  | W1 status              |
| ---------------------------- | -------------------------------------------------------- | ---------------------- |
| `orchestrator/`              | TypeScript orchestration service skeleton                | Active package         |
| `skills/`                    | Agent Skill assets under `.github/skills/`               | Bootstrap placeholders |
| `playbooks/`                 | Ordered workflow playbooks under `.github/playbooks/`    | Bootstrap placeholder  |
| `docs/adr/`                  | Architecture decisions for repository and delivery shape | Monorepo ADR           |
| `docs/phase-0-w1-closure.md` | W1 completion evidence and remaining GitLab proof        | W1 closure note        |

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

Run the W1 quality gate from the package directory:

```sh
cd orchestrator
pnpm lint
pnpm typecheck
pnpm test
pnpm format:check
```

The root GitLab CI mirrors these commands with `pnpm --dir orchestrator ...`. Until a
GitLab Runner is assigned to the project, the pipeline is opt-in through
`ENABLE_GITLAB_CI=1` so W2 feature work is not blocked by pending jobs.

## Key Documents

- [Monorepo ADR](docs/adr/0001-w1-monorepo.md)
- [W1 closure note](docs/phase-0-w1-closure.md)
- [Orchestrator AGENTS.md](orchestrator/AGENTS.md)
- [W1 MR description draft](orchestrator/.gitlab/W1-MR-description.md)
