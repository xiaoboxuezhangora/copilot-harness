# Showcase Snapshot Schema (W4-A)

## 1) Scope

本文件定义 W4 Showcase 只读导出契约 `ShowcaseSnapshotV1`。本阶段仅定义 contract、映射与 fixture 约定，不包含前端实现。

## 2) Phase 0 输入盘点（当前仓库）

已发现：

- `orchestrator/eval/report.json`
- `orchestrator/eval/report.md`
- `orchestrator/eval/jira-eval-20.json`
- `orchestrator/docs/audit-sample.jsonl`
- `orchestrator/docs/audit-sample-w3.jsonl`

未发现：

- `reports/audit.log`
- `state/tasks/**/*.json`
- 真实 MCP trace 文件
- 既有 `docs/showcase-schema.md` / `orchestrator/docs/showcase-schema.md`

结论：Phase 0 展示输入不完整，W4 首页状态必须为 `NOT_READY`，MCP 面板必须标注 `demo data` 或 `missing real trace`。

## 3) `ShowcaseSnapshotV1` 数据契约

```ts
type Phase0Readiness = 'READY' | 'NOT_READY';

type PresenceStatus = 'present' | 'missing' | 'partial' | 'unknown';

interface PresenceStat {
  present: number;
  missing: number;
  coverage: number; // 0..1
  status: PresenceStatus;
  notes?: string[];
}

interface ShowcaseMetadataV1 {
  generatedAt: string; // ISO timestamp
  sourceFiles: string[]; // relative paths used by exporter
  sampleCount: number; // expected from eval/report.json summary.sampleCount
  phase0Readiness: Phase0Readiness;
  warnings: string[];
}

interface ShowcaseTaskV1 {
  task_id: string;
  fleet_session_id: string | null;
  parent_task_id: string | null;
  agent_role: string | null;
  candidate_id: string | null;
  worktree_mode: 'mock' | 'real_disabled' | '未接入' | null;
  turn_state:
    | 'done'
    | 'continue_current'
    | 'await_human'
    | 'blocked'
    | 'handoff_needed'
    | 'unknown';
  execution_mode: string | null; // e.g. mock/live/unknown
  role: string | null; // runtime role if available, else unknown
  prompt_version: string | null;
  model: string | null;
  runtime: string | null;
  budget_usage: {
    fanout: number | null;
    fleet_fanout: number | null;
    tool_calls: number | null;
    input_tokens: number | null;
    output_tokens: number | null;
    premium_requests: number | null;
  } | null;
  tool_policy_hit: {
    decision: 'allow' | 'deny' | 'escalate' | 'unknown';
    hit_count: number;
  } | null;
  evidence_pack_size: number | null;
  memory_hit_count: number | null;
}

interface ShowcaseMcpCallV1 {
  task_id: string;
  mcp_server_name: string | null;
  mcp_tool_name: string | null;
  transport_type: string | null;
  side_effect_level: 'read' | 'write' | 'high_risk' | 'unknown';
  confirm_required: boolean | null;
  audit_event_name: string | null;
  decision: 'allow' | 'deny' | 'escalate' | 'unknown';
  latency_ms: number | null;
  success: boolean | null;
}

interface ShowcaseEvidencePackV1 {
  task_id: string;
  source_refs: string[];
  confidence: number | null; // 0..1
  assumptions: Array<{
    statement: string;
    confidence: number | null; // 0..1
  }>;
  evidence_count: number;
}

interface ShowcaseRouteChainV1 {
  task_id: string;
  task_class: string | null;
  execution_mode: string | null;
  role: string | null;
  model_tier: string | null;
  concrete_model: string | null;
  route_chain: string[]; // ordered path nodes
}

interface ShowcaseSnapshotV1 {
  schemaVersion: 'ShowcaseSnapshotV1';
  metadata: ShowcaseMetadataV1;
  fieldPresence: Record<string, PresenceStat>;
  tasks: ShowcaseTaskV1[];
  mcpCalls: ShowcaseMcpCallV1[];
  evidencePacks: ShowcaseEvidencePackV1[];
  routeChains: ShowcaseRouteChainV1[];
}
```

## 4) 字段映射（Notion 展示字段）

说明：

- `DIRECT`：可直接从现有 Phase 0 文件读取。
- `DERIVED`：可保守推导，需显式标注推导规则。
- `MISSING`：当前无可信来源，必须输出 `null`/`unknown`，并写入 `fieldPresence` + `warnings`。

