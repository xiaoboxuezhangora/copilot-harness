import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createBootstrappedRuntime, type RuntimeAdapter, type RuntimeAdapterProbe, type RuntimeAdapterRequest, type RuntimeAdapterResponse } from './index.js';
import type { AgentTask } from './index.js';

const baseTask: AgentTask = {
  taskId: 'bootstrap-test',
  prompt: 'Return ok',
  intent: 'bootstrap test',
  turnState: 'continue_current',
  budgetLimit: {
    maxFanout: 1
  },
  promptVersion: 'jira-analysis-prompt@0.1',
  runOptions: {
    reasoningEffort: 'low'
  }
};

describe('createBootstrappedRuntime', () => {
  it('installs auto-memory harvester by default', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'runtime-bootstrap-'));
    const pendingDir = join(tempDir, '.memory', 'pending');
    const auditLogPath = join(tempDir, 'reports', 'audit.log');
    const extractorCalls: RuntimeAdapterRequest[] = [];

    const runtime = createBootstrappedRuntime({
      runtime: 'sdk',
      adapter: new FakeRuntimeAdapter('copilot_sdk'),
      autoMemory: {
        options: {
          extractor: {
            extract: async (input) => {
              extractorCalls.push({
                taskId: input.task_id,
                prompt: input.output,
                model: 'gpt-5-mini',
                reasoningEffort: 'low'
              });
              return {
                turn_state: 'done',
                candidates: [],
                skipped_by_redline: [],
                thinking: ''
              };
            }
          },
          pendingDir,
          auditLogPath,
          now: () => new Date('2026-05-08T00:00:00.000Z')
        }
      }
    });

    await runtime.run(baseTask);

    expect(extractorCalls).toHaveLength(1);
    const auditRaw = await readFile(auditLogPath, 'utf8');
    expect(auditRaw).toContain('"event_name":"automemory.harvest_summary"');

    await rm(tempDir, { recursive: true, force: true });
  });

  it('supports disabling auto-memory harvester explicitly', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'runtime-bootstrap-disabled-'));
    const auditLogPath = join(tempDir, 'reports', 'audit.log');

    const runtime = createBootstrappedRuntime({
      runtime: 'sdk',
      adapter: new FakeRuntimeAdapter('copilot_sdk'),
      autoMemory: {
        enabled: false,
        options: {
          auditLogPath
        }
      }
    });

    await runtime.run(baseTask);

    await expect(readFile(auditLogPath, 'utf8')).rejects.toThrow();
    await rm(tempDir, { recursive: true, force: true });
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
    const output = `${request.model}:${request.reasoningEffort}`;
    return Promise.resolve({
      output,
      toolCalls: [],
      inputTokens: 3,
      outputTokens: 5,
      capabilityNotes: []
    });
  }
}
