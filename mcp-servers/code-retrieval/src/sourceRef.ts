import type { GitLabEvidenceRef } from "./types.js";

export function buildGitLabFileSourceRef(input: {
  readonly project: string;
  readonly path: string;
  readonly commit: string;
  readonly startLine: number;
  readonly endLine: number;
}): string {
  return `gitlab:${input.project}#file:${input.path}@${input.commit}#L${input.startLine}-L${input.endLine}`;
}

export function buildLocalFileSourceRef(input: {
  readonly repo: string;
  readonly path: string;
  readonly sha: string;
  readonly startLine: number;
  readonly endLine: number;
}): string {
  return `local:${input.repo}#file:${input.path}@${input.sha}#L${input.startLine}-L${input.endLine}`;
}

export function buildMrSourceRef(project: string, iid: number): string {
  return `gitlab:${project}#mr:${iid}`;
}

export function buildCommitSourceRef(project: string, sha: string): string {
  return `gitlab:${project}#commit:${sha}`;
}

export function buildPipelineSourceRef(input: {
  readonly project: string;
  readonly id: number;
  readonly sha: string;
}): string {
  return `gitlab:${input.project}#pipeline:${input.id}@${input.sha}`;
}

export function fileEvidenceRef(input: {
  readonly provider: "gitlab" | "local";
  readonly project: string;
  readonly path: string;
  readonly commit: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly sourceRef: string;
}): GitLabEvidenceRef {
  return {
    kind: "file",
    source_ref: input.sourceRef,
    project: input.project,
    path: input.path,
    commit: input.commit,
    start_line: input.startLine,
    end_line: input.endLine,
    provider: input.provider,
  };
}
