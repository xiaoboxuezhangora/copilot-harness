import type {
  JiraGitLabStage1Output,
  JiraGitLabStage2Output,
  JiraContextPackV1
} from './context.js';

export interface MockGitLabEvidenceFixture {
  readonly name: string;
  readonly jiraContextPack: JiraContextPackV1;
  readonly gitlabEvidence: readonly MockGitLabEvidence[];
  readonly stage1Output: JiraGitLabStage1Output;
  readonly stage2Output: JiraGitLabStage2Output;
}

export interface MockGitLabEvidence {
  readonly source_ref: string;
  readonly project: string;
  readonly path: string;
  readonly ref: string;
  readonly commit: string;
  readonly start_line: number;
  readonly end_line: number;
  readonly content: string;
}

export const mockGitLabEvidenceFixtures: readonly MockGitLabEvidenceFixture[] = [
  {
    name: 'approval-reminder',
    jiraContextPack: {
      issueKey: { value: 'OPS-101', sourceRef: 'issue.key:OPS-101' },
      summary: { value: 'Add approval reminder', sourceRef: 'issue.summary:OPS-101' },
      description: {
        value: 'Need a reminder when approval remains pending for more than one day.',
        sourceRef: 'issue.description:OPS-101'
      },
      status: { value: 'Open', sourceRef: 'issue.status:OPS-101' },
      priority: { value: 'High', sourceRef: 'issue.priority:OPS-101' },
      assignee: { value: 'Reviewer', sourceRef: 'issue.assignee:OPS-101' },
      labels: { value: 'workflow, notification', sourceRef: 'issue.labels:OPS-101' },
      project: { value: 'OPS', sourceRef: 'issue.project:OPS-101' },
      comments: [],
      attachments: []
    },
    gitlabEvidence: [
      {
        source_ref: 'gitlab:ops/app#file:src/modules/approval/reminder.service.ts@abc123#L12-L28',
        project: 'ops/app',
        path: 'src/modules/approval/reminder.service.ts',
        ref: 'main',
        commit: 'abc123',
        start_line: 12,
        end_line: 28,
        content: 'export function buildApprovalReminder() { return "pending"; }'
      }
    ],
    stage1Output: {
      turn_state: 'done',
      jira_context_ref: 'OPS-101',
      gitlab_queries: [
        {
          intent: 'find_related_module',
          query: 'approval reminder pending notification',
          scope: 'code',
          rationale: 'summary and labels point to approval reminder notification module'
        }
      ],
      ambiguity: [],
      next_action: 'run_gitlab_queries'
    },
    stage2Output: {
      turn_state: 'done',
      jira_context_ref: 'OPS-101',
      gitlab_evidence: [
        {
          source_ref: 'gitlab:ops/app#file:src/modules/approval/reminder.service.ts@abc123#L12-L28',
          summary: 'Approval reminder logic exists in reminder service.'
        }
      ],
      repo_hints: [
        {
          project: 'ops/app',
          module: 'src/modules/approval',
          confidence: 0.86,
          source_refs: [
            'gitlab:ops/app#file:src/modules/approval/reminder.service.ts@abc123#L12-L28'
          ]
        }
      ],
      plan: {
        summary: 'Extend approval reminder timing and notification behavior.',
        steps: ['Locate reminder service', 'Add pending age condition', 'Update tests'],
        risks: ['Notification spam if schedule guard is missing'],
        test_hints: ['Unit test pending age threshold', 'Verify notification idempotency']
      },
      ambiguity: [],
      next_action: 'draft_plan'
    }
  },
  {
    name: 'ambiguous-module',
    jiraContextPack: {
      issueKey: { value: 'OPS-102', sourceRef: 'issue.key:OPS-102' },
      summary: { value: 'Fix broken page', sourceRef: 'issue.summary:OPS-102' },
      description: { value: 'User reports a broken page.', sourceRef: 'issue.description:OPS-102' },
      status: { value: 'Open', sourceRef: 'issue.status:OPS-102' },
      priority: { value: 'Medium', sourceRef: 'issue.priority:OPS-102' },
      assignee: { value: '', sourceRef: 'issue.assignee:OPS-102' },
      labels: { value: 'bug', sourceRef: 'issue.labels:OPS-102' },
      project: { value: 'OPS', sourceRef: 'issue.project:OPS-102' },
      comments: [],
      attachments: []
    },
    gitlabEvidence: [],
    stage1Output: {
      turn_state: 'await_human',
      jira_context_ref: 'OPS-102',
      gitlab_queries: [],
      ambiguity: ['No module, route, screenshot, or reproducible keyword is available.'],
      next_action: 'ask_human'
    },
    stage2Output: {
      turn_state: 'await_human',
      jira_context_ref: 'OPS-102',
      gitlab_evidence: [],
      repo_hints: [
        {
          project: 'ops/app',
          module: 'unknown',
          confidence: 0.3,
          source_refs: []
        }
      ],
      plan: {
        summary: 'More context is required before drafting an implementation plan.',
        steps: ['Ask for affected page or route', 'Request reproduction detail'],
        risks: ['Wrong module selection without code evidence'],
        test_hints: []
      },
      ambiguity: ['No repository evidence matched the Jira description.'],
      next_action: 'need_more_context'
    }
  },
  {
    name: 'local-fallback',
    jiraContextPack: {
      issueKey: { value: 'OPS-103', sourceRef: 'issue.key:OPS-103' },
      summary: { value: 'Export status label drift', sourceRef: 'issue.summary:OPS-103' },
      description: {
        value: 'Export screen and detail screen show inconsistent status labels.',
        sourceRef: 'issue.description:OPS-103'
      },
      status: { value: 'Open', sourceRef: 'issue.status:OPS-103' },
      priority: { value: 'Low', sourceRef: 'issue.priority:OPS-103' },
      assignee: { value: 'Analyst', sourceRef: 'issue.assignee:OPS-103' },
      labels: { value: 'export, ui', sourceRef: 'issue.labels:OPS-103' },
      project: { value: 'OPS', sourceRef: 'issue.project:OPS-103' },
      comments: [],
      attachments: []
    },
    gitlabEvidence: [
      {
        source_ref: 'local:ops-app#file:src/features/export/statusLabel.ts@def456#L1-L16',
        project: 'ops-app',
        path: 'src/features/export/statusLabel.ts',
        ref: 'HEAD',
        commit: 'def456',
        start_line: 1,
        end_line: 16,
        content: 'export const statusLabelMap = { archived: "Archived" };'
      }
    ],
    stage1Output: {
      turn_state: 'done',
      jira_context_ref: 'OPS-103',
      gitlab_queries: [
        {
          intent: 'find_related_module',
          query: 'export status label map',
          scope: 'code',
          rationale: 'summary mentions export and status label drift'
        }
      ],
      ambiguity: [],
      next_action: 'run_gitlab_queries'
    },
    stage2Output: {
      turn_state: 'done',
      jira_context_ref: 'OPS-103',
      gitlab_evidence: [
        {
          source_ref: 'local:ops-app#file:src/features/export/statusLabel.ts@def456#L1-L16',
          summary: 'Local fallback found the export status label map.'
        }
      ],
      repo_hints: [
        {
          project: 'ops-app',
          module: 'src/features/export',
          confidence: 0.78,
          source_refs: ['local:ops-app#file:src/features/export/statusLabel.ts@def456#L1-L16']
        }
      ],
      plan: {
        summary: 'Align status label map between export and detail views.',
        steps: ['Confirm source of truth', 'Update export label mapping', 'Add UI snapshot test'],
        risks: ['Label changes can affect existing export expectations'],
        test_hints: ['Check archived status in export and detail view']
      },
      ambiguity: [],
      next_action: 'draft_plan'
    }
  }
] as const;
