import type { JiraEvidencePackV2 } from '../jira/evidence.js';
import type { ResolverPacketV1 } from '../resolver/index.js';
import type { RequirementGateResultV0, RequirementGateLight } from './gate.js';
import { routeIssueProfile } from './router.js';
import type { RequirementProfileKind, RequirementProfileSpecResultV0 } from './profiles.js';

export type CodeImpactStatus = 'ready' | 'need_more_context';
export type CodeImpactLight = 'green' | 'yellow' | 'red' | 'gray';

export type CodeImpactDimensionId =
  | 'SurfaceArea'
  | 'AbstractionInvasion'
  | 'Compatibility'
  | 'Verifiability'
  | 'Compliance'
  | 'Rollback';

export type TargetSymbolKind =
  | 'function'
  | 'class'
  | 'method'
  | 'component'
  | 'line_slice';

export type TargetChangeKind = 'add' | 'modify' | 'delete' | 'unknown';

export interface TargetCodeMapTargetV0 {
  readonly repo: string;
  readonly branch: string;
  readonly file: string;
  readonly symbol?: string | undefined;
  readonly symbolKind?: TargetSymbolKind | undefined;
  readonly startLine?: number | undefined;
  readonly endLine?: number | undefined;
  readonly changeKind?: TargetChangeKind | undefined;
  readonly sourceRef?: string | undefined;
}

export interface TargetCodeMapV0 {
  readonly schemaVersion: 'TargetCodeMapV0';
  readonly issueKey: string;
  readonly targets: readonly TargetCodeMapTargetV0[];
  readonly sourceRefs: readonly string[];
}

export interface GitLabContextEvidenceRefV1 {
  readonly source_ref: string;
}

export interface GitLabContextSearchResultV1 {
  readonly source_ref: string;
  readonly path: string;
}

export interface GitLabContextFileSliceV1 {
  readonly source_ref: string;
  readonly path: string;
}

export interface GitLabContextPackV1Like {
  readonly version: 'GitLabContextPackV1';
  readonly evidence_refs: readonly GitLabContextEvidenceRefV1[];
  readonly search_results: readonly GitLabContextSearchResultV1[];
  readonly file_slices: readonly GitLabContextFileSliceV1[];
  readonly need_more_context?: boolean | undefined;
}

export interface BuildCodeImpactReportInputV0 {
  readonly evidencePack: JiraEvidencePackV2;
  readonly requirementGateResult?: RequirementGateResultV0 | undefined;
  readonly profileSpecResult?: RequirementProfileSpecResultV0 | undefined;
  readonly targetCodeMap?: TargetCodeMapV0 | undefined;
  readonly gitlabContextPack?: GitLabContextPackV1Like | undefined;
  readonly resolverPacket?: ResolverPacketV1 | undefined;
}

export interface CodeImpactDimensionV0 {
  readonly id: CodeImpactDimensionId;
  readonly light: CodeImpactLight;
  readonly score: number | null;
  readonly reason: string;
  readonly riskSignals: readonly string[];
  readonly turnGreenCondition: string;
  readonly sourceRefs: readonly string[];
}

export interface CodeImpactOverallV0 {
  readonly light: CodeImpactLight;
  readonly reason: string;
  readonly stricterThanReqGate?: boolean | undefined;
  readonly combinedBetaLight?: CodeImpactLight | undefined;
  readonly sourceRefs: readonly string[];
}

export interface CodeImpactAuditPayloadV0 {
  readonly schemaVersion: 'CodeImpactAuditPayloadV0';
  readonly allowedCodeSourceRefs: readonly string[];
  readonly traceableTargetCount: number;
  readonly targetCount: number;
  readonly targetCodeMapStatus: CodeImpactTargetCodeMapStatus;
  readonly dimensionSummaries: readonly {
    readonly id: CodeImpactDimensionId;
    readonly light: CodeImpactLight;
    readonly reason: string;
    readonly sourceRefs: readonly string[];
  }[];
  readonly sourceRefs: readonly string[];
}

export type CodeImpactTargetCodeMapStatus =
  | 'missing'
  | 'missing_issue_key'
  | 'issue_key_mismatch'
  | 'empty_targets'
  | 'no_traceable_target'
  | 'partial_traceable_target'
  | 'traceable_ready';

export interface CodeImpactReportV0 {
  readonly schemaVersion: 'CodeImpactReportV0';
  readonly beta: true;
  readonly nonBlocking: true;
  readonly issueKey: string;
  readonly status: CodeImpactStatus;
  readonly profile: RequirementProfileKind;
  readonly targetCodeMapStatus: CodeImpactTargetCodeMapStatus;
  readonly dimensions: readonly CodeImpactDimensionV0[];
  readonly overall: CodeImpactOverallV0;
  readonly downgradeSuggestions: readonly string[];
  readonly splitSuggestions: readonly string[];
  readonly sourceRefs: readonly string[];
  readonly auditPayload: CodeImpactAuditPayloadV0;
}

