import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, readFile, stat } from "node:fs/promises";
import { basename, relative, resolve } from "node:path";
import { promisify } from "node:util";

import { CodeRetrievalRequestError } from "./errors.js";
import {
  DEFAULT_MAX_BYTES_PER_FILE,
  assertSafeRepositoryPath,
  isExcludedPath,
  isLikelyBinaryBuffer,
  isLikelyBinaryPath,
  languageFromPath,
  sanitizeContent,
  sliceLines,
  truncateUtf8,
} from "./security.js";
import { buildLocalFileSourceRef } from "./sourceRef.js";
import type {
  CodeFileSliceV1,
  CodeSearchResultV1,
  SymbolKind,
} from "./types.js";

const execFileAsync = promisify(execFile);

export interface LocalRepositoryOptions {
  readonly repoRoot: string;
  readonly repoName?: string | undefined;
}

export interface LocalSearchInput {
  readonly query: string;
  readonly ref?: string | undefined;
  readonly limit: number;
  readonly maxBytesPerFile?: number | undefined;
}

export interface LocalReadFileInput {
  readonly path: string;
  readonly ref: string;
  readonly range?: {
    readonly start: number;
    readonly end: number;
  };
  readonly maxBytesPerFile?: number | undefined;
}

interface RgMatch {
  readonly path: string;
  readonly line: number;
  readonly text: string;
}

export class LocalRepository {
  readonly repoRoot: string;
  readonly repoName: string;

  constructor(options: LocalRepositoryOptions) {
    this.repoRoot = resolve(options.repoRoot);
    this.repoName = options.repoName ?? basename(this.repoRoot);
  }

  async exists(): Promise<boolean> {
    try {
      await access(this.repoRoot, constants.R_OK);
      return true;
    } catch {
      return false;
    }
  }

  async searchCode(
    input: LocalSearchInput,
  ): Promise<readonly CodeSearchResultV1[]> {
    if (!(await this.exists())) {
      return [];
    }

    const matches = await this.runRg(input.query, input.limit);
    const sha = await this.readHeadSha(input.ref);
    const results: CodeSearchResultV1[] = [];

    for (const match of matches) {
      if (
        results.length >= input.limit ||
        isExcludedPath(match.path) ||
        isLikelyBinaryPath(match.path)
      ) {
        continue;
      }

      const fileContent = await this.readSafeFileContent(
        match.path,
        input.maxBytesPerFile,
      );
      if (fileContent === null) {
        continue;
      }

      const lineCount = fileContent.split(/\r?\n/).length;
      const startLine = Math.max(1, match.line - 4);
      const endLine = Math.min(lineCount, match.line + 4);
      const sliced = sliceLines(fileContent, {
        start: startLine,
        end: endLine,
      });
      const sanitized = sanitizeContent(sliced.content);
      const sourceRef = buildLocalFileSourceRef({
        repo: this.repoName,
        path: match.path,
        sha,
        startLine: sliced.startLine,
        endLine: sliced.endLine,
      });
      const symbol = inferSymbol(match.path, fileContent, match.line);

      results.push({
        source_ref: sourceRef,
        provider: "local",
        project: this.repoName,
        path: match.path,
        ref: input.ref ?? "HEAD",
        commit: sha,
        start_line: sliced.startLine,
        end_line: sliced.endLine,
        language: languageFromPath(match.path),
        score: 1,
        ...(symbol.name !== undefined ? { symbol_name: symbol.name } : {}),
        symbol_kind: symbol.kind,
        content: sanitized.content,
        redacted: sanitized.redacted,
        ...(sanitized.reason !== undefined
          ? { redaction_reason: sanitized.reason }
          : {}),
      });
    }

    return results;
  }

  async readFile(input: LocalReadFileInput): Promise<CodeFileSliceV1> {
    const safePath = assertSafeRepositoryPath(input.path);
    const fileContent = await this.readSafeFileContent(
      safePath,
      input.maxBytesPerFile,
    );
    if (fileContent === null) {
      throw new CodeRetrievalRequestError(
        "Local file is excluded, binary, or too large",
      );
    }

    const sha = await this.readHeadSha(input.ref);
    const sliced = sliceLines(fileContent, input.range);
    const limited = truncateUtf8(
      sliced.content,
      input.maxBytesPerFile ?? DEFAULT_MAX_BYTES_PER_FILE,
    );
    const sanitized = sanitizeContent(limited);
    const sourceRef = buildLocalFileSourceRef({
      repo: this.repoName,
      path: safePath,
      sha,
      startLine: sliced.startLine,
      endLine: sliced.endLine,
    });

    return {
      source_ref: sourceRef,
      provider: "local",
      project: this.repoName,
      path: safePath,
      ref: input.ref,
      commit: sha,
      start_line: sliced.startLine,
      end_line: sliced.endLine,
      content: sanitized.content,
      bytes: Buffer.byteLength(sanitized.content, "utf8"),
      redacted: sanitized.redacted,
      ...(sanitized.reason !== undefined
        ? { redaction_reason: sanitized.reason }
        : {}),
    };
  }

