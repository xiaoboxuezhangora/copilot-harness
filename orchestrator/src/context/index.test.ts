import { describe, expect, it } from 'vitest';

import {
  DefaultContextAssembler,
  MemoryBackedContextAssembler,
  renderAssembledContextPrompt
} from './index.js';
import type { ContextFragment } from './index.js';
import type {
  MemoryGetInput,
  MemoryFindSimilarInput,
  MemoryFindSimilarResult,
  MemoryHotIndexInput,
  MemoryHotIndexResult,
  MemoryListInput,
  MemoryPutInput,
  MemoryRecord,
  MemorySearchInput,
  MemoryStore
} from '../memory/index.js';

class FakeMemoryStore implements MemoryStore {
  public searchCalls = 0;

  constructor(private readonly records: readonly MemoryRecord[]) {}

  async put(_input: MemoryPutInput): Promise<MemoryRecord> {
    throw new Error('put is not used in this test');
  }

  async get(_input: MemoryGetInput): Promise<MemoryRecord | null> {
    throw new Error('get is not used in this test');
  }

  async search(input: MemorySearchInput): Promise<readonly MemoryRecord[]> {
    this.searchCalls += 1;
    const filtered = this.records
      .filter((record) =>
        input.namespace === undefined ? true : record.namespace === input.namespace
      )
      .filter((record) => record.value.toLowerCase().includes(input.query.toLowerCase()))
      .slice(0, input.limit);
    return filtered;
  }

  async list(_input: MemoryListInput): Promise<readonly MemoryRecord[]> {
    throw new Error('list is not used in this test');
  }

  async findSimilarMemoryRecords(
    _input: MemoryFindSimilarInput
  ): Promise<MemoryFindSimilarResult> {
    throw new Error('findSimilarMemoryRecords is not used in this test');
  }

  async hotIndex(input: MemoryHotIndexInput): Promise<MemoryHotIndexResult> {
    const excludedRecords = this.records.filter((record) =>
      input.namespace === undefined ? true : record.namespace === input.namespace
    );
    const warnings = excludedRecords
      .filter((record) => record.value.includes('Authorization: Bearer'))
      .map((record) => `excluded_redline_or_empty:${record.namespace}:${record.key}`);
    const records = excludedRecords
      .filter((record) =>
        input.namespace === undefined ? true : record.namespace === input.namespace
      )
      .filter((record) => !record.value.includes('Authorization: Bearer'))
      .sort((left, right) => {
        const leftTs = Date.parse(left.ts);
        const rightTs = Date.parse(right.ts);
        if (leftTs !== rightTs) return rightTs - leftTs;
        if (left.sourceRef !== right.sourceRef) return left.sourceRef.localeCompare(right.sourceRef);
        if (left.namespace !== right.namespace) return left.namespace.localeCompare(right.namespace);
        return left.key.localeCompare(right.key);
      })
      .slice(0, input.limit ?? 200)
      .map((record, index) => ({
        schema_version: 'phase-1c-w9-memory-hot-index@1' as const,
        namespace: record.namespace,
        key: record.key,
        source_ref: record.sourceRef,
        summary:
          input.maxSummaryBytes === undefined
            ? record.value
            : record.value.slice(0, input.maxSummaryBytes),
        score: 1 - index * 0.1,
        score_components: {
          recency_score: 1,
          confidence_score: record.confidence ?? 0.7,
          log_hit_score: 0,
          source_quality_score: 0.8
        },
        hit_count: 0,
        last_hit_at: null,
        last_injected_at: null,
        accepted_at: record.ts,
        confidence: record.confidence ?? 0.7
      }));

    return {
      ok: true,
      total: records.length,
      records,
      warnings
    };
  }
}

