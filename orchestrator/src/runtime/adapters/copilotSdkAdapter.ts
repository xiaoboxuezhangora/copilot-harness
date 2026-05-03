import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

import { DEFAULT_MODEL, type ReasoningEffort } from '../types.js';
import {
  createSkillAgentSessionConfig,
  resolveRepoRoot,
  type CustomAgentConfig,
  type SkillAgentSessionConfig
} from '../skillAgentLoader.js';
import type {
  RuntimeAdapter,
  RuntimeAdapterProbe,
  RuntimeAdapterRequest,
  RuntimeAdapterResponse
} from './types.js';
import { BASE_UNSUPPORTED_CAPABILITIES, estimateTokens } from './shared.js';

const require = createRequire(import.meta.url);

type SdkReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh';

export interface CopilotSdkAdapterOptions {
  readonly allowExternalExecution?: boolean;
  readonly cliPath?: string;
  readonly cwd?: string;
  readonly repoRoot?: string;
  readonly enableConfigDiscovery?: boolean;
  readonly skillAgentSessionConfigFactory?: (repoRoot: string) => Promise<SkillAgentSessionConfig>;
}

export interface CopilotSdkSessionConfigInput {
  readonly reasoningEffort: SdkReasoningEffort;
  readonly skillAgentConfig: SkillAgentSessionConfig;
  readonly enableConfigDiscovery: boolean;
}

export interface CopilotSdkSessionConfig {
  readonly model: typeof DEFAULT_MODEL;
  readonly reasoningEffort: SdkReasoningEffort;
  readonly workingDirectory: string;
  readonly skillDirectories: string[];
  readonly customAgents: CustomAgentConfig[];
  readonly agent: string;
  readonly systemMessage: SkillAgentSessionConfig['systemMessage'];
  readonly enableConfigDiscovery: boolean;
  readonly hooks: {
    readonly onPreToolUse: (input: PreToolUseHookInput) => PreToolUseHookDecision;
  };
}

interface PreToolUseHookInput {
  readonly toolName: string;
}

interface PreToolUseHookDecision {
  readonly permissionDecision: 'allow' | 'deny';
  readonly permissionDecisionReason: string;
}

interface CopilotSdkPackageInfo {
  readonly version: string;
  readonly readme: string;
  readonly types: string;
}

export class CopilotSdkAdapter implements RuntimeAdapter {
  constructor(private readonly options: CopilotSdkAdapterOptions = {}) {}

  async probe(): Promise<RuntimeAdapterProbe> {
    const packageInfo = await readCopilotSdkPackageInfo();

    if (packageInfo === undefined) {
      return {
        runtime: {
          name: 'copilot_sdk'
        },
        capabilities: {
          ...BASE_UNSUPPORTED_CAPABILITIES,
          unsupportedReasons: ['@github/copilot-sdk is not installed']
        },
        rawSummary: 'SDK package not installed'
      };
    }

    const docs = `${packageInfo.readme}\n${packageInfo.types}`;
    const supportsReasoningEffort = docs.includes('reasoningEffort');
    const supportsMcp = docs.includes('mcpServers');
    const supportsHooks = docs.includes('hooks?: SessionHooks');
    const supportsSessions = docs.includes('createSession');

    return {
      runtime: {
        name: 'copilot_sdk',
        version: packageInfo.version
      },
      capabilities: {
        canSpawn: false,
        canUseTools: true,
        canResume: supportsSessions,
        canReadMemory: false,
        canWriteMemory: false,
        canUseMcp: supportsMcp,
        supportsSessions,
        supportsHooks,
        supportsReasoningEffort,
        supportsHeadless: supportsSessions,
        externalExecution: this.options.allowExternalExecution === true,
        capabilitySupported: supportsSessions && supportsReasoningEffort,
        unsupportedReasons:
          this.options.allowExternalExecution === true
            ? []
            : ['SDK external execution disabled for W2 mock smoke']
      },
      detectedVersion: packageInfo.version,
      rawSummary:
        'SDK 0.3 API exposes CopilotClient.createSession, SessionConfig.reasoningEffort, hooks, mcpServers, and sendAndWait.'
    };
  }

