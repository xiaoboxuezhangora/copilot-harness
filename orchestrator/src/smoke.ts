import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';

import { AuditLogger } from './audit/index.js';
import {
  createBootstrappedRuntime,
  type AgentResult
} from './runtime/index.js';
import {
  JiraClient,
  createJiraReaderServer,
  loadConfigFromEnv,
  startMockJiraServer,
  type JiraIssue,
  type MockJiraServer
} from '../../mcp-servers/jira-reader/src/index.js';
import { JIRA_ANALYSIS_PROMPT_VERSION } from './jira/context.js';

type SmokeRuntime = 'sdk' | 'cli';
type SmokeMode = 'mock' | 'live';

interface SmokeOutput {
  readonly taskId: string;
  readonly turnState: AgentResult['turnState'];
  readonly jiraIssue: JiraIssue;
  readonly promptVersion: string;
  readonly auditTraceId: string;
  readonly model: AgentResult['model'];
  readonly runtime: AgentResult['runtime'];
  readonly reasoningEffort: AgentResult['reasoningEffort'];
  readonly capabilities: AgentResult['capabilities'];
  readonly mode: SmokeMode;
  readonly copilotOutput?: string;
}

const runtime = parseRuntimeArg(process.argv);
const mode = parseModeArg(process.argv);
const output = await runSmoke(runtime, mode);
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);

export async function runSmoke(
  runtimeName: SmokeRuntime,
  mode: SmokeMode = 'mock'
): Promise<SmokeOutput> {
  const tempDir = await mkdtemp(join(tmpdir(), 'copilot-harness-smoke-'));
  let mockServer: MockJiraServer | undefined;
  const isLive = mode === 'live';

  try {
    // ── Jira: mock or real ──
    let jiraIssue: JiraIssue;
    if (isLive) {
      jiraIssue = await readIssueThroughRealJira();
    } else {
      mockServer = await startMockJiraServer();
      jiraIssue = await readIssueThroughMcp(mockServer.baseUrl, ['OPS']);
    }

    // ── Runtime: contract stub or real execution ──
    const auditLogger = new AuditLogger(join(tempDir, 'audit.jsonl'));
    const allowExternalExecution = isLive;
    const runtimeInstance = createBootstrappedRuntime({
      runtime: runtimeName,
      auditLogger,
      allowExternalExecution,
      autoMemory: {
        enabled: process.env.AUTO_MEMORY_HARVEST !== '0'
      }
    });

    const result = await runtimeInstance.run({
      taskId: `w2-smoke-${runtimeName}-${mode}`,
      prompt: `用中文一句话总结 Jira issue ${jiraIssue.key}: ${jiraIssue.summary}`,
      intent: `W2 ${mode} smoke`,
      turnState: 'continue_current',
      budgetLimit: {
        maxFanout: 1,
        timeoutMs: 60_000
      },
      promptVersion: JIRA_ANALYSIS_PROMPT_VERSION,
      runOptions: {
        reasoningEffort: 'medium',
        verbosity: 'low'
      }
    });

    return {
      taskId: result.taskId,
      turnState: result.turnState,
      jiraIssue,
      auditTraceId: result.auditTraceId,
      promptVersion: JIRA_ANALYSIS_PROMPT_VERSION,
      model: result.model,
      runtime: result.runtime,
      reasoningEffort: result.reasoningEffort,
      capabilities: result.capabilities,
      mode,
      ...(isLive ? { copilotOutput: result.output } : {})
    };
  } finally {
    if (mockServer !== undefined) {
      await mockServer.close();
    }

    await rm(tempDir, {
      force: true,
      recursive: true
    });
  }
}

async function readIssueThroughMcp(
  baseUrl: string,
  projectAllowlist: readonly string[]
): Promise<JiraIssue> {
  const jiraClient = new JiraClient({
    baseUrl,
    projectAllowlist: [...projectAllowlist],
    requestTimeoutMs: 5_000
  });
  const mcpServer = createJiraReaderServer(jiraClient);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({
    name: 'copilot-harness-smoke',
    version: '0.1.0'
  });

  await Promise.all([mcpServer.connect(serverTransport), client.connect(clientTransport)]);

  try {
    const result = await client.callTool(
      {
        name: 'getIssue',
        arguments: {
          issueKey: 'OPS-1'
        }
      },
      CallToolResultSchema
    );
    const payload = parseTextPayload(result.content);
    const issue = payload.issue;

    if (!isJiraIssue(issue)) {
      throw new Error('Smoke MCP getIssue result did not contain a Jira issue');
    }

    return issue;
  } finally {
    await client.close();
    await mcpServer.close();
  }
}

function parseRuntimeArg(argv: readonly string[]): SmokeRuntime {
  const runtimeIndex = argv.indexOf('--runtime');
  const value = runtimeIndex >= 0 ? argv[runtimeIndex + 1] : undefined;

  if (value === 'sdk' || value === 'cli') {
    return value;
  }

  throw new Error('Usage: pnpm smoke --runtime sdk|cli [--mode mock|live]');
}

function parseModeArg(argv: readonly string[]): SmokeMode {
  const modeIndex = argv.indexOf('--mode');
  const value = modeIndex >= 0 ? argv[modeIndex + 1] : undefined;

  if (value === 'live') {
    return 'live';
  }

  return 'mock';
}

async function readIssueThroughRealJira(): Promise<JiraIssue> {
  const config = loadConfigFromEnv({
    ...process.env,
    ...(process.env.JIRA_PROJECT_ALLOWLIST === undefined ? { JIRA_PROJECT_ALLOWLIST: 'APMIS' } : {})
  });
  const jiraClient = new JiraClient({ ...config });
  const jql =
    process.env.JIRA_SMOKE_JQL ??
    'project = APMIS AND status = 处理中 AND assignee in (currentUser()) ORDER BY cf[13301] ASC, updated DESC';
  const searchResult = await jiraClient.searchIssues(jql, 1);

  if (searchResult.issues.length === 0) {
    throw new Error(`No Jira issues found for JQL: ${jql}`);
  }

  const issueKey = searchResult.issues[0]!.key;
  return jiraClient.getIssue(issueKey);
}

function parseTextPayload(content: unknown): Record<string, unknown> {
  if (!Array.isArray(content)) {
    throw new Error('Tool result did not include array content');
  }

  const first = content[0];
  if (!isRecord(first) || first.type !== 'text' || typeof first.text !== 'string') {
    throw new Error('Tool result did not include text content');
  }

  const parsed: unknown = JSON.parse(first.text);
  if (!isRecord(parsed)) {
    throw new Error('Tool result text was not an object');
  }

  return parsed;
}

function isJiraIssue(value: unknown): value is JiraIssue {
  return (
    isRecord(value) &&
    typeof value.key === 'string' &&
    typeof value.summary === 'string' &&
    Array.isArray(value.labels) &&
    Array.isArray(value.attachments)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
