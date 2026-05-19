import type {
  JiraAttachment,
  JiraAttachmentContent,
  JiraComment,
  JiraField,
  JiraIssue,
  JiraIssueLink,
  JiraIssueRef,
  JiraIssueDetails,
  JiraIssueRelations,
  JiraProjectMetadata,
  JiraRemoteLink,
  JiraTransition
} from '../../../mcp-servers/jira-reader/src/index.js';

export interface JiraEvidenceIssueV2 {
  readonly key: string;
  readonly summary: string;
  readonly description: string;
  readonly issueType: string;
  readonly status: string;
  readonly priority: string;
  readonly assignee: string;
  readonly labels: readonly string[];
  readonly projectKey: string;
  readonly projectName: string;
  readonly created: string;
  readonly updated: string;
  readonly dueDate: string;
  readonly sourceRef: string;
}

export interface JiraEvidenceFieldV2 {
  readonly id: string;
  readonly name: string;
  readonly custom: boolean;
  readonly clauseNames: readonly string[];
  readonly schemaType: string;
  readonly schemaSystem: string;
  readonly sourceRef: string;
}

export type JiraEvidenceFieldValueKeyV2 =
  | 'affectedVersions'
  | 'fixVersions'
  | 'targetVersion'
  | 'productModule'
  | 'defectCategory'
  | 'issueCategory'
  | 'projectSource'
  | 'coreRecovery'
  | 'requirementReleased'
  | 'timeTracking';

export type JiraEvidenceFieldValueKindV2 = 'string' | 'string_list' | 'time_tracking';

export interface JiraEvidenceTimeTrackingValueV2 {
  readonly originalEstimateSeconds?: number;
  readonly remainingEstimateSeconds?: number;
  readonly timeSpentSeconds?: number;
}

export interface JiraEvidenceFieldValueV2 {
  readonly fieldKey: JiraEvidenceFieldValueKeyV2;
  readonly valueKind: JiraEvidenceFieldValueKindV2;
  readonly valueString?: string;
  readonly valueStrings?: readonly string[];
  readonly valueTimeTracking?: JiraEvidenceTimeTrackingValueV2;
  readonly sourceRef: string;
}

export interface JiraEvidenceCommentV2 {
  readonly id: string;
  readonly body: string;
  readonly author: string;
  readonly created: string;
  readonly updated: string;
  readonly sourceRef: string;
}

export interface JiraEvidenceAttachmentV2 {
  readonly id: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly size: number | null;
  readonly sourceRef: string;
  readonly securityDigest: string | null;
}

export interface JiraMediaEvidenceV2 {
  readonly attachmentId: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly byteLength: number;
  readonly truncated: boolean;
  readonly sourceRef: string;
}

export interface JiraProjectMetadataV2 {
  readonly projectKey: string;
  readonly projectName: string;
  readonly components: readonly {
    readonly id: string;
    readonly name: string;
    readonly description: string;
  }[];
  readonly versions: readonly {
    readonly id: string;
    readonly name: string;
    readonly released: boolean | null;
    readonly archived: boolean | null;
    readonly releaseDate: string;
  }[];
  readonly statuses: readonly {
    readonly id: string;
    readonly name: string;
    readonly issueTypes: readonly {
      readonly id: string;
      readonly name: string;
      readonly statuses: readonly {
        readonly id: string;
        readonly name: string;
        readonly statusCategory: string;
      }[];
    }[];
  }[];
  readonly sourceRef: string;
}

export type JiraRelationTypeV2 = 'parent' | 'subtask' | 'issueLink' | 'remoteLink';

export interface JiraIssueRelationV2 {
  readonly relationType: JiraRelationTypeV2;
  readonly relationKey: string;
  readonly summary: string;
  readonly status: string;
  readonly direction: 'inward' | 'outward' | 'none';
  readonly linkType: string;
  readonly relationship: string;
  readonly url: string;
  readonly sourceRef: string;
}

export interface JiraTransitionEvidenceV2 {
  readonly id: string;
  readonly name: string;
  readonly to: string;
  readonly sourceRef: string;
}

