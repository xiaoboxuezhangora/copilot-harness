# W8 Codex 执行版优化提示词

本文件用于 Phase 1b W8：Review CLI + Code Retrieval MCP + Jira/GitLab 联合只读分析。不要一次性把全部内容投喂给 Codex；按 W8-A、W8-B、W8-C、W8-D 顺序分批执行。每一批执行前都要求 Codex 先读取当前仓库状态与上一批交付物，避免覆盖已有 W6/W7 代码。

## Notion W8 目标重述

来源：Notion 页面《Phase 1 - Skill 化 + Auto-Memory + 验证期加固（W5-W9）》中的 W8 段落。

W8 不是单纯做一个交互 CLI，也不是让 prompt 直接猜代码影响面。W8 的核心目标是把 W7 产生的 Auto-Memory 候选闭环成“每周 10 分钟可人工审批”，并首次把 Jira 需求与 GitLab 代码、MR、commit、pipeline 只读证据接起来，让 Copilot 能回答：这个 Jira 大概率涉及哪些 repo、模块、文件、历史 MR、近期 commit 和 CI 信号。

必须守住的阶段边界：

- 只读 GitLab/Jira 证据，不创建 MR、不 push、不改 Jira 状态。
- Memory 写入只通过 Review CLI 或 Memory MCP 受控执行，且必须有人工 accept/edit 决策。
- 未命中真实代码证据时输出 `need_more_context` 或 `ask_human`，不得编造 repo/module/file。
- 50 样本 Eval 中至少 20 条是真实 Jira + GitLab 联合分析样本，禁止用 demo fixture 或 mock 作为 W8 验收样本。
- 继续锁定 `gpt-5-mini` 单模型。

## 市面对标结论

主流方案的共同点：工程智能体能力来自“可追溯上下文 + 工具边界 + 审批/审计 + Eval”，不是靠把 prompt 写长。

- GitHub Copilot cloud agent 支持研究仓库、产出实现计划、在分支上改代码，并通过 PR 审查迭代；它还把 custom instructions、MCP、hooks、skills、memory 作为增强仓库知识的机制。对 W8 的启发是：先做研究/计划/证据，再进入写代码阶段；本项目 W8 只取只读研究层，不提前做 PR。
- GitLab Duo Agent Platform 把 Planner Agent、Developer Flow、Code Review Flow、MCP clients、MCP server、Knowledge Graph 放在同一 DevSecOps 平台中。对 W8 的启发是：GitLab 证据层需要覆盖 issue/work item、code search、MR、commit、pipeline，而不是只读单个文件。
- Atlassian Rovo Dev CLI 把终端开发任务、Jira work item、memory、saved prompt、tools、subagents、MCP、worktree mode 组合起来。对 W8 的启发是：Review CLI 应该是低切换成本的终端工作流，并保留 session/memory/prompt 可复用能力。
- Sourcegraph Cody 明确把代码上下文拆成 keyword search、Sourcegraph Search、Code Graph 和 repo-based context。对 W8 的启发是：Code Retrieval MCP 需要做多路召回与 rerank，不能只有 GitLab blobs search。
- Anthropic long-running harness 实践强调结构化进度、每轮先 get bearings、单步增量推进、结束时留下清晰工件。对 W8 的启发是：每个子阶段都要产出 contract、fixture、audit/eval 证据，方便后续 W9 接手加固。

参考来源：

- GitHub Docs: https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent
- GitLab Duo Agent Platform: https://docs.gitlab.com/user/duo_agent_platform/
- GitLab Search API: https://docs.gitlab.com/api/search/
- GitLab Repository files API: https://docs.gitlab.com/api/repository_files/
- GitLab Repositories API: https://docs.gitlab.com/api/repositories/
- GitLab Merge requests API: https://docs.gitlab.com/api/merge_requests/
- GitLab Commits API: https://docs.gitlab.com/api/commits/
- GitLab Pipelines API: https://docs.gitlab.com/api/pipelines/
- Atlassian Rovo Dev CLI: https://support.atlassian.com/rovo/docs/use-rovo-dev-cli/
- Sourcegraph Cody Context: https://sourcegraph.com/docs/cody/core-concepts/context
- Anthropic Effective Harnesses: https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
- ripgrep: https://github.com/BurntSushi/ripgrep
- tree-sitter: https://tree-sitter.github.io/tree-sitter/

