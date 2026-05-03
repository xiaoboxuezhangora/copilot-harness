import { describe, expect, it } from 'vitest';

import { startMockJiraServer, JiraClient } from '../../../mcp-servers/jira-reader/src/index.js';
import {
  buildJiraAnalysisPrompt,
  buildJiraContextPackV1,
  JIRA_ANALYSIS_PROMPT_VERSION,
  scoreExecutable
} from './context.js';

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
});
