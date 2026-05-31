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

  it('loads runtime data on initial mount without exposing removed topbar actions', () => {
    expect(appSource).toContain('void refreshRuntimeData();');
    expect(appSource).not.toContain('autoExecuteEnabled');
    expect(appSource).not.toContain('async function refreshReadonly()');
    expect(appSource).not.toContain('async function syncAndTrigger()');
    expect(appSource).not.toContain('同步并触发');
  });

  it('moves repository and branch assignment from config center into jira drawer', () => {
    expect(appSource).not.toContain('<span>代码检索配置</span>');
    expect(appSource).not.toContain('addCodeRetrievalKeywordRule');
    expect(appSource).toContain('{ id: "repos", label: "仓库分支" }');
    expect(appSource).toContain('function openGitTargetsDrawer(issueKey: string)');
    expect(appSource).toContain('codeTargets: getGitTargetsForIssue(issue).map((target) => ({');
  });
});
