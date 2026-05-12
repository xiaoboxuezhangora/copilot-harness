import { ZodError } from "zod";

export class CodeRetrievalError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "CodeRetrievalError";
  }
}

export class CodeRetrievalConfigError extends CodeRetrievalError {
  constructor(message: string) {
    super(message, "CONFIG_ERROR");
    this.name = "CodeRetrievalConfigError";
  }
}

export class CodeRetrievalPolicyError extends CodeRetrievalError {
  constructor(message: string) {
    super(message, "POLICY_ERROR");
    this.name = "CodeRetrievalPolicyError";
  }
}

export class CodeRetrievalRequestError extends CodeRetrievalError {
  constructor(message: string, status?: number) {
    super(message, "GITLAB_REQUEST_ERROR", status);
    this.name = "CodeRetrievalRequestError";
  }
}

export function toCodeRetrievalError(error: unknown): CodeRetrievalError {
  if (error instanceof CodeRetrievalError) {
    return error;
  }

  if (error instanceof ZodError) {
    const message = error.issues[0]?.message ?? "invalid tool input";
    return new CodeRetrievalPolicyError(message);
  }

  if (error instanceof Error) {
    return new CodeRetrievalRequestError(error.message);
  }

  return new CodeRetrievalRequestError("Code retrieval request failed");
}
