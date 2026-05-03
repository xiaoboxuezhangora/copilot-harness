# AGENTS v1 (W1)

本文件为 always-on 约束；扩展细则见 docs/agents/\*.md。

## 红线摘要（R1-R9）

R1 所有 LLM 输出必须经 Validator 校验后才能写入目标系统。
R2 病案 / 收费 / CA 签名原文禁止进入 LLM prompt，事实发现走 MCP。
R3 任何写操作（git push / Jira 写入 / DB 变更）必须经 Policy Gate L2+ 审批。
R4 Evidence Pack 必须包含完整的 input→reasoning→output 链，不可省略。
R5 人工 Review Loop 不可跳过，CI Gate 红灯禁止合入。
R6 审计日志（OTel trace + audit.log JSONL）必须覆盖每次 tool call。
R7 敏感数据（密钥 / token / 内网 IP）禁止出现在 LLM context 或日志明文中。
R8 子 Agent（/fleet）fanout 上限由 BudgetGate 控制，超限 hard-stop。
R9 验证期锁定 gpt-5-mini 单模型；放宽需同时满足 2 周 Eval 不回退 + BudgetGate 压测达标 + 专项 ADR 通过。

## turn_state 五态契约

```ts
type TurnState =
  | 'done' // 任务完成，交付物已生成，可进入 Validator
  | 'continue_current' // 当前步骤未完成，需要继续执行
  | 'await_human' // 需要人工介入（审批或歧义澄清）
  | 'blocked' // 不可自动恢复阻塞（MCP 不可达、预算耗尽）
  | 'handoff_needed'; // 需转交其他 Agent 或人工接管
```

## TypeScript 规范（摘要）

- strict 模式，禁止 any，优先 unknown + type guard。
- 命名：camelCase 变量/函数，PascalCase 类型/接口，UPPER_SNAKE 常量。
- 异步统一 async/await，禁止裸 then 链。
- 错误处理使用自定义 Error 继承体系，禁止 catch 参数使用 any。

## 外挂文档

- TS 详细规范：`docs/agents/ts-style.md`
- 术语表：`docs/agents/glossary.md`
- 红线详细版：`docs/agents/redlines.md`
