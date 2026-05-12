# W4 Codex 执行版优化提示词

本文件用于 Phase 0.5 W4 前端 Showcase MVP 执行。不要一次性把全部内容投喂给 Codex；按 W4-A、W4-B、W4-C、W4-D 顺序分批执行。每一批执行前都要求 Codex 先读取当前仓库状态与上一步交付物，避免覆盖已有 W1/W2/W3 代码。

## 需求目标理解

Phase 0.5 的真实目标不是单纯做一个前端页面，而是把 Phase 0 的可观测输出转成一个可对外、可脱机、只读的演示入口，让管理者和业务科室能一眼看懂 AI 自动化编程流程中发生了什么。

核心验收点：

- 从 Phase 0 末 20 样本输出中生成稳定 snapshot，前端渲染任务、MCP 调用、证据、路由四类视图。
- MCP 调用面板是演示重点，必须能展示至少 1 次真实 JiraReader MCP 只读调用。
- 站点是纯静态产物，可放 GitLab Pages 或内网 nginx，也能脱机打开。
- 无任何写入动作；所有下一步操作只能跳转到 CLI 命令、Notion 页面或 GitLab 页面。
- Phase 0 字段不齐时必须优雅降级为字段存在率与缺口提示，不能崩溃，也不能伪造字段。

## 原提示词质量评估

结论：原提示词方向正确，但仍偏 PRD/任务清单，不够像可执行合同；需要优化。

DONE 优点：

- 角色、技术栈、四类视图、只读边界和验收条件已经明确。
- 突出了 MCP 调用面板，符合对外演示的叙事重点。
- 明确了静态导出、无实时、无写入、字段缺失优雅降级等关键约束。

QUALITY 主要缺口：

- 前置条件被默认满足；但本地仓库需要先确认 `docs/showcase-schema.md`、audit JSONL、task-state、MCP trace 是否真实存在。
- 子仓与目录说法不一致：`showcase-frontend` 与 `apps/showcase/` 需要收敛为一个落点。
- 缺少字段映射与缺失字段策略，容易把 UI 做完后才发现数据无法支撑。
- 缺少分阶段执行顺序，容易先搭 UI，再补数据契约，返工风险高。
- `离线打开 index.html` 与 `fetch snapshot.json` 存在冲突；浏览器 `file://` 下 fetch 本地 JSON 可能失败，应优先构建时内嵌 snapshot。
- CI 只读规则没有定义检测口径，容易停留在口号。
- 对非工程干系人的首页叙事、字段存在率、NOT_READY 状态没有明确设计。

## 通用前置提示词

