import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";

import { MemoryOptimisticLockError, MemoryStorageError } from "./errors.js";
import { findRedlineMatches } from "./security.js";
import type {
  FindSimilarMemoryRecordsInput,
  FindSimilarMemoryRecordsResult,
  GetInput,
  HotIndexInput,
  HotIndexResult,
  MemoryEmbeddingBackend,
  MemoryEmbeddingProvider,
  MemoryNamespace,
  MemoryPortableRecordV1,
  MemoryPutWarning,
  MemoryHotIndexRecord,
  MemoryRecord,
  PutInput,
  PutResult,
} from "./types.js";

interface DecisionRow {
  readonly key: string;
  readonly value: string;
  readonly source_ref: string;
  readonly producer_agent: string;
  readonly ts: string;
  readonly confidence: number;
  readonly ttl_seconds: number | null;
  readonly expires_at: string | null;
  readonly version: number;
}

interface KnowledgeIndexRow {
  readonly key: string;
  readonly value: string;
  readonly trigger_description: string;
  readonly source_ref: string;
  readonly producer_agent: string;
  readonly confidence: number;
  readonly ts: string;
  readonly version: number;
}

interface AliasRow {
  readonly key: string;
  readonly value: string;
  readonly source_ref: string;
  readonly producer_agent: string;
  readonly ts: string;
  readonly version: number;
}

interface KeyVersionRow {
  readonly version: number;
}

interface DecisionKeyRow extends KeyVersionRow {
  readonly producer_agent: string;
}

interface AliasKeyRow extends KeyVersionRow {
  readonly producer_agent: string;
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

interface StoreSearchInput {
  readonly namespace: MemoryNamespace | undefined;
  readonly query: string;
  readonly limit: number;
  readonly include_expired: boolean;
}

interface StoreListInput {
  readonly namespace: MemoryNamespace | undefined;
  readonly limit: number;
  readonly offset: number;
  readonly include_expired: boolean;
}

export interface MemoryStoreConfig {
  readonly sqlitePath: string;
  readonly now?: () => Date;
  readonly embeddingProvider?: MemoryEmbeddingProvider | undefined;
}

export class SqliteMemoryStore {
  private readonly db: DatabaseSync;
  private readonly now: () => Date;
  private readonly embeddingProvider: MemoryEmbeddingProvider;

  constructor(config: MemoryStoreConfig) {
    const absolutePath = resolve(config.sqlitePath);
    mkdirSync(dirname(absolutePath), { recursive: true });

    this.db = new DatabaseSync(absolutePath);
    this.now = config.now ?? (() => new Date());
    this.embeddingProvider = config.embeddingProvider ?? "deterministic_test";
    this.initialize();
  }

  close(): void {
    this.db.close();
  }

  put(input: PutInput): MemoryRecord {
    return this.putDetailed(input).record;
  }

