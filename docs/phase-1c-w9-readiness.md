# Phase 1c W9-0 Readiness

Generated at: 2026-05-09

## Conclusion

W8 is not ready for the W9 single-model release gate review.

The W8 technical hardening work can continue, but the ADR must not allow a Phase 2 late-stage multi-model pilot until the final W8 evidence target is met.

## Evidence Checked

- `orchestrator/eval/w8-report.md`
- `orchestrator/eval/w8-report.json`
- `orchestrator/src/w8Eval.ts`
- `orchestrator/eval/w8-eval-schema.json`
- `orchestrator/eval/w8-acceptance-profile.json`

## Current Gaps

- `status`: `NOT_READY` after re-running `pnpm --filter @copilot-harness/orchestrator eval:w8` in the current shell.
- `real_joint_sample_count`: `12`, below the W9-0 final readiness threshold of `20`.
- `source_ref_coverage`: `100%`; this portion is not blocking.
- `repo_hit_at_1`: calculable at `100%` over `12/12` eligible samples.
- `review_cli_accept_rate`: `100%`, above the `40%` threshold, but this currently comes from dataset review decisions because no `orchestrator/eval/w8-review-metrics.json` exists.
- `review_time_minutes`: `null` / `not_available`, so the `<= 10` requirement is not proven by real Review CLI metrics.
- Read-only environment: current shell does not expose `GITLAB_BASE_URL`, `GITLAB_TOKEN`, `JIRA_BASE_URL`, `JIRA_TOKEN`, or `JIRA_API_TOKEN`. Token values were not printed.
- Acceptance profile is temporary: `w8-current-jira-limited-closure` uses `12` samples and records a final target of `50` samples / `20` real joint samples.

## Blocking Assessment

- W9 technical hardening: not blocked. W9-A/W9-B/W9-C/W9-D may continue using deterministic tests, contracts, and local harness evidence.
- ADR multi-model release: blocked. The ADR decision must keep the default model locked to `gpt-5-mini` and must not approve a Phase 2 multi-model pilot from the current W8 evidence.

## W9 Phase Entry Assumptions

- W9-A Memory conflict detection may proceed if it uses deterministic conflict fixtures and does not rely on W8 being final-ready.
- W9-B hot_index loading may proceed if it preserves redline filtering and source_ref traceability.
- W9-C AgentRuntime contract smoke may proceed, but real SDK/CLI blocks must be recorded instead of fabricated.
- W9-D BudgetGate pressure may proceed against a local deterministic harness; fanout and overrun evidence must be real harness output.

## Required Follow-up Before ADR Release

- Restore the final W8 acceptance target: `50` samples with at least `20` real Jira + GitLab joint samples.
- Re-run Code Retrieval MCP in a read-only GitLab environment and attach real evidence refs to each joint sample.
- Complete one real Auto-Memory Review CLI approval pass and generate `orchestrator/eval/w8-review-metrics.json`.
- Re-run `pnpm --filter @copilot-harness/orchestrator eval:w8` with read-only Jira/GitLab env configured and verify `status` is `PASS`.
