# 角色

你是资深 TS/Node 架构师 + MCP 协议熟手，正在帮我把 W1 的 skeleton 变成能跑 hello world 的最小闭环。

# 背景

- W1 已完成：单仓 `copilot-harness` 下建好 `orchestrator/`、`skills/`、`playbooks/` 三个工作区目录，pnpm workspace + CI 绿、AGENTS.md v1 合入
- 现有 skeleton 目录：`src/runtime/` / `src/gates/` / `src/context/` / `src/memory/` / `src/audit/`
- 现有类型定义：`TurnState`（五态）、`AgentRuntime` 接口占位、`BudgetGate` / `PolicyGate` / `Validator` 接口占位、`ContextAssembler` 接口占位、`MemoryClient` 接口占位、`AuditLogger` / `OTelExporter` 接口占位
- 本周重点：跑通 **CLI → orchestrator → SDK → gpt-5-mini → JiraReader MCP** 的端到端链路
- 目标运行环境：内网 GitLab + Linux VM（4C8G）+ Node.js LTS

# 技术栈锁定（继承 W1，全程不变）

- **LLM 模型**：全程锁定 **gpt-5-mini 单模型**（R9 红线），代码中硬编码 `model: "gpt-5-mini"` + CI 断言保护
- **MCP 开发栈**：`@modelcontextprotocol/sdk` v1.29.x，transport 统一 stdio
- **Copilot SDK**：`@github/copilot-sdk`（Public Preview），若签名变动用 adapter 层隔离
- **Jira 版本**：Jira 7.10.1（内网实例），REST API v2
- **OTel**：GenAI Semantic Conventions（`gen_ai.system` / `gen_ai.request.model` / `gen_ai.usage.input_tokens`），W1-W8 用 stdout exporter + `audit.log` JSONL
- **Node 版本**：`.nvmrc` 锁定 `v22.14.0`
- **TS 规范**：strict 模式，禁止 `any`，自定义 Error 类继承体系，async/await 统一

# 本周任务（W2 — AgentRuntime 接口 + Copilot SDK 接入 + 第一个 MCP）

## 任务 1：AgentRuntime 接口定义

在 `src/runtime/types.ts` 中**替换** W1 占位，定义完整 `AgentRuntime` 接口：

```typescript
interface AgentRuntime {
  run(task: AgentTask): Promise<AgentResult>; // 单次执行
  spawn(n: number): Promise<AgentResult[]>; // 子 Agent fanout（受 BudgetGate 限制）
  onTurnEnd(hook: TurnEndHook): void; // turn 结束回调（审计 + Memory 候选采集点）
  onToolCall(hook: ToolCallHook): void; // tool call 拦截（PolicyGate 检查点）
  resumeSession(sessionId: string): Promise<AgentResult>; // 会话恢复（await_human → continue）
}
```

- `AgentTask` 必须包含 `taskId` / `prompt` / `turnState` / `budgetLimit` 字段
- `AgentResult` 必须包含 `turnState: TurnState` / `evidencePack` / `auditTraceId` 字段
- `TurnEndHook` 签名：`(result: AgentResult, context: TurnContext) => Promise<void>`
- `ToolCallHook` 签名：`(toolName: string, args: unknown, context: TurnContext) => Promise<ToolCallDecision>`
- `ToolCallDecision` 为 `'allow' | 'deny' | 'escalate'`（对应 PolicyGate L0-L2）

## 任务 2：CopilotSdkRuntime 实现

文件 `src/runtime/copilotSdkRuntime.ts`，实现 `AgentRuntime` 接口：

- 用 `@github/copilot-sdk` 的 `createAgent` API
- **硬编码** `model: "gpt-5-mini"`（R9），并在构造函数中加 runtime assertion
- 若 SDK 处于 Public Preview 导致 API 签名变动，通过 `src/runtime/adapters/copilotSdkAdapter.ts` 隔离，上层接口不动
- `onTurnEnd` 回调中调用 `src/audit/` 的 `AuditLogger.logTurn()` 写 JSONL
- `onToolCall` 回调中调用 `src/gates/` 的 `PolicyGate.check()` 做准入判断
- 每次 `run()` 调用生成 OTel span，属性包含 `gen_ai.system: "copilot"` / `gen_ai.request.model: "gpt-5-mini"`

## 任务 3：CopilotCliRuntime 实现（降级通道）

文件 `src/runtime/copilotCliRuntime.ts`，实现同一 `AgentRuntime` 接口：

- 子进程调用 `copilot --prompt --model gpt-5-mini`
- 解析 stdout JSON 输出，映射到 `AgentResult`
- 超时控制：默认 30s，可配置
- 降级场景：SDK 不可用时自动 fallback（由编排层控制，非 Runtime 内部逻辑）
- 同样触发 `onTurnEnd` / `onToolCall` 回调，保证审计一致性

## 任务 4：Jira Reader MCP Server

