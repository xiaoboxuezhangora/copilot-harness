import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { startMockJiraServer, JiraClient } from '../../../mcp-servers/jira-reader/src/index.js';
import {
  buildJiraGitLabAnalysisPrompt,
  buildJiraAnalysisPrompt,
  buildJiraContextPackV1,
  JIRA_ANALYSIS_PROMPT_VERSION,
  JIRA_GITLAB_ANALYSIS_PROMPT_VERSION,
  scoreExecutable,
  validateJiraGitLabStage1Output,
  validateJiraGitLabStage2Output
} from './context.js';
import { mockGitLabEvidenceFixtures } from './gitlabEvidenceFixtures.js';

describe('Jira context pack v1', () => {
  it('builds structured context and prompt versioned prompt', async () => {
    const mockServer = await startMockJiraServer();
    try {
      const issue = await new JiraClient({
        baseUrl: mockServer.baseUrl,
        projectAllowlist: ['OPS'],
        requestTimeoutMs: 1000
      }).getIssue('OPS-1');
      const contextPack = buildJiraContextPackV1(issue);
      const prompt = buildJiraAnalysisPrompt(contextPack);

      expect(prompt.promptVersion).toBe(JIRA_ANALYSIS_PROMPT_VERSION);
      expect(prompt.prompt).toContain('jira-analysis-prompt@0.1');
      expect(prompt.prompt).toContain('"issueKey"');
      expect(contextPack.attachments[0]?.sourceRef).toContain('attachment:OPS-1');
    } finally {
      await mockServer.close();
    }
  });

  it('keeps attachment metadata without attachment body', async () => {
    const mockServer = await startMockJiraServer();
    try {
      const issue = await new JiraClient({
        baseUrl: mockServer.baseUrl,
        projectAllowlist: ['OPS'],
        requestTimeoutMs: 1000
      }).getIssue('OPS-1');
      const contextPack = buildJiraContextPackV1(issue);

      expect(JSON.stringify(contextPack)).not.toContain('secure/attachment');
      expect(contextPack.attachments[0]).toMatchObject({
        filename: 'screenshot.png',
        mimeType: 'image/png',
        size: 24576
      });
    } finally {
      await mockServer.close();
    }
  });

  it('scores executable context within range', async () => {
    const mockServer = await startMockJiraServer();
    try {
      const issue = await new JiraClient({
        baseUrl: mockServer.baseUrl,
        projectAllowlist: ['OPS'],
        requestTimeoutMs: 1000
      }).getIssue('OPS-1');
      const contextPack = buildJiraContextPackV1(issue);

      expect(scoreExecutable(contextPack)).toBeGreaterThanOrEqual(0);
      expect(scoreExecutable(contextPack)).toBeLessThanOrEqual(1);
    } finally {
      await mockServer.close();
    }
  });

  it('builds two-stage Jira GitLab analysis prompt without tool calls', async () => {
    const template = await readFile(
      new URL('../../../prompts/jira-gitlab-analysis.v1.md', import.meta.url),
      'utf8'
    );
    const fixture = mockGitLabEvidenceFixtures[0]!;
    const stage1 = buildJiraGitLabAnalysisPrompt(
      {
        stage: 'jira_to_gitlab_query_plan',
        jiraContextPack: fixture.jiraContextPack,
        memoryHotHits: [{ source_ref: 'memory://approval-reminder', summary: 'idempotency' }],
        skillHints: [{ skill: 'angular-delivery', hint: 'prefer tests' }]
      },
      template
    );
    const stage2 = buildJiraGitLabAnalysisPrompt(
      {
        stage: 'jira_gitlab_evidence_to_plan',
        jiraContextPack: fixture.jiraContextPack,
        memoryHotHits: [],
        gitlabEvidence: fixture.gitlabEvidence,
        retrievalBudgetSummary: {
          used_bytes: 256,
          truncated_count: 0
        }
      },
      template
    );

    expect(stage1.promptVersion).toBe(JIRA_GITLAB_ANALYSIS_PROMPT_VERSION);
    expect(stage1.prompt).toContain('"stage": "jira_to_gitlab_query_plan"');
    expect(stage1.prompt).toContain('Only return one strict JSON object. Do not call tools.');
    expect(stage2.prompt).toContain('"stage": "jira_gitlab_evidence_to_plan"');
    expect(stage2.prompt).toContain('gitlab:ops/app#file:src/modules/approval/reminder.service.ts');
  });

  it('validates staged Jira GitLab fixture outputs', () => {
    for (const fixture of mockGitLabEvidenceFixtures) {
      expect(validateJiraGitLabStage1Output(fixture.stage1Output, fixture.jiraContextPack)).toEqual(
        []
      );
      expect(validateJiraGitLabStage2Output(fixture.stage2Output, fixture.jiraContextPack)).toEqual(
        []
      );
    }
  });

  it('rejects draft_plan without repo evidence and high-confidence sourceless repo hints', () => {
    const fixture = mockGitLabEvidenceFixtures[1]!;
    const invalid = {
      ...fixture.stage2Output,
      repo_hints: [
        {
          project: 'ops/app',
          module: 'unknown',
          confidence: 0.8,
          source_refs: []
        }
      ],
      next_action: 'draft_plan' as const
    };

    const issues = validateJiraGitLabStage2Output(invalid, fixture.jiraContextPack);
    expect(issues.map((issue) => issue.field)).toContain('stage2.repo_hints[0].confidence');
    expect(issues.map((issue) => issue.field)).toContain('stage2.next_action');
  });

  it('allows need_more_context without fabricated GitLab files', () => {
    const fixture = mockGitLabEvidenceFixtures[1]!;
    const issues = validateJiraGitLabStage2Output(fixture.stage2Output, fixture.jiraContextPack);

    expect(fixture.stage2Output.next_action).toBe('need_more_context');
    expect(fixture.stage2Output.gitlab_evidence).toEqual([]);
    expect(issues).toEqual([]);
  });
});
