import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const DEFAULT_MEMORY_SQLITE_PATH = 'reports/memory.sqlite';
export const MEMORY_NAMESPACES = ['decisions', 'knowledge_index', 'aliases'] as const;
export const MEMORY_EMBEDDING_PROVIDERS = [
  'local_bge_small_zh',
  'openai_text_embedding_3_small',
  'deterministic_test'
] as const;

export type MemoryNamespace = (typeof MEMORY_NAMESPACES)[number];
export type MemoryEmbeddingProvider = (typeof MEMORY_EMBEDDING_PROVIDERS)[number];
export type MemoryEmbeddingBackend = 'sqlite_vec' | 'fallback_lexical';

export interface MemoryRecord {
  readonly namespace: MemoryNamespace;
  readonly key: string;
  readonly value: string;
  readonly sourceRef: string;
  readonly ts: string;
  readonly confidence?: number | undefined;
  readonly producerAgent?: string | undefined;
  readonly ttlSeconds?: number | undefined;
  readonly expiresAt?: string | undefined;
  readonly triggerDescription?: string | undefined;
  readonly manualEntry?: boolean | undefined;
}

export interface MemoryPutInput {
  readonly namespace: MemoryNamespace;
  readonly key: string;
  readonly value: string;
  readonly sourceRef: string;
  readonly ts?: string | undefined;
  readonly confidence?: number | undefined;
  readonly producerAgent?: string | undefined;
  readonly ttlSeconds?: number | undefined;
  readonly expiresAt?: string | undefined;
  readonly triggerDescription?: string | undefined;
  readonly manualEntry?: boolean | undefined;
}

export interface MemoryGetInput {
  readonly namespace: MemoryNamespace;
  readonly key: string;
}

export interface MemorySearchInput {
  readonly namespace?: MemoryNamespace | undefined;
  readonly query: string;
  readonly limit: number;
  readonly includeExpired?: boolean | undefined;
}

export interface MemoryListInput {
  readonly namespace?: MemoryNamespace | undefined;
  readonly limit: number;
  readonly offset: number;
  readonly includeExpired?: boolean | undefined;
}

export interface MemoryHotIndexInput {
  readonly namespace?: MemoryNamespace | undefined;
  readonly limit?: number | undefined;
  readonly includeExpired?: boolean | undefined;
  readonly maxSummaryBytes?: number | undefined;
}

export interface MemoryFindSimilarInput {
  readonly namespace: MemoryNamespace;
  readonly key: string;
  readonly value: string;
  readonly sourceRef: string;
  readonly producerAgent?: string | undefined;
  readonly triggerDescription?: string | undefined;
  readonly limit?: number | undefined;
  readonly threshold?: number | undefined;
  readonly includeExpired?: boolean | undefined;
  readonly embeddingProvider?: MemoryEmbeddingProvider | undefined;
}

export interface MemoryEmbeddingRecordV1 {
  readonly schema_version: 'phase-1c-w9-memory-embedding@1';
  readonly namespace: MemoryNamespace;
  readonly key: string;
  readonly source_ref: string;
  readonly embedding_provider: MemoryEmbeddingProvider;
  readonly embedding_backend: MemoryEmbeddingBackend;
  readonly dimensions: number;
  readonly created_at: string;
}

export interface MemoryConflictCandidateV1 {
  readonly schema_version: 'phase-1c-w9-memory-conflict-candidate@1';
  readonly namespace: MemoryNamespace;
  readonly key: string;
  readonly source_ref: string;
  readonly similarity: number;
  readonly embedding_backend: MemoryEmbeddingBackend;
  readonly existing_record: MemoryRecord;
}

export interface MemoryFindSimilarResult {
  readonly ok: true;
  readonly embedding_backend: MemoryEmbeddingBackend;
  readonly embedding_provider: MemoryEmbeddingProvider;
  readonly threshold: number;
  readonly warnings: readonly string[];
  readonly candidate_embedding: MemoryEmbeddingRecordV1;
  readonly candidates: readonly MemoryConflictCandidateV1[];
}

export interface MemoryHotIndexScoreComponents {
  readonly recency_score: number;
  readonly confidence_score: number;
  readonly log_hit_score: number;
  readonly source_quality_score: number;
}

export interface MemoryHotIndexRecordV1 {
  readonly schema_version: 'phase-1c-w9-memory-hot-index@1';
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

export interface MemoryHotIndexResult {
  readonly ok: true;
  readonly total: number;
  readonly records: readonly MemoryHotIndexRecordV1[];
  readonly warnings: readonly string[];
}

export interface MemoryStore {
  put(input: MemoryPutInput): Promise<MemoryRecord>;
  get(input: MemoryGetInput): Promise<MemoryRecord | null>;
  search(input: MemorySearchInput): Promise<readonly MemoryRecord[]>;
  list(input: MemoryListInput): Promise<readonly MemoryRecord[]>;
  findSimilarMemoryRecords(input: MemoryFindSimilarInput): Promise<MemoryFindSimilarResult>;
  hotIndex(input: MemoryHotIndexInput): Promise<MemoryHotIndexResult>;
}

interface DecisionRow {
  readonly key: string;
  readonly value: string;
  readonly source_ref: string;
  readonly producer_agent: string;
  readonly ts: string;
  readonly confidence: number;
  readonly ttl_seconds: number | null;
  readonly expires_at: string | null;
}

interface KnowledgeIndexRow {
  readonly key: string;
  readonly value: string;
  readonly trigger_description: string;
  readonly source_ref: string;
  readonly ts: string;
}

interface AliasRow {
  readonly key: string;
  readonly value: string;
  readonly source_ref: string;
  readonly producer_agent: string;
  readonly ts: string;
}

interface MemoryStatsRow {
  readonly namespace: MemoryNamespace;
  readonly key: string;
  readonly hit_count: number;
  readonly last_hit_at: string | null;
  readonly last_injected_at: string | null;
  readonly accepted_at: string;
  readonly confidence: number;
}

export interface SqliteMemoryStoreOptions {
  readonly sqlitePath?: string;
  readonly now?: () => Date;
  readonly embeddingProvider?: MemoryEmbeddingProvider | undefined;
}

export class SqliteMemoryStore implements MemoryStore {
  private readonly db: DatabaseSync;
  private readonly now: () => Date;
  private readonly embeddingProvider: MemoryEmbeddingProvider;

  constructor(options: SqliteMemoryStoreOptions = {}) {
    const sqlitePath = resolve(options.sqlitePath ?? DEFAULT_MEMORY_SQLITE_PATH);
    mkdirSync(dirname(sqlitePath), { recursive: true });

    this.db = new DatabaseSync(sqlitePath);
    this.now = options.now ?? (() => new Date());
    this.embeddingProvider = options.embeddingProvider ?? 'deterministic_test';
    this.initialize();
  }

  close(): void {
    this.db.close();
  }