```markdown
你在仓库 `/Users/wangbo/own/copilot-harness` 中工作。本轮是 Phase 0.5 W4：前端 Showcase MVP。不要重做 W1/W2/W3，不要改写已有 Phase 0 交付物，除非 W4 必须新增只读导出或展示适配。

# 当前事实与必须先检查的上下文
- 根仓使用 pnpm workspace；先读取 `package.json`、`pnpm-workspace.yaml`、`orchestrator/package.json`。
- 先读取 `orchestrator/AGENTS.md`，遵守 R1-R9，尤其是 R3 写操作审批、R6 audit 覆盖、R7 敏感数据禁止入仓、R9 gpt-5-mini 单模型。
- 先读取 Phase 0 相关输出：
  - `orchestrator/eval/report.json`
  - `orchestrator/eval/report.md`
  - `orchestrator/eval/jira-eval-20.json`
  - `orchestrator/docs/audit-sample*.jsonl`
  - 如存在，再读取 `reports/audit.log`、`state/tasks/**/*.json`、MCP trace 文件。
- 先检查是否存在 `orchestrator/docs/showcase-schema.md` 或等价 schema 文档；如果不存在，本轮 W4-A 必须先创建 schema contract。
- 当前工作区可能存在未提交改动；必须先运行 `git status --short`，理解已有改动后再改，不覆盖用户改动。

# W4 目标
在 1 周内产出可对外脱机演示的只读 Showcase 静态站：
- 技术栈：Vue 3 + Vite + TypeScript + Ant Design Vue + ECharts/vue-echarts。
- 应用落点：优先新增根目录 `apps/showcase/`，并将 `apps/*` 纳入 pnpm workspace；如果仓库已有其他约定，先说明再沿用。
- 数据来源：Phase 0 audit JSONL、task-state JSON、JiraReader MCP trace、20 样本 Eval 输出。
- 输出：`reports/showcase/<YYYY-MM-DD>/snapshot.json` 与可发布的 `apps/showcase/dist/` 静态产物。
- 前端必须渲染四类视图：任务面板、MCP 调用面板、证据面板、路由面板。

# 只读红线
- 不触发 Jira/GitLab/Notion/DB 写入。
- 不新增服务端、数据库、用户体系、实时推送、SSR。
- 不调用真实 Jira，除非我明确提供凭证并要求补证；默认使用已有脱敏样例和 mock/fixture。
- 不提交真实 audit.log、真实患者信息、CA 私钥、收费明细原文、token、内网 IP。
- 前端不得包含 POST/PUT/PATCH/DELETE fetch，不得导入写入类 SDK 或 MCP write tool。
- 所有“下一步”按钮只能是只读跳转或展示 CLI 命令文本，不在浏览器内执行命令。

# Phase 0 readiness 规则
如果 Phase 0 W3 验收未过或关键输入缺失：
- 不得宣称 W4 已验收。
- 可以继续做 schema、export、前端只读骨架与脱敏 demo fixture。
- UI 首页必须显示 `NOT_READY` 状态、字段存在率、缺失输入列表。
- 真实 JiraReader MCP 调用缺失时，MCP 面板必须标注 `demo data` 或 `missing real trace`，不能伪造真实调用。

# 通用实现原则
- 先建数据 contract，再做 export，再做 UI，再做 CI 门禁和演示脚本。
- 解析 JSON/JSONL 使用 TypeScript/Node 结构化解析，不用脆弱 grep 拼接。
- 字段缺失时输出 `null`、`unknown`、`fieldPresence` 与 `warnings`，不得编造。
- Vite 必须设置 `base: './'`；为满足脱机打开 `index.html`，snapshot 优先在 build 时作为 JSON 模块内嵌到 bundle，不依赖 `file://` fetch。
- 前端风格是面向管理者/业务科室的工作型 dashboard：首页首屏直接呈现运行状态、20 样本概览、MCP 调用摘要和字段存在率，不做营销式 landing page。

# 通用报告格式
每个子阶段完成后按以下格式回报：
1. 修改文件清单
2. 执行的验证命令与结果
3. 当前字段覆盖率与缺失项
4. 是否阻塞 W4 验收，以及下一阶段前置条件
```

## W4-A：数据盘点与 Showcase Schema

```markdown
你在 `/Users/wangbo/own/copilot-harness` 中工作。目标是完成 W4-A：盘点 Phase 0 输出，建立 Showcase snapshot schema 与字段映射。本阶段只做数据 contract、fixture 与文档，不搭前端 UI。

# 请执行
1. 读取通用前置上下文，尤其是：
   - `orchestrator/AGENTS.md`
   - `orchestrator/src/audit/types.ts`
   - `orchestrator/src/runtime/types.ts`
   - `orchestrator/src/jira/context.ts`
   - `orchestrator/eval/report.json`
   - `orchestrator/eval/jira-eval-20.json`
   - `orchestrator/docs/audit-sample*.jsonl`
2. 搜索是否存在：
   - `reports/audit.log`
   - `state/tasks/**/*.json`
   - MCP trace 文件
   - `docs/showcase-schema.md` 或 `orchestrator/docs/showcase-schema.md`
3. 新增或补齐 `orchestrator/docs/showcase-schema.md`，定义 `ShowcaseSnapshotV1`：
   - `metadata`: generatedAt、sourceFiles、sampleCount、phase0Readiness、warnings
   - `fieldPresence`: 每个关键字段的 present/missing/coverage
   - `tasks[]`: task_id、turn_state、execution_mode、role、prompt_version、model、runtime、budget_usage、tool_policy_hit、evidence_pack_size、memory_hit_count
   - `mcpCalls[]`: task_id、mcp_server_name、mcp_tool_name、transport_type、side_effect_level、confirm_required、audit_event_name、decision、latency_ms、success
   - `evidencePacks[]`: task_id、source_refs、confidence、assumptions、evidence_count
   - `routeChains[]`: task_id、task_class、execution_mode、role、model_tier、concrete_model、route_chain
4. 为每个 Notion 要求字段写清来源映射：
   - 可直接读取的字段
   - 可从现有字段保守推导的字段
   - 当前缺失、只能输出 null/unknown 的字段
5. 新增最小脱敏 fixture：
   - 如果已有真实脱敏输出足够，复用现有文件。
   - 如果缺少 MCP trace，新增明确标注为 demo 的 fixture，不能伪装真实数据。

# 约束
- 不写前端。
- 不新增写入能力。
- 不把真实敏感数据入仓。
- 不因字段缺失阻塞 schema 生成；字段缺失写入 `fieldPresence` 和 `warnings`。

# 验证
- `pnpm --dir orchestrator typecheck`
- `rg "JIRA_API_TOKEN|JIRA_PASSWORD|password|Authorization|Bearer" orchestrator docs scripts apps`
- 如新增 JSON fixture，使用 Node/TypeScript 解析验证 JSON 格式。

# 交付
1. `orchestrator/docs/showcase-schema.md`
2. 字段映射与缺失字段清单
3. W4-B export 脚本输入/输出约定
```

