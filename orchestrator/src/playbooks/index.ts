import {
  isRepoEvidenceSourceRef,
  type ResolverPacketV1,
  type ResolverRiskLevel
} from '../resolver/index.js';

export const PLAYBOOK_SCHEMA_VERSION = 'playbook.v1';

export type PlaybookId = 'bugfix_fastlane' | 'refactor_guarded' | 'regression_recovery';
export type PlaybookRunStatus =
  | 'shadow_success'
  | 'needs_human_review'
  | 'blocked_missing_evidence'
  | 'blocked_high_risk';
export type PlaybookApprovalGate =
  | 'shadow_only'
  | 'human_review'
  | 'senior_review'
  | 'security_review';

export interface PlaybookInputContract {
  readonly required_packets: readonly string[];
  readonly optional_packets: readonly string[];
  readonly required_fields: readonly string[];
  readonly evidence_requirements: readonly string[];
  readonly forbidden_actions: readonly string[];
}

export interface PlaybookStepNode {
  readonly id: string;
  readonly title: string;
  readonly action: string;
  readonly exit_criteria: readonly string[];
}

export interface PlaybookStepEdge {
  readonly from: string;
  readonly to: string;
  readonly condition: string;
}

export interface PlaybookStepGraph {
  readonly nodes: readonly PlaybookStepNode[];
  readonly edges: readonly PlaybookStepEdge[];
}

export interface PlaybookFailureBranch {
  readonly condition: string;
  readonly action: string;
  readonly review_queue_reason: string;
}

export interface PlaybookSlo {
  readonly sample_minimum: number;
  readonly target_success_rate: number;
  readonly max_fallback_rate: number;
  readonly max_human_intervention_rate: number;
  readonly target_avg_handling_minutes: number;
}

export interface PlaybookSourceRefRules {
  readonly allowed_prefixes: readonly string[];
  readonly minimum_repo_evidence_refs: number;
  readonly require_source_refs_in_outputs: boolean;
  readonly missing_source_ref_action: 'blocked_missing_evidence';
  readonly fabrication_guard: 'validate_against_resolver_packet';
}

export interface PlaybookDefinitionV1 {
  readonly schema_version: typeof PLAYBOOK_SCHEMA_VERSION;
  readonly id: PlaybookId;
  readonly name: string;
  readonly description: string;
  readonly trigger_conditions: readonly string[];
  readonly input_contract: PlaybookInputContract;
  readonly step_graph: PlaybookStepGraph;
  readonly failure_branches: readonly PlaybookFailureBranch[];
  readonly rollback_actions: readonly string[];
  readonly slo: PlaybookSlo;
  readonly source_ref_rules: PlaybookSourceRefRules;
  readonly approval_thresholds: Readonly<Record<ResolverRiskLevel, PlaybookApprovalGate>>;
}

export interface PlaybookValidationIssue {
  readonly playbook_id: PlaybookId;
  readonly field: string;
  readonly message: string;
}

export interface PlaybookRunInput {
  readonly playbook: PlaybookDefinitionV1;
  readonly resolverPacket: ResolverPacketV1;
  readonly draftMrPacket?: PlaybookDraftPacketRef | undefined;
  readonly traceRef: string;
}

export interface PlaybookDraftPacketRef {
  readonly trace_ref: string;
  readonly source_refs: readonly string[];
}

export interface PlaybookRunResult {
  readonly trace_ref: string;
  readonly playbook_id: PlaybookId;
  readonly playbook_name: string;
  readonly issue_key: string;
  readonly status: PlaybookRunStatus;
  readonly risk_level: ResolverRiskLevel;
  readonly approval_gate: PlaybookApprovalGate;
  readonly source_refs: readonly string[];
  readonly repo_evidence_refs: readonly string[];
  readonly resolver_next_action: ResolverPacketV1['next_action'];
  readonly draft_mr_trace_ref: string | null;
  readonly estimated_handling_minutes: number;
  readonly decisions: readonly string[];
  readonly failure_reason: string | null;
  readonly rollback_actions: readonly string[];
  readonly external_writes: {
    readonly git_push: false;
    readonly merge_request_created: false;
    readonly jira_write: false;
  };
}

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | readonly JsonValue[] | JsonObject;
interface JsonObject {
  readonly [key: string]: JsonValue;
}

