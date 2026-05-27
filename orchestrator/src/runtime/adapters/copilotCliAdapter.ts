import { DEFAULT_MODEL, type ReasoningEffort, type ToolCallRecord } from '../types.js';
import type {
  RuntimeAdapter,
  RuntimeAdapterProbe,
  RuntimeAdapterRequest,
  RuntimeAdapterResponse
} from './types.js';
import {
  BASE_UNSUPPORTED_CAPABILITIES,
  estimateTokens,
  pathExists,
  runCommand,
  withTemporaryHome
} from './shared.js';

type CliReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh';

// ── NDJSON parser for Copilot CLI --output-format json ──

interface CliNdjsonParsed {
  readonly content: string;
  readonly outputTokens: number | undefined;
  readonly sessionId: string | undefined;
  readonly exitCode?: number;
  readonly toolCalls: readonly ToolCallRecord[];
}

/**
 * Parses the NDJSON stream emitted by `copilot --output-format json`.
 *
 * Relevant event types:
 *   assistant.message  → data.content (final reply), data.outputTokens
 *   result             → sessionId, exitCode
 *
 * All other event types (session.tools_updated, user.message,
 * assistant.turn_start, assistant.message_delta, assistant.turn_end)
 * are ignored.
 */
export function parseCliNdjsonOutput(stdout: string): CliNdjsonParsed {
  let content = '';
  let outputTokens: number | undefined;
  let sessionId: string | undefined;
  const toolCalls: ToolCallRecord[] = [];

  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    let event: Record<string, unknown>;
    try {
      event = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }

    const type = event.type;
    const data =
      typeof event.data === 'object' && event.data !== null
        ? (event.data as Record<string, unknown>)
        : undefined;

    if (type === 'assistant.message' && data !== undefined) {
      if (typeof data.content === 'string') {
        content = data.content;
      }
      if (typeof data.outputTokens === 'number') {
        outputTokens = data.outputTokens;
      }
    }

    if (type === 'result') {
      if (typeof event.sessionId === 'string') {
        sessionId = event.sessionId;
      }
    }
  }

  return { content, outputTokens, sessionId, toolCalls };
}

export interface CopilotCliAdapterOptions {
  readonly command?: string;
  readonly allowExternalExecution?: boolean;
  readonly cwd?: string;
}

interface CliHelpCapabilities {
  readonly commandAvailable: boolean;
  readonly helpText: string;
  readonly unsupportedReasons: readonly string[];
}

export class CopilotCliAdapter implements RuntimeAdapter {
  private readonly command: string;

  constructor(private readonly options: CopilotCliAdapterOptions = {}) {
    this.command = options.command ?? 'copilot';
  }

  async probe(): Promise<RuntimeAdapterProbe> {
    const helpCapabilities = await this.readHelpCapabilities();
    const helpText = helpCapabilities.helpText;
    const supportsPrompt = helpText.includes('--prompt') || helpText.includes('-p, --prompt');
    const supportsJson = helpText.includes('--output-format') && helpText.includes('json');
    const supportsModel = helpText.includes('--model') && helpText.includes(DEFAULT_MODEL);
    const supportsReasoningEffort =
      helpText.includes('--reasoning-effort') &&
      helpText.includes('low') &&
      helpText.includes('medium') &&
      helpText.includes('high');
    const supportsMcp = helpText.includes('--additional-mcp-config');
    const unsupportedReasons = [
      ...helpCapabilities.unsupportedReasons,
      ...(supportsPrompt ? [] : ['CLI prompt mode not detected']),
      ...(supportsJson ? [] : ['CLI JSON output mode not detected']),
      ...(supportsModel ? [] : [`CLI model list does not include ${DEFAULT_MODEL}`]),
      ...(supportsReasoningEffort ? [] : ['CLI reasoning effort flag not detected']),
      ...(this.options.allowExternalExecution === true
        ? []
        : ['CLI external execution disabled for W2 mock smoke'])
    ];

    return {
      runtime: {
        name: 'copilot_cli'
      },
      capabilities: {
        ...BASE_UNSUPPORTED_CAPABILITIES,
        canUseTools: supportsMcp,
        canUseMcp: supportsMcp,
        supportsReasoningEffort,
        supportsHeadless: supportsPrompt && supportsJson,
        externalExecution: this.options.allowExternalExecution === true,
        capabilitySupported:
          helpCapabilities.commandAvailable &&
          supportsPrompt &&
          supportsJson &&
          supportsModel &&
          supportsReasoningEffort,
        unsupportedReasons
      },
      rawSummary: summarizeHelpCapabilities(helpText)
    };
  }

