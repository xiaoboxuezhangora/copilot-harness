import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodType } from "zod";

import { toMemoryMcpError } from "./errors.js";
import {
  errorPayloadSchema,
  findSimilarMemoryRecordsInputSchema,
  findSimilarMemoryRecordsInputValidator,
  findSimilarMemoryRecordsOutputSchema,
  getInputSchema,
  getInputValidator,
  getOutputSchema,
  hotIndexInputSchema,
  hotIndexInputValidator,
  hotIndexOutputSchema,
  listInputSchema,
  listInputValidator,
  listOutputSchema,
  putInputSchema,
  putInputValidator,
  putOutputSchema,
  searchInputSchema,
  searchInputValidator,
  searchOutputSchema,
} from "./schemas.js";
import { assertMemoryRedline } from "./security.js";
import { SqliteMemoryStore } from "./store.js";

export const TOOL_NAMES = [
  "put",
  "get",
  "search",
  "list",
  "findSimilarMemoryRecords",
  "hotIndex",
] as const;

export interface MemoryToolHandlers {
  readonly put: (input: unknown) => Promise<CallToolResult>;
  readonly get: (input: unknown) => Promise<CallToolResult>;
  readonly search: (input: unknown) => Promise<CallToolResult>;
  readonly list: (input: unknown) => Promise<CallToolResult>;
  readonly findSimilarMemoryRecords: (
    input: unknown,
  ) => Promise<CallToolResult>;
  readonly hotIndex: (input: unknown) => Promise<CallToolResult>;
}

export function createMemoryToolHandlers(
  store: SqliteMemoryStore,
): MemoryToolHandlers {
  return {
    put: async (input) =>
      toToolResult("put", putOutputSchema, async () => {
        const parsed = putInputValidator.parse(input);
        const redlineSource = parsed.portable_record ?? parsed;
        assertMemoryRedline({
          key: redlineSource.key,
          value: redlineSource.value,
          source_ref: redlineSource.source_ref,
          producer_agent: redlineSource.producer_agent,
          trigger_description: parsed.trigger_description,
        });

        const stored = store.putDetailed(parsed);
        return {
          ok: true as const,
          record: stored.record,
          portable_record: stored.portable_record,
          version: stored.version,
          warnings: [...stored.warnings],
        };
      }),
    get: async (input) =>
      toToolResult("get", getOutputSchema, async () => {
        const parsed = getInputValidator.parse(input);
        const record = store.get(parsed);
        return {
          ok: true as const,
          record,
          portable_record: record === null ? null : toPortableRecord(record),
        };
      }),
    search: async (input) =>
      toToolResult("search", searchOutputSchema, async () => {
        const parsed = searchInputValidator.parse(input);
        const limit = parsed.limit ?? 20;
        const includeExpired = parsed.include_expired ?? false;
        const records = store.search({
          namespace: parsed.namespace,
          query: parsed.query,
          limit,
          include_expired: includeExpired,
        });

        return {
          ok: true as const,
          query: parsed.query,
          total: records.length,
          records: [...records],
          portable_records: records.map((record) => toPortableRecord(record)),
        };
      }),
    list: async (input) =>
      toToolResult("list", listOutputSchema, async () => {
        const parsed = listInputValidator.parse(input);
        const limit = parsed.limit ?? 50;
        const offset = parsed.offset ?? 0;
        const includeExpired = parsed.include_expired ?? false;
        const records = store.list({
          namespace: parsed.namespace,
          limit,
          offset,
          include_expired: includeExpired,
        });

        return {
          ok: true as const,
          total: records.length,
          records: [...records],
          portable_records: records.map((record) => toPortableRecord(record)),
        };
      }),
    findSimilarMemoryRecords: async (input) =>
      toToolResult(
        "findSimilarMemoryRecords",
        findSimilarMemoryRecordsOutputSchema,
        async () => {
          const parsed = findSimilarMemoryRecordsInputValidator.parse(input);
          assertMemoryRedline({
            key: parsed.key,
            value: parsed.value,
            source_ref: parsed.source_ref,
            producer_agent: parsed.producer_agent,
            trigger_description: parsed.trigger_description,
          });

          return store.findSimilarMemoryRecords(parsed);
        },
      ),
    hotIndex: async (input) =>
      toToolResult("hotIndex", hotIndexOutputSchema, async () => {
        const parsed = hotIndexInputValidator.parse(input);
        return store.hotIndex(parsed);
      }),
  };
}

