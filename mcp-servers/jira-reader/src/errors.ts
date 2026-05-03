export class JiraReaderError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "JiraReaderError";
  }
}

export class JiraConfigError extends JiraReaderError {
  constructor(message: string) {
    super(message, "CONFIG_ERROR");
    this.name = "JiraConfigError";
  }
}

export class JiraPolicyError extends JiraReaderError {
  constructor(message: string) {
    super(message, "POLICY_ERROR");
    this.name = "JiraPolicyError";
  }
}

export class JiraRequestError extends JiraReaderError {
  constructor(message: string, status?: number) {
    super(message, "JIRA_REQUEST_ERROR", status);
    this.name = "JiraRequestError";
  }
}

export function toJiraReaderError(error: unknown): JiraReaderError {
  if (error instanceof JiraReaderError) {
    return error;
  }

  if (error instanceof Error) {
    return new JiraRequestError(error.message);
  }

  return new JiraRequestError("Jira request failed");
}
