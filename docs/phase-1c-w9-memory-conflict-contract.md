# Phase 1c W9-A: Memory Conflict Contract

## Scope

- Auto-Memory Review CLI must check Memory conflicts before `accept` or `edit` writes.
- Harvester still only writes pending candidates and must not resolve conflicts.
- Redline violations stop before embedding generation and before Memory writes.
- Tests use `deterministic_test`; real embedding providers are allowlisted but not required for local tests.

## MemoryEmbeddingRecordV1

```ts
interface MemoryEmbeddingRecordV1 {
  schema_version: "phase-1c-w9-memory-embedding@1";
  namespace: "decisions" | "knowledge_index" | "aliases";
  key: string;
  source_ref: string;
  embedding_provider:
    | "local_bge_small_zh"
    | "openai_text_embedding_3_small"
    | "deterministic_test";
  embedding_backend: "sqlite_vec" | "fallback_lexical";
  dimensions: number;
  created_at: string;
}
```

The embedding vector is not written to audit logs. When sqlite-vec is unavailable, the store still creates this metadata record and uses deterministic lexical similarity.

## MemoryConflictCandidateV1

```ts
interface MemoryConflictCandidateV1 {
  schema_version: "phase-1c-w9-memory-conflict-candidate@1";
  namespace: "decisions" | "knowledge_index" | "aliases";
  key: string;
  source_ref: string;
  similarity: number;
  embedding_backend: "sqlite_vec" | "fallback_lexical";
  existing_record: MemoryRecord;
}
```

Default conflict threshold: `similarity >= 0.85`.

Similarity is evaluated only inside the same namespace. Exact key matches are always treated as conflicts. Expired decisions are excluded unless the caller explicitly asks to include expired records.

## MemoryConflictDecisionV1

```ts
type MemoryConflictResolution =
  | "keep_existing"
  | "replace_existing"
  | "merge"
  | "add_new"
  | "reject"
  | "skip";

interface MemoryConflictDecisionV1 {
  schema_version: "phase-1c-w9-memory-conflict-decision@1";
  task_id: string;
  candidate_key: string;
  candidate_kind: "decision" | "knowledge" | "correction" | "alias";
  namespace: "decisions" | "knowledge_index" | "aliases";
  conflict_count: number;
  top_similarity: number | null;
  embedding_backend: "sqlite_vec" | "fallback_lexical";
  decision: MemoryConflictResolution;
  reviewer: string;
  reviewer_reason?: string;
  edited_fields: readonly string[];
  memory_write_ok: boolean;
  source_ref: string;
}
```

`add_new` requires `reviewer_reason`. `replace_existing` and `merge` require at least one `edited_fields` entry. If conflicts exist and no decision is recorded, the candidate must not be written.

## Provider And Fallback Rules

- Allowlist:
  - `local_bge_small_zh`
  - `openai_text_embedding_3_small`
  - `deterministic_test`
- Test default: `deterministic_test`.
- Real providers may read endpoint/model/token settings from env, but token values must not be logged or serialized.
- sqlite-vec is capability-detected. When unavailable, conflict checks return `embedding_backend=fallback_lexical` and include a warning.
- The store exposes `findSimilarMemoryRecords()` so sqlite-vec, sqlite-vss, or pgvector can replace the fallback without changing Review CLI flow.

## Audit Events

`automemory.conflict_check` fields:

- `task_id`
- `candidate_key`
- `candidate_kind`
- `namespace`
- `conflict_count`
- `top_similarity`
- `embedding_backend`
- `decision`: `no_conflict | compare_required`
- `reviewer`
- `memory_write_ok`
- `source_ref`

`automemory.conflict_decision` fields:

- `task_id`
- `candidate_key`
- `candidate_kind`
- `namespace`
- `conflict_count`
- `top_similarity`
- `embedding_backend`
- `decision`
- `reviewer`
- `memory_write_ok`
- `source_ref`
- `reviewer_reason`
- `edited_fields`

Audit records must not include Memory values, embedding input text, vectors, tokens, credentials, PHI, patient identifiers, charge details, CA private keys, or full sensitive request/response payloads.
