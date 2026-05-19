# Implementation Artifacts

Generated: 2026-05-16

This file maps current landed成果物 to repository paths and evidence.

## High-Level Status

| Area                                       | Status                                                                 | Evidence                                                                           |
| ------------------------------------------ | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Monorepo and local quality scripts         | Complete                                                               | `README.md`, `package.json`, `pnpm-workspace.yaml`, `docs/adr/0001-w1-monorepo.md` |
| Runtime abstraction                        | Complete                                                               | `orchestrator/src/runtime/*`, `docs/phase-1c-w9-agent-runtime-contract.md`         |
| Jira Reader MCP                            | Complete as read-only                                                  | `mcp-servers/jira-reader/*`                                                        |
| Code Retrieval MCP                         | Complete as read-only evidence layer                                   | `mcp-servers/code-retrieval/*`, W8 reports                                         |
| Memory MCP                                 | Contract and local implementation complete; production cutover blocked | `mcp-servers/memory/*`, `docs/phase-2-w13-memory-portable-contract.md`             |
| Gates                                      | Implemented locally                                                    | `orchestrator/src/gates/index.ts`, W9/W16 evidence                                 |
| Auto-Memory                                | Candidate/review flow implemented                                      | `orchestrator/src/automemory/*`, W11 evidence                                      |
| Fleet/Arena                                | Mock/control-plane implemented                                         | W10/W12 reports                                                                    |
| Showcase                                   | Read-only UI exists, with newer product gaps documented                | `apps/showcase/*`, `docs/showcase-*.md`                                            |
| Resolver/Draft/Security/Playbook/Readiness | Shadow/readiness artifacts exist                                       | `reports/w14` through `reports/w18`                                                |

## Current Phase Evidence

| Phase/Week | Evidence File                                                                                                              | Key Result                                                            |
| ---------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| W1         | `docs/phase-0-w1-closure.md`                                                                                               | Monorepo skeleton accepted locally.                                   |
| W3         | `docs/phase-0-w3-closure.md`                                                                                               | Phase 0 baseline and eval closure.                                    |
| W6         | `docs/phase-1a-w6-memory-contract.md`                                                                                      | Memory/Evidence contract.                                             |
| W8         | `docs/phase-1b-w8-code-retrieval-contract.md`, `docs/phase-1b-w8-review-cli-contract.md`, `orchestrator/eval/w8-report.md` | Code Retrieval, Review CLI, joint Jira+GitLab eval.                   |
| W9         | `docs/phase-1c-w9-*.md`                                                                                                    | AgentRuntime, BudgetGate, hot_index, conflict, readiness and closure. |
| W10        | `docs/phase-2-w10-closure.md`, `orchestrator/eval/w10-fleet-smoke.md`                                                      | Fleet mock control-plane pass.                                        |
| W11        | `docs/phase-2-w11-closure.md`                                                                                              | Local CI gates and Correction Capture pass; live Runner blocked.      |
| W12        | `orchestrator/eval/w12-arena-closure.md`                                                                                   | Arena mock baseline pass.                                             |
| W13        | `docs/phase-2-w13-memory-portable-contract.md`, `orchestrator/eval/w13-memory-drift-report.mock.md`                        | Portable Memory contract and mock drift detector.                     |
| W14        | `reports/w14/eval-report.md`                                                                                               | Resolver shadow pass.                                                 |
| W15        | `reports/w15/eval-report.md`                                                                                               | Draft MR composer shadow pass.                                        |
| W16        | `reports/w16/security-eval.md`                                                                                             | Security hardening pass.                                              |
| W17        | `reports/w17/weekly-shadow-report.md`                                                                                      | Playbook shadow pass.                                                 |
| W18        | `reports/w18/readiness-report.md`                                                                                          | Readiness package complete; NO-GO.                                    |

## W14-W18 Shadow Evidence Details

| Week                  | Key Metrics                                                                                                                   |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| W14 Resolver          | 100 samples; schema pass 100%; misrelease 0%; need_more_context 32%; high-risk await_human 21/21; source_ref fabrication 0.   |
| W15 Draft MR Composer | 20 samples; packet schema pass 100%; human-review executable 100%; PR body source_ref coverage 100%; write guard blocked 5/5. |
| W16 Security          | injection intercept 100%; audit redaction 100%; write state machine pass 100%; default deny true.                             |
| W17 Playbook          | 3 playbooks; 15 shadow runs; classification pass 100%; unsafe auto success 0; all missing-source cases blocked.               |
| W18 Readiness         | engineering_closure_status complete; release_status blocked_by_rb_1_rb_2; decision NO-GO.                                     |

## Product/Showcase Artifacts

| File                                                     | Purpose                                                                 |
| -------------------------------------------------------- | ----------------------------------------------------------------------- |
| `docs/showcase-jira-dispatch-skill-assignment-design.md` | Jira dispatch and Skill assignment design.                              |
| `docs/showcase-jira-dispatch-operation-guide.md`         | Current operation guide for Jira dispatch/governance dashboard.         |
| `docs/showcase-agent-progress-config-requirements.md`    | Requirements for Agent progress visualization and configuration center. |

## Known Dirty Worktree Context

At the time this structure was created, the working tree already contained unrelated or pre-existing
modifications in:

- `apps/showcase/src/App.vue`
- `apps/showcase/src/style.css`
- `orchestrator/eval/harvester-report.json`
- `orchestrator/eval/harvester/harvester-report-mock-latest.json`
- `state/tasks/w14/resolver-shadow-state.json`
- `state/tasks/w17/playbook-shadow-state.json`
- `state/tasks/w18/go-live-readiness-state.json`
- untracked `docs/showcase-agent-progress-config-requirements.md`
- untracked `docs/showcase-jira-dispatch-operation-guide.md`

Those changes were not reverted.