  async put(input: MemoryPutInput): Promise<MemoryRecord> {
    const ts = input.ts ?? this.now().toISOString();

    if (input.namespace === 'decisions') {
      const producerAgent = requiredString(
        input.producerAgent,
        'producerAgent is required for decisions namespace'
      );
      const confidence = requiredNumber(
        input.confidence,
        'confidence is required for decisions namespace'
      );
      const expiresAt = resolveExpiresAt(ts, input.ttlSeconds, input.expiresAt);

      this.db
        .prepare(
          `
          INSERT INTO decisions (
            key, value, source_ref, producer_agent, ts, confidence, ttl_seconds, expires_at, updated_at
          ) VALUES (
            :key, :value, :source_ref, :producer_agent, :ts, :confidence, :ttl_seconds, :expires_at, :updated_at
          )
          ON CONFLICT(key) DO UPDATE SET
            value = excluded.value,
            source_ref = excluded.source_ref,
            producer_agent = excluded.producer_agent,
            ts = excluded.ts,
            confidence = excluded.confidence,
            ttl_seconds = excluded.ttl_seconds,
            expires_at = excluded.expires_at,
            updated_at = excluded.updated_at
          `
        )
        .run({
          key: input.key,
          value: input.value,
          source_ref: input.sourceRef,
          producer_agent: producerAgent,
          ts,
          confidence,
          ttl_seconds: input.ttlSeconds ?? null,
          expires_at: expiresAt ?? null,
          updated_at: this.now().toISOString()
        });
    } else if (input.namespace === 'knowledge_index') {
      const triggerDescription = requiredString(
        input.triggerDescription,
        'triggerDescription is required for knowledge_index namespace'
      );

      this.db
        .prepare(
          `
          INSERT INTO knowledge_index (
            key, value, trigger_description, source_ref, ts, updated_at
          ) VALUES (
            :key, :value, :trigger_description, :source_ref, :ts, :updated_at
          )
          ON CONFLICT(key) DO UPDATE SET
            value = excluded.value,
            trigger_description = excluded.trigger_description,
            source_ref = excluded.source_ref,
            ts = excluded.ts,
            updated_at = excluded.updated_at
          `
        )
        .run({
          key: input.key,
          value: input.value,
          trigger_description: triggerDescription,
          source_ref: input.sourceRef,
          ts,
          updated_at: this.now().toISOString()
        });
    } else {
      if (input.manualEntry !== true) {
        throw new Error('manualEntry=true is required for aliases namespace');
      }
      const producerAgent = requiredString(
        input.producerAgent,
        'producerAgent is required for aliases namespace'
      );

      this.db
        .prepare(
          `
          INSERT INTO aliases (
            key, value, source_ref, producer_agent, ts, updated_at
          ) VALUES (
            :key, :value, :source_ref, :producer_agent, :ts, :updated_at
          )
          ON CONFLICT(key) DO UPDATE SET
            value = excluded.value,
            source_ref = excluded.source_ref,
            producer_agent = excluded.producer_agent,
            ts = excluded.ts,
            updated_at = excluded.updated_at
          `
        )
        .run({
          key: input.key,
          value: input.value,
          source_ref: input.sourceRef,
          producer_agent: producerAgent,
          ts,
          updated_at: this.now().toISOString()
        });
    }

    const stored = this.readRecord({
      namespace: input.namespace,
      key: input.key
    });

    if (stored === null) {
      throw new Error('Memory record was not found after put');
    }

    this.upsertMemoryStats(stored);
    return stored;
  }

  async get(input: MemoryGetInput): Promise<MemoryRecord | null> {
    const record = this.readRecord(input);
    if (record !== null) {
      this.recordMemoryHit(record.namespace, record.key);
    }
    return record;
  }

  private readRecord(input: MemoryGetInput): MemoryRecord | null {
    if (input.namespace === 'decisions') {
      const row = this.db
        .prepare(
          `
          SELECT key, value, source_ref, producer_agent, ts, confidence, ttl_seconds, expires_at
          FROM decisions
          WHERE key = :key
          `
        )
        .get({
          key: input.key
        });

      if (row === undefined) return null;
      return mapDecisionRow(readDecisionRow(row));
    }

    if (input.namespace === 'knowledge_index') {
      const row = this.db
        .prepare(
          `
          SELECT key, value, trigger_description, source_ref, ts
          FROM knowledge_index
          WHERE key = :key
          `
        )
        .get({
          key: input.key
        });

      if (row === undefined) return null;
      return mapKnowledgeIndexRow(readKnowledgeIndexRow(row));
    }

    const row = this.db
      .prepare(
        `
        SELECT key, value, source_ref, producer_agent, ts
        FROM aliases
        WHERE key = :key
        `
      )
      .get({
        key: input.key
      });

    if (row === undefined) return null;
    return mapAliasRow(readAliasRow(row));
  }

  async search(input: MemorySearchInput): Promise<readonly MemoryRecord[]> {
    const includeExpired = input.includeExpired ?? false;
    const pattern = `%${escapeSqlLike(input.query)}%`;
    let records: readonly MemoryRecord[];

    if (input.namespace === 'decisions') {
      records = this.searchDecisions(pattern, input.limit, includeExpired);
    } else if (input.namespace === 'knowledge_index') {
      records = this.searchKnowledgeIndex(pattern, input.limit);
    } else if (input.namespace === 'aliases') {
      records = this.searchAliases(pattern, input.limit);
    } else {
      const combined = [
        ...this.searchDecisions(pattern, input.limit, includeExpired),
        ...this.searchKnowledgeIndex(pattern, input.limit),
        ...this.searchAliases(pattern, input.limit)
      ];

      records = sortMemoryRecords(combined).slice(0, input.limit);
    }

    this.recordMemoryHits(records);
    return records;
  }

  async list(input: MemoryListInput): Promise<readonly MemoryRecord[]> {
    const includeExpired = input.includeExpired ?? false;

    if (input.namespace === 'decisions') {
      return this.listDecisions(input.limit, input.offset, includeExpired);
    }

    if (input.namespace === 'knowledge_index') {
      return this.listKnowledgeIndex(input.limit, input.offset);
    }

    if (input.namespace === 'aliases') {
      return this.listAliases(input.limit, input.offset);
    }

    const fetchSize = input.limit + input.offset;
    const combined = [
      ...this.listDecisions(fetchSize, 0, includeExpired),
      ...this.listKnowledgeIndex(fetchSize, 0),
      ...this.listAliases(fetchSize, 0)
    ];

    return sortMemoryRecords(combined).slice(input.offset, input.offset + input.limit);
  }

