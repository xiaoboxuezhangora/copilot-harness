# W2 SDK / CLI Capability Notes

Date: 2026-04-28

## SDK

Package inspected: `@github/copilot-sdk@0.3.0`

Observed current API:

- `CopilotClient`
- `client.createSession(config)`
- `client.resumeSession(sessionId, config)`
- `client.listModels()`
- `CopilotSession.sendAndWait(...)`
- `SessionConfig.reasoningEffort`
- `SessionConfig.mcpServers`
- `SessionConfig.hooks`
- hook names include `onPreToolUse`, `onPostToolUse`, `onSessionStart`, `onSessionEnd`,
  and `onErrorOccurred`

The package README marks the SDK as public preview, so `orchestrator/src/runtime/adapters/` owns
the mapping into `AgentRuntime`.

## CLI

Local CLI detected at `/Users/wangbo/.volta/bin/copilot`.

Observed help flags:

- `-p, --prompt`
- `--output-format json`
- `--model`, including `gpt-5-mini`
- `--reasoning-effort low|medium|high|xhigh`
- `--additional-mcp-config`
- `--config-dir`
- `--log-dir`

Internal `reasoningEffort: "minimal"` has no direct CLI/SDK equivalent and maps to CLI/SDK `low`.

## W2 Execution Policy

Mock smoke does not call real Copilot SDK/CLI model execution. The adapters record
`externalExecution: false` and include an unsupported reason. This keeps W2 deterministic while
preserving the real execution path behind explicit adapter options.
