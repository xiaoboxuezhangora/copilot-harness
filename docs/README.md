# Documentation Index

This directory keeps two kinds of documentation:

- Curated framework documentation under `docs/framework/`.
- Historical evidence, ADRs, phase closures, and contracts at their original paths.

Do not move historical phase evidence casually. Many Notion pages, reports, and acceptance notes
refer to the current filenames directly.

## Start Here

| Path                                                               | Purpose                                                                                    |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `docs/framework/README.md`                                         | Canonical local entry for the current Copilot-Harness framework information architecture.  |
| `docs/framework/01-notion-source-map.md`                           | Notion source map: current routes, market inputs, adopted plans, and local evidence.       |
| `docs/framework/02-market-benchmark-and-adopted-decisions.md`      | Market experience and how it shaped the adopted scheme.                                    |
| `docs/framework/03-architecture-blueprint.md`                      | Current target architecture and module boundaries.                                         |
| `docs/framework/04-roadmap-and-phase-plan.md`                      | Phase planning from W0 through W19+.                                                       |
| `docs/framework/05-implementation-artifacts.md`                    | Current landed artifacts, verification evidence, and blockers.                             |
| `docs/framework/06-operating-boundaries-and-next-steps.md`         | NO-GO boundaries, RB blockers, and next planning priorities.                               |
| `docs/framework/07-requirements-analysis-jira-routing-system.md`   | Current Jira requirements analysis, routing, readiness gate, and code-impact review chain. |
| `docs/skill-management-standard.md`                                | Business Skill canonical model, vendor protocol assessment, export strategy, and evolution loop. |

## Historical Evidence

| Area                         | Files                                         |
| ---------------------------- | --------------------------------------------- |
| ADRs                         | `docs/adr/*.md`                               |
| Phase 0                      | `docs/phase-0-*.md`                           |
| Phase 1                      | `docs/phase-1*.md`                            |
| Phase 2                      | `docs/phase-2*.md`                            |
| Orchestrator current state   | `docs/orchestrator-implementation-current.md` |
| Overall local progress brief | `docs/project-brief-architecture-progress.md` |
| Showcase product docs        | `docs/showcase-*.md`                          |

## Source-of-Truth Rule

- Notion is the planning, research, and management synchronization surface.
- Repository docs are the executable-context surface for agents and engineers.
- Reports under `reports/`, `orchestrator/eval/`, and `state/tasks/` are evidence artifacts.
- When Notion and local evidence disagree, use the local evidence plus a drift note, then sync the
  corrected status back to Notion.
