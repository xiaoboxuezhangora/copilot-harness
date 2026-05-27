# Requirements Analysis Upgrade W2 (M2)

## Scope

- 本文档仅覆盖 W2：`issue-type-router v0`。
- 输入合同固定为 `JiraEvidencePackV2`；不回退到 `JiraContextPackV1` 作为路由输入。
- 当前能力定位：`deterministic + replay + read-only`，不是生产自动分派。

## Delivery

- 新增路由模块：`orchestrator/src/requirements/router.ts`
- 新增路由测试：`orchestrator/src/requirements/router.test.ts`
- 新增模块导出：`orchestrator/src/requirements/index.ts`
- 新增路由小型样本集：`orchestrator/fixtures/requirements/issue-type-router-v0-samples.json`

## Input Contract

主入口：

```ts
routeIssueProfile(evidencePack: JiraEvidencePackV2, options?: IssueTypeRouterOptions)
```

输出：

- `profile`: `Visual | Integration | Workflow | Billing | AccessControl | General`
- `confidence`: `0..1`
- `matchedSignals`: 每条包含 `kind/profile/value/weight/sourceRef`
- `sourceRefs`: 由 `matchedSignals.sourceRef` 去重汇总
- `rationale`: 可解释结论
- `fallbackReason`: 回退原因（例如 `insufficient_evidence`、`ambiguous_profile_scores`）

## Rule Baseline (v0)

- `Visual`: UI/页面/样式/截图关键词，`image/*` 附件 MIME，截图类文件名。
- `Integration`: 接口/API/回调/webhook/字段映射/上下游/超时/重试关键词，集成模块元数据线索。
- `Workflow`: 流程/审批/状态流转/节点/步骤/触发条件/业务规则关键词。
- `Billing`: 收费/计费/金额/支付/退款/发票/账单/结算/医保关键词。
- `AccessControl`: 权限/角色/菜单/登录/SSO/OAuth/认证/授权/租户/签名关键词。
- `General`: 无足够可追溯信号、信号过弱、或多 profile 分数接近导致歧义时回退。

## Scoring & Confidence

- 每个 signal 有权重，按 profile 聚合分数。
- `confidence` 始终限制在 `0..1`。
- 若没有任何带合法 `sourceRef` 的命中信号，强制回退 `General` 且 `confidence <= 0.4`。
- 当最高分与次高分差距过小，降低置信度并以 `General` 回退，`rationale` 标明歧义。

## Traceability Constraint

- `matchedSignals[].sourceRef` 必须来自输入 `JiraEvidencePackV2.sourceRefs`。
- 不允许伪造 sourceRef。
- 测试覆盖 sourceRef 追溯与去重汇总。

## Replay Dataset Note

- 现有 `orchestrator/eval/jira-eval-50.json` 属于早期技能路由评测集，不是 `JiraEvidencePackV2` 的真实 Jira 50 样本回放数据。
- W2 已新增 router 专用小型 fixture（6 类全覆盖）用于本地逻辑验证。
- 真实 Jira 50 样本回放入口已预留；后续需从 Notion v2 事实基线导入并对接到 router 评测流程。

## Non-goals (This Round)

- Profile Spec v0
- ReqGate
- Code-Impact Gate
- Showcase 面板
- Jira 评论草稿 / Jira 写回
- GitLab MR 创建
- LLM 分型
- OCR / vision 多模态解析
