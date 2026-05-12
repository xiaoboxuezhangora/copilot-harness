# ADR 0003: Phase 1c Single-Model Release Gate

## Context

Phase 1c W9 is a release-gate review for whether the project can loosen the single-model constraint before Phase 2 work.

Current evidence does not support that release:

- W8 report status is `NOT_READY`.
- Current W8 dataset has 12 real Jira + GitLab joint samples, while the final target remains 20 real joint samples within a 50-sample target.
- Read-only Jira/GitLab environment is not configured in the current W8 report.
- Review CLI 10-minute approval target is not proven by real metrics because `review_time_minutes` is unavailable.
- W9-A Memory conflict and W9-B hot_index are technical hardening items, not release-gate evidence for multi-model execution.

## Decision

Do not approve a Phase 2 multi-model pilot from the current Phase 1c evidence.

The default model remains `gpt-5-mini`. No default-model change, real fanout, or real `/fleet` execution is approved by this ADR.

Phase 2 may continue design work, mock harness work, and contract drafting, but it must not enable real fanout and must not depend on the current W8 GitLab evidence quality conclusion.

## Status

Accepted for Phase 1c closeout.

## Evidence

- `docs/phase-1c-w9-readiness.md`: W8 is not ready for W9 single-model release gate review.
- `orchestrator/eval/w8-report.md`: `status: NOT_READY`, missing read-only Jira/GitLab env, `review_time_minutes: not_available`.
- `orchestrator/eval/w8-report.json`: current temporary profile has 12 real joint samples, final target remains 20 real joint samples.
- `docs/phase-1c-w9-memory-conflict-contract.md`: Memory conflict contract exists.
- `docs/phase-1c-w9-hot-index-contract.md`: hot_index contract exists.
- `docs/phase-1c-w9-agent-runtime-contract.md`: AgentRuntime V1 contract freezes single-model runtime surface.
- `orchestrator/eval/w9-runtime-smoke.md`: live SDK/CLI smoke is `blocked`, not pass.
- `docs/phase-1c-w9-budgetgate-contract.md`: BudgetGate pressure contract exists.
- `orchestrator/eval/w9-budget-pressure.md`: deterministic BudgetGate forced overrun conversion passed 5/5.

## Gate Results

| Gate | Result | Notes |
| --- | --- | --- |
| W8 readiness | NOT_READY | Blocks multi-model release decision. |
| W9-A Memory conflict | Stage complete | Technical hardening only. |
| W9-B hot_index | Stage complete | Technical hardening only. |
| W9-C AgentRuntime V1 | Control-plane ready, live blocked | Unsupported `spawn` and `resumeSession` are auditable; live smoke is blocked. |
| W9-D BudgetGate pressure | Deterministic pass | P95 thresholds generated; forced overrun 5/5 converted to partial result. |
| Default model | LOCKED | `gpt-5-mini` remains the only default. |
| Multi-model pilot | NOT_APPROVED | W8 and live runtime evidence are insufficient. |

## Trial Scope

Allowed:

- Phase 2 design and mock-only `/fleet` planning.
- Deterministic BudgetGate, runtime, and context harness tests.
- ADR drafts for future fanout, session resume, or model expansion.

Not allowed:

- Real fanout.
- Real multi-model routing.
- Default model changes.
- Treating current W8 GitLab evidence as final-quality release evidence.
- Using mocked W8 evidence as a substitute for live read-only Jira/GitLab evidence.

## Rollback Conditions

Any of the following requires immediate rollback to the single-turn `gpt-5-mini` path and a new ADR review:

- `DEFAULT_MODEL` changes away from `gpt-5-mini`.
- `RuntimeModel` is widened without ADR approval.
- `spawn` or `/fleet` performs real execution before BudgetGate and W8 final evidence pass.
- BudgetGate overrun fails to return `turn_state="blocked"` and `policy_decision="deny"`.
- W8 final report remains `NOT_READY` or loses source-ref coverage.
- Runtime live smoke lacks audit trace coverage.

## Owners

- Orchestrator control plane: copilot-harness maintainers.
- Runtime contract: copilot-harness maintainers.
- W8 evidence readiness: Jira/GitLab evidence owner and Review CLI owner.
- Release decision: Phase 1c gate reviewers.

## Next Review Date

2026-05-18