  async execute(request: RuntimeAdapterRequest): Promise<RuntimeAdapterResponse> {
    const probe = await this.probe();

    if (!probe.capabilities.externalExecution || !probe.capabilities.capabilitySupported) {
      const output = `CLI adapter contract run for ${request.taskId} using ${request.model} with reasoningEffort=${request.reasoningEffort}.`;
      return {
        output,
        toolCalls: [],
        inputTokens: estimateTokens(request.prompt),
        outputTokens: estimateTokens(output),
        capabilityNotes: probe.capabilities.unsupportedReasons
      };
    }

    const args = ['--model', request.model, '--output-format', 'json', '--prompt', request.prompt];

    const result = await runCommand(this.command, args, {
      ...(this.options.cwd !== undefined ? { cwd: this.options.cwd } : {}),
      timeoutMs: request.timeoutMs ?? 30_000
    });

    const raw = result.stdout.length > 0 ? result.stdout : result.stderr;
    const parsed = parseCliNdjsonOutput(raw);
    const output = parsed.content.length > 0 ? parsed.content : raw;
    return {
      output,
      toolCalls: parsed.toolCalls,
      inputTokens: estimateTokens(request.prompt),
      outputTokens: parsed.outputTokens ?? estimateTokens(output),
      ...(parsed.sessionId !== undefined ? { sessionId: parsed.sessionId } : {}),
      capabilityNotes:
        result.exitCode === 0 ? [] : [`CLI exited with code ${result.exitCode ?? 'unknown'}`]
    };
  }

  private async readHelpCapabilities(): Promise<CliHelpCapabilities> {
    const commandIsPath = this.command.includes('/');
    if (commandIsPath && !(await pathExists(this.command))) {
      return {
        commandAvailable: false,
        helpText: '',
        unsupportedReasons: [`CLI command not found: ${this.command}`]
      };
    }

    try {
      return await withTemporaryHome(async (home) => {
        const result = await runCommand(this.command, ['--help'], {
          env: isolatedCopilotEnv(home),
          timeoutMs: 10_000
        });

        return {
          commandAvailable: result.exitCode === 0,
          helpText: `${result.stdout}\n${result.stderr}`,
          unsupportedReasons:
            result.exitCode === 0
              ? []
              : [`CLI help exited with code ${result.exitCode ?? 'unknown'}`]
        };
      });
    } catch {
      return {
        commandAvailable: false,
        helpText: '',
        unsupportedReasons: [`CLI command not found: ${this.command}`]
      };
    }
  }
}

export function mapCliReasoningEffort(reasoningEffort: ReasoningEffort): CliReasoningEffort {
  return reasoningEffort === 'minimal' ? 'low' : reasoningEffort;
}

function isolatedCopilotEnv(home: string): Readonly<Record<string, string>> {
  return {
    HOME: home,
    XDG_CONFIG_HOME: `${home}/.config`,
    XDG_CACHE_HOME: `${home}/.cache`,
    XDG_STATE_HOME: `${home}/.state`,
    COPILOT_ALLOW_ALL: 'false'
  };
}

function summarizeHelpCapabilities(helpText: string): string {
  if (helpText.length === 0) {
    return 'Copilot CLI help unavailable';
  }

  const flags = [
    '--prompt',
    '--output-format',
    '--model',
    '--reasoning-effort',
    '--additional-mcp-config'
  ];
  return flags.filter((flag) => helpText.includes(flag)).join(', ');
}
