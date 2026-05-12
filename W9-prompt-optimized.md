# W9 Codex 执行版优化提示词

本文件用于 Phase 1c W9：三项加固 + BudgetGate 压测 + 单模型放行门槛评审。不要一次性把全部内容投喂给 Codex；按 W9-0、W9-A、W9-B、W9-C、W9-D、W9-E、W9-F 顺序分批执行。每一批执行前都要求 Codex 重新读取仓库状态与上一批交付物，避免覆盖已有 W6-W8 代码。

## Notion W9 目标重述

来源：Notion 页面《Phase 1 - Skill 化 + Auto-Memory + 验证期加固（W5-W9）》中的 W9 段落。

W9 不是继续扩展 Jira/GitLab 分析能力，也不是提前进入多 Agent 写回。W9 的核心是 Phase 1c 的门槛验收周：把 W7-W8 已搭好的 Auto-Memory、Memory MCP、Context Assembler、AgentRuntime、BudgetGate 从“能跑”加固到“能被审计、能压测、能决定是否放宽单模型约束”。

必须守住的阶段边界：

- 默认继续锁定 `gpt-5-mini` 单模型；W9 只写放行评审，不直接切换默认模型。
- 任一门槛未达标，ADR 必须记录“不放行/继续单模型”，不能为了进入 Phase 2 修改结论。
- W9 可以实现冲突检测、hot_index、压测 harness、只读健康看板；不得创建 MR、push、改 Jira、写 GitLab、绕过 PolicyGate。
- 如果 W8 真实 Jira+GitLab Eval 仍未通过，W9 最终结论只能是“技术加固可验收，单模型放行未达标”。

## 市面对标结论（2026-05-08）

主流方案的方向已经从“更长 prompt”转向“Agent 控制面 + 可追溯上下文 + 受控工具 + 预算/审计 + 私有 Eval”。W9 应该补控制面和门槛，而不是再堆业务 prompt。

- GitHub Copilot 正在把 coding agent、custom agents、MCP、custom instructions、code review、模型选择和 premium request 预算放在同一控制面里。对 W9 的启发是：多模型和多 agent 是受策略、预算和审计约束的能力，不应在默认路径直接放开。
- GitLab Duo Agent Platform 已把 Planner Agent、Software Development Flow、Code Review Flow、MCP client、Knowledge Graph、sandbox 与审计整合到 DevSecOps 平台。对 W9 的启发是：AgentRuntime 接口和 tool sandbox 必须定型，否则后续多 agent 会失控。
- Atlassian Rovo Dev CLI 支持项目/用户 memory、saved prompts、tools、subagents、MCP、worktree mode 和模型切换；同时不同模型消耗不同 credit。对 W9 的启发是：Memory 必须分层、可审计、可清理；BudgetGate 必须能解释为什么熔断。
- Sourcegraph Cody 把上下文拆成 keyword search、Sourcegraph Search、embeddings、Code Graph、repo context、open tabs 等多个来源。对 W9 的启发是：Context Assembler 默认只能注入 hot_index，详情必须 lazy load，并保留 source_ref。
- OpenAI Agents SDK 的 guardrails、tracing、MCP 工具过滤和 handoff 机制说明，工程化 Agent 需要把输入/输出防护、工具边界和 trace 作为一等对象。对 W9 的启发是：PolicyGate、Validator、BudgetGate、audit.log/OTel 需要统一到验收报告。
- MCP 官方 tool annotations 已定义 `readOnlyHint`、`destructiveHint`、`idempotentHint`、`openWorldHint` 等提示。对 W9 的启发是：所有新增 read tools 必须声明 read-only，写入类 tools 必须经过人工/PolicyGate。
- OpenTelemetry GenAI semantic conventions 仍在演进，但已经覆盖模型请求、token、tool/retrieval 等观测维度。对 W9 的启发是：压测和门槛报告要落在标准化 span/audit 字段，而不是散落日志。
- SWE-bench Verified 等公开基准容易被污染或被目标化优化；W9 的放行依据应该优先使用项目私有 50 样本 Eval、真实 source_ref 和可复核失败样本。

参考来源：

