import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const appVuePath = resolve(process.cwd(), "src/App.vue");
const appSource = readFileSync(appVuePath, "utf8");

describe("agent status panel source", () => {
  it("enables Agent 状态 as a real navigation page", () => {
    expect(appSource).toContain(
      '"Skill 管理",',
    );
    expect(appSource).toContain('const isAgentStatusPanel = computed(() => activeNavItem.value === "Agent 状态");');
    expect(appSource).toContain('v-else-if="isAgentStatusPanel"');
    expect(appSource).toContain("Agent 状态与优化分析");
  });

  it("derives agent health and optimization advice from stage data", () => {
    expect(appSource).toContain("function buildAgentStageHealthRows(");
    expect(appSource).toContain("function resolveAgentOptimization(");
    expect(appSource).toContain('selectedAgentStageId.value');
    expect(appSource).toContain("agentStageHealthRows");
    expect(appSource).toContain("建议优化");
  });
});
