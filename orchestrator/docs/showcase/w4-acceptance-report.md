# W4 Acceptance Report (Phase 0.5)

## 结论

- 当前状态：`EVIDENCE_LOOP_CLOSED / NOT_READY`
- 不宣称 W4 最终验收通过；已完成“只读展示 + 门禁 + 演示脚本 + 可复跑证据闭环”交付。
- `NOT_READY` 当前由 W3 Eval 质量门禁触发，而不是由 W4 展示输入缺失触发。

## Review Findings 修复状态

- 已修复：`buildMcpCalls` 在 audit + trace 同时存在时的双计数风险（trace 优先，audit fallback 去重）。
- 已修复：EvidencePack 解析兼容嵌套契约 `record.evidencePack.*` 与顶层 fallback，并可推导 `tasks[].evidence_pack_size`。
- 已修复：`showcase-schema.md` 格式检查（Prettier）问题。
- 已修复：前端复制导出命令日期硬编码，改为从 snapshot metadata 读取日期，缺失时回退默认命令。

## Snapshot 来源与日期

- 证据闭环命令：`pnpm showcase:evidence -- --date 2026-05-06 --mode mock`
- 导出命令：`bash scripts/oc-showcase-export.sh --date 2026-05-06`
- Snapshot 路径：`reports/showcase/2026-05-06/snapshot.json`
- 前端内嵌副本：`apps/showcase/src/generated/snapshot.json`
- 数据来源文件：
  - `orchestrator/eval/report.json`
  - `reports/audit.log`
  - `reports/mcp-traces/2026-05-06/jira-reader-trace.jsonl`
  - `state/tasks/showcase/w4-evidence-jira-reader-mock.json`
  - `state/tasks/eval/*.json`（20 个 W3 Eval 样本 task-state）
  - `orchestrator/docs/audit-sample*.jsonl`（历史样例补充）

## 字段存在率

- `fieldPresence` 字段总数：38
- 当前 snapshot 任务数：23
- 当前 MCP 调用数：4，其中 3 条来自新生成的真实 JiraReader MCP trace。
- 关键字段改善：
  - `tasks.execution_mode` 覆盖率：0.913
  - `tasks.evidence_pack_size` 覆盖率：1.0
  - `mcpCalls.latency_ms` 覆盖率：0.75
  - `evidencePacks.source_refs` 覆盖率：0.913
  - `evidencePacks.confidence` 覆盖率：0.913
  - `routeChains.execution_mode` 覆盖率：0.913
  - `routeChains.role` 覆盖率：0.913

## 真实 JiraReader MCP 调用验收

- 结果：已满足真实 MCP round-trip trace。
- 证据：`reports/mcp-traces/2026-05-06/jira-reader-trace.jsonl`
- 调用链：
  - `JiraReader.searchIssues`
  - `JiraReader.getIssue`
  - `JiraReader.getComments`
- 当前闭环使用 `--mode mock`，即通过仓库 mock Jira server 走真实 JiraReader MCP server + InMemoryTransport。
- 若要把外部 Jira 环境也纳入同一 trace 链路，提供 `secrets/jira.env` 后运行：`pnpm showcase:evidence -- --date 2026-05-06 --mode live`。

## 脱机演示能力

- 结果：满足
- 说明：
  - `apps/showcase/dist/index.html` 可直接发布为静态站
  - Vite 配置 `base: './'`
  - 默认使用内嵌 `src/generated/snapshot.json`，不依赖 `file://` fetch

## 只读门禁状态

- 结果：已接入
- 脚本：`scripts/check-showcase-readonly.sh`
- 覆盖规则：
  - 禁止 `fetch` 写方法（POST/PUT/PATCH/DELETE）
  - 禁止写入类 MCP/Jira/GitLab/Notion 关键词调用
  - 禁止服务端依赖与 `http.createServer` 等服务端入口
  - 禁止表单提交逻辑（`<form>` / `@submit` / `submit` 事件）
- 执行入口：
  - `pnpm --filter @copilot-harness/showcase lint:readonly`
  - `pnpm showcase:lint:readonly`

## 阻塞项（必须明确）

- Phase 0 评估仍有失败样本（`report.json` 中 `failedCount > 0`）
- 如验收口径要求外部 Jira 实例而不是 mock Jira runtime，还需要补跑 `--mode live` 并归档对应 trace。

在以上阻塞项补齐前，W4 可作为证据链闭合的演示版，不作为生产验收结果。

## 非阻塞性能债

- `apps/showcase` 构建存在 Vite chunk size warning（主包较大，ECharts + Ant Design Vue 带来的体积开销）。
- Lighthouse 指标本轮未执行验证（性能/可访问性分数暂未给出）。
