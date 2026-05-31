import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const appVuePath = resolve(process.cwd(), 'src/App.vue');
const appSource = readFileSync(appVuePath, 'utf8');

function getRequirementsPanelSource() {
  const match = appSource.match(
    /<!-- requirements-review-panel:start -->([\s\S]*?)<!-- requirements-review-panel:end -->/,
  );
  return match?.[1] ?? '';
}

describe('requirements review readonly panel source', () => {
  it('contains explicit read-only markers', () => {
    expect(appSource).toContain('Replay / Shadow / Read-only');
    expect(appSource).toContain('Read-only:');
    expect(appSource).toContain('只读模式');
  });

  it('does not expose write operation actions in requirements panel', () => {
    const panelSource = getRequirementsPanelSource();

    expect(panelSource).not.toMatch(/创建\s*(MR|PR)/);
    expect(panelSource).not.toMatch(/提交评论/);
    expect(panelSource).not.toMatch(/状态流转/);
    expect(panelSource).not.toMatch(/写回/);
    expect(panelSource).not.toMatch(/Notion\s*写入/);
  });

  it('does not declare write fetch methods in requirements panel', () => {
    const panelSource = getRequirementsPanelSource();

    expect(panelSource).not.toMatch(/method\s*:\s*['"]POST['"]/);
    expect(panelSource).not.toMatch(/method\s*:\s*['"]PUT['"]/);
    expect(panelSource).not.toMatch(/method\s*:\s*['"]PATCH['"]/);
    expect(panelSource).not.toMatch(/method\s*:\s*['"]DELETE['"]/);
  });
});
