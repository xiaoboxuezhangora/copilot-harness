# W7：Code-Impact Gate beta 升级说明

## 范围与边界
- 新增 `CodeImpactReportV0`，定位为 `beta + nonBlocking + shadow`。
- 实现文件：`orchestrator/src/requirements/codeImpact.ts`。
- 测试文件：`orchestrator/src/requirements/codeImpact.test.ts`。
- 导出入口：`orchestrator/src/requirements/index.ts`。
- 本阶段不改 `RequirementGateResultV0` 合同，不将 beta 结果升级为硬阻断。
- 不调用真实 GitLab/Jira，不创建 MR/PR，不写回 Jira/Notion。

## 输入合同
`buildCodeImpactReportV0(input)` 支持以下输入：
- `evidencePack: JiraEvidencePackV2`
- `requirementGateResult?: RequirementGateResultV0`
- `profileSpecResult?: RequirementProfileSpecResultV0`
- `targetCodeMap?: TargetCodeMapV0`
- `gitlabContextPack?: GitLabContextPackV1Like`
- `resolverPacket?: ResolverPacketV1`

`TargetCodeMapV0` 合同：
- `schemaVersion: "TargetCodeMapV0"`
- `issueKey`
- `targets[]`（repo/branch/file/symbol/symbolKind/startLine/endLine/changeKind/sourceRef）
- `sourceRefs[]`

## 输出合同
`CodeImpactReportV0` 关键字段：
- `schemaVersion: "CodeImpactReportV0"`
- `beta: true`
- `nonBlocking: true`
- `issueKey`
- `status: "ready" | "need_more_context"`
- `profile`
- `targetCodeMapStatus`
- `dimensions[]`（六维）
- `overall`
- `downgradeSuggestions`
- `splitSuggestions`
- `sourceRefs`
- `auditPayload`

## need_more_context 触发条件
命中任一条件即 `status=need_more_context`：
- 缺少 `targetCodeMap`
- `targetCodeMap.issueKey` 为空（`targetCodeMapStatus=missing_issue_key`）
- `targetCodeMap.issueKey !== evidencePack.issue.key`（`targetCodeMapStatus=issue_key_mismatch`）
- `targetCodeMap.targets` 为空
- 所有 target 缺少可追溯 `sourceRef`
- `targetCodeMapStatus=partial_traceable_target`（存在任一 target 缺少合法 sourceRef）

此时强制：
- 六维全部 `gray`
- `overall.light=gray`
- `reason` 明确指出缺少 Target Code Map / code sourceRef，或 issueKey 不一致
- 不输出红黄绿代码结论

## sourceRef 可追溯约束
W7 仅允许使用以下来源作为代码证据：
- `targetCodeMap.sourceRefs`
- `target.sourceRef`
- `gitlabContextPack.evidence_refs[].source_ref`
- `gitlabContextPack.search_results[].source_ref`
- `gitlabContextPack.file_slices[].source_ref`
- `resolverPacket.source_refs`

实现策略：
- 先构建 allowed sourceRef 集合。
- 报告中的 `dimensions/sourceRefs`、`overall/sourceRefs`、`report.sourceRefs`、`auditPayload.sourceRefs` 都从该集合过滤并去重。
- 不允许生成集合外 sourceRef，避免 fabricated 证据。
- `partial_traceable_target` 视为证据链不完整，必须 `need_more_context + gray`，不能继续 `ready`。
- `Verifiability=green` 仅接受 `gitlabContextPack.search_results/file_slices` 中 `source_ref` 非空且在 allowed 集合内的 test/spec/fixture/mock 线索。
- 只有 path 没有合法 `source_ref` 的测试线索不能触发 `Verifiability=green`。
- `Verifiability` 维度 `sourceRefs` 必须包含实际测试线索 `source_ref`，不能只引用目标代码 sourceRef。

## 六维 deterministic 规则
- `SurfaceArea`
  - 1 文件/1 目标/1 repo：`green`
  - 2-5 文件或跨模块：`yellow`
  - >5 文件或跨 2+ repo：`red`
- `AbstractionInvasion`
  - leaf/component/local：`green`
  - service/API/shared/boundary：`yellow`
  - framework/core/global/cross-cutting：`red`
- `Compatibility`
  - add/local non-contract：`green`
  - modify public API/contract/mapping/state：`yellow`
  - delete/breaking(rename/remove/break) 信号：`red`
- `Verifiability`
  - 命中 test/spec/fixture/mock 线索：`green`
  - 仅 manual/UAT 线索：`yellow`
  - 无验证线索：`red`
- `Compliance`
  - 普通 local/UI：`green`
  - auth/billing/export/token/signature 敏感域：`yellow`
  - medical 高风险或鉴权绕过信号：`red`
- `Rollback`
  - 单文件可逆改动：`green`
  - 多文件但可拆分：`yellow`
  - migration/data destructive 信号：`red`

红灯策略：
- 至少提供 `downgradeSuggestions` 或 `splitSuggestions`。

## 与 ReqGate 关系
- 保持 `RequirementGateResultV0` 原样。
- `CodeImpactReportV0` 可额外输出：
  - `overall.stricterThanReqGate?`
  - `overall.combinedBetaLight? = max(reqGate implementationReady.light, codeImpact overall.light)`
- 该结果仅用于 beta 观察，不直接阻断主流程。

## 测试覆盖
`codeImpact.test.ts` 覆盖：
- 无 targetCodeMap -> need_more_context + gray
- targetCodeMap issueKey 与 Jira issueKey 不一致 -> need_more_context + gray
- target 无 sourceRef -> need_more_context
- 单文件 leaf -> SurfaceArea/Abstraction/Verifiability green
- 无 source_ref 的 test path 线索不能让 Verifiability 变 green
- 有合法 test/spec/fixture sourceRef 时 Verifiability green 且包含测试 sourceRef
- 多文件多模块 -> SurfaceArea yellow/red
- shared API/public contract 改动 -> Abstraction/Compatibility 非 green
- auth/billing/medical/token/signature -> Compliance 非 green
- 无测试线索 -> Verifiability red + turnGreenCondition
- 红灯报告 -> downgrade/split 建议
- sourceRefs 全链路合法来源 + 去重
