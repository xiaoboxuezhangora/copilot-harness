# 角色
你是资深 TS/Node 架构师，正在帮我从零启动 Copilot 自动化 Harness 项目。

# 背景
- 项目零基础，无现成仓库 / CI / Skill / MCP
- 目标运行环境：内网 GitLab + Linux VM（4C8G）+ Node.js LTS
- 全程锁定 **gpt-5-mini 单模型**（见 AGENTS.md 第 9 条红线）
- 本项目是一个 AI 自动化编程 harness：Copilot SDK 做执行壳、垂直资产（Skill / Memory / MCP / AGENTS / Eval）做认知脑、自建 TypeScript 编排服务做安全网

# 技术栈锁定（全程不变，除非 ADR 推翻）
- **Skill 规范**：遵循 agentskills.io 开放规范（Apache-2.0），`SKILL.md` body ≤ 500 行，超出走 `references/` / `scripts/` / `assets/` progressive disclosure；`description` 字段按"正触发 + 反触发"双向写法
- **AGENTS.md 硬约束**：主文件严格 **≤ 60 行**，超出即拆分到 `docs/agents/*.md`，防止污染 always-on context
- **MCP 开发栈**：`@modelcontextprotocol/sdk` v1.29.x + `mcp-framework` / `FastMCP-TS` 做脚手架
- **向量检索**：验证期锁 `sqlite-vec`（零运维），`pgvector` 仅 Phase 4 备选
- **LLM 可观测性**：OTel GenAI Semantic Conventions（`gen_ai.system` / `gen_ai.request.model` / `gen_ai.usage.input_tokens`），通过 `OTEL_SEMCONV_STABILITY_OPT_IN` 锁版本；W1-W8 先用 stdout exporter + `audit.log` JSONL
- **Node 版本**：`.nvmrc` 锁定 `v22.14.0`（当前 LTS）<!-- 👈 请按实际内网版本修改 -->

# 本周任务（W1 — 仓库骨架 + 编排服务 skeleton）

## 任务 1：建仓
在 GitLab `copilot-harness` group 下新建 3 个仓库，各自含 README + `.gitignore`（Node）+ LICENSE + CODEOWNERS：
- `orchestrator`（编排服务，TS 主体）
- `skills`（`.github/skills/*/SKILL.md` 集合）
- `playbooks`（`.github/playbooks/*.md`，Phase 3 才大量写入，先建仓占位）

## 任务 2：orchestrator 初始化
`pnpm workspace` + TypeScript strict + ESLint flat config + Prettier + Vitest + husky pre-commit（lint + typecheck）

## 任务 3：目录骨架
建以下目录并各放 `index.ts` 占位接口（本周只定义类型，不实现）：
- `src/runtime/` — AgentRuntime 接口 + CopilotSdkRuntime + CopilotCliRuntime 两实现占位
- `src/gates/` — BudgetGate / PolicyGate / Validator
- `src/context/` — Context Assembler
- `src/memory/` — Memory MCP client（先 stub）
- `src/audit/` — OTel exporter + audit log writer

## 任务 4：AGENTS.md v1
编写 `AGENTS.md` v1，**主文件严格 ≤ 60 行**，长细则外挂到 `docs/agents/*.md`。内容必须包含：

**(a) 九条红线摘要**（每条一行，编号 R1-R9）：
- R1：所有 LLM 输出必须经 Validator 校验后才能写入目标系统
- R2：病案 / 收费 / CA 签名原文禁止进入 LLM prompt（事实发现走 MCP）
- R3：任何写操作（git push / Jira 写入 / DB 变更）必须经 Policy Gate L2+ 审批
- R4：Evidence Pack 必须包含完整的 input→reasoning→output 链，不可省略
- R5：人工 Review Loop 不可跳过，CI Gate 红灯禁止合入
- R6：审计日志（OTel trace + audit.log JSONL）必须覆盖每次 tool call
- R7：敏感数据（密钥 / token / 内网 IP）禁止出现在 LLM context 或日志明文中
- R8：子 Agent（/fleet）fanout 上限由 BudgetGate 控制，超限 hard-stop
- R9：**验证期锁定 gpt-5-mini 单模型**，所有角色统一走同一模型；放宽需同时满足：连续 2 周 Eval 不回退 + BudgetGate 压测达标 + 专项 ADR 评审通过
<!-- 👈 请根据团队实际红线文档校准措辞 -->