  async findSimilarMemoryRecords(
    input: MemoryFindSimilarInput
  ): Promise<MemoryFindSimilarResult> {
    const threshold = input.threshold ?? 0.85;
    const limit = input.limit ?? 5;
    const embeddingProvider = input.embeddingProvider ?? this.embeddingProvider;
    const backend = this.detectEmbeddingBackend();
    const warnings =
      backend === 'fallback_lexical'
        ? ['sqlite_vec_unavailable', 'embedding_backend=fallback_lexical']
        : [];
    const candidateEmbedding = buildMemoryEmbeddingRecord({
      input,
      embeddingBackend: backend,
      embeddingProvider,
      createdAt: this.now().toISOString()
    });
    const records = await this.list({
      namespace: input.namespace,
      limit: 1_000,
      offset: 0,
      includeExpired: input.includeExpired
    });
    const candidates = records
      .map((record) => ({
        schema_version: 'phase-1c-w9-memory-conflict-candidate@1' as const,
        namespace: record.namespace,
        key: record.key,
        source_ref: record.sourceRef,
        similarity: scoreMemorySimilarity(input, record),
        embedding_backend: backend,
        existing_record: record
      }))
      .filter((candidate) => candidate.similarity >= threshold)
      .sort((left, right) => {
        if (left.similarity !== right.similarity) return right.similarity - left.similarity;
        return left.key.localeCompare(right.key);
      })
      .slice(0, limit);

    return {
      ok: true,
      embedding_backend: backend,
      embedding_provider: embeddingProvider,
      threshold,
      warnings,
      candidate_embedding: candidateEmbedding,
      candidates
    };
  }

  async hotIndex(input: MemoryHotIndexInput): Promise<MemoryHotIndexResult> {
    const limit = input.limit ?? 200;
    const maxSummaryBytes = input.maxSummaryBytes ?? 240;
    const records = await this.list({
      namespace: input.namespace,
      limit: 1_000,
      offset: 0,
      includeExpired: input.includeExpired
    });
    const warnings: string[] = [];
    const hotRecords: MemoryHotIndexRecordV1[] = [];

    for (const record of records) {
      const summary = summarizeMemoryValue(record.value, maxSummaryBytes);
      if (summary === null) {
        warnings.push(`excluded_redline_or_empty:${record.namespace}:${record.key}`);
        continue;
      }

      const stats = this.getMemoryStats(record) ?? this.upsertMemoryStats(record);
      hotRecords.push(buildMemoryHotIndexRecord(record, stats, summary, this.now()));
    }

    const selected = hotRecords.sort(sortMemoryHotIndexRecords).slice(0, limit);
    const injectedAt = this.now().toISOString();
    for (const record of selected) {
      this.recordMemoryInjected(record.namespace, record.key, injectedAt);
    }

    return {
      ok: true,
      total: selected.length,
      records: selected,
      warnings
    };
  }

  private searchDecisions(
    pattern: string,
    limit: number,
    includeExpired: boolean
  ): readonly MemoryRecord[] {
    const rows = this.db
      .prepare(
        `
        SELECT key, value, source_ref, producer_agent, ts, confidence, ttl_seconds, expires_at
        FROM decisions
        WHERE (
          key LIKE :pattern ESCAPE '\\'
          OR value LIKE :pattern ESCAPE '\\'
          OR source_ref LIKE :pattern ESCAPE '\\'
          OR producer_agent LIKE :pattern ESCAPE '\\'
        )
        AND (
          :include_expired = 1 OR expires_at IS NULL OR expires_at > :now_iso
        )
        ORDER BY ts DESC, key ASC
        LIMIT :limit
        `
      )
      .all({
        pattern,
        include_expired: includeExpired ? 1 : 0,
        now_iso: this.now().toISOString(),
        limit
      });

    return rows.map((row) => mapDecisionRow(readDecisionRow(row)));
  }

  private searchKnowledgeIndex(pattern: string, limit: number): readonly MemoryRecord[] {
    const rows = this.db
      .prepare(
        `
        SELECT key, value, trigger_description, source_ref, ts
        FROM knowledge_index
        WHERE (
          key LIKE :pattern ESCAPE '\\'
          OR value LIKE :pattern ESCAPE '\\'
          OR trigger_description LIKE :pattern ESCAPE '\\'
          OR source_ref LIKE :pattern ESCAPE '\\'
        )
        ORDER BY ts DESC, key ASC
        LIMIT :limit
        `
      )
      .all({
        pattern,
        limit
      });

    return rows.map((row) => mapKnowledgeIndexRow(readKnowledgeIndexRow(row)));
  }

  private searchAliases(pattern: string, limit: number): readonly MemoryRecord[] {
    const rows = this.db
      .prepare(
        `
        SELECT key, value, source_ref, producer_agent, ts
        FROM aliases
        WHERE (
          key LIKE :pattern ESCAPE '\\'
          OR value LIKE :pattern ESCAPE '\\'
          OR source_ref LIKE :pattern ESCAPE '\\'
          OR producer_agent LIKE :pattern ESCAPE '\\'
        )
        ORDER BY ts DESC, key ASC
        LIMIT :limit
        `
      )
      .all({
        pattern,
        limit
      });

    return rows.map((row) => mapAliasRow(readAliasRow(row)));
  }

  private listDecisions(
    limit: number,
    offset: number,
    includeExpired: boolean
  ): readonly MemoryRecord[] {
    const rows = this.db
      .prepare(
        `
        SELECT key, value, source_ref, producer_agent, ts, confidence, ttl_seconds, expires_at
        FROM decisions
        WHERE (
          :include_expired = 1 OR expires_at IS NULL OR expires_at > :now_iso
        )
        ORDER BY ts DESC, key ASC
        LIMIT :limit OFFSET :offset
        `
      )
      .all({
        include_expired: includeExpired ? 1 : 0,
        now_iso: this.now().toISOString(),
        limit,
        offset
      });

    return rows.map((row) => mapDecisionRow(readDecisionRow(row)));
  }

  private listKnowledgeIndex(limit: number, offset: number): readonly MemoryRecord[] {
    const rows = this.db
      .prepare(
        `
        SELECT key, value, trigger_description, source_ref, ts
        FROM knowledge_index
        ORDER BY ts DESC, key ASC
        LIMIT :limit OFFSET :offset
        `
      )
      .all({
        limit,
        offset
      });

    return rows.map((row) => mapKnowledgeIndexRow(readKnowledgeIndexRow(row)));
  }