interface TraceableTarget {
  readonly repo: string;
  readonly branch: string;
  readonly file: string;
  readonly symbol: string;
  readonly symbolKind: TargetSymbolKind;
  readonly startLine: number | null;
  readonly endLine: number | null;
  readonly changeKind: TargetChangeKind;
  readonly sourceRef: string;
}

interface DimensionContext {
  readonly issueText: string;
  readonly targets: readonly TraceableTarget[];
  readonly targetCount: number;
  readonly repoCount: number;
  readonly fileCount: number;
  readonly moduleCount: number;
  readonly codeEvidenceSourceRefs: readonly string[];
  readonly verifierEvidence: readonly VerifierEvidence[];
  readonly resolverConstraints: readonly string[];
}

interface VerifierEvidence {
  readonly path: string;
  readonly sourceRef: string;
}

const ALL_DIMENSIONS: readonly CodeImpactDimensionId[] = [
  'SurfaceArea',
  'AbstractionInvasion',
  'Compatibility',
  'Verifiability',
  'Compliance',
  'Rollback'
] as const;

const MEDICAL_PATTERNS = ['medical', 'patient', 'transfusion', 'blood', '病历', '输血', '患者'];
const AUTH_BILLING_PATTERNS = [
  'auth',
  'token',
  'signature',
  'oauth',
  'billing',
  'payment',
  'invoice',
  'medical',
  'export',
  'credential',
  '权限',
  '计费',
  '签名'
];
const BYPASS_PATTERNS = ['bypass', 'skip auth', 'disable auth', '绕过', '免鉴权'];
const MANUAL_VERIFY_PATTERNS = ['manual', '人工', 'uat', 'smoke', '手工验证', '回归验证'];
const BREAKING_PATTERNS = ['breaking', 'rename', 'remove', '删除', '重命名', '破坏'];

