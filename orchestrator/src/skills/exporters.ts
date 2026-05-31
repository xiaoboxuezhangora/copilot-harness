import {
  ANGULAR17_BUSINESS_SKILL_ID,
  businessSkillCatalog,
  findBusinessSkill
} from './catalog.js';
import type {
  BusinessSkillDefinition,
  SkillQualityImprovement,
  VendorSkillExportTarget
} from './types.js';

export interface VendorSkillExport {
  readonly target: VendorSkillExportTarget;
  readonly skillId: string;
  readonly filename: string;
  readonly contentType: 'markdown' | 'json';
  readonly content: string;
  readonly warnings: readonly string[];
}

export function exportBusinessSkill(
  skillId: string,
  target: VendorSkillExportTarget
): VendorSkillExport {
  const skill = findBusinessSkill(skillId);
  if (skill === null) {
    throw new Error(`Unknown business skill: ${skillId}`);
  }

  if (
    target === 'anthropic-claude-skills' ||
    target === 'github-copilot-skills' ||
    target === 'google-adk-skills'
  ) {
    return {
      target,
      skillId,
      filename: `${skill.id}/SKILL.md`,
      contentType: 'markdown',
      content: renderAgentSkillMarkdown(skill),
      warnings: []
    };
  }

  if (target === 'openai-gpt' || target === 'openai-agents-sdk') {
    return {
      target,
      skillId,
      filename: `${skill.id}.openai.json`,
      contentType: 'json',
      content: JSON.stringify(renderOpenAiExport(skill, target), null, 2),
      warnings: [
        'OpenAI GPT/Agents exports do not preserve SKILL.md folder semantics one-to-one.',
        'Review tool/action descriptors and knowledge file boundaries before publishing.'
      ]
    };
  }

  return {
    target,
    skillId,
    filename: `${skill.id}.m365-declarative-agent.json`,
    contentType: 'json',
    content: JSON.stringify(renderMicrosoft365Export(skill), null, 2),
    warnings: [
      'Microsoft 365 Copilot declarative agents use manifest-specific schema rather than SKILL.md.',
      'Knowledge and action package references must be bound during the packaging step.'
    ]
  };
}

export function buildSkillQualityImprovements(): readonly SkillQualityImprovement[] {
  return businessSkillCatalog.flatMap((skill) => {
    const candidateAssets = skill.semanticAssets.filter(
      (asset) => asset.promotion === 'candidate' && asset.qualityImpact > 0
    );
    const correctionPriority =
      skill.quality.correctionRate >= 0.2 ? ('high' as const) : ('medium' as const);

    return candidateAssets.map((asset) => ({
      skillId: skill.id,
      priority: skill.id === ANGULAR17_BUSINESS_SKILL_ID ? correctionPriority : 'medium',
      title: `Promote semantic asset: ${asset.id}`,
      rationale: `${asset.summary} Current correction rate is ${Math.round(
        skill.quality.correctionRate * 100
      )}%.`,
      sourceAssetIds: [asset.id]
    }));
  });
}

function renderAgentSkillMarkdown(skill: BusinessSkillDefinition): string {
  return [
    '---',
    `name: ${skill.id}`,
    `description: "${renderDescription(skill)}"`,
    `owner: ${skill.owner}`,
    `version: ${skill.version}`,
    '---',
    '',
    `# ${skill.name}`,
    '',
    '## What This Skill Does',
    '',
    skill.description,
    '',
    '## Use This Skill When',
    '',
    renderMarkdownList(skill.positiveTriggers),
    '',
    '## Do Not Use This Skill When',
    '',
    renderMarkdownList(skill.negativeTriggers),
    '',
    '## Default Workflow',
    '',
    renderMarkdownList(skill.defaultWorkflow),
    '',
    '## Repository Targets',
    '',
    renderMarkdownList(
      skill.repositoryTargets.map(
        (target) =>
          `${target.repository}@${target.branch} (${target.module}) - ${target.reason}`
      )
    ),
    '',
    '## Guardrails',
    '',
    renderMarkdownList(skill.guardrails),
    '',
    '## Required Outputs',
    '',
    renderMarkdownList(skill.requiredOutputs),
    '',
    '## Progressive Disclosure References',
    '',
    renderMarkdownList(skill.referenceFiles)
  ].join('\n');
}

function renderOpenAiExport(skill: BusinessSkillDefinition, target: VendorSkillExportTarget) {
  return {
    name: skill.name,
    target,
    instructions: [
      skill.description,
      'Use when:',
      ...skill.positiveTriggers.map((trigger) => `- ${trigger}`),
      'Do not use when:',
      ...skill.negativeTriggers.map((trigger) => `- ${trigger}`),
      'Guardrails:',
      ...skill.guardrails.map((guardrail) => `- ${guardrail}`),
      'Required outputs:',
      ...skill.requiredOutputs.map((output) => `- ${output}`)
    ].join('\n'),
    knowledgeFiles: skill.referenceFiles,
    tools: skill.mcpAllowList.map((tool) => ({
      name: tool,
      sideEffect: tool.includes('Policy') ? 'policy_gate' : 'read'
    })),
    metadata: {
      canonicalSkillId: skill.id,
      version: skill.version,
      owner: skill.owner,
      defaultWorkflow: skill.defaultWorkflow
    }
  };
}

function renderMicrosoft365Export(skill: BusinessSkillDefinition) {
  return {
    declarativeAgent: {
      name: skill.name,
      description: skill.description,
      instructions: [
        ...skill.positiveTriggers.map((trigger) => `Use when ${trigger}`),
        ...skill.negativeTriggers.map((trigger) => `Do not use when ${trigger}`),
        ...skill.guardrails
      ],
      capabilities: {
        knowledge: skill.referenceFiles,
        actions: skill.mcpAllowList
      },
      copilotHarness: {
        canonicalSkillId: skill.id,
        version: skill.version,
        requiredOutputs: skill.requiredOutputs,
        repositoryTargets: skill.repositoryTargets
      }
    }
  };
}

function renderDescription(skill: BusinessSkillDefinition): string {
  return [
    `正触发：${skill.positiveTriggers.join('；')}`,
    `反触发：${skill.negativeTriggers.join('；')}`
  ].join(' ');
}

function renderMarkdownList(items: readonly string[]): string {
  return items.map((item) => `- ${item}`).join('\n');
}
