# Phase 1b W8-B: Code Retrieval MCP Contract

## Scope

- 本阶段只实现只读 GitLab Context Pack 与 Code Retrieval MCP。
- 不接 Context Assembler，不做 Eval，不创建 MR，不 push，不写 GitLab/Jira/Notion。
- GitLab token 仅从环境变量读取，不入仓、不进日志、不进入 tool 输出。

## Source Ref

所有代码证据必须输出稳定 `source_ref`：

- file: `gitlab:<project>#file:<path>@<commit>#L<start>-L<end>`
- mr: `gitlab:<project>#mr:<iid>`
- commit: `gitlab:<project>#commit:<sha>`
- pipeline: `gitlab:<project>#pipeline:<id>@<sha>`
- local fallback: `local:<repo>#file:<path>@<git-sha>#L<start>-L<end>`

`project` 使用 GitLab project path 或 id 的调用值；`path` 保留仓库相对路径；行号从 1 开始。

## GitLabEvidenceRef

```ts
type GitLabEvidenceRef =
  | {
      kind: "file";
      source_ref: string;
      project: string;
      path: string;
      commit: string;
      start_line: number;
      end_line: number;
      provider: "gitlab" | "local";
    }
  | {
      kind: "mr";
      source_ref: string;
      project: string;
      iid: number;
    }
  | {
      kind: "commit";
      source_ref: string;
      project: string;
      sha: string;
    }
  | {
      kind: "pipeline";
      source_ref: string;
      project: string;
      id: number;
      sha: string;
    };
```

## CodeSearchResultV1

```ts
interface CodeSearchResultV1 {
  source_ref: string;
  provider: "gitlab" | "local";
  project: string;
  path: string;
  ref: string;
  commit: string;
  start_line: number;
  end_line: number;
  language: string;
  score: number;
  symbol_name?: string;
  symbol_kind?: "function" | "class" | "method" | "component" | "line_slice";
  content: string;
  redacted: boolean;
  redaction_reason?: string;
}
```

## CodeFileSliceV1

```ts
interface CodeFileSliceV1 {
  source_ref: string;
  provider: "gitlab" | "local";
  project: string;
  path: string;
  ref: string;
  commit: string;
  start_line: number;
  end_line: number;
  content: string;
  bytes: number;
  redacted: boolean;
  redaction_reason?: string;
}
```

## GitLabContextPackV1

```ts
interface GitLabContextPackV1 {
  version: "GitLabContextPackV1";
  generated_at: string;
  query: string;
  scope: "blobs" | "files" | "commits" | "merge_requests" | "pipelines";
  ref?: string;
  search_results: readonly CodeSearchResultV1[];
  file_slices: readonly CodeFileSliceV1[];
  evidence_refs: readonly GitLabEvidenceRef[];
  need_more_context: boolean;
  warnings: readonly string[];
}
```

当没有真实代码证据时，调用方必须输出 `need_more_context` 或 `ask_human`，不得编造实现结论。

## MCP Tools

- `searchCode({ query, scope, ref?, limit?, mode? })`
- `readFile({ project, path, ref, range? })`
- `listRepositoryTree({ project, path?, ref?, recursive?, limit? })`
- `listMergeRequests({ project?, query?, state?, updatedAfter?, limit? })`
- `listCommits({ project, query?, path?, since?, until?, limit? })`
- `getDiff({ project, from, to, maxFiles?, maxPatchBytes? })`
- `listPipelines({ project, ref?, sha?, status?, limit? })`

所有 tools 的 MCP annotations 必须为 read-only：`readOnlyHint=true`、`destructiveHint=false`。

## Retrieval Order

`searchCode` 多路召回顺序：

1. GitLab Search API `scope=blobs`，在 `GITLAB_BASE_URL` 和 `GITLAB_TOKEN` 可用时优先。
2. 本地 clone 存在时用 `rg` fallback，并遵守 `.gitignore`。
3. TypeScript/Vue/JavaScript 文件可使用 tree-sitter 抽取 symbol 片段；tree-sitter 不可用时降级为行片段。

## Security

默认排除：

- `.memory/`
- `reports/`
- `secrets/`
- `.env*`
- `node_modules/`
- `dist/`
- `coverage/`
- 二进制文件
- 大文件

输出上限：

- 单文件默认最多 `32 KiB`
- 单次 tool 默认最多 `128 KiB`
- patch 默认最多 `64 KiB`

返回内容前必须运行 redline scan。命中 token、secret、Authorization/Bearer、PHI、患者标识或完整敏感请求/响应时，只返回 metadata 与 redacted summary，不返回原文。

## GitLab Client

- 配置来自 `GITLAB_BASE_URL`、`GITLAB_TOKEN`。
- 只允许 GET。
- 所有请求必须支持 timeout、pagination limit 与 HTTP error mapping。
- 测试默认 mock，不访问真实 GitLab。
