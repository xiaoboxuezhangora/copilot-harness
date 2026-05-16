export const MEMORY_NAMESPACES = [
  "decisions",
  "knowledge_index",
  "aliases",
] as const;
export const MEMORY_PORTABLE_KINDS = [
  "decision",
  "knowledge",
  "alias",
] as const;
export const MEMORY_EMBEDDING_PROVIDERS = [
  "local_bge_small_zh",
  "openai_text_embedding_3_small",
  "deterministic_test",
] as const;

export type MemoryNamespace = (typeof MEMORY_NAMESPACES)[number];
export type MemoryPortableKind = (typeof MEMORY_PORTABLE_KINDS)[number];
export type MemoryEmbeddingProvider =
  (typeof MEMORY_EMBEDDING_PROVIDERS)[number];
export type MemoryEmbeddingBackend = "sqlite_vec" | "fallback_lexical";

export interface DecisionRecord {
  readonly namespace: "decisions";
  readonly key: string;
  readonly value: string;
  readonly source_ref: string;
  readonly producer_agent: string;
  readonly ts: string;
  readonly confidence: number;
  readonly ttl_seconds?: number | undefined;
  readonly expires_at?: string | undefined;
  readonly version: number;
}

export interface KnowledgeIndexRecord {
  readonly namespace: "knowledge_index";
  readonly key: string;
  readonly value: string;
  readonly trigger_description: string;
  readonly source_ref: string;
  readonly producer_agent: string;
  readonly confidence: number;
  readonly ts: string;
  readonly version: number;
}

export interface AliasRecord {
  readonly namespace: "aliases";
  readonly key: string;
  readonly value: string;
  readonly source_ref: string;
  readonly producer_agent: string;
  readonly ts: string;
  readonly version: number;
}

export type MemoryRecord = DecisionRecord | KnowledgeIndexRecord | AliasRecord;

export interface MemoryPortableRecordV1 {
  readonly kind: MemoryPortableKind;
  readonly key: string;
  readonly value: string;
  readonly source_ref: string;
  readonly producer_agent: string;
  readonly ts: string;
  readonly confidence: number;
}

export type MemoryPutWarningCode =
  | "producer_agent_immutable"
  | "optimistic_lock_conflict";

export interface MemoryPutWarning {
  readonly code: MemoryPutWarningCode;
  readonly namespace: MemoryNamespace;
  readonly key: string;
  readonly message: string;
  readonly expected_version?: number | undefined;
  readonly current_version?: number | undefined;
  readonly existing_producer_agent?: string | undefined;
  readonly incoming_producer_agent?: string | undefined;
}

export interface PutInput {
  readonly namespace?: MemoryNamespace | undefined;
  readonly key?: string | undefined;
  readonly value?: string | undefined;
  readonly source_ref?: string | undefined;
  readonly ts?: string | undefined;
  readonly confidence?: number | undefined;
  readonly producer_agent?: string | undefined;
  readonly ttl_seconds?: number | undefined;
  readonly expires_at?: string | undefined;
  readonly trigger_description?: string | undefined;
  readonly manual_entry?: boolean | undefined;
  readonly expected_version?: number | undefined;
  readonly portable_record?: MemoryPortableRecordV1 | undefined;
}

export interface PutResult {
  readonly record: MemoryRecord;
  readonly portable_record: MemoryPortableRecordV1;
  readonly version: number;
  readonly warnings: readonly MemoryPutWarning[];
}

export interface GetInput {
  readonly namespace: MemoryNamespace;
  readonly key: string;
}

export interface SearchInput {
  readonly namespace?: MemoryNamespace | undefined;
  readonly query: string;
  readonly limit?: number | undefined;
  readonly include_expired?: boolean | undefined;
}

export interface ListInput {
  readonly namespace?: MemoryNamespace | undefined;
  readonly limit?: number | undefined;
  readonly offset?: number | undefined;
  readonly include_expired?: boolean | undefined;
}

export interface HotIndexInput {
  readonly namespace?: MemoryNamespace | undefined;
  readonly limit?: number | undefined;
  readonly include_expired?: boolean | undefined;
  readonly max_summary_bytes?: number | undefined;
}

export interface FindSimilarMemoryRecordsInput {
  readonly namespace: MemoryNamespace;
  readonly key: string;
  readonly value: string;
  readonly source_ref: string;
  readonly producer_agent?: string | undefined;
  readonly trigger_description?: string | undefined;
  readonly limit?: number | undefined;
  readonly threshold?: number | undefined;
  readonly include_expired?: boolean | undefined;
  readonly embedding_provider?: MemoryEmbeddingProvider | undefined;
}

export interface MemoryEmbeddingRecord {
  readonly schema_version: "phase-1c-w9-memory-embedding@1";
  readonly namespace: MemoryNamespace;
  readonly key: string;
  readonly source_ref: string;
  readonly embedding_provider: MemoryEmbeddingProvider;
  readonly embedding_backend: MemoryEmbeddingBackend;
  readonly dimensions: number;
  readonly created_at: string;
}

export interface MemoryConflictCandidate {
  readonly schema_version: "phase-1c-w9-memory-conflict-candidate@1";
  readonly namespace: MemoryNamespace;
  readonly key: string;
  readonly source_ref: string;
  readonly similarity: number;
  readonly embedding_backend: MemoryEmbeddingBackend;
  readonly existing_record: MemoryRecord;
}

export interface FindSimilarMemoryRecordsResult {
  readonly ok: true;
  readonly embedding_backend: MemoryEmbeddingBackend;
  readonly embedding_provider: MemoryEmbeddingProvider;
  readonly threshold: number;
  readonly warnings: readonly string[];
  readonly candidate_embedding: MemoryEmbeddingRecord;
  readonly candidates: readonly MemoryConflictCandidate[];
}

export interface MemoryHotIndexScoreComponents {
  readonly recency_score: number;
  readonly confidence_score: number;
  readonly log_hit_score: number;
  readonly source_quality_score: number;
}

export interface MemoryHotIndexRecord {
  readonly schema_version: "phase-1c-w9-memory-hot-index@1";
  readonly namespace: MemoryNamespace;
  readonly key: string;
  readonly source_ref: string;
  readonly summary: string;
  readonly score: number;
  readonly score_components: MemoryHotIndexScoreComponents;
  readonly hit_count: number;
  readonly last_hit_at: string | null;
  readonly last_injected_at: string | null;
  readonly accepted_at: string;
  readonly confidence: number;
}

export interface HotIndexResult {
  readonly ok: true;
  readonly total: number;
  readonly records: readonly MemoryHotIndexRecord[];
  readonly warnings: readonly string[];
}

export interface RedlineMatch {
  readonly field: string;
  readonly rule_id: string;
  readonly description: string;
}
