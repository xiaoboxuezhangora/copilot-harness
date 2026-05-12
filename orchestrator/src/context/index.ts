import {
  type MemoryHotIndexRecordV1,
  type MemoryNamespace,
  type MemoryStore
} from '../memory/index.js';

export interface ContextFragment {
  readonly source: string;
  readonly content: string;
  readonly sensitivity: 'public' | 'restricted';
}

export interface RetrievalFragment {
  readonly sourceRef: string;
  readonly project: string;
  readonly path: string;
  readonly ref: string;
  readonly commit: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly content: string;
  readonly provider: 'gitlab' | 'local';
  readonly redacted?: boolean | undefined;
}

export interface SkillHintFragment {
  readonly skill: string;
  readonly hint: string;
  readonly sourceRef?: string | undefined;
}

export interface RetrievalBudget {
  readonly maxBytesPerFragment: number;
  readonly maxTotalBytes: number;
}

export interface RetrievalBudgetSummary {
  readonly max_bytes_per_fragment: number;
  readonly max_total_bytes: number;
  readonly used_bytes: number;
  readonly truncated_count: number;
  readonly dropped_count: number;
}

export interface AssembledContext {
  readonly fragments: readonly ContextFragment[];
  readonly redactionApplied: boolean;
  readonly memory_hit_count: number;
  readonly retrieval_hit_count: number;
  readonly skill_hint_count: number;
  readonly memory_loading_strategy?: 'hot_index_then_lazy_search' | 'search_lazy_detail';
  readonly retrieval_budget_summary?: RetrievalBudgetSummary | undefined;
}

export interface ContextAssembler {
  assemble(_fragments: readonly ContextFragment[]): AssembledContext;
}

export interface MemoryInjectionRequest {
  readonly query: string;
  readonly limit: number;
  readonly namespace?: MemoryNamespace | undefined;
  readonly includeExpired?: boolean | undefined;
  readonly fragmentSensitivity?: ContextFragment['sensitivity'];
}

export interface MemoryAwareContextAssembler extends ContextAssembler {
  assembleWithMemory(
    _fragments: readonly ContextFragment[],
    _request: MemoryInjectionRequest
  ): Promise<AssembledContext>;

  assembleForJiraGitLabAnalysis(
    _request: JiraGitLabContextAssemblyRequest
  ): Promise<AssembledContext>;
}

export interface JiraGitLabContextAssemblyRequest {
  readonly jiraFragments: readonly ContextFragment[];
  readonly memoryRequest: MemoryInjectionRequest;
  readonly retrievalFragments: readonly RetrievalFragment[];
  readonly skillHints: readonly SkillHintFragment[];
  readonly retrievalBudget?: RetrievalBudget | undefined;
}

export class DefaultContextAssembler implements ContextAssembler {
  assemble(fragments: readonly ContextFragment[]): AssembledContext {
    return {
      fragments: [...fragments],
      redactionApplied: false,
      memory_hit_count: 0,
      retrieval_hit_count: 0,
      skill_hint_count: 0
    };
  }
}

export class MemoryBackedContextAssembler implements MemoryAwareContextAssembler {
  constructor(private readonly memoryStore: MemoryStore) {}

  assemble(fragments: readonly ContextFragment[]): AssembledContext {
    return {
      fragments: [...fragments],
      redactionApplied: false,
      memory_hit_count: 0,
      retrieval_hit_count: 0,
      skill_hint_count: 0
    };
  }

  async assembleWithMemory(
    fragments: readonly ContextFragment[],
    request: MemoryInjectionRequest
  ): Promise<AssembledContext> {
    const hotIndex = await this.memoryStore.hotIndex({
      namespace: request.namespace,
      limit: request.limit,
      includeExpired: request.includeExpired,
      maxSummaryBytes: 240
    });
    const memoryFragments = buildHotIndexContextFragments(
      hotIndex.records,
      request.fragmentSensitivity ?? 'restricted'
    );

    return {
      fragments: [...fragments, ...memoryFragments],
      redactionApplied: hotIndex.warnings.length > 0,
      memory_hit_count: memoryFragments.length,
      retrieval_hit_count: 0,
      skill_hint_count: 0,
      memory_loading_strategy: 'hot_index_then_lazy_search'
    };
  }

  async assembleForJiraGitLabAnalysis(
    request: JiraGitLabContextAssemblyRequest
  ): Promise<AssembledContext> {
    const hotIndex = await this.memoryStore.hotIndex({
      namespace: request.memoryRequest.namespace,
      limit: request.memoryRequest.limit,
      includeExpired: request.memoryRequest.includeExpired,
      maxSummaryBytes: 240
    });
    const memoryFragments = buildHotIndexContextFragments(
      hotIndex.records,
      request.memoryRequest.fragmentSensitivity ?? 'restricted'
    );
    const budget = request.retrievalBudget ?? {
      maxBytesPerFragment: 8_192,
      maxTotalBytes: 24_576
    };
    const retrievalResult = buildRetrievalContextFragments(request.retrievalFragments, budget);
    const skillFragments = request.skillHints.map((hint) => ({
      source: `skill:${hint.skill}`,
      content:
        hint.sourceRef === undefined
          ? `hint: ${hint.hint}`
          : `source_ref: ${hint.sourceRef}\nhint: ${hint.hint}`,
      sensitivity: 'restricted' as const
    }));

    return {
      fragments: [
        ...request.jiraFragments,
        ...memoryFragments,
        ...retrievalResult.fragments,
        ...skillFragments
      ],
      redactionApplied:
        hotIndex.warnings.length > 0 ||
        retrievalResult.redactionApplied ||
        request.retrievalFragments.some((fragment) => fragment.redacted === true),
      memory_hit_count: memoryFragments.length,
      retrieval_hit_count: retrievalResult.fragments.length,
      skill_hint_count: skillFragments.length,
      memory_loading_strategy: 'hot_index_then_lazy_search',
      retrieval_budget_summary: retrievalResult.budgetSummary
    };
  }
}