- GitHub Copilot coding agent MCP: https://docs.github.com/en/copilot/concepts/coding-agent/mcp-and-coding-agent
- GitHub Copilot custom agents: https://docs.github.com/en/copilot/customizing-copilot/custom-agents/about-custom-agents
- GitHub Copilot billing / premium requests: https://docs.github.com/en/copilot/concepts/billing/copilot-requests
- GitLab Duo Agent Platform: https://docs.gitlab.com/user/duo_agent_platform/
- GitLab Duo Agent Platform Flows: https://docs.gitlab.com/user/duo_agent_platform/flows/
- Atlassian Rovo Dev CLI: https://support.atlassian.com/rovo/docs/use-rovo-dev-cli/
- Atlassian Rovo Dev CLI memory: https://support.atlassian.com/rovo/docs/use-memory-in-rovo-dev-cli/
- Atlassian Rovo Dev CLI model switching: https://support.atlassian.com/rovo/docs/switch-between-large-language-models-in-rovo-dev-cli/
- Sourcegraph Cody context: https://sourcegraph.com/docs/cody/core-concepts/context
- OpenAI Agents SDK guardrails: https://openai.github.io/openai-agents-python/guardrails/
- OpenAI Agents SDK tracing: https://openai.github.io/openai-agents-python/tracing/
- Model Context Protocol tool annotations: https://modelcontextprotocol.io/specification/2025-06-18/server/tools#tool-annotations
- OpenTelemetry GenAI semantic conventions: https://opentelemetry.io/docs/specs/semconv/gen-ai/
- sqlite-vec: https://github.com/asg017/sqlite-vec
- OpenAI on SWE-bench Verified limitations: https://openai.com/index/why-we-no-longer-evaluate-swe-bench-verified/

## 当前仓库事实

执行 W9 前必须先重新确认，因为工作区可能已有未提交改动。

- 当前仓库是单仓 `copilot-harness`，含 `orchestrator/`、`mcp-servers/memory/`、`mcp-servers/code-retrieval/`、`apps/showcase/`。
- `apps/showcase/package.json` 使用 Vue 3 + Vite + TypeScript；W9 前端只允许做真实 gate/audit 只读展示。
- `orchestrator/AGENTS.md` 的 R9 仍锁定 `gpt-5-mini` 单模型；放宽必须满足 Eval 不回退 + BudgetGate 压测 + ADR。
- W8 交付物已经存在：`docs/phase-1b-w8-review-cli-contract.md`、`docs/phase-1b-w8-code-retrieval-contract.md`、`prompts/jira-gitlab-analysis.v1.md`、`orchestrator/src/w8Eval.ts`、`mcp-servers/code-retrieval/`。
- `orchestrator/eval/w8-report.md` 当前状态为 `NOT_READY`：真实 Jira+GitLab 联合样本 0/20，GitLab/Jira env 未配置，Repo Hit@1、accept_rate、review_time_minutes 均不可用。
- `mcp-servers/memory/src/tools.ts` 当前只有 `put/get/search/list`，尚无 `hotIndex`、冲突检测或 embedding 索引。
- `mcp-servers/memory/src/store.ts` 当前 SQLite 表为 `decisions/knowledge_index/aliases`，search 仍是 `LIKE`，尚无 hit_count、last_hit_at、embedding 或 hot_index view。
- `orchestrator/src/context/index.ts` 已实现 Memory > Retrieval > Skill 顺序和 retrieval budget，但 Memory 仍直接 search 注入，尚未默认 hot_index + lazy search。
- `orchestrator/src/runtime/types.ts` 已有 `AgentRuntime`、`AgentTask`、`AgentResult`、`BudgetUsage`，默认模型类型只有 `gpt-5-mini`。
- `CopilotSdkRuntime` / `CopilotCliRuntime` 的 `spawn` 与 `resumeSession` 仍抛 Not implemented；W9 不能把 `/fleet fanout=5` 当成真实多 agent 能力，只能先压测 BudgetGate/harness 行为。
- `orchestrator/src/gates/index.ts` 的 `DefaultBudgetGate` 当前只做阈值判断并抛 `BudgetExceededError`，尚无 partial result 合约、P95 校准报告或强制超限测试。

## 原 W9 提示词质量评估

结论：原 W9 提示词方向正确，但还不够适合当前仓库状态。它把“技术加固”和“放行判定”混在一起，容易在 W8 未通过时误给多模型放行。