## 当前仓库事实

执行 W8 前必须先重新确认，因为工作区可能已有未提交改动。

- W6 Memory MCP 已存在 `mcp-servers/memory/`，tool 包含 `put/get/search/list`，namespace 包含 `decisions/knowledge_index/aliases`。
- W7 Auto-Memory Harvester 已存在 `orchestrator/src/automemory/harvester.ts`，能把候选写入 `.memory/pending/`，并产出 audit/metric。
- `prompts/harvester.v1.md` 已存在，输出 JSON 契约锁定为 `decision|knowledge|correction|alias`。
- Context Assembler 已能注入 Memory，但尚未接入 Code Retrieval。
- Eval 仍显示 `Repo Hit@1: not_applicable`，W8 后应在 Jira+GitLab 子集启用。
- 当前 Jira Reader MCP 仍以 Jira 只读工具为主；W6 追加的字段/filter 工具需执行前确认是否已完成。

## 原 W8 提示词质量评估

结论：原 W8 提示词方向正确，但仍偏任务清单，不足以直接驱动高质量实现。

DONE 已明确的点：

- Review CLI 的交互动作 `accept/reject/edit/skip/quit` 明确。
- Code Retrieval MCP 的高层方向明确，包括 GitLab code search、ripgrep、tree-sitter。
- Context Assembler 要接入 Memory + Retrieval。
- Eval 需要 50 样本，人工审批 10 分钟内，accept >= 40%。
- 只读边界与不编造模块的原则已经写出。

QUALITY 主要缺口：

- 没有把 Review CLI 的 pending Markdown 格式、状态流转、审计字段和 Memory MCP `put` 入参映射写成契约。
- 没有区分 GitLabReader MCP、Code Retrieval MCP、本地 ripgrep fallback 和 tree-sitter symbol extraction 的职责。
- GitLab tool schema 过粗，缺少 project/ref/path/range/source_ref/token budget/redline 目录过滤等必需字段。
- “两段式需求分析”没有落成 prompt contract，容易继续让 LLM 直接猜 repo。
- Eval 数据结构缺少 `ground_truth_repo`、`gitlab_evidence_refs`、`repo_hints`、`review_decision`，无法可靠统计 Repo Hit@1 和 Correction Rate。
- 前端 W8 项目前端项过多，容易越界；本轮优先后端 contract、MCP、CLI、eval，前端只消费已落地 snapshot，不作为写入口。

## 通用前置提示词

