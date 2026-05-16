import type { ResolverPacketV1, ResolverRiskLevel } from '../resolver/index.js';

export const DRAFT_MR_PACKET_SCHEMA_VERSION = 'draft_mr_packet.v1';

export type DraftMrBranchKind = 'feature' | 'fix' | 'refactor' | 'docs';
export type ExternalWriteOperation =
  | 'git_push'
  | 'merge_request_create'
  | 'merge_request_update'
  | 'merge_request_merge'
  | 'jira_write';

export interface DraftMrCommitPlanItem {
  readonly message: string;
  readonly files: readonly string[];
  readonly rationale: string;
}

export interface DraftMrCommitPlan {
  readonly strategy: 'single_commit' | 'await_human_before_commit';
  readonly commits: readonly DraftMrCommitPlanItem[];
  readonly source_refs: readonly string[];
}

export interface DraftMrDiffBundle {
  readonly patch_path: string;
  readonly review_checklist_path: string;
  readonly files_changed: readonly string[];
  readonly uncertainty: readonly string[];
  readonly source_refs: readonly string[];
}

export interface DraftMrTestPlanItem {
  readonly command: string;
  readonly purpose: string;
  readonly required_before_merge: boolean;
}

export interface DraftMrRollbackPlan {
  readonly summary: string;
  readonly steps: readonly string[];
}

export interface DraftMrWriteGuard {
  readonly git_push: 'blocked';
  readonly merge_request_api: 'blocked';
  readonly jira_write: 'blocked';
  readonly warning: string;
}

export interface DraftMrPacketV1 {
  readonly schema_version: typeof DRAFT_MR_PACKET_SCHEMA_VERSION;
  readonly trace_ref: string;
  readonly branch_name: string;
  readonly commit_plan: DraftMrCommitPlan;
  readonly pr_title: string;
  readonly pr_body: string;
  readonly diff_bundle: DraftMrDiffBundle;
  readonly test_plan: readonly DraftMrTestPlanItem[];
  readonly rollback_plan: DraftMrRollbackPlan;
  readonly source_refs: readonly string[];
  readonly risk_level: ResolverRiskLevel;
  readonly write_guard: DraftMrWriteGuard;
}

export interface DraftMrComposeOptions {
  readonly traceRef: string;
  readonly patchPath: string;
  readonly reviewChecklistPath: string;
}

export interface DraftMrBundleArtifact {
  readonly packet: DraftMrPacketV1;
  readonly patchText: string;
  readonly reviewChecklistText: string;
  readonly auditRecord: DraftMrAuditRecord;
}

export interface DraftMrAuditRecord {
  readonly schema_version: 'w15-draft-mr-audit@1';
  readonly event_name: 'draft_mr_packet.composed';
  readonly trace_ref: string;
  readonly timestamp: string;
  readonly issue_key: string;
  readonly branch_name: string;
  readonly source_refs: readonly string[];
  readonly risk_level: ResolverRiskLevel;
  readonly external_writes: {
    readonly git_push: false;
    readonly merge_request_created: false;
    readonly jira_write: false;
  };
}

export interface ExternalWriteGuardResult {
  readonly operation: ExternalWriteOperation;
  readonly allowed: false;
  readonly status: 'blocked';
  readonly trace_ref: string;
  readonly source_refs: readonly string[];
  readonly warning: string;
}

export interface DraftMrPacketValidationIssue {
  readonly field: string;
  readonly message: string;
}

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | readonly JsonValue[] | JsonObject;
interface JsonObject {
  readonly [key: string]: JsonValue;
}

export const DRAFT_MR_PACKET_V1_JSON_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'draft_mr_packet.v1.schema.json',
  title: 'draft_mr_packet v1',
  type: 'object',
  additionalProperties: false,
  required: [
    'schema_version',
    'trace_ref',
    'branch_name',
    'commit_plan',
    'pr_title',
    'pr_body',
    'diff_bundle',
    'test_plan',
    'rollback_plan',
    'source_refs',
    'risk_level',
    'write_guard'
  ],
  properties: {
    schema_version: { const: DRAFT_MR_PACKET_SCHEMA_VERSION },
    trace_ref: { type: 'string', minLength: 1 },
    branch_name: { type: 'string', pattern: '^(feature|fix|refactor|docs)/' },
    commit_plan: { type: 'object' },
    pr_title: { type: 'string', minLength: 1 },
    pr_body: { type: 'string', minLength: 1 },
    diff_bundle: { type: 'object' },
    test_plan: { type: 'array' },
    rollback_plan: { type: 'object' },
    source_refs: { type: 'array', items: { type: 'string', minLength: 1 } },
    risk_level: { enum: ['L0', 'L1', 'L2', 'L3'] },
    write_guard: { type: 'object' }
  }
} as const satisfies JsonObject;