DONE 已明确的点：

- 三项加固方向明确：Memory 冲突检测、Memory 分层加载、AgentRuntime 接口定型。
- BudgetGate 压测目标明确：fanout=5 + Auto-Memory，P95 留 20% 余量，5 次超限正确熔断。
- ADR 必须包含放行条件、试点范围、回滚条件、责任人。
- 前端只读 gate 健康看板的方向符合 Showcase 真实数据收敛原则。

QUALITY 主要缺口：

- 缺少 W9-0 readiness gate：必须先读取 W8 报告和真实样本，否则 ADR 结论无效。
- 把 `sqlite-vec` 和 `vss_search` 混写；`vss_search` 更像 sqlite-vss 口径，W9 应改为“sqlite-vec 能力检测 + adapter 封装”，避免把 SQL 细节写死在 prompt。
- 冲突检测缺少数据契约：embedding 表、conflict candidate、compare 决策、audit 字段和 fallback 策略都未定义。
- hot_index 缺少评分规则：最近命中、置信度、人工接受、source_ref 可信度、过期项处理都未定义。
- AgentRuntime “锁签名”缺少产物：应有 contract doc、类型快照测试、SDK/CLI 20 样本 smoke 报告和变更 ADR 流程。
- BudgetGate 缺少 partial result 合约，熔断只抛错会让上层无法交付可审计的部分结果。
- 前端项没有约束真实数据来源，容易重新出现假 KPI、假 Agent 状态。

## W9 优化原则

- 先门槛读取，再技术实现，最后 ADR 结论；不要先写“允许试点”。
- W8 未 ready 时，W9 仍可完成技术加固，但最终 gate 必须失败或延后。
- 所有新增能力先落 contract，再实现，再测试，再生成报告。
- embedding provider 必须 allowlist：本地 `bge-small-zh` 或 OpenAI `text-embedding-3-small`；测试用 deterministic mock，不依赖网络。
- Memory 冲突检测是 Review CLI accept/edit 前置检查，不是 harvester 自动入库。
- Context Assembler 默认注入 hot_index 摘要，详情走 `search` lazy load；不能把全量 Memory 塞进 prompt。
- AgentRuntime 接口定型必须保留单模型默认；多模型试点只能出现在 ADR 的受控范围。
- BudgetGate 熔断必须返回 partial result + audit，不得静默失败。

## 通用前置提示词

