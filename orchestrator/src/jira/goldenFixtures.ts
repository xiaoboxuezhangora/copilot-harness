import type { JiraContextPackV1 } from './context.js';

export interface JiraGoldenFixture {
  readonly name: string;
  readonly contextPack: JiraContextPackV1;
  readonly expectedSnapshot: string;
}

export const jiraGoldenFixtures: readonly JiraGoldenFixture[] = [
  {
    name: 'informative',
    contextPack: {
      issueKey: { value: 'OPS-1', sourceRef: 'issue.key:OPS-1' },
      summary: { value: 'Add approval reminder', sourceRef: 'issue.summary:OPS-1' },
      description: {
        value: 'Need a reminder when approval is pending.',
        sourceRef: 'issue.description:OPS-1'
      },
      status: { value: 'Open', sourceRef: 'issue.status:OPS-1' },
      priority: { value: 'High', sourceRef: 'issue.priority:OPS-1' },
      assignee: { value: 'Bob', sourceRef: 'issue.assignee:OPS-1' },
      labels: { value: 'workflow, api', sourceRef: 'issue.labels:OPS-1' },
      project: { value: 'OPS', sourceRef: 'issue.project:OPS-1' },
      comments: [],
      attachments: []
    },
    expectedSnapshot:
      '{"promptVersion":"jira-analysis-prompt@0.1","issueKey":"OPS-1","summary":"Add approval reminder","description":"Need a reminder when approval is pending.","status":"Open","priority":"High","assignee":"Bob","labels":"workflow, api","project":"OPS","comments":[],"attachments":[]}'
  },
  {
    name: 'ambiguous',
    contextPack: {
      issueKey: { value: 'OPS-2', sourceRef: 'issue.key:OPS-2' },
      summary: { value: 'Fix it', sourceRef: 'issue.summary:OPS-2' },
      description: { value: 'User says it is broken.', sourceRef: 'issue.description:OPS-2' },
      status: { value: 'Open', sourceRef: 'issue.status:OPS-2' },
      priority: { value: 'Medium', sourceRef: 'issue.priority:OPS-2' },
      assignee: { value: '', sourceRef: 'issue.assignee:OPS-2' },
      labels: { value: 'bug', sourceRef: 'issue.labels:OPS-2' },
      project: { value: 'OPS', sourceRef: 'issue.project:OPS-2' },
      comments: [],
      attachments: []
    },
    expectedSnapshot:
      '{"promptVersion":"jira-analysis-prompt@0.1","issueKey":"OPS-2","summary":"Fix it","description":"User says it is broken.","status":"Open","priority":"Medium","assignee":"","labels":"bug","project":"OPS","comments":[],"attachments":[]}'
  },
  {
    name: 'attachments',
    contextPack: {
      issueKey: { value: 'OPS-3', sourceRef: 'issue.key:OPS-3' },
      summary: { value: 'Upload evidence', sourceRef: 'issue.summary:OPS-3' },
      description: {
        value: 'See attached file for context.',
        sourceRef: 'issue.description:OPS-3'
      },
      status: { value: 'Open', sourceRef: 'issue.status:OPS-3' },
      priority: { value: 'Low', sourceRef: 'issue.priority:OPS-3' },
      assignee: { value: 'Alice', sourceRef: 'issue.assignee:OPS-3' },
      labels: { value: 'docs', sourceRef: 'issue.labels:OPS-3' },
      project: { value: 'OPS', sourceRef: 'issue.project:OPS-3' },
      comments: [],
      attachments: [
        {
          filename: 'spec.pdf',
          mimeType: 'application/pdf',
          size: 4096,
          sourceRef: 'attachment:OPS-3:1001'
        }
      ]
    },
    expectedSnapshot:
      '{"promptVersion":"jira-analysis-prompt@0.1","issueKey":"OPS-3","summary":"Upload evidence","description":"See attached file for context.","status":"Open","priority":"Low","assignee":"Alice","labels":"docs","project":"OPS","comments":[],"attachments":[{"filename":"spec.pdf","mimeType":"application/pdf","size":4096,"sourceRef":"attachment:OPS-3:1001"}]}'
  },
  {
    name: 'comments-and-cross-module',
    contextPack: {
      issueKey: { value: 'OPS-4', sourceRef: 'issue.key:OPS-4' },
      summary: { value: 'Cross-module alert path', sourceRef: 'issue.summary:OPS-4' },
      description: { value: 'Touches API and UI flow.', sourceRef: 'issue.description:OPS-4' },
      status: { value: 'In Progress', sourceRef: 'issue.status:OPS-4' },
      priority: { value: 'High', sourceRef: 'issue.priority:OPS-4' },
      assignee: { value: 'Carol', sourceRef: 'issue.assignee:OPS-4' },
      labels: { value: 'api, ui', sourceRef: 'issue.labels:OPS-4' },
      project: { value: 'OPS', sourceRef: 'issue.project:OPS-4' },
      comments: [
        {
          id: 'c1',
          body: 'Need verification on mobile and API response.',
          author: { value: 'Reviewer', sourceRef: 'comment.author:c1' },
          created: { value: '2026-04-28T00:00:00.000Z', sourceRef: 'comment.created:c1' },
          updated: { value: '2026-04-28T00:00:00.000Z', sourceRef: 'comment.updated:c1' },
          sourceRef: 'comment:c1'
        }
      ],
      attachments: []
    },
    expectedSnapshot:
      '{"promptVersion":"jira-analysis-prompt@0.1","issueKey":"OPS-4","summary":"Cross-module alert path","description":"Touches API and UI flow.","status":"In Progress","priority":"High","assignee":"Carol","labels":"api, ui","project":"OPS","comments":[{"id":"c1","body":"Need verification on mobile and API response.","author":"Reviewer","created":"2026-04-28T00:00:00.000Z","updated":"2026-04-28T00:00:00.000Z","sourceRef":"comment:c1"}],"attachments":[]}'
  }
] as const;
