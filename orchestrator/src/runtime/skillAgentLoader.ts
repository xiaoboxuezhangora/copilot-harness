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
export const INVESTIGATOR_ALLOWED_TOOLS = ['getIssue', 'searchIssues', 'getComments'] as const;

export function resolveRepoRoot(fromFileUrl: string = import.meta.url): string {
  const runtimeDir = dirname(fileURLToPath(fromFileUrl));
  return resolve(runtimeDir, '../../..');
}

export async function createSkillAgentSessionConfig(
  repoRoot = resolveRepoRoot()
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
        skills: [INVESTIGATOR_SKILL_NAME]
      }
    ],
    agent: INVESTIGATOR_AGENT_NAME,
    systemMessage: {
      mode: 'append',
      content: buildAgentsSystemMessage(agentsMd)
    }
  };
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
