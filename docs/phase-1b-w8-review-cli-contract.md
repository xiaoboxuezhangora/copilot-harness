# Phase 1b W8-A: Auto-Memory Review CLI Contract

## Scope

- 本阶段只覆盖 Auto-Memory pending 候选的人工审批、受控入库、归档与审计。
- 不调用 LLM，不访问网络，不写 Jira/GitLab/Notion，不创建 MR，不 push。
- Review CLI 是本地人工审批入口，不提供前端写入口。

## Pending Markdown

Review CLI 默认读取 `.memory/pending/**/*.md`。

每个 pending Markdown 文件由 W7 harvester 生成，包含一个文件级 header 和一个或多个候选。

Header 支持两种格式：

1. YAML-style frontmatter：

```md
---
generated_at: 2026-05-08T00:00:14.000Z
task_id: case-1
audit_trace_id: trace-case-1
---
```

2. W7 当前产物的 bullet header：

```md
- generated_at: 2026-05-08T00:00:14.000Z
- task_id: case-1
- audit_trace_id: trace-case-1
```

Parser 规则：

- header 只解析第一个 `##` 标题之前的键值行。
- candidate 以 `## Accepted Candidates` 下的 fenced JSON 对象为准。
- 若没有 `## Accepted Candidates`，可回退解析 `## Harvester Raw Output` 中 `candidates[]`。
- 当前 W7 文件可能包含多个 accepted candidates；W8-A CLI 对一个 pending 文件执行一次人工决策。
- 文件排序使用候选最高 `confidence` 降序，再按最高 `novelty` 降序，再按文件 mtime 升序。

## Candidate Fields

每个 candidate 必须包含：

- `kind`: `decision | knowledge | correction | alias`
- `key`: stable memory key
- `value`: memory value
- `source_ref`: 必须来自 Evidence Pack 或人工可追溯来源
- `producer_agent`: 产生候选的 agent 标识
- `confidence`: `[0, 1]`
- `novelty`: `[0, 1]`
- `rationale`: 简短理由

缺失字段、空字符串、非法 kind 或非法 score 都视为 pending 文件无效。

## Decision Fields

每条候选的 review decision 导出为 snake_case 审计字段：

- `decision`: `accept | edit | reject | skip`
- `reviewer`
- `reviewed_at`
- `edited_fields`
- `archive_path`
- `audit_trace_id`

`accept` / `edit` 成功写入 Memory 后移动到 `.memory/archive/YYYY-MM-DD/accepted/`。

`reject` 移动到 `.memory/archive/YYYY-MM-DD/rejected/`。

`skip` 不移动 pending 文件，只写审计。

## Memory Namespace Mapping

| candidate kind | Memory namespace | Mapping rule |
| --- | --- | --- |
| `decision` | `decisions` | `key` 原样写入 |
| `knowledge` | `knowledge_index` | `trigger_description` 使用 `rationale` |
| `correction` | `decisions` | `key` 必须标准化为 `correction.<key>` |
| `alias` | `aliases` | 必须带 `manual_entry=true` |

所有 Memory 写入前必须执行 redline 扫描。命中 PHI、token、密钥、完整敏感请求/响应等内容时不得入库，不移动 pending 文件，并写失败审计。

## Audit Event

每条候选的决策都写入 `reports/audit.log`，`event_name` 固定为 `automemory.review_decision`。

必含字段：

- `task_id`
- `candidate_key`
- `candidate_kind`
- `source_ref`
- `decision`
- `reviewer`
- `edited`
- `archive_path`
- `memory_namespace`
- `memory_write_ok`
- `reason`

审计日志只记录结构化结果，不记录 token、凭证、真实敏感请求/响应。

## CLI

入口：

```sh
pnpm --filter @copilot-harness/orchestrator automemory-review -- --dry-run
```

等价本地 bin：

```sh
./orchestrator/bin/automemory-review --dry-run
```

参数：

- `--dry-run`
- `--pending-dir <path>`
- `--archive-dir <path>`
- `--sqlite-path <path>`
- `--reviewer <name>`
- `--limit <n>`

交互键：

- `a`: accept
- `r`: reject
- `e`: edit then accept
- `s`: skip
- `q`: quit

## W8 Eval Review Metrics

`pnpm --filter @copilot-harness/orchestrator eval:w8` 会可选读取 `orchestrator/eval/w8-review-metrics.json`。该文件必须来自一次真实人工 Review CLI 审批，不得由 dry-run 或 mock 代替。

Schema 文件：`orchestrator/eval/w8-review-metrics.schema.json`。

示例文件：`orchestrator/eval/w8-review-metrics.example.json`。

字段约束：

- `schema_version`: 固定为 `phase-1b-w8-review-metrics@1`。
- `source`: 指向真实审计来源，例如 `reports/audit.log#automemory.review_decision`。
- `reviewed_count`: 必须等于 `accepted_count + edit_accepted_count + rejected_count + major_edit_count`。
- `skipped_count`: 记录但不计入 accept rate 分母。
- `review_time_minutes`: 从人工开始审批到完成审批的分钟数，W8 目标为 `<= 10`。

`eval:w8` 使用规则：

- 有 `w8-review-metrics.json` 时，`accept_rate = (accepted_count + edit_accepted_count) / reviewed_count`。
- 无该文件时，回退到 W8 dataset 的 `review_decision` 字段；若 dataset 也没有真实 review 决策，则报告保持 `NOT_READY`。
- `review_time_minutes` 只来自 `w8-review-metrics.json`，不会自动从 dry-run 推断。

生成命令：

```sh
pnpm --filter @copilot-harness/orchestrator automemory-review:metrics -- \
  --audit-log reports/audit.log \
  --output eval/w8-review-metrics.json
```

注意：该命令只统计已经写入 `reports/audit.log` 的 `automemory.review_decision` 事件；必须先完成真实人工 Review CLI 审批。
