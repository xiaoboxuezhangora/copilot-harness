import { z } from "zod";

import {
  MEMORY_EMBEDDING_PROVIDERS,
  MEMORY_NAMESPACES,
  MEMORY_PORTABLE_KINDS,
} from "./types.js";

export const namespaceSchema = z.enum(MEMORY_NAMESPACES);
export const portableKindSchema = z.enum(MEMORY_PORTABLE_KINDS);
export const embeddingProviderSchema = z.enum(MEMORY_EMBEDDING_PROVIDERS);
export const embeddingBackendSchema = z.enum([
  "sqlite_vec",
  "fallback_lexical",
]);

export const isoTimestampSchema = z
  .string()
  .min(1)
  .refine(
    (value) => Number.isFinite(Date.parse(value)),
    "timestamp must be a valid ISO-8601 string",
  );

const keySchema = z.string().min(1).max(256);
const valueSchema = z.string().min(1).max(16_384);
const sourceRefSchema = z.string().min(1).max(2_048);
const producerAgentSchema = z.string().min(1).max(128);
const triggerDescriptionSchema = z.string().min(1).max(2_048);
const confidenceSchema = z.number().min(0).max(1);
const expectedVersionSchema = z.number().int().min(0);
const recordVersionSchema = z.number().int().min(1);

export const portableRecordSchema = z.object({
  kind: portableKindSchema,
  key: keySchema,
  value: valueSchema,
  source_ref: sourceRefSchema,
  producer_agent: producerAgentSchema,
  ts: isoTimestampSchema,
  confidence: confidenceSchema,
});

export const putInputSchema = {
  namespace: namespaceSchema.optional(),
  key: keySchema.optional(),
  value: valueSchema.optional(),
  source_ref: sourceRefSchema.optional(),
  ts: isoTimestampSchema.optional(),
  confidence: confidenceSchema.optional(),
  producer_agent: producerAgentSchema.optional(),
  ttl_seconds: z.number().int().min(1).max(31_536_000).optional(),
  expires_at: isoTimestampSchema.optional(),
  trigger_description: triggerDescriptionSchema.optional(),
  manual_entry: z.boolean().optional(),
  expected_version: expectedVersionSchema.optional(),
  portable_record: portableRecordSchema.optional(),
};

export const putInputValidator = z
  .object(putInputSchema)
  .superRefine((value, ctx) => {
    const namespaceFromPortable =
      value.portable_record?.kind === "decision"
        ? "decisions"
        : value.portable_record?.kind === "knowledge"
          ? "knowledge_index"
          : value.portable_record?.kind === "alias"
            ? "aliases"
            : undefined;
    const namespace = value.namespace ?? namespaceFromPortable;

    if (namespace === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["namespace"],
        message: "namespace is required when portable_record is absent",
      });
    }

    const key = value.key ?? value.portable_record?.key;
    if (key === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["key"],
        message: "key is required when portable_record is absent",
      });
    }

    const val = value.value ?? value.portable_record?.value;
    if (val === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["value"],
        message: "value is required when portable_record is absent",
      });
    }

    const sourceRef = value.source_ref ?? value.portable_record?.source_ref;
    if (sourceRef === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["source_ref"],
        message: "source_ref is required when portable_record is absent",
      });
    }

    if (value.portable_record !== undefined && value.namespace !== undefined) {
      if (namespaceFromPortable !== value.namespace) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["portable_record", "kind"],
          message: "portable_record.kind does not match namespace",
        });
      }
    }

    if (value.portable_record !== undefined && value.key !== undefined) {
      if (value.portable_record.key !== value.key) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["portable_record", "key"],
          message: "portable_record.key does not match key",
        });
      }
    }

    if (value.portable_record !== undefined && value.source_ref !== undefined) {
      if (value.portable_record.source_ref !== value.source_ref) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["portable_record", "source_ref"],
          message: "portable_record.source_ref does not match source_ref",
        });
      }
    }

    if (value.portable_record !== undefined && value.value !== undefined) {
      if (value.portable_record.value !== value.value) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["portable_record", "value"],
          message: "portable_record.value does not match value",
        });
      }
    }

    if (namespace === "decisions") {
      if (
        value.producer_agent === undefined &&
        value.portable_record?.producer_agent === undefined
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["producer_agent"],
          message: "producer_agent is required for decisions namespace",
        });
      }

      if (
        value.confidence === undefined &&
        value.portable_record?.confidence === undefined
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["confidence"],
          message: "confidence is required for decisions namespace",
        });
      }
    }

    if (namespace === "knowledge_index") {
      if (
        value.trigger_description === undefined &&
        value.portable_record?.kind !== "knowledge"
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["trigger_description"],
          message:
            "trigger_description is required for knowledge_index namespace",
        });
      }
    }

    if (namespace === "aliases") {
      if (
        value.producer_agent === undefined &&
        value.portable_record?.producer_agent === undefined
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["producer_agent"],
          message: "producer_agent is required for aliases namespace",
        });
      }

      if (value.manual_entry !== true) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["manual_entry"],
          message: "manual_entry=true is required for aliases namespace",
        });
      }
    }
  });

