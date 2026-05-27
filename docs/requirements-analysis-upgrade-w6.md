# W6 需求评审链路 Showcase 升级说明

## 范围与边界
- 本次仅在 `apps/showcase` 新增「需求评审链路」只读展示面板。
- 展示链路固定为：`JiraEvidencePackV2 -> issue-type-router -> Profile Spec -> ReqGate`。
- Router、Profile Spec、ReqGate 结构需对齐真实合同：
  - W2：`IssueTypeRouterResult`（`profile` 只能是 `Visual|Integration|Workflow|Billing|AccessControl|General`）
  - W3：`RequirementProfileSpecV0`（`spec.kind` 为 `VisualDefectSpecV0|IntegrationSpecV0|WorkflowRequirementSpecV0`）
  - W4：`RequirementGateResultV0`（轴仅 `Goal|Evidence|Scope|Testability|Profile|Policy`）
- W5 requirements eval 若存在则展示摘要；若不存在，展示 W1-W4 replay/shadow fixture 说明，不阻塞页面。
- 不实现 Code-Impact Gate。
- 不实现 Jira 评论草稿、自动写回、MR/PR 创建、Notion 写入。

## 数据来源
- Showcase 数据来源为本地 fixture：
  - `apps/showcase/src/generated/requirements-review-snapshot.json`
- 数据状态明确标记为：`replay / shadow / read-only`。
- 不调用真实 Jira/GitLab/Notion 写接口。
- fixture 中的 `sourceRef` 必须对齐 W1-W4 canonical 形态：
  - `jira.issue:<issueKey>`
  - `jira.comment:<issueKey>:<commentId>`
  - `jira.attachment:<issueKey>:<attachmentId>`
  - `jira.field:<issueKey>:<fieldId>`
  - `jira.field-value:<issueKey>:<fieldKey>`
  - `jira.media:<issueKey>:<attachmentId>`
- ReqGate 的 `result/sourceRefs/auditPayload.sourceRefs` 只能引用 JiraEvidencePackV2 或 W3 已验证 sourceRef，禁止使用 `reqgate:*` 这类非证据源前缀。
- 若前端为了可读性对合同字段做对象化展示（例如 `clarificationQuestions` 的对象形式），必须明确标注为 `view projection`，不能伪装成 W4 原始合同字段。

## 只读约束
- 页面首屏和样例详情均展示只读标识。
- 不提供写回动作入口（无状态流转、评论提交、MR/PR 创建按钮）。
- 前端不新增 `POST/PUT/PATCH/DELETE` fetch。
- 保留原 Showcase 既有页面，不破坏 Jira 调度与配置中心。

## 验证命令
```bash
pnpm --filter @copilot-harness/showcase test
pnpm --filter @copilot-harness/showcase typecheck
pnpm --filter @copilot-harness/showcase lint
pnpm --filter @copilot-harness/showcase lint:readonly
pnpm --filter @copilot-harness/showcase build
```

## 本地预览
```bash
pnpm --filter @copilot-harness/showcase dev -- --host 127.0.0.1 --port 4173
```
- 预览地址：`http://127.0.0.1:4173`
- 首屏应直接进入「需求评审链路」页面，可切换 Visual/Integration/Workflow 三个样例。