```markdown
你在仓库 `/Users/wangbo/own/copilot-harness` 中工作。本轮是 Phase 1b W8：Review CLI + Code Retrieval MCP + Jira/GitLab 联合只读分析。不要重做 W1-W7，不要覆盖已有未提交改动。

# 必须先检查
1. 运行 `git status --short`，确认工作区已有改动；只改本阶段声明文件，禁止 revert 或覆盖他人改动。
2. 读取：
   - `orchestrator/AGENTS.md`
   - `README.md`
   - `docs/phase-1a-w6-memory-contract.md`
   - `prompts/harvester.v1.md`
   - `orchestrator/src/automemory/harvester.ts`
   - `orchestrator/src/context/index.ts`
   - `orchestrator/src/runtime/types.ts`
   - `orchestrator/src/gates/index.ts`
   - `mcp-servers/memory/src/{tools.ts,schemas.ts,types.ts,store.ts,security.ts}`
   - `mcp-servers/jira-reader/src/{tools.ts,jiraClient.ts,types.ts,security.ts}`
   - `orchestrator/eval/report.json`
3. 搜索是否已存在 `automemory-review`、`code-retrieval`、`gitlab-reader`、`repoHitAt1`、`GitLabContextPack`，若存在则优先增量补齐。

# W8 总目标
完成可验收的只读证据闭环：
- Auto-Memory pending 候选可通过 Review CLI 在 10 分钟内完成一轮人工审批。
- accept/edit 后通过 Memory MCP `put` 入库，reject/skip/archive 全程审计。
- Code Retrieval MCP 提供 GitLab + 本地仓库的只读检索与读取能力，输出稳定 `source_ref`。
- Context Assembler 支持两段式需求分析：Jira 先生成 GitLab 查询计划，拉取代码证据后再生成最终 Evidence Pack。
- 50 样本 Eval 中至少 20 条真实 Jira + GitLab 联合分析样本，启用 Repo Hit@1。

# 全局红线
- 不创建 MR，不 push，不提交远程分支，不改 Jira 状态，不写 GitLab/Jira/Notion。
- GitLab token/Jira token 只读 env，不入仓、不进日志、不进 prompt。
- Code Retrieval 禁止返回 `.memory/`、`reports/`、`secrets/`、`.env*`、`node_modules/`、`dist/`、`coverage/`、真实 audit.log、凭证或敏感请求/响应。
- 未命中真实代码证据时必须输出 `need_more_context` 或 `ask_human`。
- gpt-5-mini 单模型约束不变。

# 实现原则
- 先 contract 和 parser，再 CLI/MCP 实现，再 Context Assembler，再 Eval。
- 所有外部 API 包一层 client，测试默认 mock，不依赖内网 GitLab 在线。
- TypeScript strict，禁止 `any`；未知外部响应用 `unknown` + type guard/zod。
- 导出 JSON/audit 使用 snake_case，TS 内部使用 camelCase，并提供映射测试。
- 预计超过 120 秒的全量验证先说明原因；默认跑最小必要验证。

# 通用报告格式
1. 修改文件清单
2. 执行的验证命令与结果
3. 未完成项、原因、是否阻塞 W8
4. W8 验收指标：pending 审批耗时、accept rate、Repo Hit@1、Plan Executability、Correction Rate、source_ref coverage
```

## W8-A：Review CLI Contract + 实现

```markdown
你在 `/Users/wangbo/own/copilot-harness` 中工作。目标是完成 W8-A：Auto-Memory Review CLI，让 W7 pending 候选可以人工审批并受控入库。本阶段只做 CLI 和 Memory put 流转，不做 GitLab/Code Retrieval。

# 请执行
1. 读取通用前置上下文，重点读：
   - `orchestrator/src/automemory/harvester.ts`
   - `.memory/pending/` 下现有样例，如存在
   - `mcp-servers/memory/src/schemas.ts`
   - `mcp-servers/memory/src/tools.ts`
   - `orchestrator/src/audit/`
2. 先补 contract 文档，例如 `docs/phase-1b-w8-review-cli-contract.md`：
   - pending Markdown frontmatter/正文解析规则。
   - candidate 字段：kind/key/value/source_ref/producer_agent/confidence/novelty/rationale。
   - decision 字段：decision、reviewer、reviewed_at、edited_fields、archive_path、audit_trace_id。
   - kind 到 Memory namespace 映射：
     - `decision` -> `decisions`
     - `knowledge` -> `knowledge_index`
     - `correction` -> `decisions`，key 建议以 `correction.` 前缀标准化
     - `alias` -> `aliases`，必须 `manual_entry=true`
3. 新增 CLI 入口，优先放在 orchestrator 包内，例如：
   - `orchestrator/src/automemory/reviewCli.ts`
   - `orchestrator/bin/automemory-review` 或 package bin 等价入口
4. CLI 行为：
   - 默认读取 `.memory/pending/**/*.md`。
   - 按 confidence 降序，再按 novelty 降序，再按文件时间排序。
   - 支持 `--dry-run`、`--pending-dir`、`--archive-dir`、`--sqlite-path`、`--reviewer`、`--limit`。
   - 交互键：`a` accept、`r` reject、`e` edit、`s` skip、`q` quit。
   - `accept/edit` 后通过本地 Memory store 或 Memory MCP handler 写入，成功后 pending 移动到 `.memory/archive/YYYY-MM-DD/accepted/`。
   - `reject` 移动到 `.memory/archive/YYYY-MM-DD/rejected/`。
   - `skip` 不移动，仅写 audit。
   - 每条决策写 `reports/audit.log`，event_name 使用 `automemory.review_decision`。
5. 审计字段必须包含：
   - task_id
   - candidate_key
   - candidate_kind
   - source_ref
   - decision
   - reviewer
   - edited
   - archive_path
   - memory_namespace
   - memory_write_ok
   - reason
6. 单测覆盖：
   - pending parser 正确解析 W7 产物。
   - confidence/novelty 排序。
   - accept 写入 decisions/knowledge_index/aliases。
   - alias 没有 `manual_entry=true` 会被拒绝。
   - reject/skip/archive 审计。
   - redline value 不可入库。

# 约束
- 不调用真实 LLM。
- 不依赖网络。
- 不删除 pending 文件，除非成功移动到 archive。
- 不把 review CLI 做成前端写入口。

# 验证
- `pnpm --filter @copilot-harness/orchestrator test -- automemory`
- `pnpm --filter @copilot-harness/orchestrator typecheck`
- `pnpm --filter @copilot-harness/memory-mcp test`

# 交付
1. Review CLI contract 文档
2. CLI 入口与用法
3. parser/decision/archive/audit 单测
4. 一次 dry-run 输出示例
```