const BRANCH_KIND_VALUES = ['feature', 'fix', 'refactor', 'docs'] as const;

export function composeDraftMrBundle(
  resolverPacket: ResolverPacketV1,
  options: DraftMrComposeOptions
): DraftMrBundleArtifact {
  const branchKind = resolveBranchKind(resolverPacket);
  const branchName = buildBranchName(resolverPacket, branchKind);
  const uncertainty = buildUncertaintyNotes(resolverPacket);
  const filesChanged = buildReviewFiles(resolverPacket, branchName);
  const sourceRefs = resolverPacket.source_refs;
  const commitPlan = buildCommitPlan(resolverPacket, branchKind, filesChanged);
  const testPlan = buildTestPlan(resolverPacket);
  const rollbackPlan = buildRollbackPlan(resolverPacket, filesChanged);
  const writeGuard = buildWriteGuard();
  const prTitle = buildPrTitle(resolverPacket, branchKind);
  const prBody = renderPrBody({
    resolverPacket,
    branchName,
    commitPlan,
    testPlan,
    rollbackPlan,
    uncertainty,
    sourceRefs
  });
  const packet: DraftMrPacketV1 = {
    schema_version: DRAFT_MR_PACKET_SCHEMA_VERSION,
    trace_ref: options.traceRef,
    branch_name: branchName,
    commit_plan: commitPlan,
    pr_title: prTitle,
    pr_body: prBody,
    diff_bundle: {
      patch_path: options.patchPath,
      review_checklist_path: options.reviewChecklistPath,
      files_changed: filesChanged,
      uncertainty,
      source_refs: sourceRefs
    },
    test_plan: testPlan,
    rollback_plan: rollbackPlan,
    source_refs: sourceRefs,
    risk_level: resolverPacket.risk_level,
    write_guard: writeGuard
  };

  return {
    packet,
    patchText: renderPatchText(packet, resolverPacket),
    reviewChecklistText: renderReviewChecklist(packet, resolverPacket),
    auditRecord: buildAuditRecord(packet, resolverPacket)
  };
}

export function guardExternalWriteAttempt(input: {
  readonly operation: ExternalWriteOperation;
  readonly traceRef: string;
  readonly sourceRefs: readonly string[];
}): ExternalWriteGuardResult {
  return {
    operation: input.operation,
    allowed: false,
    status: 'blocked',
    trace_ref: input.traceRef,
    source_refs: input.sourceRefs,
    warning: `Blocked ${input.operation}: W15 shadow mode freezes all external writes until RB-1/RB-2 are closed.`
  };
}

export function validateDraftMrPacketV1(
  value: DraftMrPacketV1
): readonly DraftMrPacketValidationIssue[] {
  const issues: DraftMrPacketValidationIssue[] = [];

  if (value.schema_version !== DRAFT_MR_PACKET_SCHEMA_VERSION) {
    issues.push({
      field: 'schema_version',
      message: `schema_version must be ${DRAFT_MR_PACKET_SCHEMA_VERSION}`
    });
  }
  if (!/^(feature|fix|refactor|docs)\/[a-z0-9][a-z0-9._-]*$/u.test(value.branch_name)) {
    issues.push({
      field: 'branch_name',
      message: 'branch_name must use feature/fix/refactor/docs prefix'
    });
  }
  if (!value.pr_body.includes('Source refs')) {
    issues.push({ field: 'pr_body', message: 'pr_body must include Source refs' });
  }
  if (!value.pr_body.includes(`Risk level: ${value.risk_level}`)) {
    issues.push({ field: 'pr_body', message: 'pr_body must include risk level' });
  }
  if (value.source_refs.length === 0) {
    issues.push({ field: 'source_refs', message: 'source_refs must not be empty' });
  }
  if (value.diff_bundle.uncertainty.length > 0 && !value.pr_body.includes('Uncertainty')) {
    issues.push({
      field: 'pr_body',
      message: 'pr_body must explicitly mark uncertainty when evidence is missing'
    });
  }
  if (
    value.write_guard.git_push !== 'blocked' ||
    value.write_guard.merge_request_api !== 'blocked' ||
    value.write_guard.jira_write !== 'blocked'
  ) {
    issues.push({ field: 'write_guard', message: 'all external writes must be blocked' });
  }

  return issues;
}