export function buildCodeImpactReportV0(input: BuildCodeImpactReportInputV0): CodeImpactReportV0 {
  const issueKey = input.evidencePack.issue.key;
  const profile =
    input.profileSpecResult?.profile ??
    input.requirementGateResult?.profile ??
    routeIssueProfile(input.evidencePack).profile;

  const allowedCodeSourceRefs = collectAllowedCodeSourceRefs(input);
  const targetCodeMapIssueKey = input.targetCodeMap?.issueKey.trim() ?? '';
  const traceableTargets = buildTraceableTargets(input.targetCodeMap, allowedCodeSourceRefs);
  const targetCount = input.targetCodeMap?.targets.length ?? 0;
  const traceableTargetCount = traceableTargets.length;

  if (input.targetCodeMap !== undefined && targetCodeMapIssueKey.length === 0) {
    return buildNeedMoreContextGrayReport({
      issueKey,
      profile,
      requirementGateResult: input.requirementGateResult,
      allowedCodeSourceRefs,
      targetCodeMapStatus: 'missing_issue_key',
      targetCount,
      traceableTargetCount,
      reason: 'Target Code Map issueKey 为空，无法与当前 Jira 绑定。'
    });
  }

  const issueKeyMismatch =
    input.targetCodeMap !== undefined &&
    targetCodeMapIssueKey !== issueKey;

  if (issueKeyMismatch) {
    return buildNeedMoreContextGrayReport({
      issueKey,
      profile,
      requirementGateResult: input.requirementGateResult,
      allowedCodeSourceRefs,
      targetCodeMapStatus: 'issue_key_mismatch',
      targetCount,
      traceableTargetCount,
      reason: `Target Code Map issueKey(${input.targetCodeMap?.issueKey ?? ''}) 与 JiraEvidencePackV2 issueKey(${issueKey}) 不一致。`
    });
  }

  const targetCodeMapStatus = resolveTargetCodeMapStatus(input.targetCodeMap, allowedCodeSourceRefs);
  if (targetCodeMapStatus === 'partial_traceable_target') {
    return buildNeedMoreContextGrayReport({
      issueKey,
      profile,
      requirementGateResult: input.requirementGateResult,
      allowedCodeSourceRefs,
      targetCodeMapStatus,
      targetCount,
      traceableTargetCount,
      reason: 'targets 仅部分具备可追溯 code sourceRef，当前不允许输出红黄绿代码结论。'
    });
  }

  const hasCodeEvidence = traceableTargets.length > 0;

  if (!hasCodeEvidence) {
    const dimensions = buildGrayDimensions(
      `缺少可追溯代码证据：${describeMissingCodeEvidence(targetCodeMapStatus)}`,
      []
    );
    const overall: CodeImpactOverallV0 = {
      light: 'gray',
      reason: `Code Impact beta 仅支持基于 Target Code Map / code sourceRef 的评估；当前${describeMissingCodeEvidence(targetCodeMapStatus)}。`,
      ...(input.requirementGateResult !== undefined
        ? {
            combinedBetaLight: maxLight(
              mapRequirementGateLight(input.requirementGateResult.implementationReady.light),
              'gray'
            )
          }
        : {}),
      sourceRefs: []
    };

    const auditPayload: CodeImpactAuditPayloadV0 = {
      schemaVersion: 'CodeImpactAuditPayloadV0',
      allowedCodeSourceRefs,
      traceableTargetCount,
      targetCount,
      targetCodeMapStatus,
      dimensionSummaries: dimensions.map((dimension) => ({
        id: dimension.id,
        light: dimension.light,
        reason: dimension.reason,
        sourceRefs: dimension.sourceRefs
      })),
      sourceRefs: []
    };

    return {
      schemaVersion: 'CodeImpactReportV0',
      beta: true,
      nonBlocking: true,
      issueKey,
      status: 'need_more_context',
      profile,
      targetCodeMapStatus,
      dimensions,
      overall,
      downgradeSuggestions: [],
      splitSuggestions: [],
      sourceRefs: [],
      auditPayload
    };
  }

  const context = buildDimensionContext(input, traceableTargets);
  const dimensions = buildReadyDimensions(context);
  const overallLight = aggregateLight(dimensions);
  const overallSourceRefs = dedupeStrings(dimensions.flatMap((dimension) => dimension.sourceRefs));
  const reqGateLight = input.requirementGateResult?.implementationReady.light;
  const codeImpactVsReqGate =
    reqGateLight === undefined
      ? undefined
      : lightRank(overallLight) > lightRank(mapRequirementGateLight(reqGateLight));

  const overall: CodeImpactOverallV0 = {
    light: overallLight,
    reason: buildOverallReason(dimensions),
    ...(codeImpactVsReqGate === true ? { stricterThanReqGate: true } : {}),
    ...(reqGateLight !== undefined
      ? {
          combinedBetaLight: maxLight(
            mapRequirementGateLight(reqGateLight),
            overallLight
          )
        }
      : {}),
    sourceRefs: overallSourceRefs
  };

  const downgradeSuggestions = dedupeStrings(buildDowngradeSuggestions(dimensions));
  const splitSuggestions = dedupeStrings(buildSplitSuggestions(dimensions));

  const reportSourceRefs = dedupeStrings([
    ...dimensions.flatMap((dimension) => dimension.sourceRefs),
    ...overall.sourceRefs
  ]);

  const auditPayloadSourceRefs = dedupeStrings([
    ...reportSourceRefs,
    ...allowedCodeSourceRefs
  ]);

  const auditPayload: CodeImpactAuditPayloadV0 = {
    schemaVersion: 'CodeImpactAuditPayloadV0',
    allowedCodeSourceRefs,
    traceableTargetCount: traceableTargets.length,
    targetCount: input.targetCodeMap?.targets.length ?? traceableTargets.length,
    targetCodeMapStatus,
    dimensionSummaries: dimensions.map((dimension) => ({
      id: dimension.id,
      light: dimension.light,
      reason: dimension.reason,
      sourceRefs: dimension.sourceRefs
    })),
    sourceRefs: auditPayloadSourceRefs
  };

  return {
    schemaVersion: 'CodeImpactReportV0',
    beta: true,
    nonBlocking: true,
    issueKey,
    status: 'ready',
    profile,
    targetCodeMapStatus,
    dimensions,
    overall,
    downgradeSuggestions,
    splitSuggestions,
    sourceRefs: reportSourceRefs,
    auditPayload
  };
}

function resolveTargetCodeMapStatus(
  targetCodeMap: TargetCodeMapV0 | undefined,
  allowedCodeSourceRefs: readonly string[]
): CodeImpactTargetCodeMapStatus {
  if (targetCodeMap === undefined) {
    return 'missing';
  }

  if (targetCodeMap.targets.length === 0) {
    return 'empty_targets';
  }

  const traceableCount = targetCodeMap.targets.filter((target) => {
    const ref = target.sourceRef?.trim() ?? '';
    return ref.length > 0 && allowedCodeSourceRefs.includes(ref);
  }).length;

  if (traceableCount === 0) {
    return 'no_traceable_target';
  }

  if (traceableCount < targetCodeMap.targets.length) {
    return 'partial_traceable_target';
  }

  return 'traceable_ready';
}

