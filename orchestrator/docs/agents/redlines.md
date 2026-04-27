# 红线条款（详细版）

- R1：所有 LLM 输出必须经 Validator 校验后才能写入目标系统。
- R2：病案、收费、CA 签名原文禁止进入 LLM prompt，事实发现走 MCP。
- R3：任何写操作（git push、Jira 写入、DB 变更）必须经 Policy Gate L2+ 审批。
- R4：Evidence Pack 必须包含完整 input→reasoning→output 链，不可省略。
- R5：人工 Review Loop 不可跳过，CI Gate 红灯禁止合入。
- R6：审计日志（OTel trace + audit.log JSONL）必须覆盖每次 tool call。
- R7：敏感数据（密钥、token、内网 IP）禁止出现在 LLM context 或日志明文中。
- R8：子 Agent（/fleet）fanout 上限由 BudgetGate 控制，超限 hard-stop。
- R9：验证期锁定 gpt-5-mini 单模型；放宽需同时满足以下三条：
  1. Eval 基线不回退：连续 2 次周级全量 Eval，passRate 相对上次基线下降不超过 2%（`delta >= -0.02`）；
  2. BudgetGate 压测达标；
  3. 专项 ADR 评审通过。
  - 触发方式：每次 MR 合入时自动运行 smoke 子集（10 题），passRate < 90% 则阻断合入；
  - 周级全量 Eval 由 GitLab CI Scheduled Pipeline 每周一 09:00 触发，结果写入 audit.log JSONL；
  - baseline 存于 `eval/baseline-smoke.json`（smoke）和 `eval/baseline-full.json`（全量），需人工确认初始值后提交。