export const getInputSchema = {
  namespace: namespaceSchema,
  key: keySchema,
};

export const getInputValidator = z.object(getInputSchema);

export const searchInputSchema = {
  namespace: namespaceSchema.optional(),
  query: z.string().min(1).max(2_048),
  limit: z.number().int().min(1).max(200).optional(),
  include_expired: z.boolean().optional(),
};

export const searchInputValidator = z.object(searchInputSchema);

export const listInputSchema = {
  namespace: namespaceSchema.optional(),
  limit: z.number().int().min(1).max(200).optional(),
  offset: z.number().int().min(0).max(10_000).optional(),
  include_expired: z.boolean().optional(),
};

export const listInputValidator = z.object(listInputSchema);

export const hotIndexInputSchema = {
  namespace: namespaceSchema.optional(),
  limit: z.number().int().min(1).max(200).optional(),
  include_expired: z.boolean().optional(),
  max_summary_bytes: z.number().int().min(32).max(2_048).optional(),
};

export const hotIndexInputValidator = z.object(hotIndexInputSchema);

export const findSimilarMemoryRecordsInputSchema = {
  namespace: namespaceSchema,
  key: keySchema,
  value: valueSchema,
  source_ref: sourceRefSchema,
  producer_agent: producerAgentSchema.optional(),
  trigger_description: triggerDescriptionSchema.optional(),
  limit: z.number().int().min(1).max(50).optional(),
  threshold: z.number().min(0).max(1).optional(),
  include_expired: z.boolean().optional(),
  embedding_provider: embeddingProviderSchema.optional(),
};

export const findSimilarMemoryRecordsInputValidator = z.object(
  findSimilarMemoryRecordsInputSchema,
);

const decisionRecordSchema = z.object({
  namespace: z.literal("decisions"),
  key: keySchema,
  value: valueSchema,
  source_ref: sourceRefSchema,
  producer_agent: producerAgentSchema,
  ts: isoTimestampSchema,
  confidence: z.number().min(0).max(1),
  ttl_seconds: z.number().int().min(1).optional(),
  expires_at: isoTimestampSchema.optional(),
  version: recordVersionSchema,
});

const knowledgeIndexRecordSchema = z.object({
  namespace: z.literal("knowledge_index"),
  key: keySchema,
  value: valueSchema,
  trigger_description: triggerDescriptionSchema,
  source_ref: sourceRefSchema,
  producer_agent: producerAgentSchema,
  confidence: confidenceSchema,
  ts: isoTimestampSchema,
  version: recordVersionSchema,
});

const aliasRecordSchema = z.object({
  namespace: z.literal("aliases"),
  key: keySchema,
  value: valueSchema,
  source_ref: sourceRefSchema,
  producer_agent: producerAgentSchema,
  ts: isoTimestampSchema,
  version: recordVersionSchema,
});

export const memoryRecordSchema = z.union([
  decisionRecordSchema,
  knowledgeIndexRecordSchema,
  aliasRecordSchema,
]);