function describeMissingCodeEvidence(status: CodeImpactTargetCodeMapStatus): string {
  switch (status) {
    case 'missing':
      return '缺少 Target Code Map';
    case 'missing_issue_key':
      return 'Target Code Map issueKey 为空';
    case 'issue_key_mismatch':
      return 'Target Code Map issueKey 与 Jira issueKey 不一致';
    case 'empty_targets':
      return 'Target Code Map targets 为空';
    case 'no_traceable_target':
      return 'targets 缺少可追溯 code sourceRef';
    case 'partial_traceable_target':
      return 'targets 仅部分具备可追溯 code sourceRef';
    case 'traceable_ready':
      return '无可用代码证据';
  }
}

function buildTraceableTargets(
  targetCodeMap: TargetCodeMapV0 | undefined,
  allowedCodeSourceRefs: readonly string[]
): readonly TraceableTarget[] {
  if (targetCodeMap === undefined) {
    return [];
  }

  const allowed = new Set(allowedCodeSourceRefs);
  return targetCodeMap.targets
    .map((target) => {
      const sourceRef = target.sourceRef?.trim() ?? '';
      if (sourceRef.length === 0 || !allowed.has(sourceRef)) {
        return null;
      }

      return {
        repo: target.repo.trim(),
        branch: target.branch.trim(),
        file: target.file.trim(),
        symbol: target.symbol?.trim() ?? '',
        symbolKind: target.symbolKind ?? 'line_slice',
        startLine:
          typeof target.startLine === 'number' && Number.isFinite(target.startLine)
            ? target.startLine
            : null,
        endLine:
          typeof target.endLine === 'number' && Number.isFinite(target.endLine)
            ? target.endLine
            : null,
        changeKind: target.changeKind ?? 'unknown',
        sourceRef
      } satisfies TraceableTarget;
    })
    .filter((target): target is TraceableTarget => target !== null);
}

function buildDimensionContext(
  input: BuildCodeImpactReportInputV0,
  traceableTargets: readonly TraceableTarget[]
): DimensionContext {
  const repoCount = new Set(traceableTargets.map((target) => target.repo)).size;
  const fileCount = new Set(traceableTargets.map((target) => target.file)).size;
  const moduleCount = new Set(traceableTargets.map((target) => inferModuleKey(target.file))).size;

  return {
    issueText: normalizeText([
      input.evidencePack.issue.summary,
      input.evidencePack.issue.description,
      ...input.evidencePack.issue.labels
    ]),
    targets: traceableTargets,
    targetCount: traceableTargets.length,
    repoCount,
    fileCount,
    moduleCount,
    codeEvidenceSourceRefs: dedupeStrings(traceableTargets.map((target) => target.sourceRef)),
    verifierEvidence: collectVerifierEvidence(input),
    resolverConstraints: input.resolverPacket?.constraints ?? []
  };
}

function collectVerifierEvidence(input: BuildCodeImpactReportInputV0): readonly VerifierEvidence[] {
  const allowed = new Set(collectAllowedCodeSourceRefs(input));
  const results: VerifierEvidence[] = [];

  for (const item of input.gitlabContextPack?.search_results ?? []) {
    const sourceRef = item.source_ref.trim();
    const path = item.path.trim();
    if (sourceRef.length === 0 || path.length === 0 || !allowed.has(sourceRef)) {
      continue;
    }
    results.push({ path, sourceRef });
  }

  for (const item of input.gitlabContextPack?.file_slices ?? []) {
    const sourceRef = item.source_ref.trim();
    const path = item.path.trim();
    if (sourceRef.length === 0 || path.length === 0 || !allowed.has(sourceRef)) {
      continue;
    }
    results.push({ path, sourceRef });
  }

  return dedupeVerifierEvidence(results);
}

function buildReadyDimensions(context: DimensionContext): readonly CodeImpactDimensionV0[] {
  return [
    buildSurfaceAreaDimension(context),
    buildAbstractionInvasionDimension(context),
    buildCompatibilityDimension(context),
    buildVerifiabilityDimension(context),
    buildComplianceDimension(context),
    buildRollbackDimension(context)
  ];
}

function buildSurfaceAreaDimension(context: DimensionContext): CodeImpactDimensionV0 {
  const signals: string[] = [
    `files=${context.fileCount}`,
    `repos=${context.repoCount}`,
    `modules=${context.moduleCount}`
  ];

  if (context.fileCount <= 1 && context.repoCount <= 1 && context.targetCount <= 1) {
    return buildReadyDimension({
      id: 'SurfaceArea',
      light: 'green',
      score: 92,
      reason: '影响面集中在单文件单目标，代码侧改动边界清晰。',
      riskSignals: signals,
      turnGreenCondition: '保持单模块内最小改动范围并避免扩散到共享模块。',
      context
    });
  }

  if (context.fileCount <= 5 && context.repoCount <= 2 && context.moduleCount <= 3) {
    return buildReadyDimension({
      id: 'SurfaceArea',
      light: 'yellow',
      score: 63,
      reason: '影响面进入多文件或多模块区间，建议限制单次改动范围。',
      riskSignals: signals,
      turnGreenCondition: '将改动收敛到 1 个模块并将文件数控制在 1-2 个。',
      context
    });
  }

  return buildReadyDimension({
    id: 'SurfaceArea',
    light: 'red',
    score: 28,
    reason: '影响面覆盖大量文件/仓库，侵入性过高。',
    riskSignals: signals,
    turnGreenCondition: '按仓库或模块拆分需求，每个子任务仅覆盖有限文件集合。',
    context
  });
}

