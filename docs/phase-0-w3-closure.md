# Phase 0 W3 Closure

## Delivered

- W1 monorepo skeleton under `orchestrator/`, `skills/`, `playbooks/`
- W2 runtime contracts, Copilot SDK/CLI adapters, Jira Reader MCP, audit JSONL, smoke
- W3 gates, Jira requirement analysis skill, investigator agent contract, explicit SDK AGENTS/skill/agent session config, Jira Context Pack v1, 20-sample eval, `pnpm eval`

## Phase 0 Decisions

- `Repo Hit@1` remains `not_applicable` until a repo resolver exists
- The 20-sample eval baseline is accepted as a W3 baseline with 6/20 pass rate
- `promptVersion` is a required runtime/audit field and must be emitted by supported paths

## Remaining Risks

- No repo resolver yet, so Repo Hit@1 is intentionally `not_applicable`
- No GitLab code context in W3
- No real Jira execution in W3
- No production write path added in this phase
- CLI runtime loading may still differ from SDK loading semantics and should be verified separately

## Human Decisions Needed

- Whether W4 should introduce repo resolver and code retrieval together or separately
- Whether the Jira analysis prompt should stay heuristic-only or be wired to a real model-backed analyzer
- Whether the 20-sample eval should become a scheduled regression gate before any live Jira integration

## Entry Conditions for W4

- Repo resolver design approved
- No regressions in W3 eval and smoke
- Clear boundary for code-context retrieval versus Jira-context retrieval
- Audit fields remain stable across mock and live paths
- W3 baseline remains reproducible after the above decisions
- SDK path must keep explicit `systemMessage` AGENTS loading plus `skillDirectories`, `customAgents`, `agent`, `workingDirectory`, and investigator tool allowlist assembly covered by tests
