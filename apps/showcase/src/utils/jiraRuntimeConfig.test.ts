import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const rootDir = resolve(process.cwd(), '../..');
const startScript = readFileSync(resolve(rootDir, 'scripts/start-showcase-live.sh'), 'utf8');
const viteConfig = readFileSync(resolve(process.cwd(), 'vite.config.ts'), 'utf8');

describe('jira runtime configuration', () => {
  it('uses showcase-specific jira jql instead of inherited smoke jql', () => {
    expect(startScript).toContain('DEFAULT_SHOWCASE_JIRA_JQL=');
    expect(startScript).toContain('export SHOWCASE_JIRA_JQL=');
    expect(startScript).toContain('export JIRA_SMOKE_JQL="${SHOWCASE_JIRA_JQL}"');
  });

  it('defaults the dispatch queue to current user in-progress issues', () => {
    const expectedJql =
      'project = APMIS AND status = 处理中 AND assignee in (currentUser()) ORDER BY updated DESC';

    expect(startScript).toContain(expectedJql);
    expect(viteConfig).toContain('env.SHOWCASE_JIRA_JQL?.trim()');
    expect(viteConfig).toContain(expectedJql);
    expect(viteConfig).not.toContain('return `project = ${fallbackProject} ORDER BY updated DESC`;');
  });
});
