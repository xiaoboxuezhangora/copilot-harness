# Requirements Analysis Upgrade W1 (M0 + M1)

## Scope Freeze

- 执行顺序固定为：先证据链、后分型、再准入、最后可视化。
- 本轮仅落地 M1（Evidence Pack v2 工程合同），其余能力保持 planned/shadow/read-only。
- 未完成能力不得标记为 live/production。
- Showcase / Resolver / Jira 写回边界保持不变：
  - Showcase: shadow
  - Resolver: 既有证据链不回退
  - Jira: read-only / no-write

## W1 Delivery Boundary

- 已纳入：
  - `JiraEvidencePackV2` 数据结构与构建函数
    - 字段元数据证据：`fields`
    - 字段值证据：`fieldValues`（覆盖 `affectedVersions`、`fixVersions`、`targetVersion`、`productModule`、`defectCategory`、`issueCategory`、`projectSource`、`coreRecovery`、`requirementReleased`、`timeTracking`）
  - PolicyGate Jira Reader 新增只读工具 allowlist
  - 对应最小测试覆盖
- 未纳入：
  - issue-type-router
  - Profile Spec
  - ReqGate
  - Code-Impact Gate
  - Jira 自动写回与任何写操作联动
  - W1 工程验收范围不包含 Showcase 大改，相关展示层变更应单独复核或拆分

## Release State Statement

- 当前状态：`planned + shadow + read-only`
- 不宣称上线：`not live`, `not production`
- 仍未上线：
  - Showcase 面板
  - Profile Spec
  - ReqGate
  - Code-Impact Gate