  putDetailed(input: PutInput): PutResult {
    const normalized = normalizePutInput(input, this.now);
    const updatedAt = this.now().toISOString();
    const warnings: MemoryPutWarning[] = [];

    if (normalized.namespace === "decisions") {
      const expiresAt = resolveExpiresAt(
        normalized.ts,
        normalized.ttl_seconds,
        normalized.expires_at,
      );
      const existing = this.readDecisionKeyRow(normalized.key);

      if (existing === null) {
        assertExpectedVersionForInsert(
          normalized.expected_version,
          normalized.namespace,
          normalized.key,
        );
        this.db
          .prepare(
            `
            INSERT INTO decisions (
              key, value, source_ref, producer_agent, ts, confidence, ttl_seconds, expires_at, updated_at, version
            ) VALUES (
              :key, :value, :source_ref, :producer_agent, :ts, :confidence, :ttl_seconds, :expires_at, :updated_at, 1
            )
            `,
          )
          .run({
            key: normalized.key,
            value: normalized.value,
            source_ref: normalized.source_ref,
            producer_agent: normalized.producer_agent,
            ts: normalized.ts,
            confidence: normalized.confidence,
            ttl_seconds: normalized.ttl_seconds ?? null,
            expires_at: expiresAt ?? null,
            updated_at: updatedAt,
          });
      } else {
        assertExpectedVersionForUpdate(
          normalized.expected_version,
          existing.version,
          normalized.namespace,
          normalized.key,
        );
        const resolvedProducerAgent = existing.producer_agent;
        if (resolvedProducerAgent !== normalized.producer_agent) {
          warnings.push({
            code: "producer_agent_immutable",
            namespace: normalized.namespace,
            key: normalized.key,
            message: "producer_agent is immutable after first write",
            existing_producer_agent: resolvedProducerAgent,
            incoming_producer_agent: normalized.producer_agent,
          });
        }

        const updateResult = this.db
          .prepare(
            `
            UPDATE decisions
            SET value = :value,
                source_ref = :source_ref,
                producer_agent = :producer_agent,
                ts = :ts,
                confidence = :confidence,
                ttl_seconds = :ttl_seconds,
                expires_at = :expires_at,
                updated_at = :updated_at,
                version = version + 1
            WHERE key = :key AND version = :expected_version
            `,
          )
          .run({
            key: normalized.key,
            value: normalized.value,
            source_ref: normalized.source_ref,
            producer_agent: resolvedProducerAgent,
            ts: normalized.ts,
            confidence: normalized.confidence,
            ttl_seconds: normalized.ttl_seconds ?? null,
            expires_at: expiresAt ?? null,
            updated_at: updatedAt,
            expected_version: existing.version,
          });

        if (updateResult.changes === 0) {
          throw new MemoryOptimisticLockError(
            "optimistic lock conflict during decisions update",
          );
        }
      }
    } else if (normalized.namespace === "knowledge_index") {
      const existing = this.readKnowledgeKeyVersionRow(normalized.key);
      if (existing === null) {
        assertExpectedVersionForInsert(
          normalized.expected_version,
          normalized.namespace,
          normalized.key,
        );
        this.db
          .prepare(
            `
            INSERT INTO knowledge_index (
              key, value, trigger_description, source_ref, producer_agent, confidence, ts, updated_at, version
            ) VALUES (
              :key, :value, :trigger_description, :source_ref, :producer_agent, :confidence, :ts, :updated_at, 1
            )
            `,
          )
          .run({
            key: normalized.key,
            value: normalized.value,
            trigger_description: normalized.trigger_description,
            source_ref: normalized.source_ref,
            producer_agent: normalized.producer_agent,
            confidence: normalized.confidence,
            ts: normalized.ts,
            updated_at: updatedAt,
          });
      } else {
        assertExpectedVersionForUpdate(
          normalized.expected_version,
          existing.version,
          normalized.namespace,
          normalized.key,
        );
        const updateResult = this.db
          .prepare(
            `
            UPDATE knowledge_index
            SET value = :value,
                trigger_description = :trigger_description,
                source_ref = :source_ref,
                producer_agent = :producer_agent,
                confidence = :confidence,
                ts = :ts,
                updated_at = :updated_at,
                version = version + 1
            WHERE key = :key AND version = :expected_version
            `,
          )
          .run({
            key: normalized.key,
            value: normalized.value,
            trigger_description: normalized.trigger_description,
            source_ref: normalized.source_ref,
            producer_agent: normalized.producer_agent,
            confidence: normalized.confidence,
            ts: normalized.ts,
            updated_at: updatedAt,
            expected_version: existing.version,
          });
        if (updateResult.changes === 0) {
          throw new MemoryOptimisticLockError(
            "optimistic lock conflict during knowledge_index update",
          );
        }
      }
    } else {
      const existing = this.readAliasKeyRow(normalized.key);
      if (existing === null) {
        assertExpectedVersionForInsert(
          normalized.expected_version,
          normalized.namespace,
          normalized.key,
        );
        this.db
          .prepare(
            `
            INSERT INTO aliases (
              key, value, source_ref, producer_agent, ts, updated_at, version
            ) VALUES (
              :key, :value, :source_ref, :producer_agent, :ts, :updated_at, 1
            )
            `,
          )
          .run({
            key: normalized.key,
            value: normalized.value,
            source_ref: normalized.source_ref,
            producer_agent: normalized.producer_agent,
            ts: normalized.ts,
            updated_at: updatedAt,
          });
      } else {
        assertExpectedVersionForUpdate(
          normalized.expected_version,
          existing.version,
          normalized.namespace,
          normalized.key,
        );
        const resolvedProducerAgent = existing.producer_agent;
        if (resolvedProducerAgent !== normalized.producer_agent) {
          warnings.push({
            code: "producer_agent_immutable",
            namespace: normalized.namespace,
            key: normalized.key,
            message: "producer_agent is immutable after first write",
            existing_producer_agent: resolvedProducerAgent,
            incoming_producer_agent: normalized.producer_agent,
          });
        }
        const updateResult = this.db
          .prepare(
            `
            UPDATE aliases
            SET value = :value,
                source_ref = :source_ref,
                producer_agent = :producer_agent,
                ts = :ts,
                updated_at = :updated_at,
                version = version + 1
            WHERE key = :key AND version = :expected_version
            `,
          )
          .run({
            key: normalized.key,
            value: normalized.value,
            source_ref: normalized.source_ref,
            producer_agent: resolvedProducerAgent,
            ts: normalized.ts,
            updated_at: updatedAt,
            expected_version: existing.version,
          });
        if (updateResult.changes === 0) {
          throw new MemoryOptimisticLockError(
            "optimistic lock conflict during aliases update",
          );
        }
      }
    }

    const stored = this.readRecord({
      namespace: normalized.namespace,
      key: normalized.key,
    });

    if (stored === null) {
      throw new MemoryStorageError("memory record was not found after put");
    }

    this.upsertMemoryStats(stored);
    const version = this.readRecordVersion(
      normalized.namespace,
      normalized.key,
    );
    return {
      record: stored,
      portable_record: toPortableRecord(stored),
      version,
      warnings,
    };
  }

  getDatabaseTuningState(): {
    readonly journalMode: string;
    readonly busyTimeoutMs: number;
  } {
    const journalMode = this.readPragmaText("journal_mode");
    const busyTimeoutMs = this.readPragmaNumber("busy_timeout");
    return {
      journalMode,
      busyTimeoutMs,
    };
  }

  get(input: GetInput): MemoryRecord | null {
    const record = this.readRecord(input);
    if (record !== null) {
      this.recordMemoryHit(record.namespace, record.key);
    }
    return record;
  }