export interface JiraEvidencePackV2 {
  readonly schemaVersion: 'JiraEvidencePackV2';
  readonly issue: JiraEvidenceIssueV2;
  readonly fields: readonly JiraEvidenceFieldV2[];
  readonly fieldValues: readonly JiraEvidenceFieldValueV2[];
  readonly comments: readonly JiraEvidenceCommentV2[];
  readonly attachments: readonly JiraEvidenceAttachmentV2[];
  readonly mediaEvidence: readonly JiraMediaEvidenceV2[];
  readonly projectMetadata: JiraProjectMetadataV2 | null;
  readonly relations: readonly JiraIssueRelationV2[];
  readonly transitions: readonly JiraTransitionEvidenceV2[];
  readonly sourceRefs: readonly string[];
  readonly generatedAt: string;
}

export interface BuildJiraEvidencePackV2Input {
  readonly issue: JiraIssue;
  readonly comments?: readonly JiraComment[] | undefined;
  readonly fields?: readonly JiraField[] | undefined;
  readonly issueDetails?: JiraIssueDetails | null | undefined;
  readonly attachments?: readonly JiraAttachment[] | undefined;
  readonly attachmentDigestsById?: Readonly<Record<string, string>> | undefined;
  readonly mediaAttachmentContents?: readonly JiraAttachmentContent[] | undefined;
  readonly projectMetadata?: JiraProjectMetadata | null | undefined;
  readonly relations?: JiraIssueRelations | null | undefined;
  readonly transitions?: readonly JiraTransition[] | undefined;
  readonly generatedAt?: string | undefined;
}

export function buildJiraEvidencePackV2(input: BuildJiraEvidencePackV2Input): JiraEvidencePackV2 {
  const issueRef = sourceRefForIssue(input.issue.key);
  const issue = buildIssueEvidence(input.issue, issueRef);
  const fields = buildFieldEvidence(input.issue.key, input.fields, input.issueDetails);
  const fieldValues = buildFieldValueEvidence(input.issue);
  const comments = buildCommentEvidence(input.issue.key, input.comments ?? []);
  const attachments = buildAttachmentEvidence(
    input.issue.key,
    input.attachments ?? input.issue.attachments,
    input.attachmentDigestsById
  );
  const mediaEvidence = buildMediaEvidence(input.issue.key, input.mediaAttachmentContents ?? []);
  const projectMetadata = buildProjectMetadataEvidence(input.projectMetadata);
  const relations = buildRelationsEvidence(input.issue.key, input.relations);
  const transitions = buildTransitionEvidence(input.issue.key, input.transitions ?? []);

  const sourceRefSet = new Set<string>();
  addSourceRef(sourceRefSet, issue.sourceRef);
  addSourceRefArray(sourceRefSet, fields);
  addSourceRefArray(sourceRefSet, fieldValues);
  addSourceRefArray(sourceRefSet, comments);
  addSourceRefArray(sourceRefSet, attachments);
  addSourceRefArray(sourceRefSet, mediaEvidence);
  if (projectMetadata !== null) {
    addSourceRef(sourceRefSet, projectMetadata.sourceRef);
  }
  addSourceRefArray(sourceRefSet, relations);
  addSourceRefArray(sourceRefSet, transitions);

  return {
    schemaVersion: 'JiraEvidencePackV2',
    issue,
    fields,
    fieldValues,
    comments,
    attachments,
    mediaEvidence,
    projectMetadata,
    relations,
    transitions,
    sourceRefs: [...sourceRefSet],
    generatedAt: input.generatedAt ?? new Date().toISOString()
  };
}

function buildIssueEvidence(issue: JiraIssue, sourceRef: string): JiraEvidenceIssueV2 {
  return {
    key: issue.key,
    summary: issue.summary,
    description: issue.description ?? '',
    issueType: issue.issueType ?? '',
    status: issue.status ?? '',
    priority: issue.priority ?? '',
    assignee: issue.assignee?.displayName ?? issue.assignee?.name ?? '',
    labels: [...issue.labels],
    projectKey: issue.project?.key ?? '',
    projectName: issue.project?.name ?? '',
    created: issue.created ?? '',
    updated: issue.updated ?? '',
    dueDate: issue.dueDate ?? '',
    sourceRef
  };
}

