export interface JiraUser {
  readonly name?: string;
  readonly displayName?: string;
}

export interface JiraStatus {
  readonly name?: string;
}

export interface JiraPriority {
  readonly name?: string;
}

export interface JiraProject {
  readonly key: string;
  readonly name?: string;
}

export interface JiraAttachment {
  readonly id: string;
  readonly filename: string;
  readonly mimeType?: string;
  readonly size?: number;
  readonly contentUrl?: string;
  readonly created?: string;
}

export interface JiraIssue {
  readonly key: string;
  readonly summary: string;
  readonly description?: string;
  readonly status?: string;
  readonly assignee?: JiraUser;
  readonly priority?: string;
  readonly labels: readonly string[];
  readonly project?: JiraProject;
  readonly attachments: readonly JiraAttachment[];
}

export interface JiraComment {
  readonly id: string;
  readonly body: string;
  readonly author?: JiraUser;
  readonly created?: string;
  readonly updated?: string;
}

export interface JiraSearchResult {
  readonly startAt: number;
  readonly maxResults: number;
  readonly total: number;
  readonly issues: readonly JiraIssue[];
}
