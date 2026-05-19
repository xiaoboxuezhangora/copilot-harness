# Roadmap And Phase Plan

Generated: 2026-05-16

This is the consolidated roadmap from Notion plus current repository evidence.

## Phase Summary

| Phase     | Weeks   | Notion Intent                                                                              | Current Status                                                                        |
| --------- | ------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Phase 0   | W0-W3   | Harness skeleton, Runtime/MCP hello world, first gates, first Skill, 20-sample baseline.   | Complete.                                                                             |
| Phase 0.5 | W4      | Read-only Showcase MVP for management/demo visibility.                                     | Complete enough for showcase; needs snapshot/status refresh over time.                |
| Phase 1a  | W5-W6   | First engineering Skills, Memory MCP, Evidence Pack v1, 50-sample Eval.                    | Complete by current local evidence.                                                   |
| Phase 1b  | W7-W8   | Auto-Memory Harvester, Review CLI, Code Retrieval MCP, Jira+GitLab eval.                   | Complete; W8 final target passed.                                                     |
| Phase 1c  | W9      | Memory conflicts, hot_index, AgentRuntime contract, BudgetGate pressure, release-gate ADR. | Complete; model remains locked.                                                       |
| Phase 2   | W10-W13 | Multi-agent, CI gates, Correction Capture, Arena, cross-agent Memory.                      | Partially complete: local/mock/contract pass; live Runner and Memory cutover blocked. |
| Phase 3   | W14-W18 | Resolver, Draft MR composer, security hardening, Playbooks, Dream/Reflection, readiness.   | Shadow/readiness artifacts complete; production release is NO-GO.                     |
| Phase 4   | W19+    | Cross-project reuse, registry, IDP-like governance, quarterly capability audit.            | Planned/watchlist.                                                                    |

## Phase 0: Foundation

Planned:

- Monorepo layout.
- TypeScript orchestrator skeleton.
- `AGENTS.md` and agent docs.
- `AgentRuntime`, SDK/CLI adapters.
- Read-only Jira Reader MCP.
- Budget/Policy/Validator/Audit skeleton.
- First Skill: `jira-requirement-analysis`.
- 20-sample Eval baseline.

Local status:

- Monorepo ADR and W1/W3 closure docs exist.
- Runtime/MCP ownership ADR exists.
- Jira Reader MCP package exists.
- W3 eval task states exist.

## Phase 0.5: Showcase

Planned:

- Vue 3 + Vite + Ant Design Vue + ECharts static read-only site.
- Views for tasks, MCP calls, evidence, and route chain.
- No write actions.

Local status:

- `apps/showcase/` exists.
- Showcase product/operation docs exist.
- New requirements identify Agent progress visualization and Configuration Center gaps.

## Phase 1: Skill, Memory, Auto-Memory, Code Evidence

Planned:

- W5/W6: Skills, Memory MCP, Evidence Pack v1, 50-sample Eval.
- W7/W8: Auto-Memory candidate extraction, Review CLI, Code Retrieval MCP, Jira+GitLab joint analysis.
- W9: conflict detection, hot index, BudgetGate pressure, AgentRuntime contract, release gate review.

Current local result:

- Phase 1 is complete.
- W8 final target passed with 50/50 samples and real joint sample count 50/20.
- `repo_hit_at_1=100%`, `source_ref_coverage=100%`, `review_time_minutes=0.76`.
- W9 budget/runtime/memory contracts and closure docs exist.

## Phase 2: Multi-Agent And Shared Memory

Planned:

- W10: planner/implementer/critic/reviewer and `/fleet`.
- W11: CI gate1/gate2/gate3 and Correction Capture.
- W12: Arena blind comparison and eval seed generation.
- W13: cross-client portable Memory.

Current local result:

- W10 mock control-plane PASS.
- W11 local gates and Correction Capture proof PASS; live GitLab CI is blocked by Runner availability.
- W12 Arena mock baseline PASS; `llm_shadow` is recording-only.
- W13 portable contract and mock drift detector exist; real two-day dual-write evidence is missing.

Phase 2 must be reported as:

> Local/control-plane complete, production closure incomplete.

## Phase 3: Shadow Automation And Readiness

Planned:

- W14 Resolver v1.
- W15/W16 Draft MR and governance hardening.
- W17 Playbooks.
- W18 Dream/Reflection and Go-Live readiness.

Current local result:

| Week | Evidence                              | Status                                                                                                         |
| ---- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| W14  | `reports/w14/eval-report.md`          | Resolver shadow PASS; 100 samples; schema pass 100%; misrelease 0%; source_ref fabrication 0.                  |
| W15  | `reports/w15/eval-report.md`          | Draft MR composer shadow PASS; packet schema pass 100%; human-review executable 100%; write guard blocked 5/5. |
| W16  | `reports/w16/security-eval.md`        | Security/governance hardening PASS; injection intercept 100%; default deny true.                               |
| W17  | `reports/w17/weekly-shadow-report.md` | Playbook shadow PASS; 3 playbooks; classification pass 100%; unsafe auto success 0.                            |
| W18  | `reports/w18/readiness-report.md`     | Engineering package complete; release blocked by RB-1/RB-2; decision NO-GO.                                    |

Phase 3 must be reported as:

> Shadow/readiness成果已完成，但真实 Jira -> Draft MR 生产写回闭环未上线。

## Phase 4: Scale

Planned:

- Skill registry or internal `gh skill` equivalent.
- Second-project onboarding.
- Quarterly capability audit.
- IDP-like governance surfaces only after source-of-truth alignment.
- Runner pool/autoscaler/tag matrix and monitoring.

Current local result:

- Planning exists in Notion.
- No production-scale rollout evidence in this repo yet.