  async execute(request: RuntimeAdapterRequest): Promise<RuntimeAdapterResponse> {
    const probe = await this.probe();

    if (!probe.capabilities.externalExecution) {
      const output = `SDK adapter contract run for ${request.taskId} using ${request.model} with reasoningEffort=${request.reasoningEffort}.`;
      return {
        output,
        toolCalls: [],
        inputTokens: estimateTokens(request.prompt),
        outputTokens: estimateTokens(output),
        capabilityNotes: probe.capabilities.unsupportedReasons
      };
    }

    const effort = mapSdkReasoningEffort(request.reasoningEffort);
    const sdk = await import('@github/copilot-sdk');
    const repoRoot = this.options.repoRoot ?? resolveRepoRoot();
    const skillAgentConfig = await (
      this.options.skillAgentSessionConfigFactory ?? createSkillAgentSessionConfig
    )(repoRoot);
    const client = new sdk.CopilotClient({
      logLevel: 'error',
      useLoggedInUser: true,
      ...(this.options.cliPath !== undefined ? { cliPath: this.options.cliPath } : {}),
      ...(this.options.cwd !== undefined ? { cwd: this.options.cwd } : {})
    });

    try {
      await client.start();
      const sessionConfig = createCopilotSdkSessionConfig({
        reasoningEffort: effort,
        skillAgentConfig,
        enableConfigDiscovery: this.options.enableConfigDiscovery ?? true
      });
      const session = await client.createSession({
        ...sessionConfig,
        customAgents: [...sessionConfig.customAgents],
        onPermissionRequest: sdk.approveAll
      });
      const message = await session.sendAndWait(
        {
          prompt: request.prompt
        },
        request.timeoutMs
      );
      await session.disconnect();

      const output = message?.data.content ?? '';
      return {
        output,
        toolCalls: [],
        inputTokens: estimateTokens(request.prompt),
        outputTokens: estimateTokens(output),
        sessionId: session.sessionId,
        capabilityNotes: []
      };
    } finally {
      await client.stop();
    }
  }
}

export function mapSdkReasoningEffort(reasoningEffort: ReasoningEffort): SdkReasoningEffort {
  return reasoningEffort === 'minimal' ? 'low' : reasoningEffort;
}

export function createCopilotSdkSessionConfig(
  input: CopilotSdkSessionConfigInput
): CopilotSdkSessionConfig {
  const activeAgent = input.skillAgentConfig.customAgents.find(
    (customAgent) => customAgent.name === input.skillAgentConfig.agent
  );
  const allowedTools = new Set(activeAgent?.tools ?? []);

  return {
    model: DEFAULT_MODEL,
    reasoningEffort: input.reasoningEffort,
    workingDirectory: input.skillAgentConfig.workingDirectory,
    skillDirectories: [...input.skillAgentConfig.skillDirectories],
    customAgents: [...input.skillAgentConfig.customAgents],
    agent: input.skillAgentConfig.agent,
    systemMessage: input.skillAgentConfig.systemMessage,
    enableConfigDiscovery: input.enableConfigDiscovery,
    hooks: {
      onPreToolUse: (hookInput) => {
        if (allowedTools.size > 0 && !allowedTools.has(hookInput.toolName)) {
          return {
            permissionDecision: 'deny',
            permissionDecisionReason: `Denied by W3 investigator tool allowlist: ${hookInput.toolName}`
          };
        }

        return {
          permissionDecision: 'allow',
          permissionDecisionReason: 'Allowed by W3 investigator tool allowlist'
        };
      }
    }
  };
}

async function readCopilotSdkPackageInfo(): Promise<CopilotSdkPackageInfo | undefined> {
  try {
    const indexPath = require.resolve('@github/copilot-sdk');
    const packageRoot = indexPath.replace(/\/dist\/(?:cjs|esm)\/index\.js$/, '');
    const packageJson = JSON.parse(
      await readFile(`${packageRoot}/package.json`, 'utf8')
    ) as unknown;
    const version = readStringProperty(packageJson, 'version') ?? 'unknown';
    const readme = await readFile(`${packageRoot}/README.md`, 'utf8');
    const types = await readFile(`${packageRoot}/dist/types.d.ts`, 'utf8');

    return {
      version,
      readme,
      types
    };
  } catch {
    return undefined;
  }
}

function readStringProperty(record: unknown, key: string): string | undefined {
  if (typeof record !== 'object' || record === null || Array.isArray(record)) {
    return undefined;
  }

  const value = (record as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}