function buildFieldEvidence(
  issueKey: string,
  fields: readonly JiraField[] | undefined,
  issueDetails: JiraIssueDetails | null | undefined
): readonly JiraEvidenceFieldV2[] {
  if (fields !== undefined && fields.length > 0) {
    return fields.map((field) => ({
      id: field.id,
      name: field.name,
      custom: field.custom,
      clauseNames: [...field.clauseNames],
      schemaType: field.schema?.type ?? '',
      schemaSystem: field.schema?.system ?? '',
      sourceRef: sourceRefForField(issueKey, field.id)
    }));
  }

  const names = issueDetails?.names;
  if (names === undefined) {
    return [];
  }

  return Object.entries(names)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, name]) => ({
      id,
      name,
      custom: id.startsWith('customfield_'),
      clauseNames: [],
      schemaType: '',
      schemaSystem: '',
      sourceRef: sourceRefForIssueDetailField(issueKey, id)
    }));
}

function buildFieldValueEvidence(issue: JiraIssue): readonly JiraEvidenceFieldValueV2[] {
  const values: JiraEvidenceFieldValueV2[] = [];

  if (issue.affectedVersions !== undefined && issue.affectedVersions.length > 0) {
    values.push({
      fieldKey: 'affectedVersions',
      valueKind: 'string_list',
      valueStrings: [...issue.affectedVersions],
      sourceRef: sourceRefForFieldValue(issue.key, 'affectedVersions')
    });
  }

  if (issue.fixVersions !== undefined && issue.fixVersions.length > 0) {
    values.push({
      fieldKey: 'fixVersions',
      valueKind: 'string_list',
      valueStrings: [...issue.fixVersions],
      sourceRef: sourceRefForFieldValue(issue.key, 'fixVersions')
    });
  }

  addNonEmptyStringFieldValue(values, issue.key, 'targetVersion', issue.targetVersion);
  addNonEmptyStringFieldValue(values, issue.key, 'productModule', issue.productModule);
  addNonEmptyStringFieldValue(values, issue.key, 'defectCategory', issue.defectCategory);
  addNonEmptyStringFieldValue(values, issue.key, 'issueCategory', issue.issueCategory);
  addNonEmptyStringFieldValue(values, issue.key, 'projectSource', issue.projectSource);
  addNonEmptyStringFieldValue(values, issue.key, 'coreRecovery', issue.coreRecovery);
  addNonEmptyStringFieldValue(values, issue.key, 'requirementReleased', issue.requirementReleased);

  const timeTracking = issue.timeTracking;
  if (timeTracking !== undefined) {
    const trackingValue: JiraEvidenceTimeTrackingValueV2 = {
      ...(timeTracking.originalEstimateSeconds !== undefined
        ? { originalEstimateSeconds: timeTracking.originalEstimateSeconds }
        : {}),
      ...(timeTracking.remainingEstimateSeconds !== undefined
        ? { remainingEstimateSeconds: timeTracking.remainingEstimateSeconds }
        : {}),
      ...(timeTracking.timeSpentSeconds !== undefined
        ? { timeSpentSeconds: timeTracking.timeSpentSeconds }
        : {})
    };
    if (Object.keys(trackingValue).length > 0) {
      values.push({
        fieldKey: 'timeTracking',
        valueKind: 'time_tracking',
        valueTimeTracking: trackingValue,
        sourceRef: sourceRefForFieldValue(issue.key, 'timeTracking')
      });
    }
  }

  return values;
}

function addNonEmptyStringFieldValue(
  values: JiraEvidenceFieldValueV2[],
  issueKey: string,
  fieldKey: Exclude<JiraEvidenceFieldValueKeyV2, 'affectedVersions' | 'fixVersions' | 'timeTracking'>,
  value: string | undefined
): void {
  if (value === undefined || value.trim().length === 0) {
    return;
  }

  values.push({
    fieldKey,
    valueKind: 'string',
    valueString: value,
    sourceRef: sourceRefForFieldValue(issueKey, fieldKey)
  });
}