| 字段                             | 类型         | 映射级别       | 来源与规则                                                                                                         |
| -------------------------------- | ------------ | -------------- | ------------------------------------------------------------------------------------------------------------------ |
| `metadata.generatedAt`           | string       | DERIVED        | 导出脚本生成时的当前 ISO 时间                                                                                      |
| `metadata.sourceFiles`           | string[]     | DERIVED        | 导出器实际成功读取的文件路径列表                                                                                   |
| `metadata.sampleCount`           | number       | DIRECT         | `orchestrator/eval/report.json` `summary.sampleCount`                                                              |
| `metadata.phase0Readiness`       | enum         | DERIVED        | 若缺关键输入（`reports/audit.log` / `state/tasks/**/*.json` / 真实 MCP trace）或 `failedCount > 0`，则 `NOT_READY` |
| `metadata.warnings`              | string[]     | DERIVED        | 缺文件、坏行、缺字段、demo trace 使用说明                                                                          |
| `fieldPresence.*`                | object       | DERIVED        | 遍历快照目标字段，按 present/missing 计数，coverage=`present/(present+missing)`                                    |
| `tasks[].task_id`                | string       | DIRECT         | audit JSONL `taskId`                                                                                               |
| `tasks[].fleet_session_id`       | string/null  | DIRECT         | W10 fleet audit `fleetSessionId` / `fleet_session_id`；无真实信号显示 `未接入`                                     |
| `tasks[].parent_task_id`         | string/null  | DIRECT         | W10 fleet audit `parentTaskId` / `parent_task_id`                                                                  |
| `tasks[].agent_role`             | string/null  | DIRECT         | W10 fleet audit `agentRole` / `agent_role`                                                                         |
| `tasks[].candidate_id`           | string/null  | DIRECT         | W10 fleet candidate audit `candidateId` / `candidate_id`                                                           |
| `tasks[].worktree_mode`          | enum/null    | DIRECT         | W10 fleet audit `worktreeMode` / `worktree_mode`；无真实 worktree 信号显示 `未接入`                                |
| `tasks[].turn_state`             | string       | DIRECT         | audit JSONL `turnState`                                                                                            |
| `tasks[].execution_mode`         | string/null  | DERIVED        | 优先从 `taskId`/上下文约定推断（如包含 `-mock`/`-live`），否则 `unknown`                                           |
| `tasks[].role`                   | string/null  | MISSING        | 当前无稳定字段，输出 `unknown`                                                                                     |
| `tasks[].prompt_version`         | string/null  | DIRECT         | audit JSONL `promptVersion`（W2 样本缺失时为 `null`）                                                              |
| `tasks[].model`                  | string/null  | DIRECT         | audit JSONL `model`                                                                                                |
| `tasks[].runtime`                | string/null  | DIRECT         | audit JSONL `runtime.name`                                                                                         |
| `tasks[].budget_usage`           | object/null  | DIRECT         | audit JSONL `budgetUsage`（字段不存在则 `null`）                                                                   |
| `tasks[].tool_policy_hit`        | object/null  | DERIVED        | 从 audit `policyDecision` + `toolCalls[].decision` 统计；缺失时 `null`                                             |
| `tasks[].evidence_pack_size`     | number/null  | MISSING        | audit 样本不含 evidencePack，输出 `null`                                                                           |
| `tasks[].memory_hit_count`       | number/null  | MISSING        | 当前无 memory 命中日志，输出 `null`                                                                                |
| `mcpCalls[].task_id`             | string       | DIRECT/DERIVED | 优先真实 MCP trace；无 trace 时来自 demo fixture                                                                   |
| `mcpCalls[].mcp_server_name`     | string/null  | DIRECT/DERIVED | 真实 trace 字段；demo fixture 显式给值并标注 demo                                                                  |
| `mcpCalls[].mcp_tool_name`       | string/null  | DIRECT         | 优先 trace 字段；可回退 audit `toolCalls[].toolName`                                                               |
| `mcpCalls[].transport_type`      | string/null  | MISSING        | 当前 audit 样本无该字段；demo fixture 可给演示值，真实缺失时仍应标识 unknown                                       |
| `mcpCalls[].side_effect_level`   | enum         | DERIVED        | 对 JiraReader 白名单工具（`getIssue/searchIssues/getComments`）映射 `read`，其他未知为 `unknown`                   |
| `mcpCalls[].confirm_required`    | boolean/null | DERIVED        | 若 `decision=escalate` 可保守推导 `true`；其余无证据时 `null`                                                      |
| `mcpCalls[].audit_event_name`    | string/null  | MISSING        | 现有 audit sample 无 tool-call 事件名；demo fixture 可给 `mcp.tool_call` 并标注 demo                               |
| `mcpCalls[].decision`            | enum         | DIRECT         | `toolCalls[].decision` 或 trace `decision`                                                                         |
| `mcpCalls[].latency_ms`          | number/null  | MISSING        | 当前无延迟记录，输出 `null`                                                                                        |
| `mcpCalls[].success`             | boolean/null | DERIVED        | 若有 tool call 且无失败信号，保守为 `true`；否则 `null`                                                            |
| `evidencePacks[].task_id`        | string       | DIRECT/DERIVED | 若后续有 `state/tasks` 可直接读；当前可从 audit taskId 建空壳                                                      |
| `evidencePacks[].source_refs`    | string[]     | MISSING        | 当前无 evidence pack 原文，输出 `[]`                                                                               |
| `evidencePacks[].confidence`     | number/null  | MISSING        | 当前无 evidence pack，输出 `null`                                                                                  |
| `evidencePacks[].assumptions`    | array        | MISSING        | 当前无 evidence pack，输出 `[]`                                                                                    |
| `evidencePacks[].evidence_count` | number       | DERIVED        | 当前无 evidence 时固定 `0`                                                                                         |
| `routeChains[].task_id`          | string       | DIRECT         | audit JSONL `taskId`                                                                                               |
| `routeChains[].task_class`       | string/null  | DERIVED        | 可从 `taskId` 前缀或数据域推断；无规则则 `unknown`                                                                 |
| `routeChains[].execution_mode`   | string/null  | DERIVED        | 同 `tasks[].execution_mode`                                                                                        |
| `routeChains[].role`             | string/null  | MISSING        | 当前无稳定字段，`unknown`                                                                                          |
| `routeChains[].model_tier`       | string/null  | DERIVED        | R9 固定 `gpt-5-mini`，可映射为 `mini`                                                                              |
| `routeChains[].concrete_model`   | string/null  | DIRECT         | audit JSONL `model`                                                                                                |
| `routeChains[].route_chain`      | string[]     | DERIVED        | 组装 `[task_class, execution_mode, role, model_tier, concrete_model]`，缺失节点用 `unknown`                        |