```markdown
你在仓库 `/Users/wangbo/own/copilot-harness` 中工作。本轮是 Phase 1c W9：三项加固 + BudgetGate 压测 + 单模型放行门槛评审。不要重做 W1-W8，不要覆盖已有未提交改动。

# 必须先检查
1. 运行 `git status --short`，确认工作区已有改动；只改本阶段声明文件，禁止 revert 或覆盖他人改动。
2. 读取：
   - `orchestrator/AGENTS.md`
   - `README.md`
   - `docs/phase-1a-w6-memory-contract.md`
   - `docs/phase-1b-w8-review-cli-contract.md`
   - `docs/phase-1b-w8-code-retrieval-contract.md`
   - `prompts/harvester.v1.md`
   - `prompts/jira-gitlab-analysis.v1.md`
   - `orchestrator/eval/w8-report.md`
   - `orchestrator/eval/w8-report.json`
   - `orchestrator/src/automemory/reviewCli.ts`
   - `orchestrator/src/context/index.ts`
   - `orchestrator/src/gates/index.ts`
   - `orchestrator/src/runtime/types.ts`
   - `orchestrator/src/runtime/{copilotSdkRuntime.ts,copilotCliRuntime.ts}`
   - `mcp-servers/memory/src/{tools.ts,schemas.ts,types.ts,store.ts,security.ts}`
3. 搜索是否已存在 `hot_index`、`conflict`、`embedding`、`BudgetGatePressure`、`RuntimeContract`、`w9`。如存在，优先增量补齐。

# W9 总目标
完成 Phase 1c 可审计门槛：
- Auto-Memory Review CLI 在 accept/edit 前执行 Memory 冲突检测，并提供 compare 决策。
- Memory MCP 支持 hot_index 分层加载，Context Assembler 默认只注入 hot_index，详情 lazy search。
- AgentRuntime V1 接口定型，SDK/CLI 两实现各过 20 样本 smoke 或明确记录真实环境阻塞。
- BudgetGate 压测 fanout=5 + Auto-Memory 并发预算，产出 P95、建议阈值、5 次强制超限熔断证据。
- ADR 记录单模型放行结论：三项门槛全过才允许 Phase 2 末期受控试点，否则继续 `gpt-5-mini`。

# 全局红线
- 不创建 MR，不 push，不提交远程分支，不改 Jira 状态，不写 GitLab/Notion。
- Jira/GitLab/OpenAI token 只读 env，不入仓、不进日志、不进 prompt。
- Memory value / embedding input 禁止包含 PHI、患者标识、收费明细、CA 私钥、平台凭证、完整敏感请求/响应。
- 未命中真实证据时输出 `need_more_context` 或 `ask_human`，不得编造 repo/module/file/metric。
- 默认模型仍是 `gpt-5-mini`，任何多模型试点只能写入 ADR 的条件化建议。

# 实现原则
- 先 contract 和测试，再实现；所有新增 JSON/audit 字段使用 snake_case。
- TypeScript strict，禁止 `any`；外部响应使用 `unknown` + type guard/zod。
- sqlite-vec 作为可选能力检测；测试必须用 deterministic mock，不依赖本机扩展或网络。
- 超过 120 秒的全量验证先说明原因；默认跑最小必要验证。

# 通用报告格式
1. 修改文件清单
2. 执行的验证命令与结果
3. W8 readiness 状态是否阻塞 W9 放行结论
4. W9 指标：conflict_detected_count、conflict_resolution_rate、hot_index_coverage、runtime_smoke_pass、budget_p95、forced_overrun_pass、ADR decision
5. 未完成项、原因、是否阻塞 Phase 2
```

## W9-0：Readiness Gate + W8 回归状态确认

```markdown
你在 `/Users/wangbo/own/copilot-harness` 中工作。目标是完成 W9-0：先确认 W8 是否具备进入 W9 放行评审的真实证据。本阶段只读，不做功能实现。

# 请执行
1. 读取通用前置上下文，重点读：
   - `orchestrator/eval/w8-report.md`
   - `orchestrator/eval/w8-report.json`
   - `orchestrator/src/w8Eval.ts`
   - `orchestrator/eval/w8-eval-schema.json`
2. 检查 W8 readiness：
   - `status` 是否为 ready/pass，而不是 `NOT_READY`。
   - real_joint_sample_count 是否 ≥ 20。
   - source_ref_coverage 是否为 100%。
   - Repo Hit@1 是否可计算。
   - Review CLI accept_rate 是否 ≥ 40%，review_time_minutes 是否 ≤ 10。
   - Jira/GitLab readonly env 是否存在；不要打印 token 值。
3. 如果 W8 未 ready，创建或更新 W9 readiness 说明文档，例如 `docs/phase-1c-w9-readiness.md`：
   - 当前缺口
   - 是否阻塞技术加固
   - 是否阻塞 ADR 多模型放行
   - 进入 W9-A/W9-B/W9-C/W9-D 的前置假设
4. 不要为了让 W8 ready 去改假数据、mock 数据或伪造 source_ref。

# 判定规则
- W8 未 ready 不阻塞 W9 技术加固。
- W8 未 ready 必然阻塞“允许 Phase 2 末期多模型试点”的 ADR 结论。
- W9 后续提示词必须把 readiness 结论带入最终报告。

# 验证
- `pnpm --filter @copilot-harness/orchestrator eval:w8`（如真实环境缺失，可记录为 blocked，不要伪造）
- `pnpm --filter @copilot-harness/orchestrator test -- w8Eval`

# 交付
1. W8 readiness 结论
2. W9 是否可继续技术加固
3. ADR 是否可放行多模型
```

## W9-A：Auto-Memory 冲突检测 + Review CLI Compare

