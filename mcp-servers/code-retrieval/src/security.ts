import { extname, isAbsolute, normalize, sep } from "node:path";

import { CodeRetrievalPolicyError } from "./errors.js";

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 50;
export const DEFAULT_MAX_BYTES_PER_FILE = 32 * 1024;
export const DEFAULT_MAX_TOTAL_BYTES = 128 * 1024;
export const DEFAULT_MAX_DIFF_BYTES = 64 * 1024;

const EXCLUDED_PREFIXES = [
  ".memory/",
  "reports/",
  "secrets/",
  "node_modules/",
  "dist/",
  "coverage/",
] as const;

const BINARY_EXTENSIONS = new Set([
  ".7z",
  ".avif",
  ".bmp",
  ".class",
  ".dll",
  ".exe",
  ".gif",
  ".gz",
  ".ico",
  ".jar",
  ".jpeg",
  ".jpg",
  ".lockb",
  ".pdf",
  ".png",
  ".so",
  ".tar",
  ".webp",
  ".zip",
]);

interface RedlineRule {
  readonly id: string;
  readonly description: string;
  readonly pattern: RegExp;
}

export interface RedlineScanResult {
  readonly redacted: boolean;
  readonly content: string;
  readonly reason?: string | undefined;
}

const REDLINE_RULES: readonly RedlineRule[] = [
  {
    id: "phi",
    description:
      "PHI or clinical record details are not allowed in code evidence output",
    pattern: /(protected health information|病案|病历|诊断记录|检验结果)/i,
  },
  {
    id: "patient_identifier",
    description:
      "real patient identifiers are not allowed in code evidence output",
    pattern:
      /(patient(?:_?id|_?no)|inpatient(?:_?id|_?no)|患者(?:编号|标识|姓名|证件)|身份证号?|住院号)/i,
  },
  {
    id: "sso_token",
    description: "SSO token or ticket is not allowed in code evidence output",
    pattern:
      /(sso[_-]?(?:token|ticket)|session(?:id)?\s*[:=]\s*[A-Za-z0-9._-]{8,})/i,
  },
  {
    id: "private_key",
    description: "private key material is not allowed in code evidence output",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/i,
  },
  {
    id: "platform_credentials",
    description: "platform credentials are not allowed in code evidence output",
    pattern:
      /(client_secret|app_secret|access_key|secret_key|api[_-]?key|platform[_-]?(?:credential|secret|token)|平台(?:凭证|密钥|令牌))/i,
  },
  {
    id: "authorization_bearer",
    description:
      "Authorization/Bearer token is not allowed in code evidence output",
    pattern:
      /(authorization\s*:\s*bearer\s+[a-z0-9\-._~+/]+=*|\bbearer\s+[a-z0-9\-._~+/]+=*)/i,
  },
  {
    id: "sensitive_request_response_dump",
    description: "complete sensitive request/response payload is not allowed",
    pattern:
      /(full\s+(?:request|response)|raw\s+(?:request|response)|完整(?:敏感)?(?:请求|响应)|(?:request|response)\s*body\s*[:=])/i,
  },
];

export function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return DEFAULT_LIMIT;
  }

  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new CodeRetrievalPolicyError(
      `limit must be between 1 and ${MAX_LIMIT}`,
    );
  }

  return limit;
}

export function normalizeByteLimit(
  value: number | undefined,
  defaultValue: number,
  label: string,
): number {
  if (value === undefined) {
    return defaultValue;
  }

  if (
    !Number.isInteger(value) ||
    value < 1 ||
    value > DEFAULT_MAX_TOTAL_BYTES
  ) {
    throw new CodeRetrievalPolicyError(
      `${label} must be between 1 and ${DEFAULT_MAX_TOTAL_BYTES}`,
    );
  }

  return value;
}

export function assertSafeRepositoryPath(path: string): string {
  const normalized = normalize(path).replaceAll(sep, "/");
  if (
    normalized.length === 0 ||
    normalized === "." ||
    isAbsolute(path) ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    isExcludedPath(normalized)
  ) {
    throw new CodeRetrievalPolicyError("repository path is excluded or unsafe");
  }

  return normalized;
}

export function isExcludedPath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\/+/, "");
  if (normalized.startsWith(".env") || normalized.includes("/.env")) {
    return true;
  }

  return EXCLUDED_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export function isLikelyBinaryPath(path: string): boolean {
  return BINARY_EXTENSIONS.has(extname(path).toLowerCase());
}

export function isLikelyBinaryBuffer(buffer: Buffer): boolean {
  const sampleLength = Math.min(buffer.length, 8_000);
  for (let index = 0; index < sampleLength; index += 1) {
    if (buffer[index] === 0) {
      return true;
    }
  }

  return false;
}

export function sanitizeContent(content: string): RedlineScanResult {
  const ruleIds: string[] = [];
  for (const rule of REDLINE_RULES) {
    if (rule.pattern.test(content)) {
      ruleIds.push(rule.id);
    }
  }

  if (ruleIds.length === 0) {
    return {
      redacted: false,
      content,
    };
  }

  const reason = `redline:${[...new Set(ruleIds)].join(",")}`;
  return {
    redacted: true,
    content: `[redacted summary: ${reason}]`,
    reason,
  };
}

export function truncateUtf8(content: string, maxBytes: number): string {
  if (Buffer.byteLength(content, "utf8") <= maxBytes) {
    return content;
  }

  let end = content.length;
  while (
    end > 0 &&
    Buffer.byteLength(content.slice(0, end), "utf8") > maxBytes
  ) {
    end -= 1;
  }

  return `${content.slice(0, end)}\n[truncated]`;
}

export function languageFromPath(path: string): string {
  const extension = extname(path).toLowerCase();
  if (extension === ".ts") return "typescript";
  if (extension === ".tsx") return "typescriptreact";
  if (extension === ".js") return "javascript";
  if (extension === ".jsx") return "javascriptreact";
  if (extension === ".vue") return "vue";
  if (extension === ".java") return "java";
  if (extension === ".json") return "json";
  if (extension === ".md") return "markdown";
  return extension.length > 1 ? extension.slice(1) : "text";
}

export function sliceLines(
  content: string,
  range: { readonly start: number; readonly end: number } | undefined,
): {
  readonly content: string;
  readonly startLine: number;
  readonly endLine: number;
} {
  const lines = content.split(/\r?\n/);
  const requestedStart = range?.start ?? 1;
  const requestedEnd = range?.end ?? lines.length;
  const startLine = Math.max(1, requestedStart);
  const endLine = Math.min(lines.length, Math.max(startLine, requestedEnd));

  return {
    content: lines.slice(startLine - 1, endLine).join("\n"),
    startLine,
    endLine,
  };
}