function buildAbstractionInvasionDimension(context: DimensionContext): CodeImpactDimensionV0 {
  let maxLevel: 'green' | 'yellow' | 'red' = 'green';
  const signals: string[] = [];

  for (const target of context.targets) {
    const text = normalizeText([target.file, target.symbol]);
    if (matchesAny(text, ['framework', 'core', 'global', 'base', 'kernel', 'middleware'])) {
      maxLevel = 'red';
      signals.push(`cross_cutting:${target.file}`);
      continue;
    }

    if (matchesAny(text, ['service', 'api', 'shared', 'common', 'adapter', 'repository', 'contract'])) {
      if (maxLevel !== 'red') {
        maxLevel = 'yellow';
      }
      signals.push(`boundary:${target.file}`);
      continue;
    }

    if (signals.length < 3) {
      signals.push(`leaf:${target.file}`);
    }
  }

  if (maxLevel === 'green') {
    return buildReadyDimension({
      id: 'AbstractionInvasion',
      light: 'green',
      score: 88,
      reason: '目标位于局部叶子层/组件层，未触及全局抽象。',
      riskSignals: signals,
      turnGreenCondition: '继续避免改动 shared/core 层抽象边界。',
      context
    });
  }

  if (maxLevel === 'yellow') {
    return buildReadyDimension({
      id: 'AbstractionInvasion',
      light: 'yellow',
      score: 58,
      reason: '触达 service/API/shared 边界，存在抽象层扩散风险。',
      riskSignals: signals,
      turnGreenCondition: '将共享边界改动下沉到局部适配层并最小化接口变更。',
      context
    });
  }

  return buildReadyDimension({
    id: 'AbstractionInvasion',
    light: 'red',
    score: 24,
    reason: '触及 framework/core/global 级抽象，侵入性过高。',
    riskSignals: signals,
    turnGreenCondition: '将核心抽象变更拆到独立评审任务，并先采用外围适配方案。',
    context
  });
}

function buildCompatibilityDimension(context: DimensionContext): CodeImpactDimensionV0 {
  const hasDelete = context.targets.some((target) => target.changeKind === 'delete');
  const hasModify = context.targets.some((target) => target.changeKind === 'modify');
  const hasContractSignal = context.targets.some((target) =>
    matchesAny(normalizeText([target.file, target.symbol]), [
      'api',
      'public',
      'contract',
      'interface',
      'schema',
      'enum',
      'mapping',
      'state'
    ])
  );
  const hasBreakingSignal = matchesAny(context.issueText, BREAKING_PATTERNS);

  if (hasDelete || hasBreakingSignal) {
    return buildReadyDimension({
      id: 'Compatibility',
      light: 'red',
      score: 22,
      reason: '检测到删除/重命名/破坏契约风险，兼容性风险高。',
      riskSignals: dedupeStrings([
        ...(hasDelete ? ['changeKind=delete'] : []),
        ...(hasBreakingSignal ? ['issue:breaking_keyword'] : []),
        ...(hasContractSignal ? ['target:public_contract'] : [])
      ]),
      turnGreenCondition: '保留旧接口兼容层并通过版本化策略平滑迁移。',
      context
    });
  }

  if (hasModify || hasContractSignal) {
    return buildReadyDimension({
      id: 'Compatibility',
      light: 'yellow',
      score: 56,
      reason: '存在 public API/字段映射/状态枚举等兼容面改动。',
      riskSignals: dedupeStrings([
        ...(hasModify ? ['changeKind=modify'] : []),
        ...(hasContractSignal ? ['target:public_contract'] : [])
      ]),
      turnGreenCondition: '补充向后兼容断言并明确旧字段/旧枚举的保留策略。',
      context
    });
  }

  return buildReadyDimension({
    id: 'Compatibility',
    light: 'green',
    score: 90,
    reason: '当前为新增或局部非契约改动，兼容性风险可控。',
    riskSignals: ['changeKind=add_or_local'],
    turnGreenCondition: '保持新增行为默认兼容且不修改既有契约。',
    context
  });
}