## W8-B：GitLab Read Context Pack + Code Retrieval MCP

```markdown
你在 `/Users/wangbo/own/copilot-harness` 中工作。目标是完成 W8-B：只读 GitLab Context Pack 和 Code Retrieval MCP。本阶段只做读，不接 Context Assembler，不做 Eval。

# 请执行
1. 读取通用前置上下文，重点确认现有 mcp-servers 结构与 Jira Reader MCP 写法。
2. 新增子包，建议路径：`mcp-servers/code-retrieval/`。
3. 新增 contract 文档，例如 `docs/phase-1b-w8-code-retrieval-contract.md`，定义：
   - `GitLabContextPackV1`
   - `CodeSearchResultV1`
   - `CodeFileSliceV1`
   - `GitLabEvidenceRef`
   - source_ref 格式
4. source_ref 统一格式：
   - file: `gitlab:<project>#file:<path>@<commit>#L<start>-L<end>`
   - mr: `gitlab:<project>#mr:<iid>`
   - commit: `gitlab:<project>#commit:<sha>`
   - pipeline: `gitlab:<project>#pipeline:<id>@<sha>`
   - local fallback: `local:<repo>#file:<path>@<git-sha>#L<start>-L<end>`
5. MCP tools：
   - `searchCode({ query, scope, ref?, limit?, mode? })`
   - `readFile({ project, path, ref, range? })`
   - `listRepositoryTree({ project, path?, ref?, recursive?, limit? })`
   - `listMergeRequests({ project?, query?, state?, updatedAfter?, limit? })`
   - `listCommits({ project, query?, path?, since?, until?, limit? })`
   - `getDiff({ project, from, to, maxFiles?, maxPatchBytes? })`
   - `listPipelines({ project, ref?, sha?, status?, limit? })`
6. `searchCode` 多路召回顺序：
   - GitLab Search API `scope=blobs`，可用时优先。
   - 本地 clone 存在时用 `rg` fallback，遵守 `.gitignore`。
   - 对 TypeScript/Vue/JavaScript 文件可用 tree-sitter 抽取 symbol 片段；tree-sitter 不可用时降级为行片段。
7. 安全过滤：
   - 默认排除 `.memory/`、`reports/`、`secrets/`、`.env*`、`node_modules/`、`dist/`、`coverage/`、二进制、大文件。
   - 单次 tool 输出必须有 token/字节上限，例如 `maxBytesPerFile`、`maxTotalBytes`。
   - 返回内容前运行 redline scan，命中 token/secret/PHI 时返回 metadata + redacted summary，不返回原文。
8. GitLab client：
   - 凭证来自 `GITLAB_BASE_URL`、`GITLAB_TOKEN`，只读 token。
   - 所有请求支持 timeout、pagination limit、HTTP error mapping。
   - 测试默认 mock，不访问真实 GitLab。
9. PolicyGate：
   - 将 code retrieval tools 注册为 read-only allowlist。
   - 仍拒绝 GitLab write API，例如 create file、update file、create MR、comment、merge。

