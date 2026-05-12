import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { loadConfigFromEnv } from "./config.js";
import { SqliteMemoryStore } from "./store.js";
import { createMemoryServer } from "./tools.js";

export { loadConfigFromEnv } from "./config.js";
export {
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
  memoryRecordSchema,
  putInputSchema,
  putInputValidator,
  putOutputSchema,
  searchInputSchema,
  searchInputValidator,
  searchOutputSchema,
} from "./schemas.js";
export { MemoryMcpError, MemoryPolicyError, MemoryStorageError } from "./errors.js";
export { assertMemoryRedline, findRedlineMatches } from "./security.js";
export { SqliteMemoryStore } from "./store.js";
export { TOOL_NAMES, createMemoryServer, createMemoryToolHandlers } from "./tools.js";
export { MEMORY_NAMESPACES } from "./types.js";
export type {
  AliasRecord,
  DecisionRecord,
  FindSimilarMemoryRecordsInput,
  FindSimilarMemoryRecordsResult,
  HotIndexInput,
  HotIndexResult,
  KnowledgeIndexRecord,
  ListInput,
  MemoryConflictCandidate,
  MemoryEmbeddingBackend,
  MemoryEmbeddingProvider,
  MemoryEmbeddingRecord,
  MemoryHotIndexRecord,
  MemoryHotIndexScoreComponents,
  MemoryNamespace,
  MemoryRecord,
  PutInput,
  SearchInput,
} from "./types.js";

export async function startStdioServer(): Promise<void> {
  const config = loadConfigFromEnv();
  const store = new SqliteMemoryStore({
    sqlitePath: config.sqlitePath,
    embeddingProvider: config.embeddingProvider,
  });
  const server = createMemoryServer(store);
  const transport = new StdioServerTransport();

  await server.connect(transport);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startStdioServer().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Failed to start memory MCP";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
