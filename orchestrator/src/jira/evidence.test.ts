import { describe, expect, it } from 'vitest';

import type {
  JiraAttachmentContent,
  JiraComment,
  JiraField,
  JiraIssue,
  JiraIssueRelations,
  JiraProjectMetadata,
  JiraTransition
} from '../../../mcp-servers/jira-reader/src/index.js';
import { buildJiraContextPackV1, buildJiraEvidencePackV2 } from './index.js';

describe('JiraEvidencePackV2', () => {
  it('builds evidence pack v2 from one issue with stable generatedAt', () => {
    const issue = buildIssueFixture();
    const comments: readonly JiraComment[] = [
      {
        id: '9001',
        body: 'Need align spacing with legacy portal.',
        author: { displayName: 'Alice' },
        created: '2026-05-12T08:00:00.000Z',
        updated: '2026-05-12T08:05:00.000Z'
      }
    ];
    const fields: readonly JiraField[] = [
      {
        id: 'customfield_10126',
        name: 'Product Module',
        custom: true,
        clauseNames: ['cf[10126]'],
        schema: { type: 'string', system: 'custom' }
      }
    ];
    const projectMetadata: JiraProjectMetadata = {
      project: { key: 'OPS', name: 'Operations' },
      components: [{ id: '1', name: 'Portal', description: 'Portal app' }],
      versions: [{ id: '2', name: 'v1.2.3', released: false, archived: false }],
      statuses: [
        {
          id: '3',
          name: 'Default',
          issueTypes: [
            {
              id: '4',
              name: 'Bug',
              statuses: [{ id: '5', name: 'To Do', statusCategory: 'new' }]
            }
          ]
        }
      ]
    };
    const relations: JiraIssueRelations = {
      issueKey: 'OPS-1',
      parent: { key: 'OPS-0', summary: 'Parent story', status: 'In Progress' },
      subtasks: [{ key: 'OPS-2', summary: 'Subtask A', status: 'To Do' }],
      issueLinks: [
        {
          id: '100',
          type: 'Blocks',
          direction: 'outward',
          description: 'blocks',
          issue: { key: 'OPS-3', summary: 'Linked issue', status: 'To Do' }
        }
      ],
      remoteLinks: [
        {
          id: 200,
          globalId: 'gitlab:ops/app!123',
          title: 'MR 123',
          url: 'https://gitlab.example.com/ops/app/-/merge_requests/123',
          relationship: 'implements'
        }
      ]
    };
    const transitions: readonly JiraTransition[] = [
      { id: '11', name: 'Start Progress', to: 'In Progress' },
      { id: '11', name: 'Start Progress', to: 'In Progress' }
    ];
    const attachmentContent: JiraAttachmentContent = {
      attachment: issue.attachments[0]!,
      mimeType: 'image/png',
      byteLength: 4096,
      base64: 'ZmFrZS1iYXNlNjQ=',
      truncated: false
    };

    const pack = buildJiraEvidencePackV2({
      issue,
      comments,
      fields,
      projectMetadata,
      relations,
      transitions,
      mediaAttachmentContents: [attachmentContent],
      attachmentDigestsById: {
        '12345': 'sha256:abc123'
      },
      generatedAt: '2026-05-19T00:00:00.000Z'
    });

    expect(pack.schemaVersion).toBe('JiraEvidencePackV2');
    expect(pack.generatedAt).toBe('2026-05-19T00:00:00.000Z');
    expect(pack.issue.key).toBe('OPS-1');
    expect(pack.fields).toHaveLength(1);
    expect(pack.fieldValues).toHaveLength(10);
    expect(pack.comments).toHaveLength(1);
    expect(pack.attachments).toHaveLength(1);
    expect(pack.mediaEvidence).toHaveLength(1);
    expect(pack.projectMetadata).not.toBeNull();
    expect(pack.relations).toHaveLength(4);
    expect(pack.transitions).toHaveLength(2);
  });

  it('ensures every evidence item has sourceRef and sourceRefs are deduplicated', () => {
    const issue = buildIssueFixture();
    const pack = buildJiraEvidencePackV2({
      issue,
      comments: [{ id: '1', body: 'c', author: { name: 'u' }, created: '', updated: '' }],
      fields: [{ id: 'summary', name: 'Summary', custom: false, clauseNames: [] }],
      projectMetadata: {
        project: { key: 'OPS', name: 'Operations' },
        components: [],
        versions: [],
        statuses: []
      },
      relations: {
        issueKey: 'OPS-1',
        parent: { key: 'OPS-0', summary: 'parent', status: 'To Do' },
        subtasks: [],
        issueLinks: [],
        remoteLinks: []
      },
      transitions: [{ id: '11', name: 'Start Progress', to: 'In Progress' }],
      generatedAt: '2026-05-19T00:00:00.000Z'
    });

    expect(pack.issue.sourceRef.length).toBeGreaterThan(0);
    expect(pack.fields.every((field) => field.sourceRef.length > 0)).toBe(true);
    expect(pack.fieldValues.every((fieldValue) => fieldValue.sourceRef.length > 0)).toBe(true);
    expect(pack.comments.every((comment) => comment.sourceRef.length > 0)).toBe(true);
    expect(pack.attachments.every((attachment) => attachment.sourceRef.length > 0)).toBe(true);
    expect(pack.mediaEvidence.every((media) => media.sourceRef.length > 0)).toBe(true);
    expect(pack.projectMetadata?.sourceRef.length).toBeGreaterThan(0);
    expect(pack.relations.every((relation) => relation.sourceRef.length > 0)).toBe(true);
    expect(pack.transitions.every((transition) => transition.sourceRef.length > 0)).toBe(true);

    const uniqueSourceRefs = new Set(pack.sourceRefs);
    expect(uniqueSourceRefs.size).toBe(pack.sourceRefs.length);
    expect(pack.sourceRefs).toContain(pack.issue.sourceRef);
    expect(pack.sourceRefs).toContain(pack.fields[0]!.sourceRef);
    expect(pack.sourceRefs).toContain(pack.fieldValues[0]!.sourceRef);
    expect(pack.sourceRefs).toContain(pack.comments[0]!.sourceRef);
    expect(pack.sourceRefs).toContain(pack.attachments[0]!.sourceRef);
    expect(pack.sourceRefs).toContain(pack.projectMetadata!.sourceRef);
    expect(pack.sourceRefs).toContain(pack.relations[0]!.sourceRef);
    expect(pack.sourceRefs).toContain(pack.transitions[0]!.sourceRef);
  });

  it('keeps attachments and media evidence metadata-only without base64/body content', () => {
    const issue = buildIssueFixture();
    const content: JiraAttachmentContent = {
      attachment: issue.attachments[0]!,
      mimeType: 'image/png',
      byteLength: 128,
      base64: 'c2VjcmV0',
      truncated: true
    };
    const pack = buildJiraEvidencePackV2({
      issue,
      mediaAttachmentContents: [content],
      generatedAt: '2026-05-19T00:00:00.000Z'
    });
    const encoded = JSON.stringify(pack);

    expect(encoded).not.toContain('c2VjcmV0');
    expect(encoded).not.toContain('base64');
    expect(encoded).not.toContain('contentUrl');
    expect(pack.mediaEvidence[0]).toMatchObject({
      attachmentId: '12345',
      filename: 'login-page.png',
      mimeType: 'image/png',
      byteLength: 128,
      truncated: true
    });
  });

  it('builds valid pack when optional metadata, relations and transitions are missing', () => {
    const pack = buildJiraEvidencePackV2({
      issue: {
        key: 'OPS-9',
        summary: 'Only issue context',
        labels: [],
        attachments: []
      },
      generatedAt: '2026-05-19T00:00:00.000Z'
    });

    expect(pack.projectMetadata).toBeNull();
    expect(pack.relations).toEqual([]);
    expect(pack.transitions).toEqual([]);
    expect(pack.fieldValues).toEqual([]);
    expect(pack.sourceRefs).toEqual(['jira.issue:OPS-9']);
    expect(pack.schemaVersion).toBe('JiraEvidencePackV2');
  });

  it('captures required Jira business field values with stable sourceRef', () => {
    const issue = buildIssueFixture();
    const pack = buildJiraEvidencePackV2({
      issue,
      generatedAt: '2026-05-19T00:00:00.000Z'
    });
    const valueByKey = new Map(pack.fieldValues.map((value) => [value.fieldKey, value]));
    const expectedKeys = [
      'affectedVersions',
      'fixVersions',
      'targetVersion',
      'productModule',
      'defectCategory',
      'issueCategory',
      'projectSource',
      'coreRecovery',
      'requirementReleased',
      'timeTracking'
    ];

    expect(pack.fieldValues.map((value) => value.fieldKey)).toEqual(expectedKeys);
    expect(valueByKey.get('affectedVersions')).toMatchObject({
      valueKind: 'string_list',
      valueStrings: ['2026.Q2', '2026.Q3'],
      sourceRef: 'jira.field-value:OPS-1:affectedVersions'
    });
    expect(valueByKey.get('fixVersions')).toMatchObject({
      valueKind: 'string_list',
      valueStrings: ['v1.2.3'],
      sourceRef: 'jira.field-value:OPS-1:fixVersions'
    });
    expect(valueByKey.get('targetVersion')).toMatchObject({
      valueKind: 'string',
      valueString: '2026.06',
      sourceRef: 'jira.field-value:OPS-1:targetVersion'
    });
    expect(valueByKey.get('productModule')).toMatchObject({
      valueKind: 'string',
      valueString: 'portal-login',
      sourceRef: 'jira.field-value:OPS-1:productModule'
    });
    expect(valueByKey.get('defectCategory')).toMatchObject({
      valueKind: 'string',
      valueString: 'ui-style',
      sourceRef: 'jira.field-value:OPS-1:defectCategory'
    });
    expect(valueByKey.get('issueCategory')).toMatchObject({
      valueKind: 'string',
      valueString: 'visual-regression',
      sourceRef: 'jira.field-value:OPS-1:issueCategory'
    });
    expect(valueByKey.get('projectSource')).toMatchObject({
      valueKind: 'string',
      valueString: 'legacy-portal',
      sourceRef: 'jira.field-value:OPS-1:projectSource'
    });
    expect(valueByKey.get('coreRecovery')).toMatchObject({
      valueKind: 'string',
      valueString: 'no',
      sourceRef: 'jira.field-value:OPS-1:coreRecovery'
    });
    expect(valueByKey.get('requirementReleased')).toMatchObject({
      valueKind: 'string',
      valueString: 'yes',
      sourceRef: 'jira.field-value:OPS-1:requirementReleased'
    });
    expect(valueByKey.get('timeTracking')).toMatchObject({
      valueKind: 'time_tracking',
      valueTimeTracking: {
        originalEstimateSeconds: 3600,
        remainingEstimateSeconds: 1200,
        timeSpentSeconds: 2400
      },
      sourceRef: 'jira.field-value:OPS-1:timeTracking'
    });

    const uniqueSourceRefs = new Set(pack.sourceRefs);
    expect(uniqueSourceRefs.size).toBe(pack.sourceRefs.length);
    for (const value of pack.fieldValues) {
      expect(pack.sourceRefs).toContain(value.sourceRef);
    }
  });

  it('does not generate empty field value evidence for missing Jira business fields', () => {
    const pack = buildJiraEvidencePackV2({
      issue: {
        key: 'OPS-10',
        summary: 'Sparse issue',
        labels: [],
        attachments: [],
        affectedVersions: [],
        fixVersions: [],
        targetVersion: '',
        productModule: '   ',
        defectCategory: '',
        issueCategory: '',
        projectSource: '',
        coreRecovery: '',
        requirementReleased: '',
        timeTracking: {}
      },
      generatedAt: '2026-05-19T00:00:00.000Z'
    });

    expect(pack.fieldValues).toEqual([]);
    expect(pack.sourceRefs).toEqual(['jira.issue:OPS-10']);
  });

  it('supports barrel exports for context and evidence builders', () => {
    const issue = buildIssueFixture();
    const contextPack = buildJiraContextPackV1(issue, []);
    const evidencePack = buildJiraEvidencePackV2({
      issue,
      generatedAt: '2026-05-19T00:00:00.000Z'
    });

    expect(contextPack.issueKey.value).toBe('OPS-1');
    expect(evidencePack.schemaVersion).toBe('JiraEvidencePackV2');
  });

  it('derives fields from issueDetails names when fields input is absent', () => {
    const issue = buildIssueFixture();
    const pack = buildJiraEvidencePackV2({
      issue,
      issueDetails: {
        issue,
        names: {
          customfield_10126: 'Product Module',
          summary: 'Summary'
        }
      },
      generatedAt: '2026-05-19T00:00:00.000Z'
    });

    expect(pack.fields).toHaveLength(2);
    expect(pack.fields[0]).toMatchObject({
      id: 'customfield_10126',
      name: 'Product Module',
      custom: true
    });
    expect(pack.fields[1]).toMatchObject({
      id: 'summary',
      name: 'Summary',
      custom: false
    });
  });
});

