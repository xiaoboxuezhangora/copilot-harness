import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AuditLogger } from '../audit/index.js';
import {
  createSkillAgentSessionConfig,
  INVESTIGATOR_ALLOWED_TOOLS,
  loadInvestigatorPrompt,
  resolveRepoRoot
} from './skillAgentLoader.js';
import {
  CopilotCliAdapter,
  CopilotSdkAdapter,
  CopilotSdkRuntime,
  createCopilotSdkSessionConfig,
  parseCliNdjsonOutput
} from './index.js';
import type {
  AgentTask,
  RuntimeAdapter,
  RuntimeAdapterProbe,
  RuntimeAdapterRequest,
  RuntimeAdapterResponse
} from './index.js';

const baseTask: AgentTask = {
  taskId: 'runtime-test',
  prompt: 'Return ok',
  intent: 'runtime test',
  turnState: 'continue_current',
  budgetLimit: {
    maxFanout: 1
  },
  promptVersion: 'jira-analysis-prompt@0.1',
  runOptions: {
    reasoningEffort: 'high'
  }
};

describe('runtime adapters', () => {
  it('detects installed SDK capabilities without binding to older createAgent APIs', async () => {
    const probe = await new CopilotSdkAdapter().probe();

    expect(probe.runtime.name).toBe('copilot_sdk');
    expect(probe.rawSummary).toContain('createSession');
    expect(probe.capabilities.supportsReasoningEffort).toBe(true);
    expect(probe.capabilities.externalExecution).toBe(false);
  });

  it('records CLI capability flags and unsupported reasons', async () => {
    const probe = await new CopilotCliAdapter({
      command: '__missing_copilot_cli__'
    }).probe();

    expect(probe.runtime.name).toBe('copilot_cli');
    expect(probe.capabilities.capabilitySupported).toBe(false);
    expect(probe.capabilities.unsupportedReasons.join(' ')).toContain('not found');
  });

  it('locks SDK runtime to gpt-5-mini and audits reasoning effort', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'runtime-audit-'));
    try {
      const auditPath = join(tempDir, 'audit.jsonl');
      const runtime = new CopilotSdkRuntime({
        adapter: new FakeRuntimeAdapter('copilot_sdk'),
        auditLogger: new AuditLogger(auditPath)
      });
      const result = await runtime.run(baseTask);
      const auditLog = await readFile(auditPath, 'utf8');

      expect(result.model).toBe('gpt-5-mini');
      expect(result.reasoningEffort).toBe('high');
      expect(result.policyDecision).toBe('allow');
      expect(result.budgetUsage).toEqual({
        fanout: 1,
        toolCalls: 0,
        inputTokens: 3,
        outputTokens: 5,
        premiumRequests: 0
      });
      expect(auditLog).toContain('"reasoningEffort":"high"');
      expect(auditLog).toContain('"policyDecision":"allow"');
      expect(auditLog).toContain(
        '"budgetUsage":{"fanout":1,"toolCalls":0,"inputTokens":3,"outputTokens":5,"premiumRequests":0}'
      );
      expect(auditLog).toContain('"gen_ai.request.model":"gpt-5-mini"');
    } finally {
      await rm(tempDir, {
        force: true,
        recursive: true
      });
    }
  });

  it('builds an explicit SDK session config for investigator skill loading', async () => {
    const repoRoot = resolveRepoRoot();
    const skillAgentConfig = await createSkillAgentSessionConfig(repoRoot);
    const sessionConfig = createCopilotSdkSessionConfig({
      reasoningEffort: 'high',
      skillAgentConfig,
      enableConfigDiscovery: true
    });
    const investigatorPrompt = await loadInvestigatorPrompt(repoRoot);

    expect(skillAgentConfig.workingDirectory).toBe(repoRoot);
    expect(skillAgentConfig.skillDirectories).toContain(`${repoRoot}/skills/.github/skills`);
    expect(skillAgentConfig.customAgents.some((agent) => agent.name === 'investigator')).toBe(true);
    expect(
      skillAgentConfig.customAgents.find((agent) => agent.name === 'investigator')?.skills
    ).toContain('jira-requirement-analysis');
    expect(
      skillAgentConfig.customAgents.find((agent) => agent.name === 'investigator')?.tools
    ).toEqual([...INVESTIGATOR_ALLOWED_TOOLS]);
    expect(skillAgentConfig.agent).toBe('investigator');
    expect(
      skillAgentConfig.customAgents.find((agent) => agent.name === 'investigator')?.prompt
    ).toBe(investigatorPrompt);
    expect(skillAgentConfig.systemMessage.content).toContain('# AGENTS v1');
    expect(skillAgentConfig.systemMessage.content).toContain('R1');
    expect(sessionConfig).toMatchObject({
      model: 'gpt-5-mini',
      reasoningEffort: 'high',
      workingDirectory: repoRoot,
      skillDirectories: [`${repoRoot}/skills/.github/skills`],
      agent: 'investigator',
      systemMessage: {
        mode: 'append'
      },
      enableConfigDiscovery: true
    });
    expect(sessionConfig.systemMessage.content).toContain('# AGENTS v1');
    expect(sessionConfig.hooks.onPreToolUse({ toolName: 'getIssue' })).toEqual({
      permissionDecision: 'allow',
      permissionDecisionReason: 'Allowed by W3 investigator tool allowlist'
    });
    expect(sessionConfig.hooks.onPreToolUse({ toolName: 'shell' })).toEqual({
      permissionDecision: 'deny',
      permissionDecisionReason: 'Denied by W3 investigator tool allowlist: shell'
    });
  });
});

