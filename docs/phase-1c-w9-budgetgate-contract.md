# Phase 1c W9-D: BudgetGate Pressure Contract

## Scope

W9-D validates BudgetGate behavior with a deterministic local harness. It does not call a real model, does not access network services, and does not enable real fanout.

The harness simulates `fanout=5` plus Auto-Memory turn-end pressure, calculates P95 usage, suggests thresholds, and proves all five forced overrun dimensions convert to auditable partial results.

## BudgetPressureSampleV1

```ts
interface BudgetPressureSampleV1 {
  readonly schema_version: "phase-1c-w9-budget-pressure-sample@1";
  readonly sample_id: string;
  readonly scenario:
    | "baseline_single_turn"
    | "fanout_5_auto_memory"
    | "forced_overrun";
  readonly usage: BudgetUsage;
  readonly budget_limit: BudgetLimitConfig;
  readonly decision: "allow" | "deny";
  readonly audit_trace_id: string;
  readonly exceeded_budget?: BudgetLimitKey;
  readonly partial_result?: BudgetOverrunPartialResultV1;
  readonly notes: readonly string[];
}
```

`usage` records `fanout`, `toolCalls`, `inputTokens`, `outputTokens`, and `premiumRequests`. Forced overrun samples must include `exceeded_budget` and `partial_result`.

## BudgetPressureReportV1

```ts
interface BudgetPressureReportV1 {
  readonly schema_version: "phase-1c-w9-budget-pressure-report@1";
  readonly generated_at: string;
  readonly status: "pass" | "fail";
  readonly harness: "deterministic_mock";
  readonly model: "gpt-5-mini";
  readonly p95_method: "nearest_rank";
  readonly p95_usage: BudgetUsage;
  readonly suggested_thresholds: BudgetLimitConfig;
  readonly forced_overrun: {
    readonly passed: number;
    readonly total: 5;
    readonly cases: readonly BudgetPressureSampleV1[];
  };
  readonly samples: readonly BudgetPressureSampleV1[];
}
```

`status` is `pass` only when all baseline samples are allowed and all five forced overrun samples are denied with blocked partial result evidence.

## BudgetOverrunPartialResultV1

```ts
interface BudgetOverrunPartialResultV1 {
  readonly schema_version: "phase-1c-w9-budget-overrun-partial-result@1";
  readonly task_id: string;
  readonly turn_state: "blocked";
  readonly policy_decision: "deny";
  readonly exceeded_budget:
    | "maxFanout"
    | "maxToolCalls"
    | "maxInputTokens"
    | "maxOutputTokens"
    | "maxPremiumRequests";
  readonly exceeded_budget_limit: number;
  readonly exceeded_budget_actual: number;
  readonly budget_usage: BudgetUsage;
  readonly budget_limit: BudgetLimitConfig;
  readonly partial_result: {
    readonly summary: string;
    readonly completed_steps: readonly string[];
    readonly blocked_reason: string;
  };
  readonly audit_trace_id: string;
  readonly recovery_hint: string;
}
```

BudgetGate overrun must never fail silently. Callers can convert `BudgetExceededError` with `toBudgetOverrunPartialResultV1`.

## P95 Rule

W9-D uses nearest-rank P95:

1. Sort values ascending.
2. Compute `index = ceil(sample_count * 0.95) - 1`.
3. Select the value at `index`, clamped to the available range.

P95 is calculated independently for:

- `fanout`
- `toolCalls`
- `inputTokens`
- `outputTokens`
- `premiumRequests`

## Suggested Threshold Rule

Recommended threshold for each budget dimension:

```text
suggested_threshold = ceil(P95 * 1.2)
```

This recommendation is report-only in W9-D. It must not automatically replace production gate config.

## Forced Overrun Dimensions

The deterministic harness must force exactly these five overrun dimensions:

- `maxFanout`
- `maxToolCalls`
- `maxInputTokens`
- `maxOutputTokens`
- `maxPremiumRequests`

Each forced case must produce:

- `turn_state: "blocked"`
- `policy_decision: "deny"`
- `exceeded_budget`
- `partial_result`
- `audit_trace_id`
- `recovery_hint`

## Current W9-D Harness Output

- Script: `pnpm --filter @copilot-harness/orchestrator w9:budget-pressure`
- JSON: `orchestrator/eval/w9-budget-pressure.json`
- Markdown: `orchestrator/eval/w9-budget-pressure.md`
- Real model/network usage: none