function buildIssueFixture(): JiraIssue {
  return {
    key: 'OPS-1',
    summary: 'Fix login page style mismatch',
    description: 'Compare with old portal and fix widths.',
    issueType: 'Bug',
    status: 'To Do',
    priority: 'High',
    assignee: { displayName: 'Tom' },
    labels: ['frontend', 'login'],
    project: { key: 'OPS', name: 'Operations' },
    created: '2026-05-10T00:00:00.000Z',
    updated: '2026-05-12T00:00:00.000Z',
    dueDate: '2026-05-20',
    affectedVersions: ['2026.Q2', '2026.Q3'],
    fixVersions: ['v1.2.3'],
    targetVersion: '2026.06',
    productModule: 'portal-login',
    defectCategory: 'ui-style',
    issueCategory: 'visual-regression',
    projectSource: 'legacy-portal',
    coreRecovery: 'no',
    requirementReleased: 'yes',
    timeTracking: {
      originalEstimateSeconds: 3600,
      remainingEstimateSeconds: 1200,
      timeSpentSeconds: 2400
    },
    attachments: [
      {
        id: '12345',
        filename: 'login-page.png',
        mimeType: 'image/png',
        size: 24576,
        contentUrl: 'https://jira.example.com/secure/attachment/12345/login-page.png'
      }
    ]
  };
}