const memoryEmbeddingRecordSchema = z.object({
  schema_version: z.literal("phase-1c-w9-memory-embedding@1"),
  namespace: namespaceSchema,
  key: keySchema,
  source_ref: sourceRefSchema,
  embedding_provider: embeddingProviderSchema,
  embedding_backend: embeddingBackendSchema,
  dimensions: z.number().int().min(1),
  created_at: isoTimestampSchema,
});

const memoryConflictCandidateSchema = z.object({
  schema_version: z.literal("phase-1c-w9-memory-conflict-candidate@1"),
  namespace: namespaceSchema,
  key: keySchema,
  source_ref: sourceRefSchema,
  similarity: z.number().min(0).max(1),
  embedding_backend: embeddingBackendSchema,
  existing_record: memoryRecordSchema,
});

const hotIndexScoreComponentsSchema = z.object({
  recency_score: z.number().min(0).max(1),
  confidence_score: z.number().min(0).max(1),
  log_hit_score: z.number().min(0).max(1),
  source_quality_score: z.number().min(0).max(1),
});

const memoryHotIndexRecordSchema = z.object({
  schema_version: z.literal("phase-1c-w9-memory-hot-index@1"),
  namespace: namespaceSchema,
  key: keySchema,
  source_ref: sourceRefSchema,
  summary: z.string().min(1).max(2_048),
  score: z.number().min(0).max(1),
  score_components: hotIndexScoreComponentsSchema,
  hit_count: z.number().int().min(0),
  last_hit_at: isoTimestampSchema.nullable(),
  last_injected_at: isoTimestampSchema.nullable(),
  accepted_at: isoTimestampSchema,
  confidence: z.number().min(0).max(1),
});

export const putWarningSchema = z.object({
  code: z.enum(["producer_agent_immutable", "optimistic_lock_conflict"]),
  namespace: namespaceSchema,
  key: keySchema,
  message: z.string().min(1),
  expected_version: expectedVersionSchema.optional(),
  current_version: expectedVersionSchema.optional(),
  existing_producer_agent: producerAgentSchema.optional(),
  incoming_producer_agent: producerAgentSchema.optional(),
});

export const putOutputSchema = z.object({
  ok: z.literal(true),
  record: memoryRecordSchema,
  portable_record: portableRecordSchema,
  version: recordVersionSchema,
  warnings: z.array(putWarningSchema),
});

export const getOutputSchema = z.object({
  ok: z.literal(true),
  record: memoryRecordSchema.nullable(),
  portable_record: portableRecordSchema.nullable(),
});

export const searchOutputSchema = z.object({
  ok: z.literal(true),
  query: z.string(),
  total: z.number().int().min(0),
  records: z.array(memoryRecordSchema),
  portable_records: z.array(portableRecordSchema),
});

export const listOutputSchema = z.object({
  ok: z.literal(true),
  total: z.number().int().min(0),
  records: z.array(memoryRecordSchema),
  portable_records: z.array(portableRecordSchema),
});

export const hotIndexOutputSchema = z.object({
  ok: z.literal(true),
  total: z.number().int().min(0),
  records: z.array(memoryHotIndexRecordSchema),
  warnings: z.array(z.string()),
});

export const findSimilarMemoryRecordsOutputSchema = z.object({
  ok: z.literal(true),
  embedding_backend: embeddingBackendSchema,
  embedding_provider: embeddingProviderSchema,
  threshold: z.number().min(0).max(1),
  warnings: z.array(z.string()),
  candidate_embedding: memoryEmbeddingRecordSchema,
  candidates: z.array(memoryConflictCandidateSchema),
});

export const errorPayloadSchema = z.object({
  error: z.object({
    label: z.string().min(1),
    code: z.string().min(1),
    message: z.string().min(1),
    status: z.number().int().min(100).max(599).optional(),
    audit: z
      .object({
        rule_ids: z.array(z.string()).optional(),
        fields: z.array(z.string()).optional(),
      })
      .optional(),
  }),
});