describe('parseCliNdjsonOutput', () => {
  const SAMPLE_NDJSON = [
    '{"type":"session.tools_updated","data":{"model":"gpt-5-mini"},"id":"a","timestamp":"2026-04-28T02:53:05.902Z","ephemeral":true}',
    '{"type":"user.message","data":{"content":"reply with exactly: hello"},"id":"b","timestamp":"2026-04-28T02:53:05.903Z"}',
    '{"type":"assistant.turn_start","data":{"turnId":"0"},"id":"c","timestamp":"2026-04-28T02:53:06.746Z"}',
    '{"type":"assistant.message_delta","data":{"deltaContent":"hello"},"id":"d","timestamp":"2026-04-28T02:53:19.487Z","ephemeral":true}',
    '{"type":"assistant.message","data":{"messageId":"m1","content":"hello","outputTokens":577},"id":"e","timestamp":"2026-04-28T02:53:20.523Z"}',
    '{"type":"assistant.turn_end","data":{"turnId":"0"},"id":"f","timestamp":"2026-04-28T02:53:20.524Z"}',
    '{"type":"result","timestamp":"2026-04-28T02:53:20.525Z","sessionId":"sess-123","exitCode":0,"usage":{"premiumRequests":0}}'
  ].join('\n');

  it('extracts content from assistant.message event', () => {
    const parsed = parseCliNdjsonOutput(SAMPLE_NDJSON);
    expect(parsed.content).toBe('hello');
  });

  it('extracts outputTokens from assistant.message event', () => {
    const parsed = parseCliNdjsonOutput(SAMPLE_NDJSON);
    expect(parsed.outputTokens).toBe(577);
  });

  it('extracts sessionId from result event', () => {
    const parsed = parseCliNdjsonOutput(SAMPLE_NDJSON);
    expect(parsed.sessionId).toBe('sess-123');
  });

  it('returns empty content for non-NDJSON input', () => {
    const parsed = parseCliNdjsonOutput('plain text error output');
    expect(parsed.content).toBe('');
    expect(parsed.outputTokens).toBeUndefined();
    expect(parsed.sessionId).toBeUndefined();
  });

  it('handles empty input', () => {
    const parsed = parseCliNdjsonOutput('');
    expect(parsed.content).toBe('');
  });
});

class FakeRuntimeAdapter implements RuntimeAdapter {
  constructor(private readonly runtimeName: 'copilot_sdk' | 'copilot_cli') {}

  probe(): Promise<RuntimeAdapterProbe> {
    return Promise.resolve({
      runtime: {
        name: this.runtimeName,
        version: 'test'
      },
      capabilities: {
        canSpawn: false,
        canUseTools: true,
        canResume: true,
        canReadMemory: false,
        canWriteMemory: false,
        canUseMcp: true,
        supportsSessions: true,
        supportsHooks: true,
        supportsReasoningEffort: true,
        supportsHeadless: true,
        externalExecution: false,
        capabilitySupported: true,
        unsupportedReasons: []
      },
      detectedVersion: 'test',
      rawSummary: 'test adapter'
    });
  }

  execute(request: RuntimeAdapterRequest): Promise<RuntimeAdapterResponse> {
    return Promise.resolve({
      output: `${request.model}:${request.reasoningEffort}`,
      toolCalls: [],
      inputTokens: 3,
      outputTokens: 5,
      capabilityNotes: []
    });
  }
}