  private listAliases(limit: number, offset: number): readonly MemoryRecord[] {
    const rows = this.db
      .prepare(
        `
        SELECT key, value, source_ref, producer_agent, ts
        FROM aliases
        ORDER BY ts DESC, key ASC
        LIMIT :limit OFFSET :offset
        `
      )
      .all({
        limit,
        offset
      });

    return rows.map((row) => mapAliasRow(readAliasRow(row)));
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS decisions (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        source_ref TEXT NOT NULL,
        producer_agent TEXT NOT NULL,
        ts TEXT NOT NULL,
        confidence REAL NOT NULL,
        ttl_seconds INTEGER,
        expires_at TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS knowledge_index (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        trigger_description TEXT NOT NULL,
        source_ref TEXT NOT NULL,
        ts TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS aliases (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        source_ref TEXT NOT NULL,
        producer_agent TEXT NOT NULL,
        ts TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS memory_stats (
        namespace TEXT NOT NULL,
        key TEXT NOT NULL,
        hit_count INTEGER NOT NULL DEFAULT 0,
        last_hit_at TEXT,
        last_injected_at TEXT,
        accepted_at TEXT NOT NULL,
        confidence REAL NOT NULL,
        PRIMARY KEY(namespace, key)
      );

      CREATE INDEX IF NOT EXISTS idx_decisions_ts ON decisions(ts DESC);
      CREATE INDEX IF NOT EXISTS idx_decisions_expires_at ON decisions(expires_at);
      CREATE INDEX IF NOT EXISTS idx_knowledge_index_ts ON knowledge_index(ts DESC);
      CREATE INDEX IF NOT EXISTS idx_aliases_ts ON aliases(ts DESC);
      CREATE INDEX IF NOT EXISTS idx_memory_stats_score_inputs
        ON memory_stats(namespace, hit_count, accepted_at);
    `);
  }

  private upsertMemoryStats(record: MemoryRecord): MemoryStatsRow {
    this.db
      .prepare(
        `
        INSERT INTO memory_stats (
          namespace, key, hit_count, last_hit_at, last_injected_at, accepted_at, confidence
        ) VALUES (
          :namespace, :key, 0, NULL, NULL, :accepted_at, :confidence
        )
        ON CONFLICT(namespace, key) DO UPDATE SET
          accepted_at = excluded.accepted_at,
          confidence = excluded.confidence
        `
      )
      .run({
        namespace: record.namespace,
        key: record.key,
        accepted_at: record.ts,
        confidence: confidenceForRecord(record)
      });

    const stats = this.getMemoryStats(record);
    if (stats === null) {
      throw new Error('Memory stats were not found after upsert');
    }
    return stats;
  }

  private getMemoryStats(record: Pick<MemoryRecord, 'namespace' | 'key'>): MemoryStatsRow | null {
    const row = this.db
      .prepare(
        `
        SELECT namespace, key, hit_count, last_hit_at, last_injected_at, accepted_at, confidence
        FROM memory_stats
        WHERE namespace = :namespace AND key = :key
        `
      )
      .get({ namespace: record.namespace, key: record.key });

    if (row === undefined) {
      return null;
    }

    return readMemoryStatsRow(row);
  }

  private recordMemoryHits(records: readonly MemoryRecord[]): void {
    const hitAt = this.now().toISOString();
    for (const record of records) {
      this.recordMemoryHit(record.namespace, record.key, hitAt);
    }
  }

  private recordMemoryHit(
    namespace: MemoryNamespace,
    key: string,
    hitAt = this.now().toISOString()
  ): void {
    this.db
      .prepare(
        `
        UPDATE memory_stats
        SET hit_count = hit_count + 1,
            last_hit_at = :last_hit_at
        WHERE namespace = :namespace AND key = :key
        `
      )
      .run({ namespace, key, last_hit_at: hitAt });
  }

  private recordMemoryInjected(namespace: MemoryNamespace, key: string, injectedAt: string): void {
    this.db
      .prepare(
        `
        UPDATE memory_stats
        SET last_injected_at = :last_injected_at
        WHERE namespace = :namespace AND key = :key
        `
      )
      .run({ namespace, key, last_injected_at: injectedAt });
  }

  private detectEmbeddingBackend(): MemoryEmbeddingBackend {
    try {
      this.db.prepare('SELECT vec_version() AS version').get();
      return 'sqlite_vec';
    } catch {
      return 'fallback_lexical';
    }
  }
}

export interface MemoryMcpInvoker {
  callTool(
    name: 'put' | 'get' | 'search' | 'list' | 'findSimilarMemoryRecords' | 'hotIndex',
    args: unknown
  ): Promise<unknown>;
}

export class MemoryMcpClient implements MemoryStore {
  constructor(private readonly invoker: MemoryMcpInvoker) {}

  async put(input: MemoryPutInput): Promise<MemoryRecord> {
    const payload = await this.invoker.callTool('put', toMemoryMcpInput(input));
    return parseMemoryMcpRecord(payload, 'put');
  }

  async get(input: MemoryGetInput): Promise<MemoryRecord | null> {
    const payload = await this.invoker.callTool('get', {
      namespace: input.namespace,
      key: input.key
    });
    return parseMemoryMcpNullableRecord(payload, 'get');
  }

  async search(input: MemorySearchInput): Promise<readonly MemoryRecord[]> {
    const payload = await this.invoker.callTool('search', {
      namespace: input.namespace,
      query: input.query,
      limit: input.limit,
      include_expired: input.includeExpired
    });
    return parseMemoryMcpRecordList(payload, 'search');
  }

  async list(input: MemoryListInput): Promise<readonly MemoryRecord[]> {
    const payload = await this.invoker.callTool('list', {
      namespace: input.namespace,
      limit: input.limit,
      offset: input.offset,
      include_expired: input.includeExpired
    });
    return parseMemoryMcpRecordList(payload, 'list');
  }

  async findSimilarMemoryRecords(input: MemoryFindSimilarInput): Promise<MemoryFindSimilarResult> {
    const payload = await this.invoker.callTool('findSimilarMemoryRecords', {
      namespace: input.namespace,
      key: input.key,
      value: input.value,
      source_ref: input.sourceRef,
      producer_agent: input.producerAgent,
      trigger_description: input.triggerDescription,
      limit: input.limit,
      threshold: input.threshold,
      include_expired: input.includeExpired,
      embedding_provider: input.embeddingProvider
    });
    return parseMemoryFindSimilarPayload(payload);
  }

  async hotIndex(input: MemoryHotIndexInput): Promise<MemoryHotIndexResult> {
    const payload = await this.invoker.callTool('hotIndex', {
      namespace: input.namespace,
      limit: input.limit,
      include_expired: input.includeExpired,
      max_summary_bytes: input.maxSummaryBytes
    });
    return parseMemoryHotIndexPayload(payload);
  }
}

export class PostgresPgvectorMemoryStore implements MemoryStore {
  async put(_input: MemoryPutInput): Promise<MemoryRecord> {
    throw new Error(
      'PostgresPgvectorMemoryStore is intentionally not implemented in W6. ' +
        'Use SQLite local store now; revisit in Phase 4 via ADR.'
    );
  }

  async get(_input: MemoryGetInput): Promise<MemoryRecord | null> {
    throw new Error(
      'PostgresPgvectorMemoryStore is intentionally not implemented in W6. ' +
        'Use SQLite local store now; revisit in Phase 4 via ADR.'
    );
  }

  async search(_input: MemorySearchInput): Promise<readonly MemoryRecord[]> {
    throw new Error(
      'PostgresPgvectorMemoryStore is intentionally not implemented in W6. ' +
        'Use SQLite local store now; revisit in Phase 4 via ADR.'
    );
  }

  async list(_input: MemoryListInput): Promise<readonly MemoryRecord[]> {
    throw new Error(
      'PostgresPgvectorMemoryStore is intentionally not implemented in W6. ' +
        'Use SQLite local store now; revisit in Phase 4 via ADR.'
    );
  }

  async findSimilarMemoryRecords(_input: MemoryFindSimilarInput): Promise<MemoryFindSimilarResult> {
    throw new Error(
      'PostgresPgvectorMemoryStore is intentionally not implemented in W6. ' +
        'Use SQLite local store now; revisit in Phase 4 via ADR.'
    );
  }

  async hotIndex(_input: MemoryHotIndexInput): Promise<MemoryHotIndexResult> {
    throw new Error(
      'PostgresPgvectorMemoryStore is intentionally not implemented in W6. ' +
        'Use SQLite local store now; revisit in Phase 4 via ADR.'
    );
  }
}

export interface MemoryDecisionV1 {
  readonly key: string;
  readonly value: string;
  readonly sourceRef: string;
  readonly producerAgent: string;
  readonly ts: string;
  readonly confidence: number;
  readonly ttlSeconds?: number | undefined;
  readonly expiresAt?: string | undefined;
}

export interface MemoryKnowledgeIndexEntryV1 {
  readonly key: string;
  readonly value: string;
  readonly triggerDescription: string;
  readonly sourceRef: string;
  readonly ts: string;
}

export interface MemorySchemaV1 {
  readonly decisions: readonly MemoryDecisionV1[];
  readonly knowledgeIndex: readonly MemoryKnowledgeIndexEntryV1[];
}

export interface MemoryDecisionSnapshotV1 {
  readonly key: string;
  readonly value: string;
  readonly source_ref: string;
  readonly producer_agent: string;
  readonly ts: string;
  readonly confidence: number;
  readonly ttl_seconds?: number | undefined;
  readonly expires_at?: string | undefined;
}

export interface MemoryKnowledgeIndexSnapshotV1 {
  readonly key: string;
  readonly value: string;
  readonly trigger_description: string;
  readonly source_ref: string;
  readonly ts: string;
}

export interface MemorySchemaSnapshotV1 {
  readonly decisions: readonly MemoryDecisionSnapshotV1[];
  readonly knowledge_index: readonly MemoryKnowledgeIndexSnapshotV1[];
}

export type MemoryRedlineId =
  | 'phi'
  | 'patient_identifier'
  | 'sso_token'
  | 'ca_private_key'
  | 'pda_key'
  | 'transfusion_reaction_raw_text'
  | 'platform_credentials'
  | 'authorization_bearer'
  | 'sensitive_request_response_dump';

export interface MemoryRedlineRule {
  readonly id: MemoryRedlineId;
  readonly description: string;
  readonly pattern: RegExp;
}

export interface MemoryRedlineMatch {
  readonly id: MemoryRedlineId;
  readonly description: string;
  readonly match: string;
}

export const MEMORY_REDLINE_RULES: readonly MemoryRedlineRule[] = [
  {
    id: 'phi',
    description: '禁止写入 PHI 或病案原文。',
    pattern: /(protected health information|病案|病历|诊断记录|检验结果)/i
  },
  {
    id: 'patient_identifier',
    description: '禁止写入真实患者标识。',
    pattern: /(patient(?:_?id|_?no)|inpatient(?:_?id|_?no)|患者(?:编号|标识|姓名|证件)|身份证号?|住院号)/i
  },
  {
    id: 'sso_token',
    description: '禁止写入 SSO token 或 ticket。',
    pattern: /(sso[_-]?(?:token|ticket)|session(?:id)?\s*[:=]\s*[A-Za-z0-9._-]{8,})/i
  },
  {
    id: 'ca_private_key',
    description: '禁止写入 CA 私钥或任何私钥材料。',
    pattern: /(-----BEGIN (?:RSA |EC |)PRIVATE KEY-----|ca[^\n]{0,12}(?:private key|私钥))/i
  },
  {
    id: 'pda_key',
    description: '禁止写入 PDA 密钥/令牌。',
    pattern: /(pda[_-]?(?:key|secret|token)|PDA[^\n]{0,8}(?:密钥|秘钥|令牌))/i
  },
  {
    id: 'transfusion_reaction_raw_text',
    description: '禁止写入输血反应原文。',
    pattern: /(transfusion reaction|输血反应).{0,20}(?:原文|详情|全文|记录)/i
  },
  {
    id: 'platform_credentials',
    description: '禁止写入平台凭证。',
    pattern: /(client_secret|app_secret|access_key|secret_key|platform[_-]?(?:credential|secret|token)|平台(?:凭证|密钥|令牌))/i
  },
  {
    id: 'authorization_bearer',
    description: '禁止写入 Authorization/Bearer 令牌。',
    pattern: /(authorization\s*:\s*bearer\s+[a-z0-9\-._~+/]+=*|\bbearer\s+[a-z0-9\-._~+/]+=*)/i
  },
  {
    id: 'sensitive_request_response_dump',
    description: '禁止写入完整敏感请求/响应。',
    pattern: /(full\s+(?:request|response)|raw\s+(?:request|response)|完整(?:敏感)?(?:请求|响应)|(?:request|response)\s*body\s*[:=])/i
  }
];

export function toMemorySchemaSnapshotV1(schema: MemorySchemaV1): MemorySchemaSnapshotV1 {
  return {
    decisions: schema.decisions.map((decision) => ({
      key: decision.key,
      value: decision.value,
      source_ref: decision.sourceRef,
      producer_agent: decision.producerAgent,
      ts: decision.ts,
      confidence: decision.confidence,
      ...(decision.ttlSeconds !== undefined ? { ttl_seconds: decision.ttlSeconds } : {}),
      ...(decision.expiresAt !== undefined ? { expires_at: decision.expiresAt } : {})
    })),
    knowledge_index: schema.knowledgeIndex.map((item) => ({
      key: item.key,
      value: item.value,
      trigger_description: item.triggerDescription,
      source_ref: item.sourceRef,
      ts: item.ts
    }))
  };
}

export function fromMemorySchemaSnapshotV1(snapshot: MemorySchemaSnapshotV1): MemorySchemaV1 {
  return {
    decisions: snapshot.decisions.map((decision) => ({
      key: decision.key,
      value: decision.value,
      sourceRef: decision.source_ref,
      producerAgent: decision.producer_agent,
      ts: decision.ts,
      confidence: decision.confidence,
      ...(decision.ttl_seconds !== undefined ? { ttlSeconds: decision.ttl_seconds } : {}),
      ...(decision.expires_at !== undefined ? { expiresAt: decision.expires_at } : {})
    })),
    knowledgeIndex: snapshot.knowledge_index.map((item) => ({
      key: item.key,
      value: item.value,
      triggerDescription: item.trigger_description,
      sourceRef: item.source_ref,
      ts: item.ts
    }))
  };
}

export function findMemoryRedlineViolations(value: string): readonly MemoryRedlineMatch[] {
  const violations: MemoryRedlineMatch[] = [];
  for (const rule of MEMORY_REDLINE_RULES) {
    const matched = value.match(rule.pattern);
    if (matched?.[0] !== undefined) {
      violations.push({
        id: rule.id,
        description: rule.description,
        match: matched[0]
      });
    }
  }
  return violations;
}

export function isMemoryContentAllowed(value: string): boolean {
  return findMemoryRedlineViolations(value).length === 0;
}

export function buildSanitizedMemorySummary(
  rawValue: string,
  maxLength = 160
): Readonly<{
  summary: string;
  redactionApplied: boolean;
}> | null {
  if (!isMemoryContentAllowed(rawValue)) {
    return null;
  }

  const collapsed = rawValue.replace(/\s+/g, ' ').trim();
  if (collapsed.length === 0) {
    return null;
  }

  if (collapsed.length <= maxLength) {
    return {
      summary: collapsed,
      redactionApplied: false
    };
  }

  return {
    summary: `${collapsed.slice(0, maxLength)}...`,
    redactionApplied: true
  };
}

function buildMemoryHotIndexRecord(
  record: MemoryRecord,
  stats: MemoryStatsRow,
  summary: string,
  now: Date
): MemoryHotIndexRecordV1 {
  const scoreComponents = {
    recency_score: recencyScore(stats.accepted_at, now),
    confidence_score: clamp01(stats.confidence),
    log_hit_score: logHitScore(stats.hit_count),
    source_quality_score: sourceQualityScore(record.sourceRef)
  };
  const score = roundScore(
    scoreComponents.recency_score * 0.35 +
      scoreComponents.confidence_score * 0.25 +
      scoreComponents.log_hit_score * 0.25 +
      scoreComponents.source_quality_score * 0.15
  );

  return {
    schema_version: 'phase-1c-w9-memory-hot-index@1',
    namespace: record.namespace,
    key: record.key,
    source_ref: record.sourceRef,
    summary,
    score,
    score_components: scoreComponents,
    hit_count: stats.hit_count,
    last_hit_at: stats.last_hit_at,
    last_injected_at: stats.last_injected_at,
    accepted_at: stats.accepted_at,
    confidence: stats.confidence
  };
}

function sortMemoryHotIndexRecords(
  left: MemoryHotIndexRecordV1,
  right: MemoryHotIndexRecordV1
): number {
  if (left.score !== right.score) return right.score - left.score;

  const leftAccepted = Date.parse(left.accepted_at);
  const rightAccepted = Date.parse(right.accepted_at);
  if (leftAccepted !== rightAccepted) return rightAccepted - leftAccepted;

  if (left.namespace !== right.namespace) return left.namespace.localeCompare(right.namespace);
  return left.key.localeCompare(right.key);
}

function summarizeMemoryValue(value: string, maxBytes: number): string | null {
  if (findMemoryRedlineViolations(value).length > 0) return null;

  const collapsed = value.replace(/\s+/g, ' ').trim();
  if (collapsed.length === 0) return null;

  return truncateUtf8(collapsed, maxBytes);
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value;

  const marker = '...';
  const markerBytes = Buffer.byteLength(marker, 'utf8');
  let end = value.length;
  while (end > 0 && Buffer.byteLength(value.slice(0, end), 'utf8') > maxBytes - markerBytes) {
    end -= 1;
  }

  return `${value.slice(0, end)}${marker}`;
}

function confidenceForRecord(record: MemoryRecord): number {
  return record.namespace === 'decisions' ? (record.confidence ?? 0.7) : 0.7;
}

function recencyScore(acceptedAt: string, now: Date): number {
  const acceptedMillis = Date.parse(acceptedAt);
  if (!Number.isFinite(acceptedMillis)) return 0;

  const ageDays = Math.max(0, (now.getTime() - acceptedMillis) / 86_400_000);
  return roundScore(1 / (1 + ageDays / 30));
}

function logHitScore(hitCount: number): number {
  return roundScore(Math.min(1, Math.log1p(Math.max(0, hitCount)) / Math.log1p(100)));
}

function sourceQualityScore(sourceRef: string): number {
  if (sourceRef.startsWith('gitlab:') || sourceRef.startsWith('local:')) return 1;
  if (sourceRef.startsWith('jira:') || sourceRef.startsWith('manual:')) return 0.8;
  return 0.6;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function roundScore(value: number): number {
  return Math.round(clamp01(value) * 10_000) / 10_000;
}

function buildMemoryEmbeddingRecord(input: {
  readonly input: MemoryFindSimilarInput;
  readonly embeddingBackend: MemoryEmbeddingBackend;
  readonly embeddingProvider: MemoryEmbeddingProvider;
  readonly createdAt: string;
}): MemoryEmbeddingRecordV1 {
  return {
    schema_version: 'phase-1c-w9-memory-embedding@1',
    namespace: input.input.namespace,
    key: input.input.key,
    source_ref: input.input.sourceRef,
    embedding_provider: input.embeddingProvider,
    embedding_backend: input.embeddingBackend,
    dimensions: buildDeterministicEmbedding(input.input).length,
    created_at: input.createdAt
  };
}

function buildDeterministicEmbedding(input: MemoryFindSimilarInput): readonly number[] {
  const tokens = tokenizeMemoryText(memorySimilarityText(input)).slice(0, 16);
  const vector = new Array<number>(16).fill(0);

  tokens.forEach((token, index) => {
    const vectorIndex = index % vector.length;
    vector[vectorIndex] = (vector[vectorIndex] ?? 0) + tokenHash(token);
  });

  return vector.map((value) => Number(value.toFixed(6)));
}

function scoreMemorySimilarity(candidate: MemoryFindSimilarInput, existing: MemoryRecord): number {
  const candidateKey = normalizeComparableText(candidate.key);
  const existingKey = normalizeComparableText(existing.key);
  const keyScore = candidateKey === existingKey ? 1 : lexicalSimilarity(candidate.key, existing.key);
  const valueScore = lexicalSimilarity(candidate.value, existing.value);
  const combined = Math.max(keyScore === 1 ? 0.96 : 0, keyScore * 0.25 + valueScore * 0.75);
  return Math.min(1, Math.round(combined * 10_000) / 10_000);
}

function memorySimilarityText(input: MemoryFindSimilarInput): string {
  return [
    input.key,
    input.value,
    input.sourceRef,
    input.producerAgent ?? '',
    input.triggerDescription ?? ''
  ].join('\n');
}

function lexicalSimilarity(left: string, right: string): number {
  const leftNormalized = normalizeComparableText(left);
  const rightNormalized = normalizeComparableText(right);
  if (leftNormalized.length === 0 || rightNormalized.length === 0) return 0;
  if (leftNormalized === rightNormalized) return 1;

  const leftTokens = new Set(tokenizeMemoryText(leftNormalized));
  const rightTokens = new Set(tokenizeMemoryText(rightNormalized));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;

  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return (2 * intersection) / (leftTokens.size + rightTokens.size);
}

function tokenizeMemoryText(value: string): readonly string[] {
  return normalizeComparableText(value)
    .split(/[^a-z0-9\u4e00-\u9fa5]+/iu)
    .filter((token) => token.length > 0);
}

function normalizeComparableText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function tokenHash(token: string): number {
  let hash = 0;
  for (let index = 0; index < token.length; index += 1) {
    hash = (hash * 31 + token.charCodeAt(index)) % 10_000;
  }
  return hash / 10_000;
}

function toMemoryMcpInput(input: MemoryPutInput): Record<string, unknown> {
  return {
    namespace: input.namespace,
    key: input.key,
    value: input.value,
    source_ref: input.sourceRef,
    ...(input.ts !== undefined ? { ts: input.ts } : {}),
    ...(input.confidence !== undefined ? { confidence: input.confidence } : {}),
    ...(input.producerAgent !== undefined ? { producer_agent: input.producerAgent } : {}),
    ...(input.ttlSeconds !== undefined ? { ttl_seconds: input.ttlSeconds } : {}),
    ...(input.expiresAt !== undefined ? { expires_at: input.expiresAt } : {}),
    ...(input.triggerDescription !== undefined
      ? { trigger_description: input.triggerDescription }
      : {}),
    ...(input.manualEntry !== undefined ? { manual_entry: input.manualEntry } : {})
  };
}

function parseMemoryMcpRecord(payload: unknown, toolName: string): MemoryRecord {
  const envelope = readObject(payload, `${toolName} payload`);
  const record = readObject(envelope.record, `${toolName} payload.record`);
  return readMemoryRecordFromSnakeCase(record);
}

function parseMemoryMcpNullableRecord(payload: unknown, toolName: string): MemoryRecord | null {
  const envelope = readObject(payload, `${toolName} payload`);
  if (envelope.record === null) return null;

  const record = readObject(envelope.record, `${toolName} payload.record`);
  return readMemoryRecordFromSnakeCase(record);
}

function parseMemoryMcpRecordList(payload: unknown, toolName: string): readonly MemoryRecord[] {
  const envelope = readObject(payload, `${toolName} payload`);
  if (!Array.isArray(envelope.records)) {
    throw new Error(`${toolName} payload.records must be an array`);
  }

  return envelope.records.map((item, index) => {
    const record = readObject(item, `${toolName} payload.records[${index}]`);
    return readMemoryRecordFromSnakeCase(record);
  });
}

function parseMemoryFindSimilarPayload(payload: unknown): MemoryFindSimilarResult {
  const envelope = readObject(payload, 'findSimilarMemoryRecords payload');
  const candidatesValue = envelope.candidates;
  if (!Array.isArray(candidatesValue)) {
    throw new Error('findSimilarMemoryRecords payload.candidates must be an array');
  }

  return {
    ok: true,
    embedding_backend: readEmbeddingBackend(envelope.embedding_backend),
    embedding_provider: readEmbeddingProvider(envelope.embedding_provider),
    threshold: readRequiredNumber(envelope, 'threshold'),
    warnings: readStringArray(envelope, 'warnings'),
    candidate_embedding: readMemoryEmbeddingRecord(
      readObject(envelope.candidate_embedding, 'findSimilarMemoryRecords candidate_embedding')
    ),
    candidates: candidatesValue.map((item, index) =>
      readMemoryConflictCandidate(
        readObject(item, `findSimilarMemoryRecords candidates[${index}]`)
      )
    )
  };
}

function parseMemoryHotIndexPayload(payload: unknown): MemoryHotIndexResult {
  const envelope = readObject(payload, 'hotIndex payload');
  const recordsValue = envelope.records;
  if (!Array.isArray(recordsValue)) {
    throw new Error('hotIndex payload.records must be an array');
  }

  return {
    ok: true,
    total: readRequiredNumber(envelope, 'total'),
    records: recordsValue.map((item, index) =>
      readMemoryHotIndexRecord(readObject(item, `hotIndex records[${index}]`))
    ),
    warnings: readStringArray(envelope, 'warnings')
  };
}

function readMemoryRecordFromSnakeCase(record: Record<string, unknown>): MemoryRecord {
  const namespace = readNamespace(record.namespace);
  const key = readRequiredString(record, 'key');
  const value = readRequiredString(record, 'value');
  const sourceRef = readRequiredString(record, 'source_ref');
  const ts = readRequiredString(record, 'ts');

  if (namespace === 'decisions') {
    const producerAgent = readRequiredString(record, 'producer_agent');
    const confidence = readRequiredNumber(record, 'confidence');
    return {
      namespace,
      key,
      value,
      sourceRef,
      ts,
      confidence,
      producerAgent,
      ...readOptionalNumber(record, 'ttl_seconds', 'ttlSeconds'),
      ...readOptionalString(record, 'expires_at', 'expiresAt')
    };
  }

  if (namespace === 'aliases') {
    return {
      namespace,
      key,
      value,
      sourceRef,
      ts,
      producerAgent: readRequiredString(record, 'producer_agent')
    };
  }

  return {
    namespace,
    key,
    value,
    sourceRef,
    ts,
    ...readOptionalString(record, 'trigger_description', 'triggerDescription')
  };
}

function readMemoryEmbeddingRecord(record: Record<string, unknown>): MemoryEmbeddingRecordV1 {
  const schemaVersion = readRequiredString(record, 'schema_version');
  if (schemaVersion !== 'phase-1c-w9-memory-embedding@1') {
    throw new Error(`Unsupported memory embedding schema_version: ${schemaVersion}`);
  }

  return {
    schema_version: schemaVersion,
    namespace: readNamespace(record.namespace),
    key: readRequiredString(record, 'key'),
    source_ref: readRequiredString(record, 'source_ref'),
    embedding_provider: readEmbeddingProvider(record.embedding_provider),
    embedding_backend: readEmbeddingBackend(record.embedding_backend),
    dimensions: readRequiredNumber(record, 'dimensions'),
    created_at: readRequiredString(record, 'created_at')
  };
}

function readMemoryConflictCandidate(
  record: Record<string, unknown>
): MemoryConflictCandidateV1 {
  const schemaVersion = readRequiredString(record, 'schema_version');
  if (schemaVersion !== 'phase-1c-w9-memory-conflict-candidate@1') {
    throw new Error(`Unsupported memory conflict schema_version: ${schemaVersion}`);
  }

  return {
    schema_version: schemaVersion,
    namespace: readNamespace(record.namespace),
    key: readRequiredString(record, 'key'),
    source_ref: readRequiredString(record, 'source_ref'),
    similarity: readRequiredNumber(record, 'similarity'),
    embedding_backend: readEmbeddingBackend(record.embedding_backend),
    existing_record: readMemoryRecordFromSnakeCase(
      readObject(record.existing_record, 'memory conflict existing_record')
    )
  };
}

function readMemoryHotIndexRecord(record: Record<string, unknown>): MemoryHotIndexRecordV1 {
  const schemaVersion = readRequiredString(record, 'schema_version');
  if (schemaVersion !== 'phase-1c-w9-memory-hot-index@1') {
    throw new Error(`Unsupported memory hot index schema_version: ${schemaVersion}`);
  }

  return {
    schema_version: schemaVersion,
    namespace: readNamespace(record.namespace),
    key: readRequiredString(record, 'key'),
    source_ref: readRequiredString(record, 'source_ref'),
    summary: readRequiredString(record, 'summary'),
    score: readRequiredNumber(record, 'score'),
    score_components: readHotIndexScoreComponents(
      readObject(record.score_components, 'hotIndex score_components')
    ),
    hit_count: readRequiredNumber(record, 'hit_count'),
    last_hit_at: readNullableString(record, 'last_hit_at'),
    last_injected_at: readNullableString(record, 'last_injected_at'),
    accepted_at: readRequiredString(record, 'accepted_at'),
    confidence: readRequiredNumber(record, 'confidence')
  };
}

function readHotIndexScoreComponents(
  record: Record<string, unknown>
): MemoryHotIndexScoreComponents {
  return {
    recency_score: readRequiredNumber(record, 'recency_score'),
    confidence_score: readRequiredNumber(record, 'confidence_score'),
    log_hit_score: readRequiredNumber(record, 'log_hit_score'),
    source_quality_score: readRequiredNumber(record, 'source_quality_score')
  };
}

function readDecisionRow(value: unknown): DecisionRow {
  const row = readObject(value, 'decision row');
  return {
    key: readRequiredString(row, 'key'),
    value: readRequiredString(row, 'value'),
    source_ref: readRequiredString(row, 'source_ref'),
    producer_agent: readRequiredString(row, 'producer_agent'),
    ts: readRequiredString(row, 'ts'),
    confidence: readRequiredNumber(row, 'confidence'),
    ttl_seconds: readNullableNumber(row, 'ttl_seconds'),
    expires_at: readNullableString(row, 'expires_at')
  };
}

function readKnowledgeIndexRow(value: unknown): KnowledgeIndexRow {
  const row = readObject(value, 'knowledge_index row');
  return {
    key: readRequiredString(row, 'key'),
    value: readRequiredString(row, 'value'),
    trigger_description: readRequiredString(row, 'trigger_description'),
    source_ref: readRequiredString(row, 'source_ref'),
    ts: readRequiredString(row, 'ts')
  };
}

function readAliasRow(value: unknown): AliasRow {
  const row = readObject(value, 'aliases row');
  return {
    key: readRequiredString(row, 'key'),
    value: readRequiredString(row, 'value'),
    source_ref: readRequiredString(row, 'source_ref'),
    producer_agent: readRequiredString(row, 'producer_agent'),
    ts: readRequiredString(row, 'ts')
  };
}

function readMemoryStatsRow(value: unknown): MemoryStatsRow {
  const row = readObject(value, 'memory_stats row');
  return {
    namespace: readNamespace(row.namespace),
    key: readRequiredString(row, 'key'),
    hit_count: readRequiredNumber(row, 'hit_count'),
    last_hit_at: readNullableString(row, 'last_hit_at'),
    last_injected_at: readNullableString(row, 'last_injected_at'),
    accepted_at: readRequiredString(row, 'accepted_at'),
    confidence: readRequiredNumber(row, 'confidence')
  };
}

function mapDecisionRow(row: DecisionRow): MemoryRecord {
  return {
    namespace: 'decisions',
    key: row.key,
    value: row.value,
    sourceRef: row.source_ref,
    producerAgent: row.producer_agent,
    ts: row.ts,
    confidence: row.confidence,
    ...(row.ttl_seconds !== null ? { ttlSeconds: row.ttl_seconds } : {}),
    ...(row.expires_at !== null ? { expiresAt: row.expires_at } : {})
  };
}

function mapKnowledgeIndexRow(row: KnowledgeIndexRow): MemoryRecord {
  return {
    namespace: 'knowledge_index',
    key: row.key,
    value: row.value,
    sourceRef: row.source_ref,
    triggerDescription: row.trigger_description,
    ts: row.ts
  };
}

function mapAliasRow(row: AliasRow): MemoryRecord {
  return {
    namespace: 'aliases',
    key: row.key,
    value: row.value,
    sourceRef: row.source_ref,
    producerAgent: row.producer_agent,
    ts: row.ts
  };
}

function resolveExpiresAt(
  ts: string,
  ttlSeconds: number | undefined,
  explicitExpiresAt: string | undefined
): string | undefined {
  if (explicitExpiresAt !== undefined) return explicitExpiresAt;
  if (ttlSeconds === undefined) return undefined;

  const tsMillis = Date.parse(ts);
  if (!Number.isFinite(tsMillis)) {
    throw new Error('ts must be a valid ISO timestamp when ttlSeconds is used');
  }

  return new Date(tsMillis + ttlSeconds * 1_000).toISOString();
}

function escapeSqlLike(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}

function sortMemoryRecords(records: readonly MemoryRecord[]): readonly MemoryRecord[] {
  return [...records].sort((left, right) => {
    const leftTs = Date.parse(left.ts);
    const rightTs = Date.parse(right.ts);
    const leftTsSafe = Number.isFinite(leftTs) ? leftTs : Number.MIN_SAFE_INTEGER;
    const rightTsSafe = Number.isFinite(rightTs) ? rightTs : Number.MIN_SAFE_INTEGER;

    if (leftTsSafe !== rightTsSafe) return rightTsSafe - leftTsSafe;

    if (left.sourceRef !== right.sourceRef) return left.sourceRef.localeCompare(right.sourceRef);
    if (left.namespace !== right.namespace) return left.namespace.localeCompare(right.namespace);
    return left.key.localeCompare(right.key);
  });
}

function requiredString(value: string | undefined, message: string): string {
  if (value === undefined) throw new Error(message);
  return value;
}

function requiredNumber(value: number | undefined, message: string): number {
  if (value === undefined) throw new Error(message);
  return value;
}

function readObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function readNamespace(value: unknown): MemoryNamespace {
  if (value === 'decisions' || value === 'knowledge_index' || value === 'aliases') {
    return value;
  }
  throw new Error(`Unsupported memory namespace: ${String(value)}`);
}

function readEmbeddingBackend(value: unknown): MemoryEmbeddingBackend {
  if (value === 'sqlite_vec' || value === 'fallback_lexical') {
    return value;
  }
  throw new Error(`Unsupported memory embedding backend: ${String(value)}`);
}

function readEmbeddingProvider(value: unknown): MemoryEmbeddingProvider {
  if (
    value === 'local_bge_small_zh' ||
    value === 'openai_text_embedding_3_small' ||
    value === 'deterministic_test'
  ) {
    return value;
  }
  throw new Error(`Unsupported memory embedding provider: ${String(value)}`);
}

function readRequiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string') {
    throw new Error(`${key} must be a string`);
  }
  return value;
}

function readRequiredNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${key} must be a number`);
  }
  return value;
}

function readNullableString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (value === null) return null;
  if (typeof value === 'string') return value;
  throw new Error(`${key} must be string or null`);
}

function readNullableNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  if (value === null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  throw new Error(`${key} must be number or null`);
}

function readOptionalString<TName extends string>(
  record: Record<string, unknown>,
  key: string,
  propertyName: TName
): Partial<Record<TName, string>> {
  const value = record[key];
  if (value === undefined || value === null) return {};
  if (typeof value !== 'string') throw new Error(`${key} must be a string when present`);

  return {
    [propertyName]: value
  } as Partial<Record<TName, string>>;
}

function readOptionalNumber<TName extends string>(
  record: Record<string, unknown>,
  key: string,
  propertyName: TName
): Partial<Record<TName, number>> {
  const value = record[key];
  if (value === undefined || value === null) return {};
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${key} must be a number when present`);
  }

  return {
    [propertyName]: value
  } as Partial<Record<TName, number>>;
}

function readStringArray(record: Record<string, unknown>, key: string): readonly string[] {
  const value = record[key];
  if (!Array.isArray(value)) {
    throw new Error(`${key} must be an array`);
  }

  return value.map((item, index) => {
    if (typeof item !== 'string') {
      throw new Error(`${key}[${index}] must be a string`);
    }
    return item;
  });
}