function buildCommentEvidence(
  issueKey: string,
  comments: readonly JiraComment[]
): readonly JiraEvidenceCommentV2[] {
  return comments.map((comment) => ({
    id: comment.id,
    body: comment.body,
    author: comment.author?.displayName ?? comment.author?.name ?? '',
    created: comment.created ?? '',
    updated: comment.updated ?? '',
    sourceRef: sourceRefForComment(issueKey, comment.id)
  }));
}

function buildAttachmentEvidence(
  issueKey: string,
  attachments: readonly JiraAttachment[],
  attachmentDigestsById: Readonly<Record<string, string>> | undefined
): readonly JiraEvidenceAttachmentV2[] {
  return attachments.map((attachment) => ({
    id: attachment.id,
    filename: attachment.filename,
    mimeType: attachment.mimeType ?? '',
    size: attachment.size ?? null,
    sourceRef: sourceRefForAttachment(issueKey, attachment.id),
    securityDigest: attachmentDigestsById?.[attachment.id] ?? null
  }));
}

function buildMediaEvidence(
  issueKey: string,
  mediaAttachmentContents: readonly JiraAttachmentContent[]
): readonly JiraMediaEvidenceV2[] {
  return mediaAttachmentContents.map((content) => ({
    attachmentId: content.attachment.id,
    filename: content.attachment.filename,
    mimeType: content.mimeType,
    byteLength: content.byteLength,
    truncated: content.truncated,
    sourceRef: sourceRefForMediaEvidence(issueKey, content.attachment.id)
  }));
}

function buildProjectMetadataEvidence(
  metadata: JiraProjectMetadata | null | undefined
): JiraProjectMetadataV2 | null {
  if (metadata === null || metadata === undefined) {
    return null;
  }

  return {
    projectKey: metadata.project.key,
    projectName: metadata.project.name ?? '',
    components: metadata.components.map((component) => ({
      id: component.id ?? '',
      name: component.name ?? '',
      description: component.description ?? ''
    })),
    versions: metadata.versions.map((version) => ({
      id: version.id ?? '',
      name: version.name ?? '',
      released: version.released ?? null,
      archived: version.archived ?? null,
      releaseDate: version.releaseDate ?? ''
    })),
    statuses: metadata.statuses.map((status) => ({
      id: status.id ?? '',
      name: status.name ?? '',
      issueTypes: status.issueTypes.map((issueType) => ({
        id: issueType.id ?? '',
        name: issueType.name ?? '',
        statuses: issueType.statuses.map((item) => ({
          id: item.id ?? '',
          name: item.name ?? '',
          statusCategory: item.statusCategory ?? ''
        }))
      }))
    })),
    sourceRef: sourceRefForProjectMetadata(metadata.project.key)
  };
}

function buildRelationsEvidence(
  issueKey: string,
  relations: JiraIssueRelations | null | undefined
): readonly JiraIssueRelationV2[] {
  if (relations === null || relations === undefined) {
    return [];
  }

  const relationItems: JiraIssueRelationV2[] = [];
  if (relations.parent !== undefined) {
    relationItems.push(
      toIssueRefRelation('parent', issueKey, relations.parent, sourceRefForRelationParent(issueKey))
    );
  }

  relationItems.push(
    ...relations.subtasks.map((subtask, index) =>
      toIssueRefRelation(
        'subtask',
        issueKey,
        subtask,
        sourceRefForRelationSubtask(issueKey, subtask.key ?? `index-${index}`)
      )
    )
  );

  relationItems.push(
    ...relations.issueLinks.map((link, index) =>
      toIssueLinkRelation(
        issueKey,
        link,
        sourceRefForRelationIssueLink(issueKey, link.id ?? `index-${index}`)
      )
    )
  );

  relationItems.push(
    ...relations.remoteLinks.map((link, index) =>
      toRemoteLinkRelation(
        issueKey,
        link,
        sourceRefForRelationRemoteLink(
          issueKey,
          String(link.id ?? link.globalId ?? `index-${index}`)
        )
      )
    )
  );

  return relationItems;
}

