import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { loadConfigFromEnv } from "./config.js";
import { GitLabClient } from "./gitlabClient.js";
import { LocalRepository } from "./localRepository.js";
import { createCodeRetrievalServer } from "./tools.js";

export { loadConfigFromEnv } from "./config.js";
export { CodeRetrievalError } from "./errors.js";
export { GitLabClient } from "./gitlabClient.js";
export { LocalRepository } from "./localRepository.js";
export {
  TOOL_NAMES,
  createCodeRetrievalServer,
  createCodeRetrievalToolHandlers,
  getDiffInputSchema,
  listCommitsInputSchema,
  listMergeRequestsInputSchema,
  listPipelinesInputSchema,
  listRepositoryTreeInputSchema,
  readFileInputSchema,
  searchCodeInputSchema,
} from "./tools.js";
export {
  buildCommitSourceRef,
  buildGitLabFileSourceRef,
  buildLocalFileSourceRef,
  buildMrSourceRef,
  buildPipelineSourceRef,
} from "./sourceRef.js";
export type {
  CodeFileSliceV1,
  CodeSearchResultV1,
  DiffV1,
  GitLabContextPackV1,
  GitLabEvidenceRef,
} from "./types.js";

export async function startStdioServer(): Promise<void> {
  const config = loadConfigFromEnv();
  const gitlabClient =
    config.gitlab === undefined
      ? undefined
      : new GitLabClient({
          baseUrl: config.gitlab.baseUrl,
          token: config.gitlab.token,
          requestTimeoutMs: config.gitlab.requestTimeoutMs,
        });
  const localRepository =
    config.localRepoRoot === undefined
      ? undefined
      : new LocalRepository({
          repoRoot: config.localRepoRoot,
          repoName: config.localRepoName,
        });
  const server = createCodeRetrievalServer({
    gitlabClient,
    localRepository,
  });
  const transport = new StdioServerTransport();

  await server.connect(transport);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startStdioServer().catch((error: unknown) => {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to start code retrieval MCP";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