独立子包 `mcp-servers/jira-reader/`，用 `@modelcontextprotocol/sdk` v1.29.x：

- **只读**，3 个 tool：
  - `getIssue(issueKey: string)` → 返回 issue 详情（summary / description / status / assignee / priority / labels）
  - `searchIssues(jql: string, maxResults?: number)` → JQL 查询，默认 max 20
  - `getComments(issueKey: string)` → 返回评论列表
- Jira REST API v2（适配 Jira 7.10.1 内网实例）
- 凭证走环境变量 `JIRA_BASE_URL` / `JIRA_USERNAME` / `JIRA_API_TOKEN`，**不入仓**
- Transport：stdio（与 Copilot SDK MCP 集成方式对齐）
- 敏感字段脱敏：返回结果中不包含 reporter email / 内网 IP（R7）
- 错误处理：Jira 不可达时返回 MCP error response，不 crash server
- 子包有独立 `package.json` / `tsconfig.json` / `vitest.config.ts`

## 任务 5：端到端 Smoke 测试

`pnpm smoke` 脚本（`scripts/smoke.ts`）：

- 流程：CLI 入口 → orchestrator 调度 → CopilotSdkRuntime → 注册 JiraReader MCP → 读取一条 Jira issue → 返回结构化 JSON
- 两个 Runtime 实现必须过**同一** smoke 用例（降级一致性验证）
- 输出包含：`taskId` / `turnState` / `jiraIssue` / `auditTraceId`
- smoke 脚本支持 `--runtime sdk|cli` 参数切换
- 若无真实 Jira 可用，提供 mock Jira server（`mcp-servers/jira-reader/test/mockJiraServer.ts`）

## 任务 6：审计集成（W1 skeleton → W2 实装）

将 W1 的 `src/audit/` 占位接口实装为最小版：

- `AuditLogger.logTurn(result: AgentResult)` → 追加写入 `audit.log` JSONL
- 每条记录包含：`timestamp` / `taskId` / `turnState` / `model` / `toolCalls[]` / `traceId`
- OTel span 属性：`gen_ai.system` / `gen_ai.request.model` / `gen_ai.usage.input_tokens` / `gen_ai.usage.output_tokens`
- W2 阶段用 stdout exporter，不引入 OTel Collector

# 约束

- TS strict 模式，禁止 `any`；W1 已定义的接口类型本周替换为实现
- Jira 凭证走环境变量，**绝对不入仓**（R7）
- MCP Server 通过 stdio transport，不开 HTTP
- 两个 Runtime 实现必须过同一 smoke 用例
- 若 `@github/copilot-sdk` Public Preview 签名变动，用 adapter 层隔离，上层接口不动
- 不引入数据库、不连外部服务（Jira 除外）、不写 dev 密钥
- 所有文件 LF + UTF-8
- `AGENTS.md` 主文件保持 ≤ 60 行（如需更新，修改 `docs/agents/` 拆分文件）
- OTel 属性命名遵循 GenAI Semantic Conventions（`gen_ai.*`）

# 交付物

- `copilot-harness` 的 W2 MR 链接
- JiraReader MCP Server 子包 + 本地运行文档（`mcp-servers/jira-reader/README.md`）
- `pnpm smoke` 输出示例（至少 1 条 Jira issue 的 JSON，两个 Runtime 各一次）
- `audit.log` 示例（至少 2 条 JSONL 记录）
- CI 绿截图

# 自检清单（交付前逐项自查）

- [ ] `pnpm test` 本地与 CI 均绿
- [ ] `pnpm smoke --runtime sdk` 和 `pnpm smoke --runtime cli` 均绿
- [ ] 硬编码 `gpt-5-mini` 有 CI 断言保护（`grep -r 'gpt-5-mini' src/runtime/` 验证）
- [ ] JiraReader 只暴露 3 个只读 tool，无 write 操作
- [ ] CopilotCliRuntime 有降级单测
- [ ] Jira 凭证未泄漏到日志或代码（`grep -r 'JIRA_API_TOKEN\|password' src/` 验证无硬编码）
- [ ] 无 `any`（`grep -r ': any' src/` 验证）
- [ ] OTel span 属性包含 `gen_ai.system` / `gen_ai.request.model`
- [ ] `audit.log` JSONL 格式正确，每条含 `traceId` / `turnState` / `model`
- [ ] AgentRuntime 接口 5 个方法签名与 AGENTS.md turn_state 五态契约一致
- [ ] MCP Server 子包有独立 tsconfig + vitest 配置
- [ ] adapter 层存在且有注释说明 SDK 版本兼容策略

# 报告格式

完成后以四段式回我：

1. 可运行的 smoke 命令及输出示例
2. 已接入的 Jira 字段清单 + MCP tool schema
3. 你发现的 SDK / MCP 不足之处或 API 不稳定点
4. 与 W1 交付物的衔接问题（类型兼容性、接口变更等）