const PLAYBOOK_IDS: readonly PlaybookId[] = [
  'bugfix_fastlane',
  'refactor_guarded',
  'regression_recovery'
];

export const PLAYBOOK_DEFINITION_V1_JSON_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'playbook.v1.schema.json',
  title: 'playbook v1',
  type: 'object',
  additionalProperties: false,
  required: [
    'schema_version',
    'id',
    'name',
    'description',
    'trigger_conditions',
    'input_contract',
    'step_graph',
    'failure_branches',
    'rollback_actions',
    'slo',
    'source_ref_rules',
    'approval_thresholds'
  ],
  properties: {
    schema_version: { const: PLAYBOOK_SCHEMA_VERSION },
    id: { enum: PLAYBOOK_IDS },
    name: { type: 'string', minLength: 1 },
    description: { type: 'string', minLength: 1 },
    trigger_conditions: { type: 'array', minItems: 1 },
    input_contract: { type: 'object' },
    step_graph: { type: 'object' },
    failure_branches: { type: 'array', minItems: 1 },
    rollback_actions: { type: 'array', minItems: 1 },
    slo: { type: 'object' },
    source_ref_rules: { type: 'object' },
    approval_thresholds: { type: 'object' }
  }
} as const satisfies JsonObject;

const BASE_INPUT_CONTRACT: PlaybookInputContract = {
  required_packets: ['resolver_packet.v1'],
  optional_packets: ['draft_mr_packet.v1'],
  required_fields: [
    'resolver_packet.intent',
    'resolver_packet.risk_level',
    'resolver_packet.next_action',
    'resolver_packet.source_refs'
  ],
  evidence_requirements: [
    'At least one gitlab: or local: source_ref must back implementation-ready paths.',
    'source_refs must be copied from resolver_packet, never inferred.'
  ],
  forbidden_actions: ['git_push', 'merge_request_api', 'jira_write', 'auto_merge']
};

const BASE_SOURCE_REF_RULES: PlaybookSourceRefRules = {
  allowed_prefixes: ['gitlab:', 'local:'],
  minimum_repo_evidence_refs: 1,
  require_source_refs_in_outputs: true,
  missing_source_ref_action: 'blocked_missing_evidence',
  fabrication_guard: 'validate_against_resolver_packet'
};

const BASE_APPROVAL_THRESHOLDS: Readonly<Record<ResolverRiskLevel, PlaybookApprovalGate>> = {
  L0: 'shadow_only',
  L1: 'human_review',
  L2: 'senior_review',
  L3: 'security_review'
};