## 5) 字段缺失清单（当前必须降级）

- 缺真实输入：`reports/audit.log`、`state/tasks/**/*.json`、真实 MCP trace。
- 缺核心字段：`role`、`memory_hit_count`、`evidence_pack_size`、`latency_ms`、`audit_event_name`（真实链路）、`confirm_required`（可审计字段级）。
- 因此 `fieldPresence` 必须展示低覆盖字段，并在 `metadata.warnings` 内列出缺失项。

## 6) Demo Fixture 约定（仅补缺，不伪装真实）

- 当真实 MCP trace 缺失时，可读取 `orchestrator/docs/mcp-trace-demo.jsonl`。
- 该文件每行 JSON 必须显式包含 `data_origin: "demo"` 与 `demo_reason`。
- 前端/导出都必须将该数据标注为 `demo data`。

## 7) W4-B Export 输入/输出约定

输入（按优先级）：

1. `reports/audit.log`（若存在）
2. `orchestrator/docs/audit-sample*.jsonl`
3. `state/tasks/**/*.json`（若存在）
4. 真实 MCP trace（若存在）
5. `orchestrator/docs/mcp-trace-demo.jsonl`（仅真实 trace 缺失时）
6. `orchestrator/eval/report.json`
7. `orchestrator/eval/jira-eval-20.json`

输出：

- 主输出：`reports/showcase/<YYYY-MM-DD>/snapshot.json`
- schema version：固定 `ShowcaseSnapshotV1`
- 约束：
  - 字段缺失不抛致命错误，统一落 `null`/`unknown` + `warnings`
  - JSONL 坏行加入 warnings 并跳过该行
  - 若使用 demo trace，`metadata.phase0Readiness` 不得为 `READY`
