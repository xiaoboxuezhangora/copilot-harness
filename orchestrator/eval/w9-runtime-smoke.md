# W9 AgentRuntime Smoke Report

- status: blocked
- generated_at: 2026-05-11T13:02:30.000Z
- mode: blocked_live_smoke
- model: gpt-5-mini
- reasoning_effort: medium
- live_execution: false

## Blocked Reason

Real SDK/CLI live smoke was not executed because this W9 closeout forbids real LLM calls and network access. The report is therefore `blocked`, not `pass`.

## Runtime Matrix

| Runtime | Sample Count | Pass Count | Blocked Count | Capability Supported | Audit Trace Coverage |
| --- | ---: | ---: | ---: | --- | ---: |
| copilot_sdk | 20 | 0 | 20 | false | 100% |
| copilot_cli | 20 | 0 | 20 | false | 100% |

## Unsupported Capability Evidence

- `copilot_sdk.spawn`: returns `RuntimeCapabilityUnsupportedError`, `policy_decision=deny`, `gate=BudgetGate`.
- `copilot_sdk.resumeSession`: returns `RuntimeCapabilityUnsupportedError`, `policy_decision=deny`, `gate=AgentRuntimeV1`.
- `copilot_cli.spawn`: returns `RuntimeCapabilityUnsupportedError`, `policy_decision=deny`, `gate=BudgetGate`.
- `copilot_cli.resumeSession`: returns `RuntimeCapabilityUnsupportedError`, `policy_decision=deny`, `gate=AgentRuntimeV1`.

## Verification

- `pnpm --filter @copilot-harness/orchestrator test -- runtime gates`: passed.

## Conclusion

AgentRuntime V1 control-plane audit behavior is covered by deterministic tests. Live SDK/CLI smoke remains blocked and cannot be used as release-gate evidence.
