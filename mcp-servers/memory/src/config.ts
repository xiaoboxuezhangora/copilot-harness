import { MemoryConfigError } from "./errors.js";
import { MEMORY_EMBEDDING_PROVIDERS, type MemoryEmbeddingProvider } from "./types.js";

const SQLITE_PATH_ENV = ["MEMORY", "SQLITE", "PATH"].join("_");
const EMBEDDING_PROVIDER_ENV = ["MEMORY", "EMBEDDING", "PROVIDER"].join("_");

type EnvMap = Readonly<Record<string, string | undefined>>;

export interface MemoryMcpConfig {
  readonly sqlitePath: string;
  readonly embeddingProvider: MemoryEmbeddingProvider;
}

export function loadConfigFromEnv(env: EnvMap = process.env): MemoryMcpConfig {
  const sqlitePath = readOptionalEnv(env, SQLITE_PATH_ENV) ?? "reports/memory.sqlite";
  const embeddingProvider = readEmbeddingProvider(
    readOptionalEnv(env, EMBEDDING_PROVIDER_ENV) ?? "deterministic_test",
  );
  if (sqlitePath.length === 0) {
    throw new MemoryConfigError(`${SQLITE_PATH_ENV} must not be empty`);
  }

  return {
    sqlitePath,
    embeddingProvider,
  };
}

function readOptionalEnv(env: EnvMap, name: string): string | undefined {
  const value = env[name]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}

function readEmbeddingProvider(value: string): MemoryEmbeddingProvider {
  if (MEMORY_EMBEDDING_PROVIDERS.includes(value as MemoryEmbeddingProvider)) {
    return value as MemoryEmbeddingProvider;
  }

  throw new MemoryConfigError(`${EMBEDDING_PROVIDER_ENV} must be an allowlisted provider`);
}