  private readRecord(input: GetInput): MemoryRecord | null {
    if (input.namespace === "decisions") {
      const row = this.db
        .prepare(
          `
          SELECT key, value, source_ref, producer_agent, ts, confidence, ttl_seconds, expires_at, version
          FROM decisions
          WHERE key = :key
          `,
        )
        .get({ key: input.key });

      if (row === undefined) {
        return null;
      }

      const record = mapDecisionRow(assertDecisionRow(row));
      return record;
    }

    if (input.namespace === "knowledge_index") {
      const row = this.db
        .prepare(
          `
          SELECT key, value, trigger_description, source_ref, producer_agent, confidence, ts, version
          FROM knowledge_index
          WHERE key = :key
          `,
        )
        .get({ key: input.key });

      if (row === undefined) {
        return null;
      }

      const record = mapKnowledgeIndexRow(assertKnowledgeIndexRow(row));
      return record;
    }

    const row = this.db
      .prepare(
        `
        SELECT key, value, source_ref, producer_agent, ts, version
        FROM aliases
        WHERE key = :key
        `,
      )
      .get({ key: input.key });

    if (row === undefined) {
      return null;
    }

    const record = mapAliasRow(assertAliasRow(row));
    return record;
  }

  search(input: StoreSearchInput): readonly MemoryRecord[] {
    const pattern = `%${escapeSqlLike(input.query)}%`;
    let records: readonly MemoryRecord[];

    if (input.namespace === "decisions") {
      records = this.searchDecisions(
        pattern,
        input.limit,
        input.include_expired,
      );
    } else if (input.namespace === "knowledge_index") {
      records = this.searchKnowledgeIndex(pattern, input.limit);
    } else if (input.namespace === "aliases") {
      records = this.searchAliases(pattern, input.limit);
    } else {
      const combined = [
        ...this.searchDecisions(pattern, input.limit, input.include_expired),
        ...this.searchKnowledgeIndex(pattern, input.limit),
        ...this.searchAliases(pattern, input.limit),
      ];

      records = sortByTsDesc(combined).slice(0, input.limit);
    }

    this.recordMemoryHits(records);
    return records;
  }

  list(input: StoreListInput): readonly MemoryRecord[] {
    if (input.namespace === "decisions") {
      return this.listDecisions(
        input.limit,
        input.offset,
        input.include_expired,
      );
    }

    if (input.namespace === "knowledge_index") {
      return this.listKnowledgeIndex(input.limit, input.offset);
    }

    if (input.namespace === "aliases") {
      return this.listAliases(input.limit, input.offset);
    }

    const fetchSize = input.limit + input.offset;
    const combined = [
      ...this.listDecisions(fetchSize, 0, input.include_expired),
      ...this.listKnowledgeIndex(fetchSize, 0),
      ...this.listAliases(fetchSize, 0),
    ];

    return sortByTsDesc(combined).slice(
      input.offset,
      input.offset + input.limit,
    );
  }