export const PLAYBOOK_DEFINITIONS: readonly PlaybookDefinitionV1[] = [
  {
    schema_version: PLAYBOOK_SCHEMA_VERSION,
    id: 'bugfix_fastlane',
    name: 'Bugfix Fastlane',
    description:
      'Fast shadow path for low-risk bug fixes with evidence-backed repo hints and draft MR review.',
    trigger_conditions: [
      'resolver_packet.intent.kind=bugfix',
      'risk_level in L0/L1',
      'resolver_packet has repository evidence source_ref',
      'resolver_packet.next_action=shadow_ready'
    ],
    input_contract: BASE_INPUT_CONTRACT,
    step_graph: {
      nodes: [
        {
          id: 'resolve',
          title: 'Resolve evidence',
          action: 'Consume resolver_packet and confirm source_ref coverage.',
          exit_criteria: ['repo_evidence_refs >= 1', 'risk_level is L0 or L1']
        },
        {
          id: 'compose',
          title: 'Compose draft package',
          action: 'Attach draft_mr_packet when available for human review.',
          exit_criteria: ['draft packet includes source_refs', 'external writes remain false']
        },
        {
          id: 'review',
          title: 'Human review handoff',
          action: 'Emit review checklist and validation commands.',
          exit_criteria: ['reviewer can compare intent, patch bundle, and rollback plan']
        }
      ],
      edges: [
        { from: 'resolve', to: 'compose', condition: 'evidence and risk gates pass' },
        { from: 'compose', to: 'review', condition: 'draft packet exists or fallback is recorded' }
      ]
    },
    failure_branches: [
      {
        condition: 'missing repository evidence source_ref',
        action: 'send sample to review queue and request evidence',
        review_queue_reason: 'missing_source_ref'
      },
      {
        condition: 'risk_level=L3 or unresolved context',
        action: 'stop fastlane and require human approval',
        review_queue_reason: 'risk_or_context_gate'
      }
    ],
    rollback_actions: [
      'Discard draft patch bundle before any branch is created.',
      'Keep Jira status unchanged and attach findings only to shadow report.',
      'Require a fresh resolver_packet after source_ref correction.'
    ],
    slo: {
      sample_minimum: 5,
      target_success_rate: 0.8,
      max_fallback_rate: 0.15,
      max_human_intervention_rate: 0.2,
      target_avg_handling_minutes: 30
    },
    source_ref_rules: BASE_SOURCE_REF_RULES,
    approval_thresholds: BASE_APPROVAL_THRESHOLDS
  },
  {
    schema_version: PLAYBOOK_SCHEMA_VERSION,
    id: 'refactor_guarded',
    name: 'Refactor Guarded',
    description:
      'Guarded shadow path for refactor, cleanup, docs, style, and structural maintenance work.',
    trigger_conditions: [
      'resolver_packet.intent.kind=maintenance',
      'summary or constraints mention refactor, cleanup, docs, style, copy, 文案, or 样式',
      'risk_level L2 requires senior review before any implementation branch'
    ],
    input_contract: {
      ...BASE_INPUT_CONTRACT,
      evidence_requirements: [
        ...BASE_INPUT_CONTRACT.evidence_requirements,
        'Refactor candidates must list rollback scope and touched modules before review.'
      ]
    },
    step_graph: {
      nodes: [
        {
          id: 'scope',
          title: 'Scope module boundary',
          action: 'Map resolver repo_hints to impacted modules and reject broad unclear work.',
          exit_criteria: ['repo_hints are present or missing context is explicit']
        },
        {
          id: 'guard',
          title: 'Apply guarded approval',
          action: 'Route L1/L2 work to human or senior review.',
          exit_criteria: ['approval threshold is recorded in audit trace']
        },
        {
          id: 'package',
          title: 'Package review plan',
          action: 'Emit draft review plan, tests, and rollback scope.',
          exit_criteria: ['source_refs and rollback actions are present']
        }
      ],
      edges: [
        { from: 'scope', to: 'guard', condition: 'module boundary is known' },
        { from: 'guard', to: 'package', condition: 'approval threshold is satisfiable' }
      ]
    },
    failure_branches: [
      {
        condition: 'missing module boundary or source_ref',
        action: 'send to review queue for scope clarification',
        review_queue_reason: 'unclear_refactor_scope'
      },
      {
        condition: 'risk_level=L3',
        action: 'stop and require security review',
        review_queue_reason: 'high_risk_refactor'
      }
    ],
    rollback_actions: [
      'Do not split modules automatically in shadow mode.',
      'Discard local diff bundle if source_ref or rollback scope changes.',
      'Require senior reviewer confirmation before any future branch creation.'
    ],
    slo: {
      sample_minimum: 5,
      target_success_rate: 0.7,
      max_fallback_rate: 0.25,
      max_human_intervention_rate: 0.45,
      target_avg_handling_minutes: 60
    },
    source_ref_rules: BASE_SOURCE_REF_RULES,
    approval_thresholds: BASE_APPROVAL_THRESHOLDS
  },
  {
    schema_version: PLAYBOOK_SCHEMA_VERSION,
    id: 'regression_recovery',
    name: 'Regression Recovery',
    description:
      'Recovery path for upgrade regressions and production-like behavior regressions with rollback-first handling.',
    trigger_conditions: [
      'summary mentions regression, upgrade, rollback, recovery, blank page, fallback, 回归, 升级, or 恢复',
      'resolver_packet includes validation or missing validation question',
      'rollback plan must be generated before implementation review'
    ],
    input_contract: {
      ...BASE_INPUT_CONTRACT,
      required_fields: [...BASE_INPUT_CONTRACT.required_fields, 'resolver_packet.missing_info'],
      evidence_requirements: [
        ...BASE_INPUT_CONTRACT.evidence_requirements,
        'Regression candidates must include reproducible evidence or enter review queue.'
      ]
    },
    step_graph: {
      nodes: [
        {
          id: 'triage',
          title: 'Triage regression',
          action: 'Classify risk and confirm reproduction/source evidence.',
          exit_criteria: ['regression signal is present', 'risk gate is recorded']
        },
        {
          id: 'rollback_first',
          title: 'Prepare rollback first',
          action: 'Emit rollback actions before draft implementation text.',
          exit_criteria: ['rollback actions are reviewable before patch comparison']
        },
        {
          id: 'recover',
          title: 'Recover in shadow',
          action: 'Compose review package or enqueue missing evidence.',
          exit_criteria: [
            'shadow_success, needs_human_review, blocked_missing_evidence, or blocked_high_risk decision is auditable'
          ]
        }
      ],
      edges: [
        { from: 'triage', to: 'rollback_first', condition: 'regression evidence is sufficient' },
        { from: 'rollback_first', to: 'recover', condition: 'rollback plan is available' }
      ]
    },
    failure_branches: [
      {
        condition: 'missing reproduction or repository evidence',
        action: 'send to review queue with reproduction request',
        review_queue_reason: 'missing_regression_evidence'
      },
      {
        condition: 'high risk domain',
        action: 'require security or domain-owner review',
        review_queue_reason: 'high_risk_regression'
      }
    ],
    rollback_actions: [
      'Prefer reverting the narrowest reviewed patch bundle.',
      'Keep feature flags and production switches unchanged in shadow mode.',
      'Require validation evidence before retrying recovery path.'
    ],
    slo: {
      sample_minimum: 5,
      target_success_rate: 0.65,
      max_fallback_rate: 0.25,
      max_human_intervention_rate: 0.5,
      target_avg_handling_minutes: 90
    },
    source_ref_rules: BASE_SOURCE_REF_RULES,
    approval_thresholds: BASE_APPROVAL_THRESHOLDS
  }
];

