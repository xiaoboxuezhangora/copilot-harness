# Showcase Demo Script (W4-D)

## 演示前准备

- 入口命令：`bash scripts/oc-showcase-export.sh --date 2026-05-03`
- 前端运行：`pnpm --filter @copilot-harness/showcase dev --host 127.0.0.1 --port 4173`
- 页面地址：`http://127.0.0.1:4173/`

## 路径 1：纯读文档分析（任务 + 证据链）

- 入口：
  - 首页状态卡片（`NOT_READY`、`READ_ONLY`、`demo data`）
  - Tab `任务面板` 与 `证据面板`
- 看点：
  - 任务记录按 `turn_state / execution_mode / role` 过滤
  - 任务详情显示 `prompt_version / runtime / model / policy_hit`
  - 证据面板展示 `evidence_count / confidence / assumptions`，缺失字段显示 `unknown`
- 缺字段或失败时解释：
  - `evidence_count=0`、`confidence=unknown` 来自当前 Phase 0 未提供 `state/tasks/**/*.json`
  - 此路径仅验证“只读展示与降级策略”，不宣称证据链完备

## 路径 2：跨文件改动分析（路由链 + 风险边界）

- 入口：
  - Tab `路由面板`
  - 图表 `Task Class 分布` + 右侧 `Route Chain Detail`
- 看点：
  - 路由链按 `task_class -> execution_mode -> role -> model_tier -> concrete_model` 展示
  - 缺失节点统一映射为 `unknown`，便于业务侧识别输入缺口
  - 首页 `Field Presence` 表直接对应字段覆盖率，不隐藏缺失
- 缺字段或失败时解释：
  - `execution_mode/role` 目前来自保守推导，真实任务态缺失导致 `unknown`
  - 这不影响展示结构，但阻塞“真实路径质量”验收

## 路径 3：高风险动作与 L3 审批展示（PolicyGate + 只读跳转）

- 入口：
  - Tab `MCP 调用面板`
  - 任务详情中的 `policy_hit`
- 看点：
  - `decision_mix` 展示 allow/deny/escalate 汇总
  - `side_effect_level=read` 明确 JiraReader 只读调用
  - 页面仅提供“复制导出命令”按钮，不执行任何写操作
- 缺字段或失败时解释：
  - 当前样本中无真实 `escalate` trace，仅能展示门禁位点与只读行为
  - 若需演示真实 L3 流程，必须补真实 trace 后再导出 snapshot

## 演示口径（固定）

- 本站为离线只读 Showcase，不执行 Jira/GitLab/Notion 写入。
- 当前状态是 `NOT_READY`，因为缺 `reports/audit.log`、`state/tasks/**/*.json`、真实 MCP trace。
- `demo data` 标签仅表示“演示补位数据”，不能当作真实生产链路凭证。