function buildVerifiabilityDimension(context: DimensionContext): CodeImpactDimensionV0 {
  const automatedVerifierEvidence = context.verifierEvidence.filter((item) =>
    matchesAny(item.path, ['test', 'spec', 'fixture', 'mock'])
  );
  const automatedVerifierRefs = dedupeStrings(
    automatedVerifierEvidence.map((item) => item.sourceRef)
  );
  const hasAutomatedClue = automatedVerifierRefs.length > 0;
  const hasManualClue =
    matchesAny(context.issueText, MANUAL_VERIFY_PATTERNS) ||
    context.resolverConstraints.some((item) => matchesAny(item, MANUAL_VERIFY_PATTERNS));

  if (hasAutomatedClue) {
    return buildReadyDimension({
      id: 'Verifiability',
      light: 'green',
      score: 87,
      reason: '已定位到测试目标或 fixture 线索，可进行自动化验证。',
      riskSignals: dedupeStrings(automatedVerifierEvidence.map((item) => item.path)),
      turnGreenCondition: '将影响面映射到具体测试并在变更前后执行回归。',
      context,
      sourceRefs: automatedVerifierRefs
    });
  }

  if (hasManualClue) {
    return buildReadyDimension({
      id: 'Verifiability',
      light: 'yellow',
      score: 52,
      reason: '仅存在人工验证线索，自动化可验证性不足。',
      riskSignals: ['manual_only_validation'],
      turnGreenCondition: '补充可复用的自动化测试或最小 fixture/sourceRef。',
      context
    });
  }

  return buildReadyDimension({
    id: 'Verifiability',
    light: 'red',
    score: 18,
    reason: '未发现测试目标、fixture 或可执行验证线索。',
    riskSignals: ['no_test_evidence'],
    turnGreenCondition: '至少补充一个 test/spec/fixture 级 sourceRef 并定义通过标准。',
    context
  });
}

function buildComplianceDimension(context: DimensionContext): CodeImpactDimensionV0 {
  const targetText = normalizeText(context.targets.map((target) => `${target.file} ${target.symbol}`));
  const joined = normalizeText([context.issueText, targetText]);
  const hitMedical = matchesAny(joined, MEDICAL_PATTERNS);
  const hitBypass = matchesAny(joined, BYPASS_PATTERNS);
  const hitSensitive = matchesAny(joined, AUTH_BILLING_PATTERNS);

  if (hitMedical || hitBypass) {
    return buildReadyDimension({
      id: 'Compliance',
      light: 'red',
      score: 23,
      reason: '命中医疗高风险或凭证/鉴权绕过信号，需严格合规审查。',
      riskSignals: dedupeStrings([
        ...(hitMedical ? ['medical_high_risk'] : []),
        ...(hitBypass ? ['credential_bypass_risk'] : [])
      ]),
      turnGreenCondition: '补充合规审批与审计证据，并避免绕过鉴权/签名路径。',
      context
    });
  }

  if (hitSensitive) {
    return buildReadyDimension({
      id: 'Compliance',
      light: 'yellow',
      score: 57,
      reason: '涉及 auth/billing/data-export/token/signature 等敏感域。',
      riskSignals: ['sensitive_domain'],
      turnGreenCondition: '补充最小权限、审计留痕和敏感数据处理验证。',
      context
    });
  }

  return buildReadyDimension({
    id: 'Compliance',
    light: 'green',
    score: 91,
    reason: '未命中敏感合规域，当前为普通 UI/局部逻辑变更。',
    riskSignals: ['local_non_sensitive'],
    turnGreenCondition: '保持敏感域隔离，不引入凭证/隐私数据处理路径。',
    context
  });
}

function buildRollbackDimension(context: DimensionContext): CodeImpactDimensionV0 {
  const hasDestructiveSignal =
    matchesAny(context.issueText, ['migration', 'drop', 'truncate', 'destructive', '数据删除', '迁移']) ||
    context.targets.some((target) => matchesAny(target.file, ['migration', '.sql', 'schema']));

  const hasFeatureFlagSignal = matchesAny(context.issueText, ['feature flag', '开关', 'toggle']);

  if (hasDestructiveSignal) {
    return buildReadyDimension({
      id: 'Rollback',
      light: 'red',
      score: 21,
      reason: '存在 migration/数据破坏类信号，回滚路径不可靠。',
      riskSignals: ['destructive_or_migration'],
      turnGreenCondition: '先提供可逆迁移脚本与明确回滚预案后再实施。',
      context
    });
  }

  if (context.fileCount > 1 || context.targetCount > 1) {
    return buildReadyDimension({
      id: 'Rollback',
      light: 'yellow',
      score: 59,
      reason: '改动跨多文件，回滚需要按变更单元拆分执行。',
      riskSignals: dedupeStrings([`files=${context.fileCount}`, ...(hasFeatureFlagSignal ? ['feature_flag'] : [])]),
      turnGreenCondition: '按功能点拆单并确保每个子改动可独立回滚。',
      context
    });
  }

  return buildReadyDimension({
    id: 'Rollback',
    light: 'green',
    score: 89,
    reason: hasFeatureFlagSignal ? '单文件且具备开关线索，回滚路径清晰。' : '单文件局部改动，可快速回滚。',
    riskSignals: hasFeatureFlagSignal ? ['feature_flag'] : ['single_file_change'],
    turnGreenCondition: '维持单文件可逆提交，并保留回滚脚本或开关策略。',
    context
  });
}