describe('context assembler', () => {
  it('assembles runtime fragments without mutation', () => {
    const fragments: readonly ContextFragment[] = [
      {
        source: 'jira://TASK-1',
        content: 'Issue summary',
        sensitivity: 'restricted'
      }
    ];

    const assembled = new DefaultContextAssembler().assemble(fragments);
    expect(assembled.fragments).toEqual(fragments);
    expect(assembled.redactionApplied).toBe(false);
    expect(assembled.memory_hit_count).toBe(0);
  });

  it('injects memory hot index into assembled context prompt snapshot', async () => {
    const store = new FakeMemoryStore([
      {
        namespace: 'decisions',
        key: 'blood-transfusion.double-check.required',
        value: 'Double-check gate must remain explicit.',
        sourceRef: 'skills/.github/skills/blood-transfusion/SKILL.md',
        producerAgent: 'investigator',
        confidence: 0.9,
        ts: '2026-05-07T01:00:00.000Z'
      }
    ]);
    const assembler = new MemoryBackedContextAssembler(store);

    const assembled = await assembler.assembleWithMemory(
      [
        {
          source: 'jira://TASK-2',
          content: 'Need investigation',
          sensitivity: 'restricted'
        }
      ],
      {
        namespace: 'decisions',
        query: 'double-check',
        limit: 3
      }
    );

    expect(assembled.memory_hit_count).toBe(1);
    expect(assembled.redactionApplied).toBe(false);
    expect(store.searchCalls).toBe(0);
    expect(renderAssembledContextPrompt(assembled)).toMatchInlineSnapshot(`
      "memory_hit_count: 1
      redaction_applied: false
      memory_loading_strategy: hot_index_then_lazy_search

      [fragment 1] source=jira://TASK-2 sensitivity=restricted
      Need investigation

      [fragment 2] source=memory_hot_index:decisions sensitivity=restricted
      source_ref: skills/.github/skills/blood-transfusion/SKILL.md
      key: blood-transfusion.double-check.required
      score: 1
      hit_count: 0
      summary: Double-check gate must remain explicit."
    `);
  });

  it('keeps injected memory order stable by timestamp and source_ref', async () => {
    const records: readonly MemoryRecord[] = [
      {
        namespace: 'knowledge_index',
        key: 'k-1',
        value: 'Angular table width should use one config source.',
        sourceRef: 'skills/.github/skills/angular-delivery/SKILL.md',
        triggerDescription: 'header/body desync',
        ts: '2026-05-07T00:00:00.000Z'
      },
      {
        namespace: 'decisions',
        key: 'k-2',
        value: 'Upgrade regressions need DOM evidence before CSS patches.',
        sourceRef: 'skills/.github/skills/angular17-upgrade-regression-handler/SKILL.md',
        producerAgent: 'investigator',
        confidence: 0.8,
        ts: '2026-05-07T02:00:00.000Z'
      }
    ];
    const reversed = [...records].reverse();

    const promptA = renderAssembledContextPrompt(
      await new MemoryBackedContextAssembler(new FakeMemoryStore(records)).assembleWithMemory([], {
        query: ' ',
        limit: 10
      })
    );
    const promptB = renderAssembledContextPrompt(
      await new MemoryBackedContextAssembler(new FakeMemoryStore(reversed)).assembleWithMemory([], {
        query: ' ',
        limit: 10
      })
    );

    expect(promptA).toBe(promptB);
  });

  it('does not inject redline memory raw content into prompt', async () => {
    const assembler = new MemoryBackedContextAssembler(
      new FakeMemoryStore([
        {
          namespace: 'knowledge_index',
          key: 'forbidden-secret',
          value: 'Authorization: Bearer abc.def.ghi should never be in prompt.',
          sourceRef: 'unit-test',
          triggerDescription: 'secret leak',
          ts: '2026-05-07T00:00:00.000Z'
        },
        {
          namespace: 'knowledge_index',
          key: 'safe-key',
          value: 'Only include source ref and summary.',
          sourceRef: 'skills/.github/skills/angular-delivery/SKILL.md',
          triggerDescription: 'safe summary',
          ts: '2026-05-07T00:01:00.000Z'
        }
      ])
    );

    const assembled = await assembler.assembleWithMemory([], {
      query: ' ',
      limit: 10
    });
    const prompt = renderAssembledContextPrompt(assembled);

    expect(assembled.redactionApplied).toBe(true);
    expect(assembled.memory_hit_count).toBe(1);
    expect(prompt).not.toContain('Bearer');
    expect(prompt).toContain('source_ref: skills/.github/skills/angular-delivery/SKILL.md');
  });

  it('assembles Jira GitLab analysis context in Memory > Retrieval > Skill order with budget', async () => {
    const assembler = new MemoryBackedContextAssembler(
      new FakeMemoryStore([
        {
          namespace: 'knowledge_index',
          key: 'approval-reminder',
          value: 'Approval reminder changes should verify schedule idempotency.',
          sourceRef: 'memory://approval-reminder',
          triggerDescription: 'approval reminder',
          ts: '2026-05-08T00:00:00.000Z'
        }
      ])
    );

    const assembled = await assembler.assembleForJiraGitLabAnalysis({
      jiraFragments: [
        {
          source: 'jira://OPS-101',
          content: 'Add approval reminder',
          sensitivity: 'restricted'
        }
      ],
      memoryRequest: {
        query: 'approval reminder',
        limit: 3
      },
      retrievalFragments: [
        {
          sourceRef: 'gitlab:ops/app#file:src/approval/reminder.ts@abc123#L10-L20',
          project: 'ops/app',
          path: 'src/approval/reminder.ts',
          ref: 'main',
          commit: 'abc123',
          startLine: 10,
          endLine: 20,
          provider: 'gitlab',
          content: 'x'.repeat(200)
        },
        {
          sourceRef: 'gitlab:ops/app#file:.memory/pending/raw.md@abc123#L1-L3',
          project: 'ops/app',
          path: '.memory/pending/raw.md',
          ref: 'main',
          commit: 'abc123',
          startLine: 1,
          endLine: 3,
          provider: 'gitlab',
          content: 'must not enter prompt'
        }
      ],
      skillHints: [
        {
          skill: 'angular-delivery',
          hint: 'Check notification service tests.',
          sourceRef: 'skills/.github/skills/angular-delivery/SKILL.md'
        }
      ],
      retrievalBudget: {
        maxBytesPerFragment: 32,
        maxTotalBytes: 40
      }
    });

    const prompt = renderAssembledContextPrompt(assembled);
    expect(assembled.memory_hit_count).toBe(1);
    expect(assembled.retrieval_hit_count).toBe(1);
    expect(assembled.skill_hint_count).toBe(1);
    expect(assembled.retrieval_budget_summary?.truncated_count).toBe(1);
    expect(assembled.retrieval_budget_summary?.dropped_count).toBe(1);

    const memoryIndex = prompt.indexOf('source=memory_hot_index:knowledge_index');
    const retrievalIndex = prompt.indexOf(
      'source=retrieval:gitlab:ops/app#file:src/approval/reminder.ts@abc123#L10-L20'
    );
    const skillIndex = prompt.indexOf('source=skill:angular-delivery');

    expect(memoryIndex).toBeGreaterThan(-1);
    expect(retrievalIndex).toBeGreaterThan(memoryIndex);
    expect(skillIndex).toBeGreaterThan(retrievalIndex);
    expect(prompt).toContain(
      'source_ref: gitlab:ops/app#file:src/approval/reminder.ts@abc123#L10-L20'
    );
    expect(prompt).toContain('path: src/approval/reminder.ts');
    expect(prompt).toContain('commit: abc123');
    expect(prompt).toContain('line_range: L10-L20');
    expect(prompt).not.toContain('must not enter prompt');
    expect(prompt).toContain('memory_loading_strategy: hot_index_then_lazy_search');
    expect(prompt).not.toContain('source=memory:knowledge_index');
  });

  it('uses hot_index summaries instead of direct search for Jira GitLab memory injection', async () => {
    const longMemoryValue = 'A'.repeat(500);
    const store = new FakeMemoryStore([
      {
        namespace: 'knowledge_index',
        key: 'oversized-memory',
        value: longMemoryValue,
        sourceRef: 'manual://memory/oversized',
        triggerDescription: 'oversized memory',
        ts: '2026-05-08T00:00:00.000Z'
      }
    ]);
    const assembler = new MemoryBackedContextAssembler(store);

    const assembled = await assembler.assembleForJiraGitLabAnalysis({
      jiraFragments: [],
      memoryRequest: {
        query: 'will not run direct search',
        limit: 1
      },
      retrievalFragments: [],
      skillHints: []
    });
    const prompt = renderAssembledContextPrompt(assembled);

    expect(assembled.memory_hit_count).toBe(1);
    expect(store.searchCalls).toBe(0);
    expect(prompt).toContain('source=memory_hot_index:knowledge_index');
    expect(prompt).toContain('summary:');
    expect(prompt).not.toContain(longMemoryValue);
    expect(prompt).toContain('memory_loading_strategy: hot_index_then_lazy_search');
  });
});
