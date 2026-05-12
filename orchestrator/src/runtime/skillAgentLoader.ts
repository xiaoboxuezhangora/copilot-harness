import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface SkillAgentSessionConfig {
  readonly workingDirectory: string;
  readonly skillDirectories: readonly string[];
  readonly customAgents: readonly CustomAgentConfig[];
  readonly agent: string;
  readonly systemMessage: SystemMessageAppendConfig;
}

export interface CustomAgentConfig {
  readonly name: string;
  readonly description?: string;
  readonly prompt: string;
  readonly tools?: string[] | null;
  readonly skills?: string[];
}

export interface SystemMessageAppendConfig {
  readonly mode?: 'append';
  readonly content: string;
}

export const INVESTIGATOR_AGENT_NAME = 'investigator';
export const INVESTIGATOR_SKILL_NAME = 'jira-requirement-analysis';
export const BLOOD_TRANSFUSION_SKILL_NAME = 'blood-transfusion';
export const INVESTIGATOR_ALLOWED_TOOLS = ['getIssue', 'searchIssues', 'getComments'] as const;

export interface SkillAgentSessionOptions {
  readonly taskDescription?: string;
}

export function resolveRepoRoot(fromFileUrl: string = import.meta.url): string {
  const runtimeDir = dirname(fileURLToPath(fromFileUrl));
  return resolve(runtimeDir, '../../..');
}

export async function createSkillAgentSessionConfig(
  repoRoot = resolveRepoRoot(),
  options: SkillAgentSessionOptions = {}
): Promise<SkillAgentSessionConfig> {
  const [prompt, agentsMd] = await Promise.all([
    loadInvestigatorPrompt(repoRoot),
    loadAgentsMd(repoRoot)
  ]);
  return {
    workingDirectory: repoRoot,
    skillDirectories: [join(repoRoot, 'skills/.github/skills')],
    customAgents: [
      {
        name: INVESTIGATOR_AGENT_NAME,
        prompt,
        tools: [...INVESTIGATOR_ALLOWED_TOOLS],
        skills: resolveInvestigatorSkills(options.taskDescription)
      }
    ],
    agent: INVESTIGATOR_AGENT_NAME,
    systemMessage: {
      mode: 'append',
      content: buildAgentsSystemMessage(agentsMd)
    }
  };
}

export function resolveInvestigatorSkills(taskDescription = ''): string[] {
  const skills = [INVESTIGATOR_SKILL_NAME];

  if (shouldLoadBloodTransfusionSkill(taskDescription)) {
    skills.push(BLOOD_TRANSFUSION_SKILL_NAME);
  }

  return skills;
}

export function shouldLoadBloodTransfusionSkill(taskDescription: string): boolean {
  const normalized = taskDescription.toLowerCase();
  const triggerPatterns = [
    '输血',
    '血袋',
    '取血',
    '备改输',
    '双人核对',
    '配血',
    '输注',
    '输血反应',
    'bloodtransfusioncode',
    'neubtmis',
    'biz857',
    'blood bag',
    'blood transfusion',
    'transfusion',
    'blood-closed-loop',
    'atbloodapply'
  ];

  return triggerPatterns.some((pattern) => normalized.includes(pattern));
}

export async function loadInvestigatorPrompt(repoRoot = resolveRepoRoot()): Promise<string> {
  return readFile(join(repoRoot, 'orchestrator/docs/agents/investigator.agent.md'), 'utf8');
}

export async function loadAgentsMd(repoRoot = resolveRepoRoot()): Promise<string> {
  return readFile(join(repoRoot, 'orchestrator/AGENTS.md'), 'utf8');
}

function buildAgentsSystemMessage(agentsMd: string): string {
  return ['<copilot_harness_agents_md>', agentsMd.trim(), '</copilot_harness_agents_md>'].join(
    '\n'
  );
}