function buildReadyDimension(input: {
  readonly id: CodeImpactDimensionId;
  readonly light: Exclude<CodeImpactLight, 'gray'>;
  readonly score: number;
  readonly reason: string;
  readonly riskSignals: readonly string[];
  readonly turnGreenCondition: string;
  readonly context: DimensionContext;
  readonly sourceRefs?: readonly string[] | undefined;
}): CodeImpactDimensionV0 {
  const sourceRefs =
    input.sourceRefs !== undefined && input.sourceRefs.length > 0
      ? dedupeStrings(input.sourceRefs)
      : input.context.codeEvidenceSourceRefs;
  return {
    id: input.id,
    light: input.light,
    score: input.score,
    reason: input.reason,
    riskSignals: dedupeStrings(input.riskSignals),
    turnGreenCondition: input.turnGreenCondition,
    sourceRefs
  };
}

function buildGrayDimensions(reason: string, sourceRefs: readonly string[]): readonly CodeImpactDimensionV0[] {
  return ALL_DIMENSIONS.map((id) => ({
    id,
    light: 'gray',
    score: null,
    reason,
    riskSignals: [],
    turnGreenCondition: '请补充 Target Code Map 与可追溯 code sourceRef 后重评。',
    sourceRefs
  }));
}

function buildOverallReason(dimensions: readonly CodeImpactDimensionV0[]): string {
  const redIds = dimensions.filter((dimension) => dimension.light === 'red').map((dimension) => dimension.id);
  const yellowIds = dimensions
    .filter((dimension) => dimension.light === 'yellow')
    .map((dimension) => dimension.id);

  if (redIds.length > 0) {
    return `红灯维度：${redIds.join(', ')}。`;
  }

  if (yellowIds.length > 0) {
    return `黄灯维度：${yellowIds.join(', ')}。`;
  }

  return '六维均为绿灯，代码侵入性处于可控区间。';
}

function buildDowngradeSuggestions(dimensions: readonly CodeImpactDimensionV0[]): readonly string[] {
  const suggestions: string[] = [];

  for (const dimension of dimensions) {
    if (dimension.light !== 'red') {
      continue;
    }

    if (dimension.id === 'SurfaceArea') {
      suggestions.push('先限定单仓库单模块最小改动，再逐步扩展。');
    }
    if (dimension.id === 'AbstractionInvasion') {
      suggestions.push('优先采用外围适配层，避免直接改 framework/core/global 抽象。');
    }
    if (dimension.id === 'Compatibility') {
      suggestions.push('保留向后兼容接口，新增版本字段而非直接删除旧契约。');
    }
    if (dimension.id === 'Verifiability') {
      suggestions.push('补充最小自动化测试 target/fixture，再推进实现。');
    }
    if (dimension.id === 'Compliance') {
      suggestions.push('将敏感路径切到人工审批+审计模式，避免凭证/鉴权绕过实现。');
    }
    if (dimension.id === 'Rollback') {
      suggestions.push('先设计可逆迁移与回滚脚本，禁止一次性破坏式改动。');
    }
  }

  return suggestions;
}

function buildSplitSuggestions(dimensions: readonly CodeImpactDimensionV0[]): readonly string[] {
  const hasRed = dimensions.some((dimension) => dimension.light === 'red');
  if (!hasRed) {
    return [];
  }

  const suggestions: string[] = ['按模块拆分为多个子任务，并为每个子任务单独维护 sourceRef 与验收条件。'];

  if (dimensions.some((dimension) => dimension.id === 'Compatibility' && dimension.light === 'red')) {
    suggestions.push('将兼容层改造与新行为实现分单处理，先落兼容层。');
  }

  if (dimensions.some((dimension) => dimension.id === 'Compliance' && dimension.light === 'red')) {
    suggestions.push('将敏感合规模块单独立项，先完成风险评审再合入主改动。');
  }

  return suggestions;
}