export function resolveBranchKind(packet: ResolverPacketV1): DraftMrBranchKind {
  const constraintKind = packet.constraints.map(readBranchKindFromConstraint).find(isBranchKind);
  if (constraintKind !== undefined) {
    return constraintKind;
  }

  const summary = packet.intent.summary.toLowerCase();
  if (packet.intent.kind === 'bugfix') return 'fix';
  if (packet.intent.kind === 'feature') return 'feature';
  if (summary.includes('refactor') || summary.includes('重构')) return 'refactor';
  if (summary.includes('docs') || summary.includes('readme') || summary.includes('文档'))
    return 'docs';
  if (packet.intent.kind === 'maintenance') return 'refactor';
  return 'feature';
}

export function renderPatchText(packet: DraftMrPacketV1, resolverPacket: ResolverPacketV1): string {
  const shadowPath = `.shadow/draft-mr/${sanitizePathSegment(resolverPacket.intent.issue_key)}.md`;
  const lines = [
    `# ${packet.pr_title}`,
    '',
    `trace_ref: ${packet.trace_ref}`,
    `branch_name: ${packet.branch_name}`,
    `risk_level: ${packet.risk_level}`,
    `next_action: ${resolverPacket.next_action}`,
    '',
    '## Source refs',
    ...packet.source_refs.map((sourceRef) => `- ${sourceRef}`),
    '',
    '## Human review checklist',
    ...packet.diff_bundle.files_changed.map((file) => `- [ ] Compare intended change for ${file}`),
    '',
    '## Uncertainty',
    ...(packet.diff_bundle.uncertainty.length === 0
      ? ['- none']
      : packet.diff_bundle.uncertainty.map((item) => `- ${item}`))
  ];
  const patchLines = lines.map((line) => `+${line}`);

  return [
    `diff --git a/${shadowPath} b/${shadowPath}`,
    'new file mode 100644',
    'index 0000000..0000000',
    '--- /dev/null',
    `+++ b/${shadowPath}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...patchLines,
    ''
  ].join('\n');
}

export function renderReviewChecklist(
  packet: DraftMrPacketV1,
  resolverPacket: ResolverPacketV1
): string {
  const repoHintLines =
    resolverPacket.repo_hints.length === 0
      ? ['- repo_hints: none']
      : resolverPacket.repo_hints.map(
          (hint) =>
            `- repo_hint: ${hint.project}/${hint.module}; confidence=${hint.confidence}; locator=${hint.locator}`
        );

  return [
    `# Draft MR Review Checklist: ${resolverPacket.intent.issue_key}`,
    '',
    `- trace_ref: ${packet.trace_ref}`,
    `- branch_name: ${packet.branch_name}`,
    `- risk_level: ${packet.risk_level}`,
    `- next_action: ${resolverPacket.next_action}`,
    '',
    '## Required Human Checks',
    '',
    '- [ ] Confirm source_refs are sufficient and not fabricated.',
    '- [ ] Compare patch bundle against resolver intent before applying anything.',
    '- [ ] Confirm no Git push or MR API call was executed.',
    '- [ ] Confirm PR body uncertainty section is accurate.',
    '- [ ] Confirm rollback plan is viable for the target repo.',
    '',
    '## Repo Hints',
    '',
    ...repoHintLines,
    '',
    '## Source refs',
    '',
    ...packet.source_refs.map((sourceRef) => `- ${sourceRef}`),
    ''
  ].join('\n');
}

