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
  readonly thumbnailUrl?: string;
  readonly created?: string;
  readonly author?: JiraUser;
}

export interface JiraTimeTracking {
  readonly originalEstimateSeconds?: number;
  readonly remainingEstimateSeconds?: number;
  readonly timeSpentSeconds?: number;
}

export interface JiraIssue {
  readonly key: string;
  readonly summary: string;
  readonly description?: string;
  readonly issueType?: string;
  readonly status?: string;
  readonly assignee?: JiraUser;
  readonly priority?: string;
  readonly labels: readonly string[];
  readonly project?: JiraProject;
  readonly affectedVersions?: readonly string[];
  readonly fixVersions?: readonly string[];
  readonly created?: string;
  readonly updated?: string;
  readonly dueDate?: string;
  readonly targetVersion?: string;
  readonly productModule?: string;
  readonly defectCategory?: string;
  readonly issueCategory?: string;
  readonly projectSource?: string;
  readonly coreRecovery?: string;
  readonly requirementReleased?: string;
  readonly timeTracking?: JiraTimeTracking;
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

export interface JiraServerInfo {
  readonly baseUrl?: string;
  readonly version?: string;
  readonly versionNumbers: readonly number[];
  readonly deploymentType?: string;
  readonly buildNumber?: number;
  readonly buildDate?: string;
  readonly serverTitle?: string;
}

export interface JiraAttachmentMeta {
  readonly enabled: boolean;
  readonly uploadLimit?: number;
}

export interface JiraFieldSchema {
  readonly type?: string;
  readonly items?: string;
  readonly system?: string;
  readonly custom?: string;
  readonly customId?: number;
}

export interface JiraField {
  readonly id: string;
  readonly name: string;
  readonly custom: boolean;
  readonly orderable?: boolean;
  readonly navigable?: boolean;
  readonly searchable?: boolean;
  readonly clauseNames: readonly string[];
  readonly schema?: JiraFieldSchema;
}

export interface JiraIssueDetails {
  readonly issue: JiraIssue;
  readonly names?: Record<string, string>;
  readonly schema?: Record<string, unknown>;
  readonly renderedFields?: Record<string, unknown>;
  readonly changelog?: Record<string, unknown>;
}

export interface JiraAttachmentContent {
  readonly attachment: JiraAttachment;
  readonly mimeType: string;
  readonly byteLength: number;
  readonly base64: string;
  readonly truncated: boolean;
}

export interface JiraProjectComponent {
  readonly id?: string;
  readonly name?: string;
  readonly description?: string;
}

export interface JiraProjectVersion {
  readonly id?: string;
  readonly name?: string;
  readonly released?: boolean;
  readonly archived?: boolean;
  readonly releaseDate?: string;
}

export interface JiraProjectStatus {
  readonly id?: string;
  readonly name?: string;
  readonly issueTypes: readonly {
    readonly id?: string;
    readonly name?: string;
    readonly statuses: readonly {
      readonly id?: string;
      readonly name?: string;
      readonly statusCategory?: string;
    }[];
  }[];
}

export interface JiraProjectMetadata {
  readonly project: JiraProject;
  readonly components: readonly JiraProjectComponent[];
  readonly versions: readonly JiraProjectVersion[];
  readonly statuses: readonly JiraProjectStatus[];
}

export interface JiraIssueRef {
  readonly key?: string;
  readonly summary?: string;
  readonly status?: string;
}

export interface JiraIssueLink {
  readonly id?: string;
  readonly type?: string;
  readonly direction?: "inward" | "outward";
  readonly description?: string;
  readonly issue?: JiraIssueRef;
}

export interface JiraRemoteLink {
  readonly id?: number;
  readonly globalId?: string;
  readonly title?: string;
  readonly url?: string;
  readonly relationship?: string;
}

export interface JiraIssueRelations {
  readonly issueKey: string;
  readonly parent?: JiraIssueRef;
  readonly subtasks: readonly JiraIssueRef[];
  readonly issueLinks: readonly JiraIssueLink[];
  readonly remoteLinks: readonly JiraRemoteLink[];
}

export interface JiraTransition {
  readonly id: string;
  readonly name: string;
  readonly to?: string;
}