function collectAllowedCodeSourceRefs(input: BuildCodeImpactReportInputV0): readonly string[] {
  const refs: string[] = [];

  for (const sourceRef of input.targetCodeMap?.sourceRefs ?? []) {
    refs.push(sourceRef);
  }

  for (const target of input.targetCodeMap?.targets ?? []) {
    if (target.sourceRef !== undefined) {
      refs.push(target.sourceRef);
    }
  }

  for (const evidenceRef of input.gitlabContextPack?.evidence_refs ?? []) {
    refs.push(evidenceRef.source_ref);
  }

  for (const result of input.gitlabContextPack?.search_results ?? []) {
    refs.push(result.source_ref);
  }

  for (const slice of input.gitlabContextPack?.file_slices ?? []) {
    refs.push(slice.source_ref);
  }

  for (const sourceRef of input.resolverPacket?.source_refs ?? []) {
    refs.push(sourceRef);
  }

  return dedupeStrings(refs);
}

function aggregateLight(dimensions: readonly CodeImpactDimensionV0[]): CodeImpactLight {
  if (dimensions.length === 0) {
    return 'gray';
  }

  if (dimensions.every((dimension) => dimension.light === 'gray')) {
    return 'gray';
  }

  if (dimensions.some((dimension) => dimension.light === 'red')) {
    return 'red';
  }

  if (dimensions.some((dimension) => dimension.light === 'yellow')) {
    return 'yellow';
  }

  return 'green';
}

function mapRequirementGateLight(light: RequirementGateLight): CodeImpactLight {
  return light;
}

function maxLight(left: CodeImpactLight, right: CodeImpactLight): CodeImpactLight {
  return lightRank(left) >= lightRank(right) ? left : right;
}

function lightRank(light: CodeImpactLight): number {
  if (light === 'gray') {
    return 0;
  }

  if (light === 'green') {
    return 1;
  }

  if (light === 'yellow') {
    return 2;
  }

  return 3;
}

function inferModuleKey(path: string): string {
  const normalized = path.trim().replace(/\\+/g, '/');
  const segments = normalized.split('/').filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return 'unknown';
  }

  if (segments.length === 1) {
    return segments[0] as string;
  }

  return `${segments[0] as string}/${segments[1] as string}`;
}

function matchesAny(text: string, patterns: readonly string[]): boolean {
  const normalized = text.toLowerCase();
  return patterns.some((pattern) => normalized.includes(pattern.toLowerCase()));
}

function normalizeText(values: readonly string[]): string {
  return values
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .join(' ')
    .toLowerCase();
}

function dedupeStrings(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const value of values) {
    const normalized = value.trim();
    if (normalized.length === 0 || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    output.push(normalized);
  }

  return output;
}

function dedupeVerifierEvidence(values: readonly VerifierEvidence[]): readonly VerifierEvidence[] {
  const seen = new Set<string>();
  const output: VerifierEvidence[] = [];

  for (const value of values) {
    const key = `${value.path}@@${value.sourceRef}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(value);
  }

  return output;
}

function buildNeedMoreContextGrayReport(input: {
  readonly issueKey: string;
  readonly profile: RequirementProfileKind;
  readonly requirementGateResult: RequirementGateResultV0 | undefined;
  readonly allowedCodeSourceRefs: readonly string[];
  readonly targetCodeMapStatus: CodeImpactTargetCodeMapStatus;
  readonly targetCount: number;
  readonly traceableTargetCount: number;
  readonly reason: string;
}): CodeImpactReportV0 {
  const dimensions = buildGrayDimensions(input.reason, []);
  const overall: CodeImpactOverallV0 = {
    light: 'gray',
    reason: input.reason,
    ...(input.requirementGateResult !== undefined
      ? {
          combinedBetaLight: maxLight(
            mapRequirementGateLight(input.requirementGateResult.implementationReady.light),
            'gray'
          )
        }
      : {}),
    sourceRefs: []
  };
  const auditPayload: CodeImpactAuditPayloadV0 = {
    schemaVersion: 'CodeImpactAuditPayloadV0',
    allowedCodeSourceRefs: input.allowedCodeSourceRefs,
    traceableTargetCount: input.traceableTargetCount,
    targetCount: input.targetCount,
    targetCodeMapStatus: input.targetCodeMapStatus,
    dimensionSummaries: dimensions.map((dimension) => ({
      id: dimension.id,
      light: dimension.light,
      reason: dimension.reason,
      sourceRefs: dimension.sourceRefs
    })),
    sourceRefs: []
  };

  return {
    schemaVersion: 'CodeImpactReportV0',
    beta: true,
    nonBlocking: true,
    issueKey: input.issueKey,
    status: 'need_more_context',
    profile: input.profile,
    targetCodeMapStatus: input.targetCodeMapStatus,
    dimensions,
    overall,
    downgradeSuggestions: [],
    splitSuggestions: [],
    sourceRefs: [],
    auditPayload
  };
}