# 约束
- 不实现任何 POST/PUT/PATCH/DELETE GitLab 调用。
- 不打印 token、内网 IP、Authorization header。
- 不把 GitLab API 响应原文整包塞进 prompt，只输出裁剪片段和 source_ref。

# 验证
- `pnpm --filter @copilot-harness/code-retrieval-mcp test`
- `pnpm --filter @copilot-harness/code-retrieval-mcp typecheck`
- `pnpm --filter @copilot-harness/orchestrator test -- gates`
- `rg "POST|PUT|PATCH|DELETE|createMergeRequest|mergeRequest" mcp-servers/code-retrieval orchestrator/src/gates`

# 交付
1. Code Retrieval MCP 子包
2. GitLab Read Context Pack contract
3. mock GitLab API 单测
4. 本地 rg fallback 单测
5. source_ref 示例
```

## W8-C：两段式 Jira + GitLab 分析 Prompt 与 Context Assembler

```markdown
你在 `/Users/wangbo/own/copilot-harness` 中工作。目标是完成 W8-C：Context Assembler 接入 Memory + Code Retrieval，并落地两段式需求分析 prompt。本阶段不改 Review CLI，不扩展 GitLab 写能力。

# 请执行
1. 读取 W8-A/W8-B 交付物和现有：
   - `orchestrator/src/context/index.ts`
   - `orchestrator/src/jira/context.ts`
   - `orchestrator/src/runtime/types.ts`
   - `orchestrator/src/eval.ts`
2. 新增 prompt 文件：`prompts/jira-gitlab-analysis.v1.md`。
3. Stage 1 Prompt：Jira -> GitLab 查询计划。
   - 输入：JiraContextPackV1、Memory hot hits、Skill hints。
   - 输出严格 JSON：
     {
       "turn_state": "done|await_human",
       "jira_context_ref": "JIRA-123",
       "gitlab_queries": [
         {"intent": "find_related_module|find_history|find_ci_signal", "query": "string", "scope": "code|mr|commit|pipeline", "rationale": "string"}
       ],
       "ambiguity": ["string"],
       "next_action": "run_gitlab_queries|ask_human|need_more_context"
     }
4. Stage 2 Prompt：Jira + GitLab evidence -> final Evidence Pack。
   - 输入：JiraContextPackV1、gitlab_evidence[]、Memory hits、retrieval budget summary。
   - 输出严格 JSON：
     {
       "turn_state": "done|await_human",
       "jira_context_ref": "JIRA-123",
       "gitlab_evidence": [{"source_ref": "gitlab:...", "summary": "string"}],
       "repo_hints": [{"project": "string", "module": "string", "confidence": 0.0, "source_refs": ["gitlab:..."]}],
       "plan": {"summary": "string", "steps": ["string"], "risks": ["string"], "test_hints": ["string"]},
       "ambiguity": ["string"],
       "next_action": "draft_plan|ask_human|need_more_context"
     }
5. Context Assembler：
   - 增加 Retrieval fragments，并保留 Memory > Retrieval > Skill 优先级。
   - 加 token/字节预算，超出时裁剪 Retrieval，不能裁剪 source_ref。
   - 所有 code fragments 必须带 source_ref、path、commit/ref、line range。
6. Validator：
   - Evidence Pack 中 GitLab 结论必须至少有一个 `gitlab:` 或 `local:` source_ref。
   - `repo_hints` 无 source_ref 的项目置信度必须 <= 0.4，且 next_action 不得是 `draft_plan`。
   - 出现 `need_more_context` 不算失败，但不得输出伪造文件。
7. Snapshot/fixtures：
   - 新增 2-3 个脱敏 mock GitLab evidence fixture，仅用于单测，不作为 W8 最终验收。

# 约束
- prompt 不允许 tool call，只负责结构化输出。
- 不把完整代码文件塞进 prompt；只给裁剪片段。
- 不把 `.memory/` pending/rejected 内容作为代码检索上下文。

# 验证
- `pnpm --filter @copilot-harness/orchestrator test -- context`
- `pnpm --filter @copilot-harness/orchestrator test -- jira`
- `pnpm --filter @copilot-harness/orchestrator typecheck`

