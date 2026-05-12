import { describe, expect, it } from 'vitest';

import {
  buildEvidencePacks,
  buildFieldPresence,
  buildMcpCalls,
  buildTasks,
  parseJsonlContent,
  type ShowcaseSnapshotV1
} from '../../scripts/showcase-export-lib.js';

describe('showcase export helper', () => {
  it('parses jsonl and skips invalid lines with warnings', () => {
    const warnings: string[] = [];
    const parsed = parseJsonlContent(
      [
        '{"taskId":"a-1","turnState":"done"}',
        '{"taskId":"a-2","turnState":"done"',
        '{"taskId":"a-3","turnState":"blocked"}'
      ].join('\n'),
      '/tmp/sample.jsonl',
      warnings
    );

    expect(parsed).toHaveLength(2);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('/tmp/sample.jsonl:2');
  });

  it('aggregates mcp tool calls and maps jira read-only side effect', () => {
    const mcpCalls = buildMcpCalls(
      [
        {
          taskId: 'w3-eval-sample',
          toolCalls: [{ toolName: 'getIssue', decision: 'allow' }]
        }
      ],
      []
    );

    expect(mcpCalls).toHaveLength(1);
    expect(mcpCalls[0]).toMatchObject({
      task_id: 'w3-eval-sample',
      mcp_server_name: 'jira-reader',
      mcp_tool_name: 'getIssue',
      side_effect_level: 'read',
      decision: 'allow'
    });
  });

  it('deduplicates audit calls when trace for same task/tool exists', () => {
    const mcpCalls = buildMcpCalls(
      [
        {
          taskId: 'same-task',
          toolCalls: [{ toolName: 'getIssue', decision: 'allow' }]
        },
        {
          taskId: 'audit-only-task',
          toolCalls: [{ toolName: 'searchIssues', decision: 'allow' }]
        }
      ],
      [
        {
          task_id: 'same-task',
          mcp_tool_name: 'getIssue',
          mcp_server_name: 'jira-reader',
          transport_type: 'in_memory',
          decision: 'allow',
          side_effect_level: 'read',
          success: true
        }
      ]
    );

    expect(mcpCalls).toHaveLength(2);
    expect(mcpCalls.filter((item) => item.task_id === 'same-task')).toHaveLength(1);
    expect(mcpCalls.find((item) => item.task_id === 'same-task')).toMatchObject({
      transport_type: 'in_memory',
      success: true
    });
    expect(mcpCalls.find((item) => item.task_id === 'audit-only-task')).toMatchObject({
      mcp_tool_name: 'searchIssues',
      side_effect_level: 'read'
    });
  });

  it('reads nested evidencePack fields and derives evidence pack size', () => {
    const taskStateRecords = [
      {
        taskId: 'task-ep-1',
        evidencePack: {
          evidences: [{ source_ref: 'source://a' }, { sourceRef: 'source://b' }],
          assumptions: [{ statement: 's1', confidence: 0.6 }],
          confidence: 0.9
        },
        execution_mode: 'eval'
      }
    ];
    const tasks = buildTasks(
      [
        {
          taskId: 'task-ep-1',
          turnState: 'done'
        }
      ],
      taskStateRecords
    );

    expect(tasks[0]?.evidence_pack_size).toBe(2);
    expect(tasks[0]?.execution_mode).toBe('eval');

    const packs = buildEvidencePacks(tasks, taskStateRecords);
    expect(packs).toHaveLength(1);
    expect(packs[0]).toMatchObject({
      task_id: 'task-ep-1',
      source_refs: ['source://a', 'source://b'],
      confidence: 0.9,
      evidence_count: 2
    });
    expect(packs[0]?.assumptions).toEqual([{ statement: 's1', confidence: 0.6 }]);
  });

  it('degrades missing fields to unknown/null and reflects in fieldPresence', () => {
    const tasks = buildTasks(
      [
        {
          taskId: 'task-no-optional',
          turnState: 'done'
        }
      ],
      []
    );

    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      task_id: 'task-no-optional',
      fleet_session_id: null,
      parent_task_id: null,
      agent_role: null,
      candidate_id: null,
      worktree_mode: '未接入',
      execution_mode: 'unknown',
      role: 'unknown',
      prompt_version: null,
      budget_usage: null,
      evidence_pack_size: 0
    });

    const snapshot: ShowcaseSnapshotV1 = {
      schemaVersion: 'ShowcaseSnapshotV1',
      metadata: {
        generatedAt: '2026-05-03T00:00:00.000Z',
        sourceFiles: ['orchestrator/docs/audit-sample-w3.jsonl'],
        sampleCount: 20,
        phase0Readiness: 'NOT_READY',
        warnings: ['missing real MCP trace']
      },
      fieldPresence: {},
      tasks,
      mcpCalls: [],
      evidencePacks: [],
      routeChains: [],
      jiraIssues: []
    };

    const fieldPresence = buildFieldPresence(snapshot);
    expect(fieldPresence['tasks.prompt_version']?.status).toBe('missing');
    expect(fieldPresence['tasks.role']?.status).toBe('missing');
    expect(fieldPresence['tasks.worktree_mode']?.status).toBe('missing');
  });
});
