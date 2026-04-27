export interface RuntimeExecutionInput {
  readonly prompt: string;
  readonly metadata: Readonly<Record<string, string>>;
}

export interface RuntimeExecutionResult {
  readonly output: string;
  readonly model: string;
  readonly promptTokens: number;
  readonly completionTokens: number;
}

export interface AgentRuntime {
  executeTurn(input: RuntimeExecutionInput): Promise<RuntimeExecutionResult>;
}

export class CopilotSdkRuntime implements AgentRuntime {
  executeTurn(_input: RuntimeExecutionInput): Promise<RuntimeExecutionResult> {
    throw new Error('Not implemented in W1 skeleton.');
  }
}

export class CopilotCliRuntime implements AgentRuntime {
  executeTurn(_input: RuntimeExecutionInput): Promise<RuntimeExecutionResult> {
    throw new Error('Not implemented in W1 skeleton.');
  }
}
