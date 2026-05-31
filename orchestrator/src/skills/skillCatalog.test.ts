import { describe, expect, it } from 'vitest';

import {
  ANGULAR17_BUSINESS_SKILL_ID,
  buildSkillQualityImprovements,
  businessSkillCatalog,
  exportBusinessSkill,
  isSkillProtocolClosed,
  resolveBusinessSkillMatches,
  shouldLoadAngular17Skill,
  skillProtocolAssessments
} from './index.js';

describe('business skill catalog', () => {
  it('keeps Angular17 as a managed business skill with export targets', () => {
    const angularSkill = businessSkillCatalog.find(
      (skill) => skill.id === ANGULAR17_BUSINESS_SKILL_ID
    );

    expect(angularSkill).toBeDefined();
    expect(angularSkill?.repositoryTargets[0]?.branch).toBe('develop_to_angular17');
    expect(angularSkill?.exportTargets).toContain('github-copilot-skills');
    expect(angularSkill?.exportTargets).toContain('microsoft-365-copilot');
  });

  it('matches Angular17 issues by semantic keywords', () => {
    const matches = resolveBusinessSkillMatches(
      '【Angular17-登录页】升级后用户名、密码和登录按钮样式与原系统不一致，图标色差明显'
    );

    expect(matches[0]?.skillId).toBe(ANGULAR17_BUSINESS_SKILL_ID);
    expect(shouldLoadAngular17Skill('Angular17 空白页')).toBe(true);
    expect(shouldLoadAngular17Skill('普通 SSO token 续期失败')).toBe(false);
  });

  it('records that market skill protocols are not fully closed', () => {
    expect(isSkillProtocolClosed()).toBe(false);
    expect(skillProtocolAssessments.some((item) => item.sharedProtocol)).toBe(true);
    expect(skillProtocolAssessments.some((item) => !item.sharedProtocol)).toBe(true);
  });

  it('exports SKILL.md and vendor-specific packages from the canonical model', () => {
    const skillMarkdown = exportBusinessSkill(
      ANGULAR17_BUSINESS_SKILL_ID,
      'github-copilot-skills'
    );
    const openAiPackage = exportBusinessSkill(ANGULAR17_BUSINESS_SKILL_ID, 'openai-gpt');

    expect(skillMarkdown.filename).toBe(`${ANGULAR17_BUSINESS_SKILL_ID}/SKILL.md`);
    expect(skillMarkdown.content).toContain('## Use This Skill When');
    expect(openAiPackage.filename).toBe(`${ANGULAR17_BUSINESS_SKILL_ID}.openai.json`);
    expect(openAiPackage.warnings.length).toBeGreaterThan(0);
  });

  it('turns semantic asset candidates into skill improvement proposals', () => {
    const improvements = buildSkillQualityImprovements();

    expect(improvements.some((item) => item.skillId === ANGULAR17_BUSINESS_SKILL_ID)).toBe(true);
    expect(improvements.every((item) => item.sourceAssetIds.length > 0)).toBe(true);
  });
});
