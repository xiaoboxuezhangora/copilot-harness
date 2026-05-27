# Requirements Analysis Upgrade W3

## Scope

W3 仅实现 `Profile Spec v0`，用于把 `JiraEvidencePackV2 + IssueTypeRouterResult` 转成结构化需求规格。

## Dependency

- 输入依赖 W1 的 `JiraEvidencePackV2`。
- 分型依赖 W2 的 `routeIssueProfile`（当 `routerResult` 未传入时内部调用）。
- 若输入 profile 为 `Billing / AccessControl / General`，当前返回 `unsupported_profile`，不强转为已支持 spec。

## Supported Profile Specs in W3

- `VisualDefectSpecV0`
- `IntegrationSpecV0`
- `WorkflowRequirementSpecV0`

W3 只完整支持上述三类。

其中 `IntegrationSpecV0` 也暴露 `acceptanceAssertions`（每条 assertion 带 `sourceRef`），并参与 `result.sourceRefs` 汇总。

## Not in W3

以下能力不在本轮实现范围：

- Billing / AccessControl / General 的完整 Profile Spec
- ReqGate（留到 W4）
- Code-Impact Gate
- Jira 评论草稿、Jira 写回
- GitLab MR 创建
- OCR / vision 内容识别
- LLM 提取

## Traceability Rules

- spec 字段、gap、acceptance assertion 都必须带 `sourceRef`。
- `result.sourceRefs` 为 spec/gap/assertion 的去重汇总。
- 所有 `sourceRef` 必须来自 `JiraEvidencePackV2.sourceRefs`。
- 不能追溯的内容不进入 spec，转为 gap 或忽略。

## Runtime Characteristics

当前实现仍是 deterministic / replay / read-only 形态：

- 不是生产准入门禁
- 不是 Jira 写操作链路
- 主要用于需求分析结构化输出