```markdown
你在 `/Users/wangbo/own/copilot-harness` 中工作。目标是完成 W9-A：Auto-Memory 入库前冲突检测，并在 Review CLI 中新增 compare 决策。本阶段只做 Memory 冲突检测与 Review CLI 流转，不改 Context Assembler、不做 BudgetGate 压测。

# 请执行
1. 读取通用前置上下文，重点读：
   - `mcp-servers/memory/src/{store.ts,tools.ts,schemas.ts,types.ts,security.ts}`
   - `orchestrator/src/automemory/reviewCli.ts`
   - `orchestrator/src/automemory/reviewCli.test.ts`
   - `docs/phase-1b-w8-review-cli-contract.md`
2. 新增 contract 文档，例如 `docs/phase-1c-w9-memory-conflict-contract.md`，定义：
   - `MemoryEmbeddingRecordV1`
   - `MemoryConflictCandidateV1`
   - `MemoryConflictDecisionV1`
   - similarity 阈值、fallback 行为、audit 字段
3. Memory store 增加冲突检测能力：
   - 写入前生成 candidate embedding。
   - 在同 namespace 内查相似条目，默认 conflict 阈值 `similarity >= 0.85`。
   - sqlite-vec 可用时使用 sqlite-vec adapter；不可用时降级 deterministic lexical similarity，并在 warnings/audit 中标记 `embedding_backend=fallback_lexical`。
   - 不要把 SQL 细节写死为 `vss_search`；封装为 `findSimilarMemoryRecords()`，以后可切 sqlite-vec / sqlite-vss / pgvector。
4. embedding provider：
   - allowlist：`local_bge_small_zh`、`openai_text_embedding_3_small`、`deterministic_test`.
   - 测试默认 `deterministic_test`，不调用网络。
   - 真实 provider 只读 env 配置，不记录 token。
5. Review CLI 行为：
   - `accept` / `edit` 前先跑 conflict check。
   - 若有冲突，显示 `c` compare 选项。
   - compare 后必须选择：`keep_existing`、`replace_existing`、`merge`、`add_new`、`reject`、`skip`。
   - `add_new` 需记录 reviewer reason；`replace_existing` / `merge` 必须写 edited_fields。
   - 冲突未处理时不能入库。
6. 审计事件：
   - `automemory.conflict_check`
   - `automemory.conflict_decision`
   - 字段包含 task_id、candidate_key、candidate_kind、namespace、conflict_count、top_similarity、embedding_backend、decision、reviewer、memory_write_ok、source_ref。

# 约束
- Harvester 仍只产 pending，不自动解决冲突。
- Alias 仍必须 `manual_entry=true`。
- 命中 redline 的 value 不得 embedding、不入库。
- 不删除 pending 文件，除非写入/归档流程成功。

# 验证
- `pnpm --filter @copilot-harness/memory-mcp test`
- `pnpm --filter @copilot-harness/orchestrator test -- reviewCli`
- `pnpm --filter @copilot-harness/orchestrator typecheck`

# 交付
1. Memory conflict contract
2. store/tool/schema/review CLI 增量实现
3. conflict check 与 compare 决策单测
4. dry-run 或测试中的 compare 输出示例
```

## W9-B：Memory hot_index + Context Assembler 分层加载

