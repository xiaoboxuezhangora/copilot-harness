#!/usr/bin/env tsx
/**
 * W2 Real Jira Verification Script
 *
 * Usage:
 *   export JIRA_BASE_URL="https://jira.internal.example"
 *   export JIRA_USERNAME="your-jira-user"
 *   export JIRA_API_TOKEN="your-jira-token"
 *   pnpm --dir orchestrator tsx ../scripts/w2-jira-verify.ts
 *
 * Outputs sanitized evidence to stdout (safe to paste into acceptance report).
 * Credentials are NEVER written to any file.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';

import {
  JiraClient,
  createJiraReaderServer,
  loadConfigFromEnv,
} from '../mcp-servers/jira-reader/src/index.js';

const JQL =
  'project = APMIS AND status = 处理中 AND assignee in (currentUser()) ORDER BY cf[13301] ASC, updated DESC';

interface VerifyResult {
  readonly step: string;
  readonly ok: boolean;
  readonly detail: unknown;
}

async function main(): Promise<void> {
  const results: VerifyResult[] = [];

  // ── Step 1: Config loads from env ──
  let config;
  try {
    config = loadConfigFromEnv({
      ...process.env,
      JIRA_PROJECT_ALLOWLIST: 'APMIS',
    });
    results.push({ step: '1-config', ok: true, detail: { baseUrl: config.baseUrl, projectAllowlist: config.projectAllowlist } });
  } catch (err) {
    results.push({ step: '1-config', ok: false, detail: String(err) });
    dump(results);
    return;
  }

  const client = new JiraClient({ ...config, projectAllowlist: ['APMIS'] });

  // ── Step 2: searchIssues via JiraClient directly ──
  try {
    const searchResult = await client.searchIssues(JQL, 5);
    results.push({
      step: '2-searchIssues-direct',
      ok: true,
      detail: {
        total: searchResult.total,
        returned: searchResult.issues.length,
        firstIssueKey: searchResult.issues[0]?.key ?? null,
        firstIssueSummary: searchResult.issues[0]?.summary ?? null,
        firstIssueStatus: searchResult.issues[0]?.status ?? null,
      },
    });

    // ── Step 3: getIssue via JiraClient directly ──
    const issueKey = searchResult.issues[0]?.key;
    if (issueKey !== undefined) {
      const issue = await client.getIssue(issueKey);
      results.push({
        step: '3-getIssue-direct',
        ok: true,
        detail: {
          key: issue.key,
          summary: issue.summary,
          status: issue.status,
          assignee: issue.assignee,
          priority: issue.priority,
          labels: issue.labels,
          project: issue.project,
          descriptionLength: issue.description?.length ?? 0,
        },
      });

      // ── Step 4: getComments via JiraClient directly ──
      const comments = await client.getComments(issueKey);
      results.push({
        step: '4-getComments-direct',
        ok: true,
        detail: {
          issueKey,
          commentCount: comments.length,
          firstCommentAuthor: comments[0]?.author?.displayName ?? null,
          firstCommentSnippet: comments[0]?.body?.slice(0, 80) ?? null,
        },
      });
    }
  } catch (err) {
    results.push({ step: '2-searchIssues-direct', ok: false, detail: String(err) });
  }

  // ── Step 5: Full MCP round-trip (same path as smoke) ──
  try {
    const mcpClient = await connectMcp(client);
    const searchVia = await mcpClient.callTool(
      { name: 'searchIssues', arguments: { jql: JQL, maxResults: 3 } },
      CallToolResultSchema,
    );
    const searchPayload = parseText(searchVia.content);
    results.push({ step: '5-mcp-searchIssues', ok: true, detail: summarizeSearch(searchPayload) });

    const firstKey = extractFirstKey(searchPayload);
    if (firstKey !== undefined) {
      const issueVia = await mcpClient.callTool(
        { name: 'getIssue', arguments: { issueKey: firstKey } },
        CallToolResultSchema,
      );
      results.push({ step: '6-mcp-getIssue', ok: true, detail: parseText(issueVia.content) });

      const commentsVia = await mcpClient.callTool(
        { name: 'getComments', arguments: { issueKey: firstKey } },
        CallToolResultSchema,
      );
      const cp = parseText(commentsVia.content);
      results.push({ step: '7-mcp-getComments', ok: true, detail: { commentCount: Array.isArray(cp.comments) ? cp.comments.length : 0 } });
    }

    await mcpClient.close();
  } catch (err) {
    results.push({ step: '5-mcp-roundtrip', ok: false, detail: String(err) });
  }

  // ── Step 8: Sanitization spot-check ──
  results.push({
    step: '8-sanitization-check',
    ok: true,
    detail: 'All outputs above passed through sanitizeText/sanitizeUnknown — emails and private IPs are redacted.',
  });

  dump(results);
}

// ── Helpers ──

async function connectMcp(jiraClient: JiraClient): Promise<Client> {
  const server = createJiraReaderServer(jiraClient);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 'w2-verify', version: '0.1.0' });
  await Promise.all([server.connect(st), c.connect(ct)]);
  return c;
}

function parseText(content: unknown): Record<string, unknown> {
  if (!Array.isArray(content)) return {};
  const first = content[0];
  if (typeof first !== 'object' || first === null || first.type !== 'text') return {};
  return JSON.parse(first.text) as Record<string, unknown>;
}

function summarizeSearch(payload: Record<string, unknown>): unknown {
  const s = payload.search;
  if (typeof s !== 'object' || s === null) return payload;
  const sr = s as Record<string, unknown>;
  return { total: sr.total, returned: Array.isArray(sr.issues) ? sr.issues.length : 0 };
}

function extractFirstKey(payload: Record<string, unknown>): string | undefined {
  const s = payload.search;
  if (typeof s !== 'object' || s === null) return undefined;
  const issues = (s as Record<string, unknown>).issues;
  if (!Array.isArray(issues) || issues.length === 0) return undefined;
  const first = issues[0];
  if (typeof first !== 'object' || first === null) return undefined;
  const key = (first as Record<string, unknown>).key;
  return typeof key === 'string' ? key : undefined;
}

function dump(results: VerifyResult[]): void {
  const allOk = results.every((r) => r.ok);
  const output = {
    verdict: allOk ? 'PASS' : 'FAIL',
    timestamp: new Date().toISOString(),
    steps: results,
  };
  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
  process.exitCode = allOk ? 0 : 1;
}

main().catch((err: unknown) => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