  private async runRg(
    query: string,
    limit: number,
  ): Promise<readonly RgMatch[]> {
    try {
      const { stdout } = await execFileAsync(
        "rg",
        [
          "--line-number",
          "--column",
          "--ignore-case",
          "--fixed-strings",
          "--no-heading",
          "--color",
          "never",
          "--max-count",
          String(limit),
          "--glob",
          "!.memory/**",
          "--glob",
          "!reports/**",
          "--glob",
          "!secrets/**",
          "--glob",
          "!.env*",
          "--glob",
          "!node_modules/**",
          "--glob",
          "!dist/**",
          "--glob",
          "!coverage/**",
          "--",
          query,
          ".",
        ],
        {
          cwd: this.repoRoot,
          maxBuffer: 256 * 1024,
        },
      );

      return stdout
        .split(/\r?\n/)
        .filter((line) => line.trim().length > 0)
        .map((line) => parseRgLine(line))
        .filter((match): match is RgMatch => match !== null)
        .slice(0, limit);
    } catch (error: unknown) {
      if (isNoMatchError(error)) {
        return [];
      }

      throw new CodeRetrievalRequestError("Local rg search failed");
    }
  }

  private async readSafeFileContent(
    path: string,
    maxBytesPerFile = DEFAULT_MAX_BYTES_PER_FILE,
  ): Promise<string | null> {
    const safePath = assertSafeRepositoryPath(path);
    if (isExcludedPath(safePath) || isLikelyBinaryPath(safePath)) {
      return null;
    }

    const absolutePath = resolve(this.repoRoot, safePath);
    const relativePath = relative(this.repoRoot, absolutePath);
    if (relativePath.startsWith("..")) {
      return null;
    }

    const fileStat = await stat(absolutePath);
    if (!fileStat.isFile() || fileStat.size > maxBytesPerFile) {
      return null;
    }

    const buffer = await readFile(absolutePath);
    if (isLikelyBinaryBuffer(buffer)) {
      return null;
    }

    return buffer.toString("utf8");
  }

  private async readHeadSha(ref: string | undefined): Promise<string> {
    try {
      const { stdout } = await execFileAsync(
        "git",
        ["rev-parse", ref ?? "HEAD"],
        {
          cwd: this.repoRoot,
          maxBuffer: 16 * 1024,
        },
      );
      return stdout.trim();
    } catch {
      return ref ?? "unknown";
    }
  }
}

function parseRgLine(line: string): RgMatch | null {
  const match = /^(.*?):(\d+):(\d+):(.*)$/.exec(line);
  if (match === null) {
    return null;
  }

  const path = match[1];
  const lineNumber = match[2];
  const text = match[4];
  if (path === undefined || lineNumber === undefined || text === undefined) {
    return null;
  }

  return {
    path: path.replace(/^\.\//, ""),
    line: Number.parseInt(lineNumber, 10),
    text,
  };
}

function isNoMatchError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const record = error as Record<string, unknown>;
  return record.code === 1;
}

function inferSymbol(
  path: string,
  content: string,
  line: number,
): {
  readonly name?: string | undefined;
  readonly kind: SymbolKind;
} {
  const extension = path.split(".").pop()?.toLowerCase();
  if (
    extension !== "ts" &&
    extension !== "tsx" &&
    extension !== "js" &&
    extension !== "jsx" &&
    extension !== "vue"
  ) {
    return {
      kind: "line_slice",
    };
  }

  const lines = content.split(/\r?\n/);
  for (let index = Math.max(0, line - 1); index >= 0; index -= 1) {
    const current = lines[index];
    if (current === undefined) {
      continue;
    }

    const functionMatch = /\bfunction\s+([A-Za-z_$][\w$]*)/.exec(current);
    if (functionMatch?.[1] !== undefined) {
      return {
        name: functionMatch[1],
        kind: "function",
      };
    }

    const classMatch = /\bclass\s+([A-Za-z_$][\w$]*)/.exec(current);
    if (classMatch?.[1] !== undefined) {
      return {
        name: classMatch[1],
        kind: "class",
      };
    }

    const constFunctionMatch =
      /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/.exec(
        current,
      );
    if (constFunctionMatch?.[1] !== undefined) {
      return {
        name: constFunctionMatch[1],
        kind: extension === "vue" ? "component" : "function",
      };
    }
  }

  return {
    kind: "line_slice",
  };
}
