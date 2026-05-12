export type EvidenceProvider = "gitlab" | "local";

export type CodeSearchScope =
  | "blobs"
  | "files"
  | "commits"
  | "merge_requests"
  | "pipelines";

export type SymbolKind =
  | "function"
  | "class"
  | "method"
  | "component"
  | "line_slice";

export interface FileEvidenceRef {
  readonly kind: "file";
  readonly source_ref: string;
  readonly project: string;
  readonly path: string;
  readonly commit: string;
  readonly start_line: number;
  readonly end_line: number;
  readonly provider: EvidenceProvider;
}

export interface MrEvidenceRef {
  readonly kind: "mr";
  readonly source_ref: string;
  readonly project: string;
  readonly iid: number;
}

export interface CommitEvidenceRef {
  readonly kind: "commit";
  readonly source_ref: string;
  readonly project: string;
  readonly sha: string;
}

export interface PipelineEvidenceRef {
  readonly kind: "pipeline";
  readonly source_ref: string;
  readonly project: string;
  readonly id: number;
  readonly sha: string;
}

export type GitLabEvidenceRef =
  | FileEvidenceRef
  | MrEvidenceRef
  | CommitEvidenceRef
  | PipelineEvidenceRef;

export interface CodeSearchResultV1 {
  readonly source_ref: string;
  readonly provider: EvidenceProvider;
  readonly project: string;
  readonly path: string;
  readonly ref: string;
  readonly commit: string;
  readonly start_line: number;
  readonly end_line: number;
  readonly language: string;
  readonly score: number;
  readonly symbol_name?: string | undefined;
  readonly symbol_kind?: SymbolKind | undefined;
  readonly content: string;
  readonly redacted: boolean;
  readonly redaction_reason?: string | undefined;
}

export interface CodeFileSliceV1 {
  readonly source_ref: string;
  readonly provider: EvidenceProvider;
  readonly project: string;
  readonly path: string;
  readonly ref: string;
  readonly commit: string;
  readonly start_line: number;
  readonly end_line: number;
  readonly content: string;
  readonly bytes: number;
  readonly redacted: boolean;
  readonly redaction_reason?: string | undefined;
}

export interface GitLabContextPackV1 {
  readonly version: "GitLabContextPackV1";
  readonly generated_at: string;
  readonly query: string;
  readonly scope: CodeSearchScope;
  readonly ref?: string | undefined;
  readonly search_results: readonly CodeSearchResultV1[];
  readonly file_slices: readonly CodeFileSliceV1[];
  readonly evidence_refs: readonly GitLabEvidenceRef[];
  readonly need_more_context: boolean;
  readonly warnings: readonly string[];
}

export interface RepositoryTreeItemV1 {
  readonly project: string;
  readonly path: string;
  readonly name: string;
  readonly type: "tree" | "blob";
  readonly ref: string;
  readonly source_ref?: string | undefined;
}

export interface MergeRequestV1 {
  readonly source_ref: string;
  readonly project: string;
  readonly iid: number;
  readonly title: string;
  readonly state: string;
  readonly updated_at?: string | undefined;
  readonly source_branch?: string | undefined;
  readonly target_branch?: string | undefined;
  readonly web_url?: string | undefined;
}

export interface CommitV1 {
  readonly source_ref: string;
  readonly project: string;
  readonly sha: string;
  readonly title: string;
  readonly committed_date?: string | undefined;
  readonly web_url?: string | undefined;
}

export interface DiffFileV1 {
  readonly old_path: string;
  readonly new_path: string;
  readonly patch: string;
  readonly bytes: number;
  readonly redacted: boolean;
  readonly redaction_reason?: string | undefined;
}

export interface DiffV1 {
  readonly source_ref: string;
  readonly project: string;
  readonly from: string;
  readonly to: string;
  readonly files: readonly DiffFileV1[];
  readonly truncated: boolean;
}

export interface PipelineV1 {
  readonly source_ref: string;
  readonly project: string;
  readonly id: number;
  readonly sha: string;
  readonly ref?: string | undefined;
  readonly status?: string | undefined;
  readonly updated_at?: string | undefined;
  readonly web_url?: string | undefined;
}
