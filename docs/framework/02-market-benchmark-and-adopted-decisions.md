# Market Benchmark And Adopted Decisions

Generated: 2026-05-16

This document summarizes the Notion market research and records which ideas were adopted into
Copilot-Harness.

## Core Market Lesson

The mature industry pattern is not a bigger prompt or a single giant Skill. The stable pattern is:

> Orchestrator + Tools Facade + Specialized Executors + Repo-aware Code Agent + Harness/Eval.

This matches the Notion research around OpenCode, OpenAI/Anthropic harness engineering, LangSmith,
Google ADK, AgentKit, OpenHands, and community OpenCode frameworks.

## Borrowed Practices

| Market Practice                                  | Source Input                                                   | Local Adoption                                                                                                                         |
| ------------------------------------------------ | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Harness is the operating layer around the model  | Monthly Vol.02 and OpenCode harness research                   | `orchestrator/` owns runtime, gates, context, memory, audit, automemory, fleet, and eval surfaces.                                     |
| AGENTS.md should be a map, not a wiki            | OpenAI/Anthropic harness notes in Notion                       | Root/project instructions remain concise; detailed contracts move into docs and agent files.                                           |
| Planner/generator/evaluator separation           | Anthropic long-running harness and GAN-style evaluator pattern | Planner/implementer/critic/reviewer contracts, Fleet mock, and Arena scoring.                                                          |
| Budget and step/token limits are first-class     | Production harness components and Copilot token-cost concerns  | `BudgetGate`, forced overrun tests, partial-result blocked output, OTel/audit fields.                                                  |
| Tool schema and policy allowlists are required   | OpenAI/Anthropic guardrail guidance                            | `PolicyGate` defaults deny; only read-only Jira/code tools are allowed by default.                                                     |
| Trace/eval must move early                       | OpenAI, Anthropic, LangSmith, ADK eval guidance                | JSONL audit, W3/W8/W9/W10/W11/W12/W13 reports, W14-W18 shadow/readiness reports.                                                       |
| Evidence Pack beats prompt stuffing              | Context Engineering and Jira->GitLab resolver research         | Jira facts, GitLab evidence, Memory hot_index, Skill hints are assembled as structured context.                                        |
| Business knowledge should stay outside code      | Business-enhanced OpenCode baseline                            | Business Skills consume authoritative external sources and Evidence Packs; Memory stores lightweight stable indexes/decisions/aliases. |
| Runtime isolation and connector lifecycle matter | OpenHands/AgentKit/ADK research                                | Kept as watchlist/Phase 4 direction; write paths remain disabled until evidence is available.                                          |
| Memory needs approval and maintenance            | Devin/Claude Code/Mem0-like patterns captured in Notion        | Harvester -> pending -> Review CLI -> Memory MCP; Dream/Reflection is planned/shadowed, not direct write.                              |

## Adopted Architecture Decisions

| Decision                                    | Why It Was Adopted                                                     | Local Evidence                                                                                                |
| ------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Single monorepo with top-level workstreams  | Avoid early repo split overhead; keep CI, ADRs, and code close.        | `docs/adr/0001-w1-monorepo.md`                                                                                |
| `AgentRuntime` abstraction                  | Copilot SDK is preview-like and CLI fallback is needed.                | `docs/adr/0002-w2a-runtime-and-mcp-ownership.md`, `orchestrator/src/runtime/*`                                |
| Single-model verification with `gpt-5-mini` | Cost and behavior stability during proof phase.                        | `docs/adr/0003-phase-1c-single-model-release-gate.md`                                                         |
| MCP + Adapter mixed tool layer              | Enterprise systems cannot all be cleanly MCP-native.                   | `mcp-servers/*`, Code Retrieval/Jira Reader tools                                                             |
| Business/technical capability split         | Business knowledge and engineering rules evolve at different speeds.   | Technical Skills, Business Skills, Evidence Pack, Memory index, and MCP/Adapter facts are modeled separately. |
| Evidence-first output                       | Prevent fabricated repo/module conclusions.                            | W8 source_ref coverage and Repo Hit@1 evidence                                                                |
| Auto-Memory as reviewed candidate flow      | Avoid losing useful knowledge while preventing noisy automatic writes. | `orchestrator/src/automemory/*`, Review CLI evidence                                                          |
| Mock/control-plane before live write-back   | Prove contracts and guards before exposing production mutation.        | W10/W12/W14-W18 reports                                                                                       |

## Ideas Explicitly Delayed Or Downgraded

| Idea                          | Current Handling                                                                              |
| ----------------------------- | --------------------------------------------------------------------------------------------- |
| Real `/fleet` worktree fanout | Disabled. W10/W12 prove mock/control-plane only.                                              |
| Real GitLab push/MR creation  | Disabled until live CI and write-intent gates are proven.                                     |
| Jira write-back               | Disabled; Jira Reader is read-only.                                                           |
| Multi-model routing           | Interface ideas retained, default remains `gpt-5-mini`.                                       |
| Full connector registry       | Phase 4/watchlist; not required for current proof.                                            |
| Runtime isolation tiering     | Phase 4/watchlist; current local and mock proofs do not claim sandboxed production execution. |
| IDP-style frontend            | Phase 4; current Showcase stays read-only governance/showcase surface.                        |

## Practical Implication

Future planning should add capability only when it strengthens one of these layers:

- Runtime abstraction.
- Evidence and context assembly.
- Tool governance.
- Eval/replay/trace.
- Human review and controlled memory.
- Release/cutover readiness.

New UI, new agent roles, or new write tools should not bypass those layers.
