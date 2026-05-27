import { installAutoMemoryHarvester, type AutoMemoryHarvesterOptions } from '../automemory/harvester.js';
import { AuditLogger } from '../audit/index.js';

import { CopilotCliAdapter } from './adapters/copilotCliAdapter.js';
import { CopilotSdkAdapter } from './adapters/copilotSdkAdapter.js';
import type { RuntimeAdapter } from './adapters/types.js';
import { CopilotCliRuntime } from './copilotCliRuntime.js';
import { CopilotSdkRuntime } from './copilotSdkRuntime.js';
import type { RuntimeModelRoutingGate } from './types.js';

export interface RuntimeBootstrapAutoMemoryOptions {
  readonly enabled?: boolean;
  readonly options?: AutoMemoryHarvesterOptions;
}

export interface RuntimeBootstrapInput {
  readonly runtime: 'sdk' | 'cli';
  readonly auditLogger?: AuditLogger;
  readonly adapter?: RuntimeAdapter;
  readonly allowExternalExecution?: boolean;
  readonly modelRoutingGate?: RuntimeModelRoutingGate;
  readonly autoMemory?: RuntimeBootstrapAutoMemoryOptions;
}

export function createBootstrappedRuntime(input: RuntimeBootstrapInput): CopilotSdkRuntime | CopilotCliRuntime {
  const adapterOptions =
    input.allowExternalExecution !== undefined
      ? { allowExternalExecution: input.allowExternalExecution }
      : {};
  const runtime =
    input.runtime === 'sdk'
      ? new CopilotSdkRuntime({
          adapter: input.adapter ?? new CopilotSdkAdapter(adapterOptions),
          ...(input.auditLogger !== undefined ? { auditLogger: input.auditLogger } : {}),
          ...(input.modelRoutingGate !== undefined ? { modelRoutingGate: input.modelRoutingGate } : {})
        })
      : new CopilotCliRuntime({
          adapter: input.adapter ?? new CopilotCliAdapter(adapterOptions),
          ...(input.auditLogger !== undefined ? { auditLogger: input.auditLogger } : {}),
          ...(input.modelRoutingGate !== undefined ? { modelRoutingGate: input.modelRoutingGate } : {})
        });

  if (input.autoMemory?.enabled ?? true) {
    installAutoMemoryHarvester(runtime, input.autoMemory?.options);
  }

  return runtime;
}