## W4-B：Snapshot Export Pipeline

```markdown
你在 `/Users/wangbo/own/copilot-harness` 中工作。目标是完成 W4-B：新增只读导出脚本，把 Phase 0 输出合成为 `reports/showcase/<YYYY-MM-DD>/snapshot.json`。本阶段不做完整 UI。

# 请执行
1. 新增 `scripts/oc-showcase-export.sh` 作为入口：
   - 支持默认读取仓库内 Phase 0 输出。
   - 支持 `--date YYYY-MM-DD` 或等价参数，默认使用当天日期。
   - 生成 `reports/showcase/<YYYY-MM-DD>/snapshot.json`。
2. 如 shell 难以安全解析 JSON/JSONL，新增 TypeScript helper，例如 `scripts/showcase-export.ts`，由 shell wrapper 调用。
3. 导出逻辑：
   - 读取 audit JSONL、eval report、task-state、MCP trace。
   - 只解析结构化 JSON/JSONL；坏行进入 warnings，不导致整个导出失败。
   - 规范化字段名为 snake_case，输出符合 `ShowcaseSnapshotV1`。
   - 对缺失字段输出 `null` 或 `unknown`，并更新 `fieldPresence`。
   - MCP 调用从 `toolCalls[]` 或 trace 中提取；JiraReader 只读工具标记为 `side_effect_level: "read"`。
   - latency、transport、confirm_required 等现有数据没有来源时不要编造。
4. 生成一个可供前端构建内嵌的 snapshot：
   - 优先写入 `reports/showcase/<date>/snapshot.json`。
   - 如前端需要构建时导入，再同步生成到 `apps/showcase/src/generated/snapshot.json`；若 app 尚未创建，先跳过并在 W4-C 接入。
5. 增加脚本级测试或最小验证：
   - JSONL 解析。
   - 缺字段降级。
   - 至少 1 条 MCP toolCall 聚合。

# 约束
- export 是只读读取 + 本地文件生成，不调用远程写接口。
- 不要求真实 Jira 在线。
- 不伪造真实 JiraReader MCP 调用；demo fixture 必须显式标注。

# 验证
- `bash scripts/oc-showcase-export.sh --date 2026-05-03`
- `node -e "JSON.parse(require('fs').readFileSync('reports/showcase/2026-05-03/snapshot.json','utf8')); console.log('ok')"`
- `pnpm --dir orchestrator typecheck`
- `pnpm --dir orchestrator test`

# 交付
1. `scripts/oc-showcase-export.sh`
2. 可选 TypeScript export helper 与测试
3. `reports/showcase/<date>/snapshot.json`
4. 字段覆盖率、warnings、是否满足真实 JiraReader MCP 验收
```

## W4-C：Showcase 前端 MVP