**(b) turn_state 五态契约**（含语义定义）：
```typescript
type TurnState =
  | 'done'                // 任务完成，所有交付物已生成，可进入 Validator
  | 'continue_current'    // 当前步骤未完成，需要继续执行（如等待 MCP 返回）
  | 'await_human'         // 需要人工介入（如 Policy Gate L3 审批、歧义澄清）
  | 'blocked'             // 遇到不可自动恢复的阻塞（如 MCP 不可达、预算耗尽）
  | 'handoff_needed'      // 需要转交给其他 Agent 或人工接管（如超出当前 Skill 能力范围）
```

**(c) TS 编码规范**（要点，详细版外挂 `docs/agents/ts-style.md`）：
- strict 模式，禁止 `any`，优先 `unknown` + type guard
- 命名：camelCase 变量/函数，PascalCase 类型/接口，UPPER_SNAKE 常量
- 异步统一 async/await，禁止裸 `.then()` 链
- 错误处理：自定义 Error 类继承体系，禁止 `catch(e: any)`

**(d) 术语表**（外挂 `docs/agents/glossary.md`，主文件只放引用链接）：
SSO / 病案 / 输血闭环 / PDA / CA 签名 / Evidence Pack / turn_state / BudgetGate / Policy Gate / MCP

## 任务 5：GitLab CI 最小版
`.gitlab-ci.yml` 三阶段：`lint` → `typecheck` → `test`
- runner tag：`__RUNNER_TAG__` <!-- 👈 替换为实际内网 runner tag -->
- image：`node:22-alpine`（与 `.nvmrc` 对齐）
- cache：pnpm store

# 约束
- TS strict 模式，禁止 `any`；所有接口本周只定义类型，不实现
- `.nvmrc` 锁定 Node LTS 版本
- 不引入数据库、不连外部服务、不写 dev 密钥
- 所有文件用 LF + UTF-8
- `AGENTS.md` 主文件 **≤ 60 行**，这是硬约束
- OTel 属性命名遵循 GenAI Semantic Conventions（`gen_ai.*`），即使 W1 只是占位接口也要在注释中标注

# 交付物
- 3 个仓库 URL + `orchestrator` 的首个 MR 链接
- CI 绿截图
- `AGENTS.md` 全文（主文件 + `docs/agents/` 拆分文件）可直接发团队评审
- `docs/agents/glossary.md` 术语表初稿

# 自检清单（交付前逐项自查）
- [ ] `pnpm test` 本地与 CI 均绿
- [ ] ESLint / Prettier 全绿
- [ ] `AGENTS.md` 主文件行数 ≤ 60（`wc -l AGENTS.md` 验证）
- [ ] 9 条红线 R1-R9 无遗漏，措辞与红线文档一致
- [ ] turn_state 五态拼写全文一致，每个状态有一句话语义定义
- [ ] 无 `any` / 无 TODO 遗留（`grep -r 'any\|TODO' src/` 验证）
- [ ] `.nvmrc` 存在且版本号与 CI image 对齐
- [ ] 目录骨架 5 个模块各有 `index.ts`，导出类型定义
- [ ] OTel 相关接口注释中标注了 `gen_ai.*` 属性名
- [ ] 术语表至少覆盖 10 个核心术语

# 报告格式
完成后以四段式回我：
1. 创建的文件清单（按仓库分组）
2. 未完成项及原因
3. `AGENTS.md` 中你认为模糊需要我拍板的条款
4. 你在实现过程中发现的与本文档不一致或需要澄清的地方