export function renderAssembledContextPrompt(context: AssembledContext): string {
  const lines: string[] = [
    `memory_hit_count: ${context.memory_hit_count}`,
    `redaction_applied: ${context.redactionApplied}`
  ];

  if (context.memory_loading_strategy !== undefined) {
    lines.push(`memory_loading_strategy: ${context.memory_loading_strategy}`);
  }

  if (context.retrieval_hit_count > 0) {
    lines.push(`retrieval_hit_count: ${context.retrieval_hit_count}`);
  }

  if (context.skill_hint_count > 0) {
    lines.push(`skill_hint_count: ${context.skill_hint_count}`);
  }

  if (context.retrieval_budget_summary !== undefined) {
    lines.push(`retrieval_budget_summary: ${JSON.stringify(context.retrieval_budget_summary)}`);
  }

  context.fragments.forEach((fragment, index) => {
    lines.push(
      '',
      `[fragment ${index + 1}] source=${fragment.source} sensitivity=${fragment.sensitivity}`,
      fragment.content
    );
  });

  return lines.join('\n');
}

function buildHotIndexContextFragments(
  records: readonly MemoryHotIndexRecordV1[],
  sensitivity: ContextFragment['sensitivity']
): readonly ContextFragment[] {
  return records.map((record) => ({
    source: `memory_hot_index:${record.namespace}`,
    content: [
      `source_ref: ${record.source_ref}`,
      `key: ${record.key}`,
      `score: ${record.score}`,
      `hit_count: ${record.hit_count}`,
      `summary: ${record.summary}`
    ].join('\n'),
    sensitivity
  }));
}

function buildRetrievalContextFragments(
  fragments: readonly RetrievalFragment[],
  budget: RetrievalBudget
): {
  readonly fragments: readonly ContextFragment[];
  readonly budgetSummary: RetrievalBudgetSummary;
  readonly redactionApplied: boolean;
} {
  const contextFragments: ContextFragment[] = [];
  let usedBytes = 0;
  let truncatedCount = 0;
  let droppedCount = 0;
  let redactionApplied = false;

  for (const fragment of fragments) {
    if (isExcludedRetrievalPath(fragment.path)) {
      droppedCount += 1;
      continue;
    }

    const header = [
      `source_ref: ${fragment.sourceRef}`,
      `provider: ${fragment.provider}`,
      `project: ${fragment.project}`,
      `path: ${fragment.path}`,
      `ref: ${fragment.ref}`,
      `commit: ${fragment.commit}`,
      `line_range: L${fragment.startLine}-L${fragment.endLine}`
    ].join('\n');
    const remainingBytes = budget.maxTotalBytes - usedBytes;
    const maxContentBytes = Math.min(budget.maxBytesPerFragment, Math.max(0, remainingBytes));

    if (maxContentBytes <= 0) {
      droppedCount += 1;
      continue;
    }

    const slicedContent = truncateUtf8(fragment.content, maxContentBytes);
    const originalBytes = Buffer.byteLength(fragment.content, 'utf8');
    const slicedBytes = Buffer.byteLength(slicedContent, 'utf8');
    const content = `${header}\ncontent:\n${slicedContent}`;

    contextFragments.push({
      source: `retrieval:${fragment.sourceRef}`,
      content,
      sensitivity: 'restricted'
    });

    usedBytes += slicedBytes;
    if (slicedBytes < originalBytes) {
      truncatedCount += 1;
      redactionApplied = true;
    }
  }

  return {
    fragments: contextFragments,
    redactionApplied,
    budgetSummary: {
      max_bytes_per_fragment: budget.maxBytesPerFragment,
      max_total_bytes: budget.maxTotalBytes,
      used_bytes: usedBytes,
      truncated_count: truncatedCount,
      dropped_count: droppedCount
    }
  };
}

function isExcludedRetrievalPath(path: string): boolean {
  const normalized = path.replaceAll('\\', '/').replace(/^\.\/+/, '');
  return (
    normalized.startsWith('.memory/') ||
    normalized.startsWith('reports/') ||
    normalized.startsWith('secrets/') ||
    normalized.startsWith('.env') ||
    normalized.includes('/.env') ||
    normalized.startsWith('node_modules/') ||
    normalized.startsWith('dist/') ||
    normalized.startsWith('coverage/')
  );
}

function truncateUtf8(content: string, maxBytes: number): string {
  if (Buffer.byteLength(content, 'utf8') <= maxBytes) {
    return content;
  }

  const marker = '\n[truncated]';
  const markerBytes = Buffer.byteLength(marker, 'utf8');
  if (maxBytes <= markerBytes) {
    return marker.slice(0, maxBytes);
  }

  const contentBudget = maxBytes - markerBytes;
  let end = content.length;
  while (end > 0 && Buffer.byteLength(content.slice(0, end), 'utf8') > contentBudget) {
    end -= 1;
  }

  return `${content.slice(0, end)}${marker}`;
}