```markdown
你在 `/Users/wangbo/own/copilot-harness` 中工作。目标是完成 W9-B：Memory 分层加载，默认只把 hot_index 注入 prompt，详情通过 search lazy load。本阶段不改 Review CLI 冲突检测，不做 Runtime 定型。

# 请执行
1. 读取通用前置上下文，重点读：
   - `mcp-servers/memory/src/{store.ts,tools.ts,schemas.ts,types.ts}`
   - `orchestrator/src/memory/index.ts`
   - `orchestrator/src/context/index.ts`
   - `orchestrator/src/context/index.test.ts`
2. 新增 contract 文档，例如 `docs/phase-1c-w9-hot-index-contract.md`，定义：
   - `MemoryHotIndexRecordV1`
   - score 计算规则
   - hit_count / last_hit_at / last_injected_at 更新规则
   - Context Assembler 注入预算
3. Memory store 增加统计字段或独立表：
   - namespace
   - key
   - hit_count
   - last_hit_at
   - last_injected_at
   - accepted_at 或 ts
   - confidence（decisions 有值，其他 namespace 用默认权重）
4. hot_index 排序建议：
   - `score = recency_score * 0.35 + confidence_score * 0.25 + log_hit_score * 0.25 + source_quality_score * 0.15`
   - 过期 decisions 默认排除。
   - redline/redacted 条目不得进入 hot_index。
   - 默认 top 200，单条 summary 限制字节数。
5. MCP tools：
   - 新增只读 `hotIndex({ namespace?, limit?, include_expired? })`。
   - `search` / `get` 命中时更新 hit_count；如果当前接口不适合副作用，新增明确的 `recordMemoryHit` 内部方法，不暴露给 LLM。
   - tool annotations：`hotIndex` 为 read-only。
6. Context Assembler：
   - `assembleForJiraGitLabAnalysis` 默认优先 hot_index。
   - 详情仍通过 search lazy load，不自动注入全量 Memory。
   - prompt 渲染增加 `memory_loading_strategy: hot_index_then_lazy_search`。
   - 保持顺序：Memory hot_index > Retrieval > Skill。
7. 测试：
   - hot_index 只返回 top N。
   - expired/redline 不进入 hot_index。
   - hit_count/last_hit_at 更新。
   - Context Assembler 不再直接注入超过预算的 Memory。

# 约束
- 不引入生产外部数据库。
- 不把完整 Memory value 无预算注入 prompt。
- 不为了测试修改真实 memory sqlite。

# 验证
- `pnpm --filter @copilot-harness/memory-mcp test`
- `pnpm --filter @copilot-harness/orchestrator test -- context`
- `pnpm --filter @copilot-harness/orchestrator typecheck`

# 交付
1. hot_index contract
2. Memory MCP `hotIndex` 只读工具
3. Context Assembler 分层加载
4. 单测和 prompt snapshot 更新
```

## W9-C：AgentRuntime V1 接口定型 + SDK/CLI Smoke

```markdown
你在 `/Users/wangbo/own/copilot-harness` 中工作。目标是完成 W9-C：AgentRuntime V1 接口定型，任何后续变更必须走 ADR。本阶段不实现真实多 agent fanout，不放宽默认模型。

# 请执行
1. 读取通用前置上下文，重点读：
   - `orchestrator/src/runtime/types.ts`
   - `orchestrator/src/runtime/{copilotSdkRuntime.ts,copilotCliRuntime.ts}`
   - `orchestrator/src/runtime/adapters/{types.ts,shared.ts,copilotSdkAdapter.ts,copilotCliAdapter.ts}`
   - `orchestrator/src/runtime/runtime.test.ts`
   - `orchestrator/src/smoke.ts`
   - `docs/adr/0002-w2a-runtime-and-mcp-ownership.md`
2. 新增 contract 文档，例如 `docs/phase-1c-w9-agent-runtime-contract.md`：
   - `AgentRuntimeV1`
   - `AgentTaskV1`
   - `AgentResultV1`
   - `TurnContextV1`
   - capability flags 含义
   - not implemented 能力的显式语义
3. 类型冻结：
   - 保持 `RuntimeModel = 'gpt-5-mini'`。
   - `spawn` / `resumeSession` 若仍未实现，必须在 capabilities 和错误类型中可审计表达，而不是普通 Error。
   - 增加类型快照测试，防止签名无 ADR 被改。
   - 如果必须变更签名，先写 ADR 草稿，不直接改调用方。
4. SDK/CLI smoke：
   - 两 Runtime 各跑 20 样本 smoke；真实环境缺失时运行 mock smoke 并记录 live blocked 原因。
   - smoke 报告写 `orchestrator/eval/w9-runtime-smoke.{json,md}`。
   - 报告字段：runtime、sample_count、pass_count、blocked_count、model、reasoning_effort、capability_supported、unsupported_reasons、audit_trace_coverage。
5. Audit：
   - 每个 smoke 样本必须有 audit_trace_id。
   - 输出中不得包含 token 或环境变量原值。

# 约束
- 不实现真实 `/fleet`。
- 不加入新默认模型。
- 不把 SDK/CLI 差异藏在 prompt；必须进入 runtime matrix。

# 验证
- `pnpm --filter @copilot-harness/orchestrator test -- runtime`
- `pnpm --filter @copilot-harness/orchestrator smoke -- --runtime sdk --mode mock`
- `pnpm --filter @copilot-harness/orchestrator smoke -- --runtime cli --mode mock`
- 如 live 环境齐备，再分别跑 live；预计超过 120 秒先说明。

# 交付
1. AgentRuntime V1 contract
2. 类型快照/contract 单测
3. SDK/CLI smoke 报告
4. 未实现能力的明确审计语义
```