export function validatePlaybookDefinition(
  playbook: PlaybookDefinitionV1
): readonly PlaybookValidationIssue[] {
  const issues: PlaybookValidationIssue[] = [];
  if (playbook.schema_version !== PLAYBOOK_SCHEMA_VERSION) {
    issues.push({
      playbook_id: playbook.id,
      field: 'schema_version',
      message: `schema_version must be ${PLAYBOOK_SCHEMA_VERSION}`
    });
  }
  if (!PLAYBOOK_IDS.includes(playbook.id)) {
    issues.push({ playbook_id: playbook.id, field: 'id', message: 'unknown playbook id' });
  }
  if (playbook.trigger_conditions.length === 0) {
    issues.push({
      playbook_id: playbook.id,
      field: 'trigger_conditions',
      message: 'at least one trigger condition is required'
    });
  }
  if (playbook.step_graph.nodes.length < 3) {
    issues.push({
      playbook_id: playbook.id,
      field: 'step_graph.nodes',
      message: 'at least three nodes are required'
    });
  }
  if (playbook.failure_branches.length === 0) {
    issues.push({
      playbook_id: playbook.id,
      field: 'failure_branches',
      message: 'at least one failure branch is required'
    });
  }
  if (playbook.rollback_actions.length === 0) {
    issues.push({
      playbook_id: playbook.id,
      field: 'rollback_actions',
      message: 'at least one rollback action is required'
    });
  }
  if (playbook.slo.sample_minimum < 5) {
    issues.push({
      playbook_id: playbook.id,
      field: 'slo.sample_minimum',
      message: 'sample minimum must be at least 5'
    });
  }
  if (playbook.source_ref_rules.minimum_repo_evidence_refs < 1) {
    issues.push({
      playbook_id: playbook.id,
      field: 'source_ref_rules.minimum_repo_evidence_refs',
      message: 'minimum repo evidence refs must be at least 1'
    });
  }
  if (
    playbook.approval_thresholds.L3 !== 'security_review' ||
    playbook.approval_thresholds.L2 !== 'senior_review'
  ) {
    issues.push({
      playbook_id: playbook.id,
      field: 'approval_thresholds',
      message: 'L2 and L3 approval gates must remain guarded'
    });
  }
  return issues;
}