function toIssueRefRelation(
  relationType: 'parent' | 'subtask',
  issueKey: string,
  issueRef: JiraIssueRef,
  sourceRef: string
): JiraIssueRelationV2 {
  const relationKey = issueRef.key ?? '';

  return {
    relationType,
    relationKey,
    summary: issueRef.summary ?? '',
    status: issueRef.status ?? '',
    direction: 'none',
    linkType: relationType,
    relationship: `issue:${issueKey}:${relationType}`,
    url: '',
    sourceRef
  };
}

function toIssueLinkRelation(
  issueKey: string,
  link: JiraIssueLink,
  sourceRef: string
): JiraIssueRelationV2 {
  return {
    relationType: 'issueLink',
    relationKey: link.issue?.key ?? '',
    summary: link.issue?.summary ?? '',
    status: link.issue?.status ?? '',
    direction: link.direction ?? 'none',
    linkType: link.type ?? '',
    relationship: link.description ?? `issue:${issueKey}:issueLink`,
    url: '',
    sourceRef
  };
}

function toRemoteLinkRelation(
  issueKey: string,
  link: JiraRemoteLink,
  sourceRef: string
): JiraIssueRelationV2 {
  const relationKey = link.globalId ?? String(link.id ?? '');

  return {
    relationType: 'remoteLink',
    relationKey,
    summary: link.title ?? '',
    status: '',
    direction: 'none',
    linkType: 'remote',
    relationship: link.relationship ?? `issue:${issueKey}:remoteLink`,
    url: link.url ?? '',
    sourceRef
  };
}

function buildTransitionEvidence(
  issueKey: string,
  transitions: readonly JiraTransition[]
): readonly JiraTransitionEvidenceV2[] {
  return transitions.map((transition, index) => ({
    id: transition.id,
    name: transition.name,
    to: transition.to ?? '',
    sourceRef: sourceRefForTransition(issueKey, transition.id, index)
  }));
}

function addSourceRefArray(
  sourceRefSet: Set<string>,
  items: readonly {
    readonly sourceRef: string;
  }[]
): void {
  for (const item of items) {
    addSourceRef(sourceRefSet, item.sourceRef);
  }
}

function addSourceRef(sourceRefSet: Set<string>, sourceRef: string): void {
  if (sourceRef.trim().length > 0) {
    sourceRefSet.add(sourceRef);
  }
}

function sourceRefForIssue(issueKey: string): string {
  return `jira.issue:${issueKey}`;
}

function sourceRefForField(issueKey: string, fieldId: string): string {
  return `jira.field:${issueKey}:${fieldId}`;
}

function sourceRefForFieldValue(issueKey: string, fieldKey: JiraEvidenceFieldValueKeyV2): string {
  return `jira.field-value:${issueKey}:${fieldKey}`;
}

function sourceRefForIssueDetailField(issueKey: string, fieldId: string): string {
  return `jira.issue-details.field:${issueKey}:${fieldId}`;
}

function sourceRefForComment(issueKey: string, commentId: string): string {
  return `jira.comment:${issueKey}:${commentId}`;
}

function sourceRefForAttachment(issueKey: string, attachmentId: string): string {
  return `jira.attachment:${issueKey}:${attachmentId}`;
}

function sourceRefForMediaEvidence(issueKey: string, attachmentId: string): string {
  return `jira.media:${issueKey}:${attachmentId}`;
}

function sourceRefForProjectMetadata(projectKey: string): string {
  return `jira.project-metadata:${projectKey}`;
}

function sourceRefForRelationParent(issueKey: string): string {
  return `jira.relation.parent:${issueKey}`;
}

function sourceRefForRelationSubtask(issueKey: string, subtaskKey: string): string {
  return `jira.relation.subtask:${issueKey}:${subtaskKey}`;
}

function sourceRefForRelationIssueLink(issueKey: string, issueLinkId: string): string {
  return `jira.relation.issue-link:${issueKey}:${issueLinkId}`;
}

function sourceRefForRelationRemoteLink(issueKey: string, remoteLinkId: string): string {
  return `jira.relation.remote-link:${issueKey}:${remoteLinkId}`;
}

function sourceRefForTransition(issueKey: string, transitionId: string, index: number): string {
  return `jira.transition:${issueKey}:${transitionId}:${index}`;
}