## W9-D：BudgetGate 压测 + Partial Result 熔断

```markdown
你在 `/Users/wangbo/own/copilot-harness` 中工作。目标是完成 W9-D：BudgetGate 压测，模拟 fanout=5 + Auto-Memory，并证明 5 次强制超限都正确熔断且返回 partial result。本阶段只做 gate/harness，不实现真实多 agent。

# 请执行
1. 读取通用前置上下文，重点读：
   - `orchestrator/src/gates/index.ts`
   - `orchestrator/src/gates/index.test.ts`
   - `orchestrator/src/runtime/types.ts`
   - `orchestrator/src/automemory/harvester.ts`
   - `orchestrator/src/audit/index.ts`
2. 新增 contract 文档，例如 `docs/phase-1c-w9-budgetgate-contract.md`：
   - `BudgetPressureSampleV1`
   - `BudgetPressureReportV1`
   - `BudgetOverrunPartialResultV1`
   - P95 计算与 `P95 * 1.2` 建议阈值规则
3. 实现 pressure harness：
   - 建议路径：`orchestrator/src/gates/budgetPressure.ts` 或等价本地模式。
   - 10 个样本，模拟 `fanout=5` + Auto-Memory on-turn-end usage。
   - 不调用真实 LLM，不访问网络。
   - 记录 fanout、toolCalls、inputTokens、outputTokens、premiumRequests。
   - 产出 `orchestrator/eval/w9-budget-pressure.{json,md}`。
4. Partial result 熔断：
   - BudgetGate 超限时返回或可转换为 partial result：
     - `turn_state: "blocked"`
     - `policy_decision: "deny"`
     - `exceeded_budget`
     - `partial_result`
     - `audit_trace_id`
     - `recovery_hint`
   - 不得静默失败。
5. 强制超限：
   - 人为触发 5 次：maxFanout、maxToolCalls、maxInputTokens、maxOutputTokens、maxPremiumRequests。
   - 每次必须有 audit 记录和 partial result。
   - 熔断正确率目标 100%，误熔断率目标 0%。
6. 建议阈值：
   - 从 10 样本统计 P95。
   - 建议 gates config = P95 * 1.2，向上取整。
   - 不直接替换生产配置，先输出建议。

# 约束
- 不用真实 `/fleet`，因为当前 runtime spawn 未实现。
- 不调用真实模型做压测。
- 不把压力样本伪装成真实 Eval。

# 验证
- `pnpm --filter @copilot-harness/orchestrator test -- gates`
- `pnpm --filter @copilot-harness/orchestrator test -- budget`
- 如新增脚本：`pnpm --filter @copilot-harness/orchestrator w9:budget-pressure`

# 交付
1. BudgetGate contract
2. Pressure harness 与测试
3. P95 + 建议阈值报告
4. 5 次强制超限 partial result 证据
```

## W9-E：ADR 单模型放行评审 + 前端 Gate 健康看板