function renderPrBody(input: {
  readonly resolverPacket: ResolverPacketV1;
  readonly branchName: string;
  readonly commitPlan: DraftMrCommitPlan;
  readonly testPlan: readonly DraftMrTestPlanItem[];
  readonly rollbackPlan: DraftMrRollbackPlan;
  readonly uncertainty: readonly string[];
  readonly sourceRefs: readonly string[];
}): string {
  const repoHints =
    input.resolverPacket.repo_hints.length === 0
      ? ['- No repo hints were resolved.']
      : input.resolverPacket.repo_hints.map(
          (hint) =>
            `- ${hint.project}/${hint.module} (confidence=${hint.confidence}, locator=${hint.locator})`
        );
  const uncertaintyLines =
    input.uncertainty.length === 0 ? ['- none'] : input.uncertainty.map((item) => `- ${item}`);

  return [
    '## Problem',
    input.resolverPacket.intent.summary,
    '',
    '## Proposed solution',
    `Create a draft MR on branch \`${input.branchName}\` for human review. This is a shadow-composed package only.`,
    '',
    '## Repo hints',
    ...repoHints,
    '',
    '## Risk',
    `Risk level: ${input.resolverPacket.risk_level}`,
    `Resolver next_action: ${input.resolverPacket.next_action}`,
    '',
    '## Validation',
    ...input.testPlan.map((item) => `- \`${item.command}\`: ${item.purpose}`),
    '',
    '## Rollback',
    input.rollbackPlan.summary,
    ...input.rollbackPlan.steps.map((step) => `- ${step}`),
    '',
    '## Source refs',
    ...input.sourceRefs.map((sourceRef) => `- ${sourceRef}`),
    '',
    '## Uncertainty',
    ...uncertaintyLines,
    '',
    '## Shadow guard',
    '- No Git push was executed.',
    '- No merge request API call was executed.',
    '- No Jira write was executed.'
  ].join('\n');
}

function buildBranchName(packet: ResolverPacketV1, branchKind: DraftMrBranchKind): string {
  const issueSegment = sanitizePathSegment(packet.intent.issue_key);
  const summarySegment = sanitizePathSegment(packet.intent.summary)
    .split('-')
    .slice(0, 5)
    .join('-');
  const suffix = summarySegment.length === 0 ? 'draft-mr' : summarySegment;
  return `${branchKind}/${issueSegment}-${suffix}`.slice(0, 96);
}

function buildPrTitle(packet: ResolverPacketV1, branchKind: DraftMrBranchKind): string {
  return `[Draft][${packet.intent.issue_key}] ${branchKind}: ${packet.intent.summary}`.slice(
    0,
    180
  );
}

function buildCommitPlan(
  packet: ResolverPacketV1,
  branchKind: DraftMrBranchKind,
  filesChanged: readonly string[]
): DraftMrCommitPlan {
  const strategy =
    packet.next_action === 'shadow_ready' ? 'single_commit' : 'await_human_before_commit';
  return {
    strategy,
    commits: [
      {
        message: `${branchKind}: ${packet.intent.issue_key} ${packet.intent.summary}`.slice(0, 120),
        files: filesChanged,
        rationale:
          packet.next_action === 'shadow_ready'
            ? 'Resolver packet has evidence-backed repo hints; human still reviews before applying.'
            : 'Resolver packet is not ready for implementation; commit is deferred until missing evidence is resolved.'
      }
    ],
    source_refs: packet.source_refs
  };
}

function buildReviewFiles(packet: ResolverPacketV1, branchName: string): readonly string[] {
  const evidenceFiles = packet.source_refs
    .map(extractFilePathFromSourceRef)
    .filter((filePath): filePath is string => filePath !== null)
    .slice(0, 5);
  if (evidenceFiles.length > 0) {
    return dedupe(evidenceFiles);
  }

  const hintedFiles = packet.repo_hints
    .filter((hint) => hint.module !== 'unknown')
    .map((hint) => hint.module)
    .slice(0, 5);
  if (hintedFiles.length > 0) {
    return hintedFiles;
  }
  return [`.shadow/draft-mr/${sanitizePathSegment(branchName)}.md`];
}

function extractFilePathFromSourceRef(sourceRef: string): string | null {
  const fileMarker = '#file:';
  const markerIndex = sourceRef.indexOf(fileMarker);
  if (markerIndex < 0) {
    return null;
  }
  const fileAndSuffix = sourceRef.slice(markerIndex + fileMarker.length);
  const suffixIndexes = [fileAndSuffix.indexOf('@'), fileAndSuffix.indexOf('#')]
    .filter((index) => index >= 0)
    .sort((left, right) => left - right);
  const suffixIndex = suffixIndexes[0];
  const filePath =
    suffixIndex === undefined ? fileAndSuffix.trim() : fileAndSuffix.slice(0, suffixIndex).trim();
  return filePath.length === 0 ? null : filePath;
}