function toPortableRecord(record: {
  readonly namespace: "decisions" | "knowledge_index" | "aliases";
  readonly key: string;
  readonly value: string;
  readonly source_ref: string;
  readonly ts: string;
  readonly producer_agent: string;
  readonly confidence?: number | undefined;
}): {
  readonly kind: "decision" | "knowledge" | "alias";
  readonly key: string;
  readonly value: string;
  readonly source_ref: string;
  readonly producer_agent: string;
  readonly ts: string;
  readonly confidence: number;
} {
  if (record.namespace === "decisions") {
    return {
      kind: "decision",
      key: record.key,
      value: record.value,
      source_ref: record.source_ref,
      producer_agent: record.producer_agent ?? "unknown",
      ts: record.ts,
      confidence: record.confidence ?? 0.7,
    };
  }

  if (record.namespace === "aliases") {
    return {
      kind: "alias",
      key: record.key,
      value: record.value,
      source_ref: record.source_ref,
      producer_agent: record.producer_agent,
      ts: record.ts,
      confidence: 0.7,
    };
  }

  return {
    kind: "knowledge",
    key: record.key,
    value: record.value,
    source_ref: record.source_ref,
    producer_agent: record.producer_agent,
    ts: record.ts,
    confidence: record.confidence ?? 0.7,
  };
}

export function createMemoryServer(store: SqliteMemoryStore): McpServer {
  const server = new McpServer({
    name: "memory",
    version: "0.1.0",
  });
  const handlers = createMemoryToolHandlers(store);

  server.registerTool(
    "put",
    {
      title: "Put memory record",
      description:
        "Write one memory record into decisions or knowledge_index, with redline policy checks.",
      inputSchema: putInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => handlers.put(input),
  );

  server.registerTool(
    "get",
    {
      title: "Get memory record",
      description: "Read one memory record by namespace and key.",
      inputSchema: getInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => handlers.get(input),
  );

  server.registerTool(
    "search",
    {
      title: "Search memory records",
      description:
        "Search memory records with LIKE matching. Default excludes expired decisions.",
      inputSchema: searchInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => handlers.search(input),
  );

  server.registerTool(
    "list",
    {
      title: "List memory records",
      description:
        "List memory records with pagination. Default excludes expired decisions.",
      inputSchema: listInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => handlers.list(input),
  );

  server.registerTool(
    "findSimilarMemoryRecords",
    {
      title: "Find similar memory records",
      description:
        "Read-only conflict check for candidate memory records. Uses sqlite-vec when available and deterministic lexical fallback otherwise.",
      inputSchema: findSimilarMemoryRecordsInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => handlers.findSimilarMemoryRecords(input),
  );

  server.registerTool(
    "hotIndex",
    {
      title: "Read memory hot index",
      description:
        "Read bounded high-priority Memory summaries for prompt injection. Details should be loaded lazily through search.",
      inputSchema: hotIndexInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => handlers.hotIndex(input),
  );

  return server;
}

async function toToolResult<TOutput>(
  label: string,
  outputSchema: ZodType<TOutput>,
  operation: () => Promise<TOutput>,
): Promise<CallToolResult> {
  try {
    const payload = outputSchema.parse(await operation());
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(payload),
        },
      ],
      structuredContent: payload as Record<string, unknown>,
    };
  } catch (error: unknown) {
    const memoryError = toMemoryMcpError(error);
    const payload = errorPayloadSchema.parse({
      error: {
        label,
        code: memoryError.code,
        message: memoryError.message,
        ...(memoryError.status !== undefined
          ? { status: memoryError.status }
          : {}),
        ...(memoryError.audit !== undefined
          ? { audit: memoryError.audit }
          : {}),
      },
    });

    return {
      isError: true,
      content: [
        {
          type: "text",
          text: JSON.stringify(payload),
        },
      ],
      structuredContent: payload,
    };
  }
}