export function matchesPlaybook(playbook: PlaybookDefinitionV1, packet: ResolverPacketV1): boolean {
  const text = normalizeText(
    `${packet.intent.kind} ${packet.intent.summary} ${packet.constraints.join(' ')} ${packet.missing_info.join(' ')}`
  );
  switch (playbook.id) {
    case 'bugfix_fastlane':
      return packet.intent.kind === 'bugfix' || containsAny(text, ['bug', 'fix', '修复']);
    case 'refactor_guarded':
      return (
        packet.intent.kind === 'maintenance' ||
        containsAny(text, ['refactor', 'cleanup', 'docs', 'style', 'copy', '重构', '文案', '样式'])
      );
    case 'regression_recovery':
      return containsAny(text, [
        'regression',
        'upgrade',
        'rollback',
        'recovery',
        'fallback',
        'blank',
        '回归',
        '升级',
        '恢复'
      ]);
  }
}

export function selectPlaybookSamples(input: {
  readonly playbook: PlaybookDefinitionV1;
  readonly packets: readonly ResolverPacketV1[];
  readonly sampleCount: number;
}): readonly ResolverPacketV1[] {
  const matched = input.packets.filter((packet) => matchesPlaybook(input.playbook, packet));
  const preferred = matched.filter((packet) => packet.risk_level !== 'L3');
  const selected = dedupePackets([...preferred, ...matched]);
  return selected.slice(0, input.sampleCount);
}

export function evaluatePlaybookRun(input: PlaybookRunInput): PlaybookRunResult {
  const repoEvidenceRefs = input.resolverPacket.source_refs.filter(isRepoEvidenceSourceRef);
  const hasEnoughEvidence =
    repoEvidenceRefs.length >= input.playbook.source_ref_rules.minimum_repo_evidence_refs;
  const approvalGate = input.playbook.approval_thresholds[input.resolverPacket.risk_level];
  const draftPacketMatches =
    input.draftMrPacket !== undefined &&
    input.draftMrPacket.source_refs.every((sourceRef) =>
      input.resolverPacket.source_refs.includes(sourceRef)
    );
  const decisions = buildDecisionTrail({
    hasEnoughEvidence,
    approvalGate,
    resolverPacket: input.resolverPacket,
    draftPacketMatches
  });
  const failureReason = classifyFailureReason({
    hasEnoughEvidence,
    approvalGate,
    resolverPacket: input.resolverPacket,
    draftPacketMatches
  });
  const status = classifyStatus(failureReason, approvalGate);

  return {
    trace_ref: input.traceRef,
    playbook_id: input.playbook.id,
    playbook_name: input.playbook.name,
    issue_key: input.resolverPacket.intent.issue_key,
    status,
    risk_level: input.resolverPacket.risk_level,
    approval_gate: approvalGate,
    source_refs: input.resolverPacket.source_refs,
    repo_evidence_refs: repoEvidenceRefs,
    resolver_next_action: input.resolverPacket.next_action,
    draft_mr_trace_ref: input.draftMrPacket?.trace_ref ?? null,
    estimated_handling_minutes: estimateHandlingMinutes({
      playbookId: input.playbook.id,
      status,
      riskLevel: input.resolverPacket.risk_level,
      hasEnoughEvidence
    }),
    decisions,
    failure_reason: failureReason,
    rollback_actions: input.playbook.rollback_actions,
    external_writes: {
      git_push: false,
      merge_request_created: false,
      jira_write: false
    }
  };
}

