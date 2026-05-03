import { describe, expect, it } from 'vitest';

import { buildJiraAnalysisPrompt, buildJiraContextPackV1 } from './context.js';
import { jiraGoldenFixtures } from './goldenFixtures.js';

describe('jira golden fixtures', () => {
  it('keeps stable prompt snapshots', () => {
    for (const fixture of jiraGoldenFixtures) {
      const prompt = buildJiraAnalysisPrompt(fixture.contextPack);
      const snapshot = JSON.stringify(
        {
          promptVersion: prompt.promptVersion,
          ...flattenContextPack(fixture.contextPack)
        },
        null,
        0
      );

      expect(snapshot).toBe(fixture.expectedSnapshot);
    }
  });

  it('round-trips a context pack shape with source refs', () => {
    for (const fixture of jiraGoldenFixtures) {
      const assignee =
        fixture.contextPack.assignee.value.length > 0
          ? { displayName: fixture.contextPack.assignee.value }
          : undefined;
      const rebuilt = buildJiraContextPackV1({
        key: fixture.contextPack.issueKey.value,
        summary: fixture.contextPack.summary.value,
        description: fixture.contextPack.description.value,
        status: fixture.contextPack.status.value,
        priority: fixture.contextPack.priority.value,
        ...(assignee !== undefined ? { assignee } : {}),
        labels: [...fixture.contextPack.labels.value.split(', ').filter(Boolean)],
        project: {
          key: fixture.contextPack.project.value
        },
        attachments: []
      });

      expect(rebuilt.issueKey.sourceRef).toContain('issue.key');
    }
  });
});

function flattenContextPack(
  pack: ReturnType<typeof buildJiraContextPackV1>
): Record<string, unknown> {
  return {
    issueKey: pack.issueKey.value,
    summary: pack.summary.value,
    description: pack.description.value,
    status: pack.status.value,
    priority: pack.priority.value,
    assignee: pack.assignee.value,
    labels: pack.labels.value,
    project: pack.project.value,
    comments: pack.comments.map((comment) => ({
      id: comment.id,
      body: comment.body,
      author: comment.author.value,
      created: comment.created.value,
      updated: comment.updated.value,
      sourceRef: comment.sourceRef
    })),
    attachments: pack.attachments
  };
}