```markdown
你在 `/Users/wangbo/own/copilot-harness` 中工作。目标是完成 W9-E：写出单模型放行 ADR，并在可行时补只读 Gate 健康看板。本阶段不改变默认模型，不提供绕过按钮。

# 请执行
1. 读取前序 W9 产物：
   - `docs/phase-1c-w9-readiness.md`
   - `docs/phase-1c-w9-memory-conflict-contract.md`
   - `docs/phase-1c-w9-hot-index-contract.md`
   - `docs/phase-1c-w9-agent-runtime-contract.md`
   - `docs/phase-1c-w9-budgetgate-contract.md`
   - `orchestrator/eval/w8-report.md`
   - `orchestrator/eval/w9-runtime-smoke.md`
   - `orchestrator/eval/w9-budget-pressure.md`
2. ADR：
   - 仓库已有 `docs/adr/0001-*` 和 `0002-*`，不要覆盖。
   - 新文件使用下一个编号，例如 `docs/adr/0003-phase-1c-single-model-release-gate.md`；标题可写“Phase 1c 单模型放行门槛评审”。
   - 必含：Context、Decision、Status、Evidence、Gate Results、Trial Scope、Rollback Conditions、Owners、Next Review Date。
3. ADR 判定：
   - 只有当 W7-W8+W9 Eval 不回退、BudgetGate 压测达标、runtime smoke 达标、Memory 加固达标时，才写“允许 Phase 2 末期特定低风险场景试点非默认模型”。
   - 若 W8 仍 `NOT_READY` 或真实样本不足，Decision 必须是“不放行，继续 gpt-5-mini”。
   - 即使放行试点，默认仍 `gpt-5-mini`，高风险域仍人工终审。
4. 前端 Gate 健康看板（如本阶段实现）：
   - 读取真实 JSON/JSONL 事件：BudgetGate、PolicyGate、Validator、Runtime smoke、Memory conflict。
   - 只读展示预算、熔断、拒绝、升级审批、失败原因、source_ref 覆盖。
   - 不展示假 Agent 运行状态，不提供 bypass / approve / retry 写按钮。
   - Vue 3 + Vite + TypeScript，遵守现有 `apps/showcase` 风格。

# 约束
- 不修改 `DEFAULT_MODEL`。
- 不接真实写操作。
- 不为了通过 ADR 修改 Eval 口径。

# 验证
- ADR 文档人工可读即可。
- 若改前端：
  - `pnpm --filter @copilot-harness/showcase lint`
  - `pnpm --filter @copilot-harness/showcase typecheck`
  - `pnpm --filter @copilot-harness/showcase build`

# 交付
1. 单模型放行 ADR
2. 明确 pass/fail/blocked 结论
3. 如实现前端：真实 gate 健康看板与构建验证
```

## W9-F：Phase 1c 收尾报告 + W10 进入条件

```markdown
你在 `/Users/wangbo/own/copilot-harness` 中工作。目标是完成 W9-F：Phase 1c 收尾报告和 W10 进入条件。本阶段只汇总，不追加新功能。

# 请执行
1. 汇总 W9 所有产物，新增 `docs/phase-1c-w9-closure.md`。
2. 报告必须包含：
   - W8 readiness 结论
   - Memory conflict 检测结果
   - hot_index 覆盖与注入策略
   - AgentRuntime smoke 结果
   - BudgetGate P95、建议阈值、forced overrun 结果
   - ADR 决策
   - 是否允许进入 W10
3. W10 进入条件：
   - 如果 ADR 不放行多模型，W10 仍可进入 `/fleet` 设计，但默认模型保持 `gpt-5-mini`。
   - 如果 W8 真实样本仍缺失，W10 不得依赖 GitLab 证据质量结论。
   - 如果 BudgetGate 未达标，W10 不得开启真实 fanout。
4. 生成最终验收清单：
   - [ ] W8 readiness 已记录
   - [ ] 冲突检测阻断重复/矛盾 Memory
   - [ ] hot_index 默认注入，search lazy load
   - [ ] Runtime V1 签名冻结
   - [ ] BudgetGate forced overrun 5/5 通过
   - [ ] ADR 结论与证据一致

# 验证
- 跑本轮改动涉及的最小测试集合。
- 如只改文档，可说明无需运行测试。

# 交付
1. `docs/phase-1c-w9-closure.md`
2. W10 go/no-go 结论
3. 剩余风险与补救清单
```

## W9 验收清单

- [ ] W8 readiness 已读取并写入 W9 结论。
- [ ] Memory conflict check 在 Review CLI accept/edit 前执行。
- [ ] compare 决策可审计，冲突未处理不得入库。
- [ ] Memory MCP 有 `hotIndex` 只读工具或等价内部接口。
- [ ] Context Assembler 默认 hot_index，详情 lazy search。
- [ ] AgentRuntime V1 有 contract 和签名保护测试。
- [ ] SDK/CLI smoke 报告存在，真实环境缺失时明确 blocked。
- [ ] BudgetGate pressure report 有 P95、建议阈值、5 次强制超限证据。
- [ ] 熔断返回 partial result，不静默失败。
- [ ] ADR 不覆盖既有 ADR 编号，结论与证据一致。
- [ ] 默认模型仍为 `gpt-5-mini`。