```markdown
你在 `/Users/wangbo/own/copilot-harness` 中工作。目标是完成 W4-C：实现 Vue 3 + Vite 前端 Showcase MVP。本阶段消费 W4-B snapshot，只做只读展示。

# 请执行
1. 新增根目录 `apps/showcase/`：
   - Vue 3 + Vite + TypeScript
   - Ant Design Vue 按需引入
   - ECharts/vue-echarts
   - package name 建议 `@copilot-harness/showcase`
2. 更新 workspace：
   - `pnpm-workspace.yaml` 纳入 `apps/*`
   - 根 `package.json` 可新增最小脚本，如 `showcase:build`、`showcase:lint`
3. 数据接入：
   - Vite `base: './'`
   - 默认从 `src/generated/snapshot.json` 静态导入，确保 `dist/index.html` 脱机打开可渲染。
   - 不依赖 `window.fetch` 读取本地 JSON；如保留 fetch，只能 GET，且必须有内嵌 snapshot fallback。
4. 实现四类视图：
   - 任务面板：按 `turn_state / execution_mode / role` 过滤、排序、查看详情。
   - MCP 调用面板：作为首页重点，按 `mcp_server_name / mcp_tool_name / transport_type / side_effect_level / audit_event_name` 聚合，展示调用次数、失败率、审批/策略决策、平均耗时；缺失耗时显示 unknown。
   - 证据面板：展示单任务 evidence pack 来源、置信度、假设、证据数量。
   - 路由面板：展示 `task_class -> execution_mode -> role -> model_tier -> concrete_model` 命中链；缺失项可视化为 unknown 节点。
5. 首页信息架构：
   - 首屏直接显示 phase0Readiness、样本数、字段存在率、JiraReader MCP 状态、只读状态。
   - 面向非工程干系人，不展示大段技术说明，不做营销页。
   - 使用紧凑 dashboard 布局，避免嵌套卡片；图表和表格优先服务扫描和对比。
6. 交互约束：
   - 所有按钮只做筛选、展开详情、复制/展示命令文本或跳转只读页面。
   - 不出现写入表单，不执行 CLI，不调用写 API。

# 约束
- 不新增服务端依赖。
- 不引入数据库、auth、SSR、实时推送。
- 不引入大型 UI 框架之外的重复组件库。
- 不把真实敏感数据放进 fixture 或 bundle。

# 验证
- `pnpm --filter @copilot-harness/showcase lint`
- `pnpm --filter @copilot-harness/showcase typecheck`
- `pnpm --filter @copilot-harness/showcase build`
- 脱机检查 `apps/showcase/dist/index.html` 能渲染四类视图；如果自动化浏览器不可用，说明手动验证步骤。

# 交付
1. `apps/showcase/` 前端应用
2. 四类视图截图或验证说明
3. 构建产物路径
4. 字段缺失降级表现
```

## W4-D：只读门禁、演示脚本与验收

```markdown
你在 `/Users/wangbo/own/copilot-harness` 中工作。目标是完成 W4-D：CI/本地只读门禁、演示脚本和 W4 验收报告。

# 请执行
1. 增加只读 lint/测试规则：
   - 禁止 `fetch` 使用 POST/PUT/PATCH/DELETE。
   - 禁止导入或调用 MCP/Jira/GitLab/Notion 写入类工具。
   - 禁止 `express`、`fastify`、`koa`、`http.createServer`、数据库 client 等服务端依赖进入 `apps/showcase`。
   - 禁止前端出现会触发写入的表单提交逻辑。
2. 将只读门禁接入脚本：
   - `apps/showcase/package.json` 增加 `lint:readonly` 或等价脚本。
   - 根 package 可增加转发脚本，但不要破坏已有 lint/typecheck/test。
3. 新增 `orchestrator/docs/showcase/demo-script.md`：
   - 演示路径 1：纯读文档分析，展示任务和证据链。
   - 演示路径 2：跨文件改动，展示路由链和风险边界。
   - 演示路径 3：高风险动作触发 L3 审批，展示 PolicyGate/只读跳转。
   - 每条路径写清入口、看点、失败/缺字段时怎么解释。
4. 新增或更新 W4 验收说明：
   - snapshot 来源与日期。
   - 字段存在率。
   - 是否包含真实 JiraReader MCP 调用。
   - 是否可脱机演示。
   - 是否满足只读门禁。
   - 若 Phase 0 NOT_READY，明确列出阻塞项，不宣称完成验收。

# 验证
- `bash scripts/oc-showcase-export.sh --date 2026-05-03`
- `pnpm --filter @copilot-harness/showcase lint`
- `pnpm --filter @copilot-harness/showcase lint:readonly`
- `pnpm --filter @copilot-harness/showcase typecheck`
- `pnpm --filter @copilot-harness/showcase build`
- `pnpm --dir orchestrator typecheck`
- `pnpm --dir orchestrator test`
- `rg "method:\\s*['\\\"]POST|fetch\\([^\\n]*POST|PUT|PATCH|DELETE" apps/showcase`
- `rg "JIRA_API_TOKEN|JIRA_PASSWORD|password|Authorization|Bearer" orchestrator docs scripts apps`

# 交付
1. 只读 lint/测试规则
2. `orchestrator/docs/showcase/demo-script.md`
3. W4 验收报告
4. 可发布静态站路径与脱机验证结果
```

## 推荐执行顺序

1. 先投喂“通用前置提示词 + W4-A”。
2. W4-A 产出 schema 与字段缺口后，再执行 W4-B。
3. W4-B 能稳定生成 snapshot 后，再执行 W4-C。
4. W4-C build 通过后，最后执行 W4-D。
5. 如果 W4-A 判定 Phase 0 NOT_READY，可以继续做 demo-mode Showcase，但最终报告必须保留 NOT_READY，不得把 demo fixture 当作真实验收。
