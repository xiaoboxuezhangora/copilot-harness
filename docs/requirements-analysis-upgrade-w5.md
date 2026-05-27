# W5：50 样本 Eval 与人工复核闭环

## 目标

W5 将“需求分析链路（Router + ProfileSpec + ReqGate）”的人工复核结果固化为可本地回归的 eval，输出可审计、可定位失败样本的报告。

实现入口：

- `orchestrator/src/requirements/eval.ts`
- `pnpm --filter @copilot-harness/orchestrator requirements:eval`

## 前置门禁（W4）

在实现 W5 前已确认 W4 修复仍有效：

- 外部传入 `profileSpecResult` 若包含不属于当前 `evidencePack.sourceRefs` 的 sourceRef，ReqGate 不会放行 `implementation_ready=green`。
- 对应回归测试位于 `orchestrator/src/requirements/gate.test.ts`（mismatch case）。

## Eval Fixture Schema

文件：`orchestrator/fixtures/requirements/requirements-eval-v0-samples.json`

- `schemaVersion`: `requirements-analysis-eval-v0-samples@1`
- `samples[]` 每条至少包含：
  - `sampleId`
  - `issueKey`
  - `evidencePack` (`JiraEvidencePackV2`)
  - `expected`
    - `profile`
    - `investigationLight`
    - `implementationLight`
    - `keyGaps[]`
    - `requiredSourceRefs[]`
    - `unsupportedReason?`
  - `review`
    - `reviewer`
    - `reviewedAt`
    - `reviewSourceRef`
    - `adjustmentReason`
  - `metadata`
    - `source`: `notion-v2-50-review | local-fixture | manual-replay`
    - `highRiskMedicalDomain?`
    - `attemptedJiraWrite?`

说明：

- 当前仓库已接入 Jira filter `86004`（`主版本jira列表`）下 17 条真实 Jira partial replay 样本。
- 这 17 条样本来自真实 Jira 页面/API，但尚未完成 Notion v2 50 条人工复核闭环，因此 `metadata.source` 仍保持 `manual-replay`，不计入 `realReviewedSampleCount`。
- fixture 解析采用 typed parser + type guard；malformed fixture 会被拒绝。
- fixture 中不保存附件 base64 或二进制内容，仅保存 metadata/sourceRef。

## 执行流程

每条样本按固定顺序 replay：

1. `routeIssueProfile(evidencePack)`
2. `buildRequirementProfileSpecV0({ evidencePack, routerResult })`
3. `buildRequirementGateV0({ evidencePack, profileSpecResult, routerResult, runtimeFlags })`

产出单样本摘要：

- `routerTop1Pass`
- `investigationGatePass`
- `implementationGatePass`
- `keyGapsPass`
- `sourceRefCoveragePass`
- `profileFieldCompleteness`
- `failureReasons[]`

## 报告合同

输出：

- `orchestrator/eval/requirements-analysis-v0-report.json`
- `orchestrator/eval/requirements-analysis-v0-report.md`

`report.schemaVersion = requirements-analysis-eval-v0-report@1`

核心字段：

- `status`: `PASS | FAIL | NOT_READY`
- `dataset`
  - `sampleCount`
  - `requiredSampleCount=50`
  - `realReviewedSampleCount`
  - `missingReviewMetadataCount`
- `metrics`
  - `routerTop1Accuracy`
  - `investigationGateAccuracy`
  - `implementationGateAccuracy`
  - `sourceRefCoverage`
  - `profileFieldCompletenessAverage`
  - `redRecall`
  - `yellowFalsePositiveRate`
- `failures[]`（含 sampleId/issueKey/category/expected/actual/missingSourceRefs/missingGaps/reason）
- `samples[]`（逐样本完整摘要）

## 指标口径

- `sourceRefCoverage`: `requiredSourceRefs` 是否均出现在 `evidencePack.sourceRefs` 或 `gateResult.sourceRefs`。
- `profileFieldCompletenessAverage`:
  - 仅统计 `Visual / Integration / Workflow`。
  - `Billing / AccessControl / General` 进入 unsupported bucket（不计入平均值分母）。
- `redRecall`: 以 `expected.implementationLight=red` 为正例，统计实际 `implementationLight=red` 召回率。
- `yellowFalsePositiveRate`: 以 expected 非 yellow 的样本为分母，统计实际预测为 yellow 的比例。

## NOT_READY 条件

任一命中即 `NOT_READY`：

- `sampleCount < 50`
- `realReviewedSampleCount < 50`
- `missingReviewMetadataCount > 0`

因此在真实 50 样本未入库前，报告必须保持 `NOT_READY`，不能伪装 PASS。

## 当前阻塞

- 仍缺失 50 条 `notion-v2-50-review` 真实人工复核样本（含完整 review metadata 与 sourceRef 证据）。
- Jira filter `86004` 当前只返回 17 条真实样本，不满足 W5 终验样本量。
- 当前 partial replay 暴露了真实列表上的 router/profile gap：带截图的流程/集成/计费类问题容易被规则路由误分到 `Visual`，需要后续按真实失败样本优化规则权重。
