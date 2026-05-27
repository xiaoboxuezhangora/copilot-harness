import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const appVuePath = resolve(process.cwd(), 'src/App.vue');
const appSource = readFileSync(appVuePath, 'utf8');

describe('jira runtime queue source', () => {
  it('does not import generated snapshot as runtime source', () => {
    expect(appSource).not.toContain('./generated/snapshot.json');
    expect(appSource).not.toMatch(/\brawSnapshot\b/);
    expect(appSource).not.toMatch(/\bsnapshotData\b/);
  });

  it('loads jira queue from runtime API', () => {
    expect(appSource).toContain('const jiraIssuesApiPath = "/api/showcase/jira-issues";');
    expect(appSource).toContain('const payload = (await response.json()) as ShowcaseJiraIssuesResponse;');
    expect(appSource).toContain(
      'buildLiveJiraIssues(jiraIssues.value, runtimeMcpCallsByTaskId.value)',
    );
    expect(appSource).toContain(
      'function buildLiveJiraIssues(\n  jiraIssues: ShowcaseJiraIssue[],\n  mcpCallsByTaskId: Readonly<Record<string, string[]>>,',
    );
  });

  it('marks queue as degraded when jira queue API fails', () => {
    expect(appSource).toContain('jiraIssuesStatus.value = "degraded";');
    expect(appSource).toContain('Jira 队列未加载');
  });

  it('refresh button path triggers runtime data refresh', () => {
    expect(appSource).toContain('async function refreshReadonly()');
    expect(appSource).toContain('await refreshRuntimeData();');
  });
});