function buildTestPlan(packet: ResolverPacketV1): readonly DraftMrTestPlanItem[] {
  const basePlan: DraftMrTestPlanItem[] = [
    {
      command: 'pnpm lint',
      purpose: 'Run repository lint after a human applies the patch.',
      required_before_merge: true
    },
    {
      command: 'pnpm typecheck',
      purpose: 'Verify strict TypeScript and project types after implementation.',
      required_before_merge: true
    },
    {
      command: 'pnpm test',
      purpose: 'Run regression tests before human approval.',
      required_before_merge: true
    }
  ];

  if (packet.risk_level === 'L2' || packet.risk_level === 'L3') {
    return [
      ...basePlan,
      {
        command: 'manual approval gate',
        purpose: `Required because resolver risk_level=${packet.risk_level}.`,
        required_before_merge: true
      }
    ];
  }

  return basePlan;
}

function buildRollbackPlan(
  packet: ResolverPacketV1,
  filesChanged: readonly string[]
): DraftMrRollbackPlan {
  return {
    summary:
      packet.next_action === 'shadow_ready'
        ? 'Revert the draft MR commit or restore touched files from the base branch.'
        : 'Do not apply a code change until missing evidence is resolved; discard the shadow patch if context changes.',
    steps: [
      'Keep this W15 packet as review-only evidence.',
      `If applied later, revert files: ${filesChanged.join(', ') || 'none'}.`,
      'Re-run the listed validation commands after rollback.'
    ]
  };
}

function buildUncertaintyNotes(packet: ResolverPacketV1): readonly string[] {
  const notes: string[] = [];
  const hasRepoSourceRef = packet.source_refs.some(
    (sourceRef) => sourceRef.startsWith('gitlab:') || sourceRef.startsWith('local:')
  );

  if (!hasRepoSourceRef) {
    notes.push('No gitlab: or local: repository source_ref is attached.');
  }
  if (packet.missing_info.length > 0) {
    notes.push(...packet.missing_info.map((question) => `Missing info: ${question}`));
  }
  if (packet.next_action !== 'shadow_ready') {
    notes.push(`Resolver next_action=${packet.next_action}; this packet must stay draft-only.`);
  }
  if (packet.risk_level === 'L3') {
    notes.push('High-risk domain requires human approval before implementation or external write.');
  }

  return dedupe(notes);
}

function buildWriteGuard(): DraftMrWriteGuard {
  return {
    git_push: 'blocked',
    merge_request_api: 'blocked',
    jira_write: 'blocked',
    warning: 'W15 shadow mode: real Git push, MR API calls, and Jira writes are blocked.'
  };
}

function buildAuditRecord(
  packet: DraftMrPacketV1,
  resolverPacket: ResolverPacketV1
): DraftMrAuditRecord {
  return {
    schema_version: 'w15-draft-mr-audit@1',
    event_name: 'draft_mr_packet.composed',
    trace_ref: packet.trace_ref,
    timestamp: new Date().toISOString(),
    issue_key: resolverPacket.intent.issue_key,
    branch_name: packet.branch_name,
    source_refs: packet.source_refs,
    risk_level: packet.risk_level,
    external_writes: {
      git_push: false,
      merge_request_created: false,
      jira_write: false
    }
  };
}

function readBranchKindFromConstraint(value: string): DraftMrBranchKind | null {
  const normalized = value.toLowerCase().trim();
  const match = /(?:branch(?:_kind)?|type|kind)[:=/](feature|fix|refactor|docs)/u.exec(normalized);
  if (match?.[1] !== undefined && isBranchKind(match[1])) {
    return match[1];
  }
  if (isBranchKind(normalized)) {
    return normalized;
  }
  return null;
}

function isBranchKind(value: string | null): value is DraftMrBranchKind {
  return value !== null && BRANCH_KIND_VALUES.some((kind) => kind === value);
}

function sanitizePathSegment(value: string): string {
  const sanitized = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .replace(/-{2,}/gu, '-');
  return sanitized.length === 0 ? 'draft-mr' : sanitized;
}

function dedupe(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}