# 交付
1. `prompts/jira-gitlab-analysis.v1.md`
2. Context Assembler Retrieval 接入
3. Validator/source_ref 规则
4. 两段式输出 fixture 与单测
```

## W8-D：真实 Eval 规则、指标与验收报告

```markdown
你在 `/Users/wangbo/own/copilot-harness` 中工作。目标是完成 W8-D：50 样本 Eval 升级，至少 20 条真实 Jira + GitLab 联合分析样本，启用 Repo Hit@1。本阶段只做评测与报告，不追加新功能。

# 请执行
1. 读取：
   - `orchestrator/eval/jira-eval-50.json`
   - `orchestrator/eval/report.json`
   - W8-A/W8-B/W8-C 交付物
2. 新增或升级 Eval dataset schema：
   - `task_id`
   - `eval_input_ref`
   - `jira_key`
   - `source_ref`
   - `ground_truth_repo`
   - `ground_truth_modules[]`
   - `gitlab_evidence_refs[]`
   - `expected_next_action`
   - `review_decision`
   - `high_risk`
3. 样本构成：
   - 总样本 50。
   - 至少 20 条真实 Jira + GitLab 联合分析样本。
   - 禁止 demo fixture/mock 作为最终验收样本。
   - 每条联合样本至少包含一个 `jira:<key>` 和一个 `gitlab:<project>#...` 证据。
4. 指标：
   - Repo Hit@1：`repo_hints[0].project == ground_truth_repo`。
   - Plan Executability：0/1/2 分，2 表示步骤/文件/风险/测试完整且可直接执行。
   - Correction Rate：`(人工 reject + 大改 edit) / 总样本数`。
   - source_ref coverage：联合样本必须 100%。
   - accept rate：Review CLI 一轮人工审批后 `accept + edit_accept` 占比，目标 >= 40%。
   - review time：50 样本 pending 一轮审批目标 <= 10 分钟，记录实际耗时。
5. 报告输出：
   - `orchestrator/eval/w8-report.json`
   - `orchestrator/eval/w8-report.md`
   - 保留失败样本列表，包含 reason、missing_refs、next_action。
6. 反作弊：
   - 无真实 GitLab evidence 的样本不能计入 20 条联合样本。
   - `repo_hints` 无证据但命中 ground truth 不计分。
   - 未命中时必须是 `need_more_context` 或 `ask_human`，不能算错但要单列 coverage gap。

# 约束
- 如果真实 GitLab/Jira 凭证不可用，允许完成 schema、runner、mock 单测，但 W8 最终验收必须标记 NOT_READY。
- 不用 mock 报告冒充验收。

# 验证
- `pnpm --filter @copilot-harness/orchestrator test -- eval`
- `pnpm --filter @copilot-harness/orchestrator typecheck`
- 如有真实环境：运行 W8 eval 命令并保存报告；预计超过 120 秒先说明。

# 交付
1. W8 Eval schema 与 runner
2. W8 report JSON/MD
3. 20 条联合样本 source_ref 覆盖证明
4. W8 是否通过、未通过项与 W9 回归清单
```

## W8 验收清单

- [ ] Review CLI 可在 10 分钟内审批一轮 pending，且每条决策写 audit。
- [ ] accept/edit 后 Memory MCP 入库成功，reject/skip/archive 可回溯。
- [ ] Code Retrieval MCP 只读工具可用，无 GitLab write API。
- [ ] GitLab source_ref 覆盖 file/MR/commit/pipeline 至少两类。
- [ ] Context Assembler 输出 Memory + Retrieval fragments，并执行预算裁剪。
- [ ] 两段式 prompt 能先输出 GitLab 查询计划，再基于证据输出 final Evidence Pack。
- [ ] 50 样本 Eval 跑通，其中至少 20 条真实 Jira + GitLab 联合样本。
- [ ] Repo Hit@1 在联合样本子集启用，不再是 `not_applicable`。
- [ ] Plan Executability >= W6 baseline + 0.10；如果 W6 baseline 已是 0.94，应先确认口径是否从 0/1 改为 0/1/2，避免不可达目标。
- [ ] Correction Rate <= W6 baseline。
- [ ] 未命中代码证据时输出 `need_more_context` 或 `ask_human`，无编造模块。
