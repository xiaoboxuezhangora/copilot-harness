# Phase 1c W9-C: AgentRuntime V1 Contract

## Scope

AgentRuntime V1 is the Phase 1c control-plane contract for a single default model runtime.

- Default model remains `gpt-5-mini`.
- W9-C does not implement real fanout, `/fleet`, or multi-model routing.
- SDK and CLI runtime gaps must be auditable. Unsupported `spawn` and `resumeSession` calls must not throw a generic `Error`.
- Any later interface or model-scope change requires an ADR before implementation.

## AgentRuntimeV1

```ts
interface AgentRuntimeV1 {
  run(task: AgentTaskV1): Promise<AgentResultV1>;
  spawn(count: number): Promise<readonly AgentResultV1[]>;
  onTurnEnd(hook: TurnEndHook): void;
  onToolCall(hook: ToolCallHook): void;
  resumeSession(sessionId: string): Promise<AgentResultV1>;
}
```

`run` is the only implemented execution method in Phase 1c. It executes one `gpt-5-mini` turn through the selected adapter and emits audit data through `AgentResultV1`.

`spawn` is part of the frozen V1 surface so later fanout work has a stable policy boundary. Until W8 release evidence and BudgetGate approval are complete, it must return `RuntimeCapabilityUnsupportedError` with `policy_decision="deny"`.

`resumeSession` is also part of the frozen V1 surface. Until an audited session restore contract exists, it must return `RuntimeCapabilityUnsupportedError` with `policy_decision="deny"`.

## AgentTaskV1

```ts
interface AgentTaskV1 {
  readonly taskId: string;
  readonly prompt: string;
  readonly intent: string;
  readonly turnState: TurnState;
  readonly budgetLimit: BudgetLimit;
  readonly promptVersion: string;
  readonly runOptions?: RunOptions;
}
```

`runOptions.reasoningEffort` defaults to `medium`. `RuntimeModel` remains the literal type `"gpt-5-mini"` and cannot be widened without ADR approval.

## AgentResultV1

```ts
interface AgentResultV1 {
  readonly taskId: string;
  readonly turnState: TurnState;
  readonly output: string;
  readonly evidencePack: EvidencePack;
  readonly auditTraceId: string;
  readonly model: "gpt-5-mini";
  readonly runtime: RuntimeIdentity;
  readonly reasoningEffort: ReasoningEffort;
  readonly promptVersion: string;
  readonly policyDecision?: "deny" | "allow" | "escalate";
  readonly budgetUsage?: BudgetUsage;
  readonly capabilities: AgentCapabilityFlags;
  readonly toolCalls: readonly ToolCallRecord[];
  readonly tokenUsage?: TokenUsage;
}
```

Every implemented run must expose `auditTraceId`, `model`, `runtime`, capability flags, and budget usage when available. Evidence must stay source referenced or remain in assumptions.

## TurnContextV1

```ts
interface TurnContextV1 {
  readonly taskId: string;
  readonly sessionId?: string;
  readonly model: "gpt-5-mini";
  readonly runtime: RuntimeIdentity;
  readonly runOptions: { readonly reasoningEffort: ReasoningEffort } & RunOptions;
  readonly turnState: TurnState;
  readonly auditTraceId?: string;
  readonly toolCalls: readonly ToolCallRecord[];
}
```

Turn hooks receive this context after a run. W9-C does not rely on session resume, but the optional `sessionId` remains reserved for a future ADR-governed implementation.

## Capability Flags

- `canSpawn`: runtime can create multiple child turns in one controlled operation. `false` in W9-C.
- `canUseTools`: runtime adapter can invoke tool calls.
- `canResume`: runtime adapter can resume an audited session through `resumeSession`. Method-level support is still denied in W9-C.
- `canReadMemory`: runtime can read Memory through approved interfaces.
- `canWriteMemory`: runtime can write Memory through approved interfaces.
- `canUseMcp`: runtime can connect to MCP tools.
- `supportsSessions`: adapter can identify session state.
- `supportsHooks`: adapter supports hook-style policy and audit integration.
- `supportsReasoningEffort`: adapter accepts reasoning effort settings.
- `supportsHeadless`: adapter can run without interactive UI.
- `externalExecution`: adapter executes outside the current process boundary.
- `capabilitySupported`: aggregate probe result for the selected adapter.
- `unsupportedReasons`: human-readable blocked capability reasons.

## Unsupported Capability Audit

```ts
interface RuntimeUnsupportedCapabilityV1 {
  readonly schema_version: "phase-1c-w9-runtime-unsupported-capability@1";
  readonly capability: "spawn" | "resumeSession";
  readonly runtime: RuntimeIdentity;
  readonly reason: string;
  readonly recovery_hint: string;
  readonly policy_decision: "deny";
  readonly gate: "AgentRuntimeV1" | "BudgetGate" | "ReleaseGate";
  readonly requested_count?: number;
  readonly session_id?: string;
  readonly audit_trace_id?: string;
}
```

Required semantics:

- `spawn`: denied by BudgetGate and release-gate policy until W8 final evidence passes and an ADR approves real fanout.
- `resumeSession`: denied by AgentRuntimeV1 until an audited session restore contract exists.
- Callers can identify the error via `RuntimeCapabilityUnsupportedError` or `isRuntimeCapabilityUnsupportedError`.
- `recovery_hint` must tell the caller how to continue safely, usually by running one `gpt-5-mini` turn or returning a blocked partial result.

## Change Control

The V1 surface is frozen for Phase 1c. The following changes require an ADR:

- Widening `RuntimeModel` beyond `gpt-5-mini`.
- Changing `AgentTaskV1`, `AgentResultV1`, or `TurnContextV1` fields.
- Enabling real `spawn`, real `/fleet`, or real multi-model routing.
- Enabling `resumeSession` with persisted state.
- Changing unsupported capability policy from `deny` to `allow` or `escalate`.
