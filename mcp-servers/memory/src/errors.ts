import { ZodError } from "zod";

export interface MemoryErrorAudit {
  readonly rule_ids?: readonly string[];
  readonly fields?: readonly string[];
}

export class MemoryMcpError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status?: number,
    readonly audit?: MemoryErrorAudit,
  ) {
    super(message);
    this.name = "MemoryMcpError";
  }
}

export class MemoryConfigError extends MemoryMcpError {
  constructor(message: string) {
    super(message, "CONFIG_ERROR", 400);
    this.name = "MemoryConfigError";
  }
}

export class MemoryValidationError extends MemoryMcpError {
  constructor(message: string) {
    super(message, "VALIDATION_ERROR", 400);
    this.name = "MemoryValidationError";
  }
}

export class MemoryPolicyError extends MemoryMcpError {
  constructor(message: string, audit: MemoryErrorAudit) {
    super(message, "REDLINE_VIOLATION", 400, audit);
    this.name = "MemoryPolicyError";
  }
}

export class MemoryStorageError extends MemoryMcpError {
  constructor(message: string) {
    super(message, "STORAGE_ERROR", 500);
    this.name = "MemoryStorageError";
  }
}

export function toMemoryMcpError(error: unknown): MemoryMcpError {
  if (error instanceof MemoryMcpError) {
    return error;
  }

  if (error instanceof ZodError) {
    const message = error.issues[0]?.message ?? "invalid tool input or output";
    return new MemoryValidationError(message);
  }

  if (error instanceof Error) {
    return new MemoryStorageError(error.message);
  }

  return new MemoryStorageError("Memory operation failed");
}