function buildDecisionTrail(input: {
  readonly hasEnoughEvidence: boolean;
  readonly approvalGate: PlaybookApprovalGate;
  readonly resolverPacket: ResolverPacketV1;
  readonly draftPacketMatches: boolean;
}): readonly string[] {
  const decisions = [
    input.hasEnoughEvidence ? 'repo_evidence:present' : 'repo_evidence:missing',
    `approval_gate:${input.approvalGate}`,
    `resolver_next_action:${input.resolverPacket.next_action}`,
    input.draftPacketMatches ? 'draft_mr_packet:matched' : 'draft_mr_packet:missing_or_unmatched'
  ];

  if (input.resolverPacket.risk_level === 'L3') {
    return [...decisions, 'high_risk:await_human'];
  }

  return decisions;
}

function classifyFailureReason(input: {
  readonly hasEnoughEvidence: boolean;
  readonly approvalGate: PlaybookApprovalGate;
  readonly resolverPacket: ResolverPacketV1;
  readonly draftPacketMatches: boolean;
}): string | null {
  if (input.resolverPacket.risk_level === 'L3') {
    return 'high_risk_requires_human';
  }
  if (!input.hasEnoughEvidence) {
    return 'missing_source_ref';
  }
  if (input.resolverPacket.next_action !== 'shadow_ready') {
    return `resolver_${input.resolverPacket.next_action}`;
  }
  if (!input.draftPacketMatches) {
    return 'draft_mr_packet_missing';
  }
  if (input.approvalGate !== 'shadow_only') {
    return `approval_gate_${input.approvalGate}`;
  }
  return null;
}

function classifyStatus(
  failureReason: string | null,
  approvalGate: PlaybookApprovalGate
): PlaybookRunStatus {
  if (failureReason === null) {
    return 'shadow_success';
  }
  if (failureReason === 'high_risk_requires_human') {
    return 'blocked_high_risk';
  }
  if (failureReason === 'missing_source_ref') {
    return 'blocked_missing_evidence';
  }
  if (
    failureReason === 'draft_mr_packet_missing' ||
    failureReason.startsWith('resolver_') ||
    approvalGate !== 'shadow_only'
  ) {
    return 'needs_human_review';
  }
  return 'needs_human_review';
}

function estimateHandlingMinutes(input: {
  readonly playbookId: PlaybookId;
  readonly status: PlaybookRunStatus;
  readonly riskLevel: ResolverRiskLevel;
  readonly hasEnoughEvidence: boolean;
}): number {
  const base = baseHandlingMinutes(input.playbookId);
  const riskExtra =
    input.riskLevel === 'L3'
      ? 45
      : input.riskLevel === 'L2'
        ? 20
        : input.riskLevel === 'L1'
          ? 10
          : 0;
  const statusExtra =
    input.status === 'blocked_high_risk'
      ? 45
      : input.status === 'blocked_missing_evidence'
        ? 30
        : input.status === 'needs_human_review'
          ? 15
          : 0;
  const evidenceExtra = input.hasEnoughEvidence ? 0 : 20;
  return base + riskExtra + statusExtra + evidenceExtra;
}

function baseHandlingMinutes(playbookId: PlaybookId): number {
  switch (playbookId) {
    case 'bugfix_fastlane':
      return 20;
    case 'refactor_guarded':
      return 45;
    case 'regression_recovery':
      return 60;
  }
}

function dedupePackets(packets: readonly ResolverPacketV1[]): readonly ResolverPacketV1[] {
  const seen = new Set<string>();
  const selected: ResolverPacketV1[] = [];
  packets.forEach((packet) => {
    const key = packet.intent.issue_key;
    if (!seen.has(key)) {
      seen.add(key);
      selected.push(packet);
    }
  });
  return selected;
}

function normalizeText(value: string): string {
  return value.toLowerCase();
}

function containsAny(value: string, needles: readonly string[]): boolean {
  return needles.some((needle) => value.includes(needle.toLowerCase()));
}