  findSimilarMemoryRecords(
    input: FindSimilarMemoryRecordsInput,
  ): FindSimilarMemoryRecordsResult {
    const threshold = input.threshold ?? 0.85;
    const limit = input.limit ?? 5;
    const embeddingProvider =
      input.embedding_provider ?? this.embeddingProvider;
    const backend = this.detectEmbeddingBackend();
    const warnings =
      backend === "fallback_lexical"
        ? ["sqlite_vec_unavailable", "embedding_backend=fallback_lexical"]
        : [];
    const candidateEmbedding = buildEmbeddingRecord({
      input,
      embeddingBackend: backend,
      embeddingProvider,
      createdAt: this.now().toISOString(),
    });
    const records = this.list({
      namespace: input.namespace,
      limit: 1_000,
      offset: 0,
      include_expired: input.include_expired ?? false,
    });
    const candidates = records
      .map((record) => ({
        schema_version: "phase-1c-w9-memory-conflict-candidate@1" as const,
        namespace: record.namespace,
        key: record.key,
        source_ref: record.source_ref,
        similarity: scoreMemorySimilarity(input, record),
        embedding_backend: backend,
        existing_record: record,
      }))
      .filter((candidate) => candidate.similarity >= threshold)
      .sort((left, right) => {
        if (left.similarity !== right.similarity) {
          return right.similarity - left.similarity;
        }

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
      candidates,
    };
  }

  hotIndex(input: HotIndexInput): HotIndexResult {
    const limit = input.limit ?? 200;
    const maxSummaryBytes = input.max_summary_bytes ?? 240;
    const records = this.list({
      namespace: input.namespace,
      limit: 1_000,
      offset: 0,
      include_expired: input.include_expired ?? false,
    });
    const warnings: string[] = [];
    const hotRecords: MemoryHotIndexRecord[] = [];

    for (const record of records) {
      const summary = summarizeMemoryValue(record.value, maxSummaryBytes);
      if (summary === null) {
        warnings.push(
          `excluded_redline_or_empty:${record.namespace}:${record.key}`,
        );
        continue;
      }

      const stats =
        this.getMemoryStats(record) ?? this.upsertMemoryStats(record);
      hotRecords.push(buildHotIndexRecord(record, stats, summary, this.now()));
    }

    const selected = hotRecords.sort(sortHotIndexRecords).slice(0, limit);
    const injectedAt = this.now().toISOString();
    for (const record of selected) {
      this.recordMemoryInjected(record.namespace, record.key, injectedAt);
    }

    return {
      ok: true,
      total: selected.length,
      records: selected,
      warnings,
    };
  }

  private searchDecisions(
    pattern: string,
    limit: number,
    includeExpired: boolean,
  ): readonly MemoryRecord[] {
    const rows = this.db
      .prepare(
        `
        SELECT key, value, source_ref, producer_agent, ts, confidence, ttl_seconds, expires_at, version
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
        `,
      )
      .all({
        pattern,
        include_expired: includeExpired ? 1 : 0,
        now_iso: this.now().toISOString(),
        limit,
      });

    return rows.map((row) => mapDecisionRow(assertDecisionRow(row)));
  }

  private searchKnowledgeIndex(
    pattern: string,
    limit: number,
  ): readonly MemoryRecord[] {
    const rows = this.db
      .prepare(
        `
        SELECT key, value, trigger_description, source_ref, producer_agent, confidence, ts, version
        FROM knowledge_index
        WHERE (
          key LIKE :pattern ESCAPE '\\'
          OR value LIKE :pattern ESCAPE '\\'
          OR trigger_description LIKE :pattern ESCAPE '\\'
          OR source_ref LIKE :pattern ESCAPE '\\'
        )
        ORDER BY ts DESC, key ASC
        LIMIT :limit
        `,
      )
      .all({
        pattern,
        limit,
      });

    return rows.map((row) =>
      mapKnowledgeIndexRow(assertKnowledgeIndexRow(row)),
    );
  }

  private searchAliases(
    pattern: string,
    limit: number,
  ): readonly MemoryRecord[] {
    const rows = this.db
      .prepare(
        `
        SELECT key, value, source_ref, producer_agent, ts, version
        FROM aliases
        WHERE (
          key LIKE :pattern ESCAPE '\\'
          OR value LIKE :pattern ESCAPE '\\'
          OR source_ref LIKE :pattern ESCAPE '\\'
          OR producer_agent LIKE :pattern ESCAPE '\\'
        )
        ORDER BY ts DESC, key ASC
        LIMIT :limit
        `,
      )
      .all({
        pattern,
        limit,
      });

    return rows.map((row) => mapAliasRow(assertAliasRow(row)));
  }

  private listDecisions(
    limit: number,
    offset: number,
    includeExpired: boolean,
  ): readonly MemoryRecord[] {
    const rows = this.db
      .prepare(
        `
        SELECT key, value, source_ref, producer_agent, ts, confidence, ttl_seconds, expires_at, version
        FROM decisions
        WHERE (
          :include_expired = 1 OR expires_at IS NULL OR expires_at > :now_iso
        )
        ORDER BY ts DESC, key ASC
        LIMIT :limit OFFSET :offset
        `,
      )
      .all({
        include_expired: includeExpired ? 1 : 0,
        now_iso: this.now().toISOString(),
        limit,
        offset,
      });

    return rows.map((row) => mapDecisionRow(assertDecisionRow(row)));
  }

  private listKnowledgeIndex(
    limit: number,
    offset: number,
  ): readonly MemoryRecord[] {
    const rows = this.db
      .prepare(
        `
        SELECT key, value, trigger_description, source_ref, producer_agent, confidence, ts, version
        FROM knowledge_index
        ORDER BY ts DESC, key ASC
        LIMIT :limit OFFSET :offset
        `,
      )
      .all({
        limit,
        offset,
      });

    return rows.map((row) =>
      mapKnowledgeIndexRow(assertKnowledgeIndexRow(row)),
    );
  }

  private listAliases(limit: number, offset: number): readonly MemoryRecord[] {
    const rows = this.db
      .prepare(
        `
        SELECT key, value, source_ref, producer_agent, ts, version
        FROM aliases
        ORDER BY ts DESC, key ASC
        LIMIT :limit OFFSET :offset
        `,
      )
      .all({
        limit,
        offset,
      });

    return rows.map((row) => mapAliasRow(assertAliasRow(row)));
  }

  private readDecisionKeyRow(key: string): DecisionKeyRow | null {
    const row = this.db
      .prepare(
        `
        SELECT producer_agent, version
        FROM decisions
        WHERE key = :key
        `,
      )
      .get({ key });
    if (row === undefined) {
      return null;
    }
    return assertDecisionKeyRow(row);
  }

  private readKnowledgeKeyVersionRow(key: string): KeyVersionRow | null {
    const row = this.db
      .prepare(
        `
        SELECT version
        FROM knowledge_index
        WHERE key = :key
        `,
      )
      .get({ key });
    if (row === undefined) {
      return null;
    }
    return assertKeyVersionRow(row);
  }

  private readAliasKeyRow(key: string): AliasKeyRow | null {
    const row = this.db
      .prepare(
        `
        SELECT producer_agent, version
        FROM aliases
        WHERE key = :key
        `,
      )
      .get({ key });
    if (row === undefined) {
      return null;
    }
    return assertAliasKeyRow(row);
  }

  private readRecordVersion(namespace: MemoryNamespace, key: string): number {
    if (namespace === "decisions") {
      const row = this.readDecisionKeyRow(key);
      if (row === null) {
        throw new MemoryStorageError("decision record version was not found");
      }
      return row.version;
    }
    if (namespace === "knowledge_index") {
      const row = this.readKnowledgeKeyVersionRow(key);
      if (row === null) {
        throw new MemoryStorageError(
          "knowledge_index record version was not found",
        );
      }
      return row.version;
    }
    const row = this.readAliasKeyRow(key);
    if (row === null) {
      throw new MemoryStorageError("alias record version was not found");
    }
    return row.version;
  }

  private readPragmaText(name: string): string {
    const row = this.db.prepare(`PRAGMA ${name}`).get();
    if (
      row === undefined ||
      typeof row !== "object" ||
      row === null ||
      Array.isArray(row)
    ) {
      throw new MemoryStorageError(`PRAGMA ${name} did not return a row`);
    }
    const entries = Object.values(row);
    const value = entries[0];
    if (typeof value !== "string") {
      throw new MemoryStorageError(`PRAGMA ${name} did not return string`);
    }
    return value;
  }

  private readPragmaNumber(name: string): number {
    const row = this.db.prepare(`PRAGMA ${name}`).get();
    if (
      row === undefined ||
      typeof row !== "object" ||
      row === null ||
      Array.isArray(row)
    ) {
      throw new MemoryStorageError(`PRAGMA ${name} did not return a row`);
    }
    const entries = Object.values(row);
    const value = entries[0];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new MemoryStorageError(`PRAGMA ${name} did not return number`);
    }
    return value;
  }

