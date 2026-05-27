# Requirements Analysis Upgrade W4

## 目标与边界

W4 实现 `ReqGate v0`，用于需求侧双层准入判定：

- `investigation_ready`
- `implementation_ready`

本轮仅实现 deterministic TypeScript 规则判定，不引入 OPA runtime、LLM、OCR、vision、Jira 写回或任何真实外部服务调用。

不在 W4 范围内：

- M5 50 样本 eval
- Showcase UI
- Code-Impact Gate
- Jira 评论草稿与自动写回

## 代码落点

- `orchestrator/src/requirements/gate.ts`
- `orchestrator/src/requirements/gate.test.ts`
- `orchestrator/src/requirements/index.ts`

## 输入合同

`buildRequirementGateV0(input)` 支持：

- `JiraEvidencePackV2`（必填）
- `RequirementProfileSpecResultV0`（可选，不传则内部调用 `buildRequirementProfileSpecV0`）
- `IssueTypeRouterResult`（可选）
- runtime flags（可选）：
  - `attemptedJiraWrite`
  - `highRiskMedicalDomain`

## 输出合同

输出 `RequirementGateResultV0`：

- `schemaVersion: "RequirementGateResultV0"`
- `profile`
- `investigationReady`
- `implementationReady`
- `gaps`
- `clarificationQuestions`
- `hardBlocks`
- `sourceRefs`
- `auditPayload`

其中 `investigationReady` / `implementationReady` 均包含：

- `light: "green" | "yellow" | "red"`
- `reason`
- `axisResults`
- `sourceRefs`

`gaps[]` 每项包含：

- `axis: "Goal" | "Evidence" | "Scope" | "Testability" | "Profile" | "Policy"`
- `field`
- `severity: "blocking" | "warning"`
- `reason`
- `clarificationQuestion`
- `turnGreenCondition`
- `sourceRefs`

## 灯色判定策略

基础 4 轴：

- Goal：issue/spec 可说明要解决的问题，否则红灯。
- Evidence：至少有可追溯 Jira 证据（issue/comment/field/attachment），否则红灯。
- Scope：可定位页面/系统/流程则绿灯；仅有上下文但范围不明确时调查黄灯、实现红灯；严重缺失红灯。
- Testability：实现绿灯必须有可执行验收断言；缺失时调查黄灯、实现红灯。

Profile 轴：

- Visual / Integration / Workflow：按 W3 必填字段判定，缺必填不放行实现。
- Integration 可选风险项 `authBoundary/failureHandling/testFixtures` 缺失给 warning gap。
- Workflow 可选风险项 `businessRules/exceptionPaths/auditTrail` 缺失给 warning gap。
- Billing / AccessControl / General：W4 v0 不强行判绿，返回 `unsupported/need_more_context` 缺口，阻断实现。

Policy 轴：

- 命中硬规则时阻断。
- `highRiskMedicalDomain=true` 时调查可黄灯，但实现必须非绿（人工复核）。

## 硬规则（deterministic ruleId）

- `REQ-HARD-001-NO-JIRA-WRITE`
  - `attemptedJiraWrite=true` => hard block。
- `REQ-HARD-002-VISUAL-MEDIA-ATTACHMENT-BACKING`
  - Visual 中若 `jira.media:*` 无法通过 `attachmentId` 映射到 `jira.attachment:*` => hard block。
- `REQ-HARD-003-HIGH-RISK-MEDICAL-MANUAL-REVIEW`
  - `highRiskMedicalDomain=true` => implementation 不可绿，需人工复核。

## SourceRef 约束

- 所有 `sourceRefs`（包括 layer/gap/hardBlock/auditPayload）均仅从以下来源收敛：
  - `JiraEvidencePackV2.sourceRefs`
  - W3 spec/gap 中已验证的 `sourceRefs`
- 统一去重，禁止凭空生成来源。
- 当调用方显式传入 `profileSpecResult` 时，ReqGate 会校验其 `sourceRefs`、`gaps[].sourceRefs` 以及 spec 内部所有 trace 字段的 `sourceRef` 是否全部属于当前 `evidencePack.sourceRefs`。
- 如存在不匹配，将触发 `REQ-HARD-004-PROFILE-SPEC-SOURCE-REF-MISMATCH` 规则评估，并阻止 `implementationReady=green`。

## 验收命令

```bash
pnpm --filter @copilot-harness/orchestrator test -- src/requirements/gate.test.ts src/requirements/profiles.test.ts src/requirements/router.test.ts src/jira/evidence.test.ts
pnpm --filter @copilot-harness/orchestrator typecheck
pnpm --filter @copilot-harness/orchestrator lint
```

## 后续里程碑（W5/M5+）

W4 v0 未覆盖能力：

- OPA/Rego runtime 迁移
- Billing / AccessControl 的完整 Profile Spec 与 gate 细则
- 大样本评估（M5 50 samples）
- 与 Code-Impact Gate 的跨门禁联动
