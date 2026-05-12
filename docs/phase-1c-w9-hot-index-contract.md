# Phase 1c W9-B: Memory Hot Index Contract

## Scope

- Context Assembler defaults to Memory `hot_index` summaries for Jira + GitLab analysis.
- Full Memory detail remains lazy-loaded through `search`; no full unbounded Memory value injection is allowed.
- The Memory MCP stays local SQLite only for W9-B.

## MemoryHotIndexRecordV1

```ts
interface MemoryHotIndexRecordV1 {
  schema_version: "phase-1c-w9-memory-hot-index@1";
  namespace: "decisions" | "knowledge_index" | "aliases";
  key: string;
  source_ref: string;
  summary: string;
  score: number;
  score_components: {
    recency_score: number;
    confidence_score: number;
    log_hit_score: number;
    source_quality_score: number;
  };
  hit_count: number;
  last_hit_at: string | null;
  last_injected_at: string | null;
  accepted_at: string;
  confidence: number;
}
```

`summary` is UTF-8 byte bounded. Redline or empty values are excluded instead of redacted into prompt context.

## Score

Default score:

```text
score =
  recency_score * 0.35 +
  confidence_score * 0.25 +
  log_hit_score * 0.25 +
  source_quality_score * 0.15
```

Component rules:

- `recency_score`: `1 / (1 + age_days / 30)`, based on `accepted_at`.
- `confidence_score`: decision confidence; non-decision namespaces default to `0.7`.
- `log_hit_score`: `min(1, log1p(hit_count) / log1p(100))`.
- `source_quality_score`: `1.0` for `gitlab:`/`local:` refs, `0.8` for `jira:`/`manual:` refs, otherwise `0.6`.

Sort by `score DESC`, then `accepted_at DESC`, then `namespace ASC`, then `key ASC`.

## Stats Update Rules

The store owns an internal stats table keyed by `(namespace, key)`:

- `hit_count`
- `last_hit_at`
- `last_injected_at`
- `accepted_at`
- `confidence`

Rules:

- `put` upserts stats using `accepted_at = ts` and namespace confidence.
- `get` and `search` call internal `recordMemoryHit`; this method is not exposed as an MCP tool.
- `hotIndex` updates `last_injected_at` for returned records as telemetry. The MCP tool remains annotated read-only because it does not mutate Memory content.
- Expired decisions are excluded unless `include_expired=true`.
- Redline entries never enter `hot_index`.

## Context Budget

- MCP `hotIndex` default limit: `200`.
- Context Assembler default `hot_index` injection limit: caller `memoryRequest.limit`, capped to the request and bounded summaries only.
- Context fragments must render `memory_loading_strategy: hot_index_then_lazy_search`.
- Prompt order remains: Memory hot_index > Retrieval > Skill.
- Full details are available only through explicit lazy `search` calls.