  private initialize(): void {
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA busy_timeout = 5000;");
    this.db.exec("PRAGMA synchronous = NORMAL;");
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
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS knowledge_index (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        trigger_description TEXT NOT NULL,
        source_ref TEXT NOT NULL,
        producer_agent TEXT NOT NULL DEFAULT 'unknown',
        confidence REAL NOT NULL DEFAULT 0.7,
        ts TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS aliases (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        source_ref TEXT NOT NULL,
        producer_agent TEXT NOT NULL,
        ts TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1
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

    this.ensureColumnExists(
      "decisions",
      "version",
      "INTEGER NOT NULL DEFAULT 1",
    );
    this.ensureColumnExists(
      "knowledge_index",
      "version",
      "INTEGER NOT NULL DEFAULT 1",
    );
    this.ensureColumnExists(
      "knowledge_index",
      "producer_agent",
      "TEXT NOT NULL DEFAULT 'unknown'",
    );
    this.ensureColumnExists(
      "knowledge_index",
      "confidence",
      "REAL NOT NULL DEFAULT 0.7",
    );
    this.ensureColumnExists("aliases", "version", "INTEGER NOT NULL DEFAULT 1");
  }

  private ensureColumnExists(
    table: "decisions" | "knowledge_index" | "aliases",
    column: string,
    type: string,
  ): void {
    const rows = this.db.prepare(`PRAGMA table_info(${table})`).all();
    const exists = rows.some((row) => {
      if (typeof row !== "object" || row === null || Array.isArray(row)) {
        return false;
      }
      return (row as Record<string, unknown>).name === column;
    });
    if (!exists) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    }
  }

  private upsertMemoryStats(record: MemoryRecord): MemoryStatsRow {
    const acceptedAt = record.ts;
    const confidence = confidenceForRecord(record);
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
        `,
      )
      .run({
        namespace: record.namespace,
        key: record.key,
        accepted_at: acceptedAt,
        confidence,
      });

    const stats = this.getMemoryStats(record);
    if (stats === null) {
      throw new MemoryStorageError("memory stats were not found after upsert");
    }
    return stats;
  }

  private getMemoryStats(
    record: Pick<MemoryRecord, "namespace" | "key" | "ts">,
  ): MemoryStatsRow | null {
    const row = this.db
      .prepare(
        `
        SELECT namespace, key, hit_count, last_hit_at, last_injected_at, accepted_at, confidence
        FROM memory_stats
        WHERE namespace = :namespace AND key = :key
        `,
      )
      .get({ namespace: record.namespace, key: record.key });

    if (row === undefined) {
      return null;
    }

    return assertMemoryStatsRow(row);
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
    hitAt = this.now().toISOString(),
  ): void {
    this.db
      .prepare(
        `
        UPDATE memory_stats
        SET hit_count = hit_count + 1,
            last_hit_at = :last_hit_at
        WHERE namespace = :namespace AND key = :key
        `,
      )
      .run({ namespace, key, last_hit_at: hitAt });
  }

  private recordMemoryInjected(
    namespace: MemoryNamespace,
    key: string,
    injectedAt: string,
  ): void {
    this.db
      .prepare(
        `
        UPDATE memory_stats
        SET last_injected_at = :last_injected_at
        WHERE namespace = :namespace AND key = :key
        `,
      )
      .run({ namespace, key, last_injected_at: injectedAt });
  }

  private detectEmbeddingBackend(): MemoryEmbeddingBackend {
    try {
      this.db.prepare("SELECT vec_version() AS version").get();
      return "sqlite_vec";
    } catch {
      return "fallback_lexical";
    }
  }
}

function buildEmbeddingRecord(input: {
  readonly input: FindSimilarMemoryRecordsInput;
  readonly embeddingBackend: MemoryEmbeddingBackend;
  readonly embeddingProvider: MemoryEmbeddingProvider;
  readonly createdAt: string;
}): FindSimilarMemoryRecordsResult["candidate_embedding"] {
  return {
    schema_version: "phase-1c-w9-memory-embedding@1",
    namespace: input.input.namespace,
    key: input.input.key,
    source_ref: input.input.source_ref,
    embedding_provider: input.embeddingProvider,
    embedding_backend: input.embeddingBackend,
    dimensions: buildDeterministicEmbedding(input.input).length,
    created_at: input.createdAt,
  };
}

type NormalizedPutInput =
  | {
      readonly namespace: "decisions";
      readonly key: string;
      readonly value: string;
      readonly source_ref: string;
      readonly ts: string;
      readonly producer_agent: string;
      readonly confidence: number;
      readonly ttl_seconds?: number | undefined;
      readonly expires_at?: string | undefined;
      readonly expected_version?: number | undefined;
    }
  | {
      readonly namespace: "knowledge_index";
      readonly key: string;
      readonly value: string;
      readonly source_ref: string;
      readonly producer_agent: string;
      readonly confidence: number;
      readonly ts: string;
      readonly trigger_description: string;
      readonly expected_version?: number | undefined;
    }
  | {
      readonly namespace: "aliases";
      readonly key: string;
      readonly value: string;
      readonly source_ref: string;
      readonly ts: string;
      readonly producer_agent: string;
      readonly expected_version?: number | undefined;
    };

function normalizePutInput(
  input: PutInput,
  now: () => Date,
): NormalizedPutInput {
  const portable = input.portable_record;
  const namespace =
    input.namespace ?? namespaceFromPortableKind(portable?.kind);
  if (namespace === undefined) {
    throw new MemoryStorageError("namespace is required for put");
  }

  const key = input.key ?? portable?.key;
  if (key === undefined) {
    throw new MemoryStorageError("key is required for put");
  }

  const value = input.value ?? portable?.value;
  if (value === undefined) {
    throw new MemoryStorageError("value is required for put");
  }

  const sourceRef = input.source_ref ?? portable?.source_ref;
  if (sourceRef === undefined) {
    throw new MemoryStorageError("source_ref is required for put");
  }

  const ts = input.ts ?? portable?.ts ?? now().toISOString();

  if (namespace === "decisions") {
    const producerAgent = input.producer_agent ?? portable?.producer_agent;
    const confidence = input.confidence ?? portable?.confidence;
    return {
      namespace,
      key,
      value,
      source_ref: sourceRef,
      ts,
      producer_agent: requiredString(
        producerAgent,
        "producer_agent is required for decisions namespace",
      ),
      confidence: requiredNumber(
        confidence,
        "confidence is required for decisions namespace",
      ),
      ttl_seconds: input.ttl_seconds,
      expires_at: input.expires_at,
      expected_version: input.expected_version,
    };
  }

  if (namespace === "knowledge_index") {
    const triggerDescription =
      input.trigger_description ??
      (portable?.kind === "knowledge" ? `portable:${key}` : undefined);
    const producerAgent =
      input.producer_agent ??
      (portable?.kind === "knowledge" ? portable.producer_agent : undefined);
    const confidence =
      input.confidence ??
      (portable?.kind === "knowledge" ? portable.confidence : undefined);
    return {
      namespace,
      key,
      value,
      source_ref: sourceRef,
      producer_agent: producerAgent ?? "unknown",
      confidence: confidence ?? 0.7,
      ts,
      trigger_description: requiredString(
        triggerDescription,
        "trigger_description is required for knowledge_index namespace",
      ),
      expected_version: input.expected_version,
    };
  }

  const producerAgent = input.producer_agent ?? portable?.producer_agent;
  return {
    namespace,
    key,
    value,
    source_ref: sourceRef,
    ts,
    producer_agent: requiredString(
      producerAgent,
      "producer_agent is required for aliases namespace",
    ),
    expected_version: input.expected_version,
  };
}

function namespaceFromPortableKind(
  kind: MemoryPortableRecordV1["kind"] | undefined,
): MemoryNamespace | undefined {
  if (kind === "decision") {
    return "decisions";
  }
  if (kind === "knowledge") {
    return "knowledge_index";
  }
  if (kind === "alias") {
    return "aliases";
  }
  return undefined;
}

function portableKindFromNamespace(
  namespace: MemoryNamespace,
): MemoryPortableRecordV1["kind"] {
  if (namespace === "decisions") {
    return "decision";
  }
  if (namespace === "knowledge_index") {
    return "knowledge";
  }
  return "alias";
}

function toPortableRecord(record: MemoryRecord): MemoryPortableRecordV1 {
  return {
    kind: portableKindFromNamespace(record.namespace),
    key: record.key,
    value: record.value,
    source_ref: record.source_ref,
    producer_agent: record.producer_agent,
    ts: record.ts,
    confidence: record.namespace === "aliases" ? 0.7 : record.confidence,
  };
}

function assertExpectedVersionForInsert(
  expectedVersion: number | undefined,
  namespace: MemoryNamespace,
  key: string,
): void {
  if (expectedVersion === undefined || expectedVersion === 0) {
    return;
  }
  throw new MemoryOptimisticLockError(
    `optimistic lock conflict for ${namespace}:${key}, expected_version=${expectedVersion}, current_version=0`,
    {
      fields: ["expected_version", "current_version", "namespace", "key"],
    },
  );
}

function assertExpectedVersionForUpdate(
  expectedVersion: number | undefined,
  currentVersion: number,
  namespace: MemoryNamespace,
  key: string,
): void {
  if (expectedVersion === undefined || expectedVersion === currentVersion) {
    return;
  }
  throw new MemoryOptimisticLockError(
    `optimistic lock conflict for ${namespace}:${key}, expected_version=${expectedVersion}, current_version=${currentVersion}`,
    {
      fields: ["expected_version", "current_version", "namespace", "key"],
    },
  );
}

function buildDeterministicEmbedding(
  input: FindSimilarMemoryRecordsInput,
): readonly number[] {
  const tokens = tokenizeMemoryText(memorySimilarityText(input)).slice(0, 16);
  const vector = new Array<number>(16).fill(0);

  tokens.forEach((token, index) => {
    const vectorIndex = index % vector.length;
    vector[vectorIndex] = (vector[vectorIndex] ?? 0) + tokenHash(token);
  });

  return vector.map((value) => Number(value.toFixed(6)));
}

function scoreMemorySimilarity(
  candidate: FindSimilarMemoryRecordsInput,
  existing: MemoryRecord,
): number {
  const candidateKey = normalizeComparableText(candidate.key);
  const existingKey = normalizeComparableText(existing.key);
  const keyScore =
    candidateKey === existingKey
      ? 1
      : lexicalSimilarity(candidate.key, existing.key);
  const valueScore = lexicalSimilarity(candidate.value, existing.value);
  const combined = Math.max(
    keyScore === 1 ? 0.96 : 0,
    keyScore * 0.25 + valueScore * 0.75,
  );
  return Math.min(1, Math.round(combined * 10_000) / 10_000);
}

function memorySimilarityText(input: FindSimilarMemoryRecordsInput): string {
  return [
    input.key,
    input.value,
    input.source_ref,
    input.producer_agent ?? "",
    input.trigger_description ?? "",
  ].join("\n");
}

function lexicalSimilarity(left: string, right: string): number {
  const leftNormalized = normalizeComparableText(left);
  const rightNormalized = normalizeComparableText(right);
  if (leftNormalized.length === 0 || rightNormalized.length === 0) {
    return 0;
  }

  if (leftNormalized === rightNormalized) {
    return 1;
  }

  const leftTokens = new Set(tokenizeMemoryText(leftNormalized));
  const rightTokens = new Set(tokenizeMemoryText(rightNormalized));
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }

  const intersection = [...leftTokens].filter((token) =>
    rightTokens.has(token),
  ).length;
  return (2 * intersection) / (leftTokens.size + rightTokens.size);
}

function tokenizeMemoryText(value: string): readonly string[] {
  return normalizeComparableText(value)
    .split(/[^a-z0-9\u4e00-\u9fa5]+/iu)
    .filter((token) => token.length > 0);
}

function normalizeComparableText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function tokenHash(token: string): number {
  let hash = 0;
  for (let index = 0; index < token.length; index += 1) {
    hash = (hash * 31 + token.charCodeAt(index)) % 10_000;
  }
  return hash / 10_000;
}

function resolveExpiresAt(
  ts: string,
  ttlSeconds: number | undefined,
  explicitExpiresAt: string | undefined,
): string | undefined {
  if (explicitExpiresAt !== undefined) {
    return explicitExpiresAt;
  }

  if (ttlSeconds === undefined) {
    return undefined;
  }

  const tsMillis = Date.parse(ts);
  return new Date(tsMillis + ttlSeconds * 1_000).toISOString();
}

function mapDecisionRow(row: DecisionRow): MemoryRecord {
  return {
    namespace: "decisions",
    key: row.key,
    value: row.value,
    source_ref: row.source_ref,
    producer_agent: row.producer_agent,
    ts: row.ts,
    confidence: row.confidence,
    version: row.version,
    ...(row.ttl_seconds !== null ? { ttl_seconds: row.ttl_seconds } : {}),
    ...(row.expires_at !== null ? { expires_at: row.expires_at } : {}),
  };
}

function mapKnowledgeIndexRow(row: KnowledgeIndexRow): MemoryRecord {
  return {
    namespace: "knowledge_index",
    key: row.key,
    value: row.value,
    trigger_description: row.trigger_description,
    source_ref: row.source_ref,
    producer_agent: row.producer_agent,
    confidence: row.confidence,
    ts: row.ts,
    version: row.version,
  };
}

function mapAliasRow(row: AliasRow): MemoryRecord {
  return {
    namespace: "aliases",
    key: row.key,
    value: row.value,
    source_ref: row.source_ref,
    producer_agent: row.producer_agent,
    ts: row.ts,
    version: row.version,
  };
}

function buildHotIndexRecord(
  record: MemoryRecord,
  stats: MemoryStatsRow,
  summary: string,
  now: Date,
): MemoryHotIndexRecord {
  const scoreComponents = {
    recency_score: recencyScore(stats.accepted_at, now),
    confidence_score: clamp01(stats.confidence),
    log_hit_score: logHitScore(stats.hit_count),
    source_quality_score: sourceQualityScore(record.source_ref),
  };
  const score = roundScore(
    scoreComponents.recency_score * 0.35 +
      scoreComponents.confidence_score * 0.25 +
      scoreComponents.log_hit_score * 0.25 +
      scoreComponents.source_quality_score * 0.15,
  );

  return {
    schema_version: "phase-1c-w9-memory-hot-index@1",
    namespace: record.namespace,
    key: record.key,
    source_ref: record.source_ref,
    summary,
    score,
    score_components: scoreComponents,
    hit_count: stats.hit_count,
    last_hit_at: stats.last_hit_at,
    last_injected_at: stats.last_injected_at,
    accepted_at: stats.accepted_at,
    confidence: stats.confidence,
  };
}

function sortHotIndexRecords(
  left: MemoryHotIndexRecord,
  right: MemoryHotIndexRecord,
): number {
  if (left.score !== right.score) {
    return right.score - left.score;
  }

  const leftAccepted = Date.parse(left.accepted_at);
  const rightAccepted = Date.parse(right.accepted_at);
  if (leftAccepted !== rightAccepted) {
    return rightAccepted - leftAccepted;
  }

  if (left.namespace !== right.namespace) {
    return left.namespace.localeCompare(right.namespace);
  }

  return left.key.localeCompare(right.key);
}

function summarizeMemoryValue(value: string, maxBytes: number): string | null {
  if (findRedlineMatches({ value }).length > 0) {
    return null;
  }

  const collapsed = value.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) {
    return null;
  }

  return truncateUtf8(collapsed, maxBytes);
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) {
    return value;
  }

  const marker = "...";
  const markerBytes = Buffer.byteLength(marker, "utf8");
  let end = value.length;
  while (
    end > 0 &&
    Buffer.byteLength(value.slice(0, end), "utf8") > maxBytes - markerBytes
  ) {
    end -= 1;
  }

  return `${value.slice(0, end)}${marker}`;
}

function confidenceForRecord(record: MemoryRecord): number {
  if (record.namespace === "decisions") {
    return record.confidence;
  }
  if (record.namespace === "knowledge_index") {
    return record.confidence;
  }
  return 0.7;
}

function recencyScore(acceptedAt: string, now: Date): number {
  const acceptedMillis = Date.parse(acceptedAt);
  if (!Number.isFinite(acceptedMillis)) {
    return 0;
  }

  const ageDays = Math.max(0, (now.getTime() - acceptedMillis) / 86_400_000);
  return roundScore(1 / (1 + ageDays / 30));
}

function logHitScore(hitCount: number): number {
  return roundScore(
    Math.min(1, Math.log1p(Math.max(0, hitCount)) / Math.log1p(100)),
  );
}

function sourceQualityScore(sourceRef: string): number {
  if (sourceRef.startsWith("gitlab:") || sourceRef.startsWith("local:")) {
    return 1;
  }

  if (sourceRef.startsWith("jira:") || sourceRef.startsWith("manual:")) {
    return 0.8;
  }

  return 0.6;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function roundScore(value: number): number {
  return Math.round(clamp01(value) * 10_000) / 10_000;
}

function assertDecisionRow(value: unknown): DecisionRow {
  return decisionRowSchema.parse(value);
}

function assertDecisionKeyRow(value: unknown): DecisionKeyRow {
  return decisionKeyRowSchema.parse(value);
}

function assertKnowledgeIndexRow(value: unknown): KnowledgeIndexRow {
  return knowledgeIndexRowSchema.parse(value);
}

function assertKeyVersionRow(value: unknown): KeyVersionRow {
  return keyVersionRowSchema.parse(value);
}

function assertAliasRow(value: unknown): AliasRow {
  return aliasRowSchema.parse(value);
}

function assertAliasKeyRow(value: unknown): AliasKeyRow {
  return aliasKeyRowSchema.parse(value);
}

function assertMemoryStatsRow(value: unknown): MemoryStatsRow {
  return memoryStatsRowSchema.parse(value);
}

function escapeSqlLike(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_");
}

function sortByTsDesc(
  records: readonly MemoryRecord[],
): readonly MemoryRecord[] {
  return [...records].sort((left, right) => {
    const leftTs = Date.parse(left.ts);
    const rightTs = Date.parse(right.ts);

    if (leftTs !== rightTs) {
      return rightTs - leftTs;
    }

    if (left.namespace !== right.namespace) {
      return left.namespace.localeCompare(right.namespace);
    }

    return left.key.localeCompare(right.key);
  });
}

function requiredString(value: string | undefined, message: string): string {
  if (value === undefined) {
    throw new MemoryStorageError(message);
  }

  return value;
}

function requiredNumber(value: number | undefined, message: string): number {
  if (value === undefined) {
    throw new MemoryStorageError(message);
  }

  return value;
}

const decisionRowSchema = z.object({
  key: z.string(),
  value: z.string(),
  source_ref: z.string(),
  producer_agent: z.string(),
  ts: z.string(),
  confidence: z.number(),
  ttl_seconds: z.number().int().nullable(),
  expires_at: z.string().nullable(),
  version: z.number().int().min(1),
});

const knowledgeIndexRowSchema = z.object({
  key: z.string(),
  value: z.string(),
  trigger_description: z.string(),
  source_ref: z.string(),
  producer_agent: z.string(),
  confidence: z.number().min(0).max(1),
  ts: z.string(),
  version: z.number().int().min(1),
});

const keyVersionRowSchema = z.object({
  version: z.number().int().min(1),
});

const decisionKeyRowSchema = z.object({
  producer_agent: z.string(),
  version: z.number().int().min(1),
});

const aliasRowSchema = z.object({
  key: z.string(),
  value: z.string(),
  source_ref: z.string(),
  producer_agent: z.string(),
  ts: z.string(),
  version: z.number().int().min(1),
});

const aliasKeyRowSchema = z.object({
  producer_agent: z.string(),
  version: z.number().int().min(1),
});

const memoryStatsRowSchema = z.object({
  namespace: z.enum(["decisions", "knowledge_index", "aliases"]),
  key: z.string(),
  hit_count: z.number().int().min(0),
  last_hit_at: z.string().nullable(),
  last_injected_at: z.string().nullable(),
  accepted_at: z.string(),
  confidence: z.number().min(0).max(1),
});
