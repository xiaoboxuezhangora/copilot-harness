# Notion Source Map

Generated: 2026-05-16

This map organizes the Notion pages used to understand the current Copilot-Harness framework. It
separates planning baselines, market inputs, adopted方案, and local status sync pages.

## Current Baseline Pages

| Page                                                                                                     | Role                         | How to Use                                                                                                                   |
| -------------------------------------------------------------------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| [Copilot 自动化编程工作流方案](https://www.notion.so/5dea20987ae782f69580817ce76dc29b)                   | Master scheme                | Defines the core thesis: Copilot SDK/CLI as execution shell, OpenCode assets as cognitive layer, orchestrator as safety net. |
| [从零搭建详细计划](https://www.notion.so/fb6a20987ae782c6b60801b605f128be)                               | 18-week route                | Canonical phase directory and management-facing roadmap.                                                                     |
| [Copilot-Harness 架构落地状态同步（2026-05-16）](https://www.notion.so/362a20987ae781298187ccb5e756d0e1) | Latest status sync           | Current bridge between local evidence and Notion AI. Prefer this for current status.                                         |
| [Phase 0](https://www.notion.so/f29a20987ae78267849e815ef5dc1cfe)                                        | W0-W3 baseline               | Repository skeleton, Runtime/MCP minimum loop, gates, first eval baseline.                                                   |
| [Phase 0.5](https://www.notion.so/1cca20987ae7832e813481c3f4eb673a)                                      | W4 Showcase                  | Read-only static/product showcase requirements and boundaries.                                                               |
| [Phase 1](https://www.notion.so/079a20987ae7838bb7a401abbbe0c4da)                                        | W5-W9 hardening              | Skill, Memory MCP, Auto-Memory, Review CLI, Code Retrieval, BudgetGate, W8/W9 final gates.                                   |
| [Phase 2](https://www.notion.so/c9ea20987ae7832fa2fa01e2599533fc)                                        | W10-W13 control plane        | Fleet, CI gates, Correction Capture, Arena, portable Memory.                                                                 |
| [Phase 3](https://www.notion.so/a92a20987ae783009b3781d9f980e885)                                        | W14-W18 automation/readiness | Resolver, Draft MR composer, security hardening, Playbook shadow, Go-Live readiness.                                         |
| [Phase 4 + 附录](https://www.notion.so/a06a20987ae783c99f0b818f5cfcfba2)                                 | W19+ scale                   | Cross-project reuse, registry, quarterly audit, release gates, risks, manpower and deliverables.                             |

## Market And Research Inputs

| Page                                                                                                 | Role                    | Adopted Signal                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [OpenCode 增强框架与 Harness 最新调研](https://www.notion.so/d72a20987ae7821d94e781c8fd380356)       | Market benchmark        | Confirms the route should add native config alignment, guardrails, evidence/context assembly, OTel trace, invariants as code, and connector/runtime isolation. |
| [主流 Agent / Skill / MCP 编排方案调研](https://www.notion.so/8aaa20987ae7828a955301169ecb2589)      | Architecture comparison | Recommends Orchestrator + Tools Facade + Specialized Executors + Repo-aware Code Agent + Harness/Eval.                                                         |
| [OpenCode 现网架构深度升级方案](https://www.notion.so/ce7a20987ae782c98e8b012a5f42a95a)              | Prior baseline          | Frames the two-line upgrade: control-plane upgrade + business-enhancement upgrade.                                                                             |
| [业务增强型 OpenCode 架构方案](https://www.notion.so/a29a20987ae7833da471814d63100925)               | Business baseline       | Defines Business Skill layering, external knowledge boundaries, lightweight Memory schema, and MCP/Adapter interface catalog.                                  |
| [当前架构缺口分析与重构优先级](https://www.notion.so/1dca20987ae78279bf69817f49da6fc0)               | Gap analysis            | Identifies missing runtime protocol, orchestrator kernel, tools layer protocol, dual-track validation, and harness data loop.                                  |
| [Jira->GitLab->代码上下文解析与开发规划方案](https://www.notion.so/adda20987ae78297a86601a199493a52) | Resolver special plan   | Converts short Jira work items into evidence-backed repo/branch/code/planning context.                                                                         |
| [AI 开发中枢月报 Vol.02](https://www.notion.so/8b1a20987ae78357a31e01ed52f5fdce)                     | Narrative explanation   | Explains Harness Engineering, Orchestrator metaphors, AgentRuntime, and four gates for non-engineering readers.                                                |

## Local Evidence Anchors

| Local Path                                    | Role                                                     |
| --------------------------------------------- | -------------------------------------------------------- |
| `docs/project-brief-architecture-progress.md` | Previous local architecture/progress synthesis.          |
| `docs/orchestrator-implementation-current.md` | Current orchestrator implementation explanation.         |
| `docs/phase-*-*.md`                           | Phase closure reports and contracts.                     |
| `docs/adr/*.md`                               | Architecture decision records.                           |
| `orchestrator/eval/*.md`                      | Eval, harvester, fleet, arena, and memory drift reports. |
| `reports/w14/eval-report.md`                  | Resolver shadow replay evidence.                         |
| `reports/w15/eval-report.md`                  | Draft MR composer shadow evidence.                       |
| `reports/w16/security-eval.md`                | Security/governance hardening evidence.                  |
| `reports/w17/weekly-shadow-report.md`         | Playbook shadow evidence.                                |
| `reports/w18/readiness-report.md`             | Go-live readiness and NO-GO evidence.                    |

## Conflict Handling

Some Notion pages contain older planning assumptions, especially around real `/fleet`, Runner
timing, and production write-back. Use these precedence rules:

1. Current local evidence wins for status.
2. The 2026-05-16 Notion status sync page wins over older Notion planning text.
3. Mock/control-plane PASS never implies real write-back approval.
4. Any production release claim must first answer RB-1 and RB-2.
