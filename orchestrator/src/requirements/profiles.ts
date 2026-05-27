import type {
  JiraEvidenceFieldValueV2,
  JiraEvidencePackV2
} from '../jira/evidence.js';
import {
  routeIssueProfile,
  type IssueTypeRouterResult
} from './router.js';

export type RequirementProfileKind =
  | 'Visual'
  | 'Integration'
  | 'Workflow'
  | 'Billing'
  | 'AccessControl'
  | 'General';

export interface BuildRequirementProfileSpecInput {
  readonly evidencePack: JiraEvidencePackV2;
  readonly routerResult?: IssueTypeRouterResult;
}

export interface TraceableTextValueV0 {
  readonly text: string;
  readonly sourceRef: string;
}

export interface RequirementAcceptanceAssertionV0 {
  readonly assertion: string;
  readonly sourceRef: string;
}

export interface VisualEvidenceItemV0 {
  readonly evidenceType: 'attachment' | 'media';
  readonly attachmentId: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly byteLength: number | null;
  readonly sourceRef: string;
}

export interface VisualDefectSpecV0 {
  readonly kind: 'VisualDefectSpecV0';
  readonly pageOrComponent: readonly TraceableTextValueV0[];
  readonly actualBehavior: readonly TraceableTextValueV0[];
  readonly expectedBehavior: readonly TraceableTextValueV0[];
  readonly visualEvidence: readonly VisualEvidenceItemV0[];
  readonly baselineEvidence: readonly TraceableTextValueV0[];
  readonly viewport: readonly TraceableTextValueV0[];
  readonly acceptanceAssertions: readonly RequirementAcceptanceAssertionV0[];
}

export interface IntegrationSpecV0 {
  readonly kind: 'IntegrationSpecV0';
  readonly upstreamSystem: readonly TraceableTextValueV0[];
  readonly downstreamSystem: readonly TraceableTextValueV0[];
  readonly apiContract: readonly TraceableTextValueV0[];
  readonly fieldMapping: readonly TraceableTextValueV0[];
  readonly authBoundary: readonly TraceableTextValueV0[];
  readonly failureHandling: readonly TraceableTextValueV0[];
  readonly testFixtures: readonly TraceableTextValueV0[];
  readonly acceptanceAssertions: readonly RequirementAcceptanceAssertionV0[];
}

export interface WorkflowRequirementSpecV0 {
  readonly kind: 'WorkflowRequirementSpecV0';
  readonly roles: readonly TraceableTextValueV0[];
  readonly triggerConditions: readonly TraceableTextValueV0[];
  readonly processSteps: readonly TraceableTextValueV0[];
  readonly businessRules: readonly TraceableTextValueV0[];
  readonly exceptionPaths: readonly TraceableTextValueV0[];
  readonly auditTrail: readonly TraceableTextValueV0[];
  readonly acceptanceAssertions: readonly RequirementAcceptanceAssertionV0[];
}

export interface UnsupportedProfileSpecV0 {
  readonly kind: 'UnsupportedProfileSpecV0';
  readonly profile: RequirementProfileKind;
  readonly reason: 'needs_later_profile' | 'unsupported_profile';
  readonly message: string;
  readonly sourceRefs: readonly string[];
}

export type RequirementProfileSpecV0 =
  | VisualDefectSpecV0
  | IntegrationSpecV0
  | WorkflowRequirementSpecV0
  | UnsupportedProfileSpecV0;

export interface RequirementProfileGapV0 {
  readonly field: string;
  readonly reason: string;
  readonly clarificationQuestion: string;
  readonly sourceRefs: readonly string[];
}

export interface RequirementProfileSpecResultV0 {
  readonly schemaVersion: 'RequirementProfileSpecV0';
  readonly profile: RequirementProfileKind;
  readonly status: 'spec_ready' | 'gap_blocked' | 'unsupported_profile';
  readonly spec: RequirementProfileSpecV0;
  readonly gaps: readonly RequirementProfileGapV0[];
  readonly sourceRefs: readonly string[];
}

interface SourceTextEvidence {
  readonly text: string;
  readonly sourceRef: string;
}

const VISUAL_PAGE_KEYWORDS = ['页面', '页', '组件', '按钮', '弹窗', '表格', '布局', 'ui', 'page', 'component'];
const VISUAL_ACTUAL_KEYWORDS = ['异常', '错位', '空白', '不一致', '偏差', '错误', '回归', '失效', '闪烁', '重叠', '缺失'];
const VISUAL_EXPECTED_KEYWORDS = ['预期', '应', '应该', '应当', '一致', '设计稿', 'baseline', '基线', '规范', '对齐'];
const VISUAL_BASELINE_KEYWORDS = ['设计稿', 'baseline', '基线', '对照', '参考图', 'golden', 'legacy'];

const INTEGRATION_UPSTREAM_KEYWORDS = ['上游', 'source', '第三方', 'external', '回调来源'];
const INTEGRATION_DOWNSTREAM_KEYWORDS = ['下游', 'target', '目标系统', '写入', '推送到', '落库'];
const INTEGRATION_API_KEYWORDS = [
  'api',
  'webhook',
  'http',
  'rpc',
  '报文',
  'payload',
  '请求',
  '响应',
  '回调',
  '契约',
  'contract',
  'endpoint'
];
const INTEGRATION_MAPPING_KEYWORDS = ['字段映射', 'mapping', '映射', '字段对齐', '字段转换'];
const INTEGRATION_AUTH_KEYWORDS = [
  'token',
  'oauth',
  'auth',
  '认证',
  '授权',
  '鉴权',
  'sso',
  '签名校验'
];
const INTEGRATION_FAILURE_KEYWORDS = ['超时', 'timeout', '重试', 'retry', 'fallback', '告警', '补偿', '回滚'];
const INTEGRATION_FIXTURE_KEYWORDS = ['fixture', 'mock', '样例', '测试数据', 'payload', 'contract', 'json', 'csv'];

const WORKFLOW_ROLE_KEYWORDS = ['角色', '审批人', '申请人', '运营', '财务', '管理员', 'reviewer', 'approver', 'owner'];
const WORKFLOW_TRIGGER_KEYWORDS = ['触发', '条件', '如果', '提交后', '创建后', '变更后', 'trigger'];
const WORKFLOW_STEP_KEYWORDS = ['流程', '步骤', '节点', '流转', '审批', '任务流', '状态'];
const WORKFLOW_RULE_KEYWORDS = ['业务规则', '规则', '必须', '仅当', '限制', '校验', '不符合预期'];
const WORKFLOW_EXCEPTION_KEYWORDS = ['异常', '失败', '驳回', '回退', '超时', '中断', '卡住'];
const WORKFLOW_AUDIT_KEYWORDS = ['留痕', '审计', '日志', '记录', 'trace', 'history'];

const ASSERTION_KEYWORDS = ['预期', '应', '应该', '应当', '必须', '一致', '通过', '成功', '可见', '不应', 'should', 'expected'];

export function buildRequirementProfileSpecV0(
  input: BuildRequirementProfileSpecInput
): RequirementProfileSpecResultV0 {
  const evidencePack = input.evidencePack;
  const validSourceRefs = new Set(evidencePack.sourceRefs);
  const routerResult = input.routerResult ?? routeIssueProfile(evidencePack);
  const profile = routerResult.profile as RequirementProfileKind;

  if (profile === 'Visual') {
    const built = buildVisualSpec(evidencePack, validSourceRefs);
    return finalizeResult(profile, built.status, built.spec, built.gaps, validSourceRefs);
  }

  if (profile === 'Integration') {
    const built = buildIntegrationSpec(evidencePack, validSourceRefs);
    return finalizeResult(profile, built.status, built.spec, built.gaps, validSourceRefs);
  }

  if (profile === 'Workflow') {
    const built = buildWorkflowSpec(evidencePack, validSourceRefs);
    return finalizeResult(profile, built.status, built.spec, built.gaps, validSourceRefs);
  }

  const fallbackSourceRefs = dedupeStrings(
    [
      ...routerResult.sourceRefs.filter((sourceRef) => validSourceRefs.has(sourceRef)),
      evidencePack.issue.sourceRef
    ].filter((sourceRef) => validSourceRefs.has(sourceRef))
  );

  const spec: UnsupportedProfileSpecV0 = {
    kind: 'UnsupportedProfileSpecV0',
    profile,
    reason: profile === 'General' ? 'unsupported_profile' : 'needs_later_profile',
    message:
      profile === 'General'
        ? '当前证据不足以映射到已支持的 Profile Spec v0。'
        : `${profile} Profile Spec v0 暂未在 W3 实现。`,
    sourceRefs: fallbackSourceRefs
  };

  return {
    schemaVersion: 'RequirementProfileSpecV0',
    profile,
    status: 'unsupported_profile',
    spec,
    gaps: [],
    sourceRefs: fallbackSourceRefs
  };
}

function buildVisualSpec(
  evidencePack: JiraEvidencePackV2,
  validSourceRefs: ReadonlySet<string>
): {
  readonly status: 'spec_ready' | 'gap_blocked';
  readonly spec: VisualDefectSpecV0;
  readonly gaps: readonly RequirementProfileGapV0[];
} {
  const textEvidence = collectTextEvidence(evidencePack, validSourceRefs);
  const pageOrComponent = matchTextEvidence(textEvidence, VISUAL_PAGE_KEYWORDS);
  const actualBehavior = matchTextEvidence(textEvidence, VISUAL_ACTUAL_KEYWORDS);
  const expectedBehavior = matchTextEvidence(textEvidence, VISUAL_EXPECTED_KEYWORDS);
  const baselineEvidence = matchTextEvidence(textEvidence, VISUAL_BASELINE_KEYWORDS);
  const viewport = extractViewportEvidence(textEvidence);
  const visualEvidence = collectVisualEvidence(evidencePack, validSourceRefs);
  const acceptanceAssertions = buildAssertions(textEvidence);

  const gaps: RequirementProfileGapV0[] = [];
  appendRequiredFieldGaps(gaps, {
    field: 'pageOrComponent',
    values: pageOrComponent,
    reason: '缺少可定位的页面或组件证据。',
    question: '请明确受影响的页面或组件名称是什么？',
    sourceRef: evidencePack.issue.sourceRef,
    validSourceRefs
  });
  appendRequiredFieldGaps(gaps, {
    field: 'actualBehavior',
    values: actualBehavior,
    reason: '缺少可复现的视觉异常描述。',
    question: '请补充当前实际表现（例如错位、空白、重叠）是什么？',
    sourceRef: evidencePack.issue.sourceRef,
    validSourceRefs
  });
  appendRequiredFieldGaps(gaps, {
    field: 'expectedBehavior',
    values: expectedBehavior,
    reason: '缺少预期视觉表现描述。',
    question: '请补充预期视觉表现应满足什么标准？',
    sourceRef: evidencePack.issue.sourceRef,
    validSourceRefs
  });
  appendRequiredFieldGaps(gaps, {
    field: 'visualEvidence',
    values: visualEvidence,
    reason: '未发现可追溯的截图或图片证据。',
    question: '请补充可复现问题的截图附件（image/*）。',
    sourceRef: evidencePack.issue.sourceRef,
    validSourceRefs
  });
  appendRequiredFieldGaps(gaps, {
    field: 'baselineEvidence',
    values: baselineEvidence,
    reason: '缺少基线对照证据（设计稿、基线图或参考版本说明）。',
    question: '请提供设计稿/基线图或明确的对照版本说明。',
    sourceRef: evidencePack.issue.sourceRef,
    validSourceRefs
  });
  appendRequiredFieldGaps(gaps, {
    field: 'viewport',
    values: viewport,
    reason: '缺少 viewport / 分辨率信息，无法稳定复现。',
    question: '请提供复现场景的 viewport 或分辨率（例如 1920x1080）。',
    sourceRef: evidencePack.issue.sourceRef,
    validSourceRefs
  });
  appendRequiredFieldGaps(gaps, {
    field: 'acceptanceAssertions',
    values: acceptanceAssertions,
    reason: '缺少可执行的验收断言线索。',
    question: '请补充可验证通过/失败的验收断言。',
    sourceRef: evidencePack.issue.sourceRef,
    validSourceRefs
  });

  const spec: VisualDefectSpecV0 = {
    kind: 'VisualDefectSpecV0',
    pageOrComponent,
    actualBehavior,
    expectedBehavior,
    visualEvidence,
    baselineEvidence,
    viewport,
    acceptanceAssertions
  };

  return {
    status: gaps.length === 0 ? 'spec_ready' : 'gap_blocked',
    spec,
    gaps
  };
}

function buildIntegrationSpec(
  evidencePack: JiraEvidencePackV2,
  validSourceRefs: ReadonlySet<string>
): {
  readonly status: 'spec_ready' | 'gap_blocked';
  readonly spec: IntegrationSpecV0;
  readonly gaps: readonly RequirementProfileGapV0[];
} {
  const textEvidence = collectTextEvidence(evidencePack, validSourceRefs);
  const upstreamSystem = matchTextEvidence(textEvidence, INTEGRATION_UPSTREAM_KEYWORDS);
  const downstreamSystem = matchTextEvidence(textEvidence, INTEGRATION_DOWNSTREAM_KEYWORDS);
  const apiContract = matchTextEvidence(textEvidence, INTEGRATION_API_KEYWORDS);
  const fieldMapping = matchTextEvidence(textEvidence, INTEGRATION_MAPPING_KEYWORDS);
  const authBoundary = matchTextEvidence(textEvidence, INTEGRATION_AUTH_KEYWORDS);
  const failureHandling = matchTextEvidence(textEvidence, INTEGRATION_FAILURE_KEYWORDS);
  const testFixtures = matchTextEvidence(textEvidence, INTEGRATION_FIXTURE_KEYWORDS);
  const acceptanceAssertions = buildAssertions(textEvidence);

  const gaps: RequirementProfileGapV0[] = [];
  appendRequiredFieldGaps(gaps, {
    field: 'upstreamSystem',
    values: upstreamSystem,
    reason: '缺少上游系统证据。',
    question: '请明确上游系统或事件来源是什么？',
    sourceRef: evidencePack.issue.sourceRef,
    validSourceRefs
  });
  appendRequiredFieldGaps(gaps, {
    field: 'downstreamSystem',
    values: downstreamSystem,
    reason: '缺少下游系统证据。',
    question: '请明确下游系统或落地目标是什么？',
    sourceRef: evidencePack.issue.sourceRef,
    validSourceRefs
  });
  appendRequiredFieldGaps(gaps, {
    field: 'apiContract',
    values: apiContract,
    reason: '缺少接口契约证据（API/webhook/报文）。',
    question: '请补充接口契约信息（端点、请求/响应或报文示例）。',
    sourceRef: evidencePack.issue.sourceRef,
    validSourceRefs
  });
  appendRequiredFieldGaps(gaps, {
    field: 'fieldMapping',
    values: fieldMapping,
    reason: '缺少字段映射证据。',
    question: '请补充关键字段映射关系。',
    sourceRef: evidencePack.issue.sourceRef,
    validSourceRefs
  });
  appendRequiredFieldGaps(gaps, {
    field: 'authBoundary',
    values: authBoundary,
    reason: '缺少鉴权边界证据（token/签名校验/授权策略）。',
    question: '请补充接口鉴权方式、令牌边界与失败处理策略。',
    sourceRef: evidencePack.issue.sourceRef,
    validSourceRefs
  });
  appendRequiredFieldGaps(gaps, {
    field: 'failureHandling',
    values: failureHandling,
    reason: '缺少失败处理证据（超时/重试/补偿/回滚）。',
    question: '请补充超时、重试、补偿或回滚的闭环处理方式。',
    sourceRef: evidencePack.issue.sourceRef,
    validSourceRefs
  });
  appendRequiredFieldGaps(gaps, {
    field: 'testFixtures',
    values: testFixtures,
    reason: '缺少联调或回归夹具证据（fixture/mock/payload）。',
    question: '请补充用于复现与回归的 payload、mock 或 fixture 示例。',
    sourceRef: evidencePack.issue.sourceRef,
    validSourceRefs
  });
  appendRequiredFieldGaps(gaps, {
    field: 'acceptanceAssertions',
    values: acceptanceAssertions,
    reason: '缺少可执行的验收断言线索。',
    question: '请补充接口成功/失败判定标准。',
    sourceRef: evidencePack.issue.sourceRef,
    validSourceRefs
  });

  const spec: IntegrationSpecV0 = {
    kind: 'IntegrationSpecV0',
    upstreamSystem,
    downstreamSystem,
    apiContract,
    fieldMapping,
    authBoundary,
    failureHandling,
    testFixtures,
    acceptanceAssertions
  };

  return {
    status: gaps.length === 0 ? 'spec_ready' : 'gap_blocked',
    spec,
    gaps
  };
}

function buildWorkflowSpec(
  evidencePack: JiraEvidencePackV2,
  validSourceRefs: ReadonlySet<string>
): {
  readonly status: 'spec_ready' | 'gap_blocked';
  readonly spec: WorkflowRequirementSpecV0;
  readonly gaps: readonly RequirementProfileGapV0[];
} {
  const textEvidence = collectTextEvidence(evidencePack, validSourceRefs);
  const roles = matchTextEvidence(textEvidence, WORKFLOW_ROLE_KEYWORDS);
  const triggerConditions = matchTextEvidence(textEvidence, WORKFLOW_TRIGGER_KEYWORDS);
  const processSteps = matchTextEvidence(textEvidence, WORKFLOW_STEP_KEYWORDS);
  const businessRules = matchTextEvidence(textEvidence, WORKFLOW_RULE_KEYWORDS);
  const exceptionPaths = matchTextEvidence(textEvidence, WORKFLOW_EXCEPTION_KEYWORDS);
  const auditTrail = matchTextEvidence(textEvidence, WORKFLOW_AUDIT_KEYWORDS);
  const acceptanceAssertions = buildAssertions(textEvidence);

  const gaps: RequirementProfileGapV0[] = [];
  appendRequiredFieldGaps(gaps, {
    field: 'roles',
    values: roles,
    reason: '缺少流程角色证据。',
    question: '请补充流程涉及的角色（如申请人、审批人）。',
    sourceRef: evidencePack.issue.sourceRef,
    validSourceRefs
  });
  appendRequiredFieldGaps(gaps, {
    field: 'triggerConditions',
    values: triggerConditions,
    reason: '缺少触发条件证据。',
    question: '请补充流程何时触发及触发前置条件。',
    sourceRef: evidencePack.issue.sourceRef,
    validSourceRefs
  });
  appendRequiredFieldGaps(gaps, {
    field: 'processSteps',
    values: processSteps,
    reason: '缺少流程步骤或节点证据。',
    question: '请补充关键流程步骤或节点顺序。',
    sourceRef: evidencePack.issue.sourceRef,
    validSourceRefs
  });
  appendRequiredFieldGaps(gaps, {
    field: 'businessRules',
    values: businessRules,
    reason: '缺少业务规则证据。',
    question: '请补充流程中的校验、限制或必须满足的业务规则。',
    sourceRef: evidencePack.issue.sourceRef,
    validSourceRefs
  });
  appendRequiredFieldGaps(gaps, {
    field: 'exceptionPaths',
    values: exceptionPaths,
    reason: '缺少异常路径证据。',
    question: '请补充失败、超时、回退或拦截时的异常处理路径。',
    sourceRef: evidencePack.issue.sourceRef,
    validSourceRefs
  });
  appendRequiredFieldGaps(gaps, {
    field: 'auditTrail',
    values: auditTrail,
    reason: '缺少留痕或审计证据。',
    question: '请补充日志、留痕或审计记录要求。',
    sourceRef: evidencePack.issue.sourceRef,
    validSourceRefs
  });
  appendRequiredFieldGaps(gaps, {
    field: 'acceptanceAssertions',
    values: acceptanceAssertions,
    reason: '缺少可执行的流程验收断言线索。',
    question: '请补充流程通过/失败的可验证断言。',
    sourceRef: evidencePack.issue.sourceRef,
    validSourceRefs
  });

  const spec: WorkflowRequirementSpecV0 = {
    kind: 'WorkflowRequirementSpecV0',
    roles,
    triggerConditions,
    processSteps,
    businessRules,
    exceptionPaths,
    auditTrail,
    acceptanceAssertions
  };

  return {
    status: gaps.length === 0 ? 'spec_ready' : 'gap_blocked',
    spec,
    gaps
  };
}

function appendRequiredFieldGaps(
  gaps: RequirementProfileGapV0[],
  input: {
    readonly field: string;
    readonly values: readonly unknown[];
    readonly reason: string;
    readonly question: string;
    readonly sourceRef: string;
    readonly validSourceRefs: ReadonlySet<string>;
  }
): void {
  if (input.values.length > 0) {
    return;
  }

  const sourceRefs = input.validSourceRefs.has(input.sourceRef) ? [input.sourceRef] : [];
  gaps.push({
    field: input.field,
    reason: input.reason,
    clarificationQuestion: input.question,
    sourceRefs
  });
}

function collectTextEvidence(
  evidencePack: JiraEvidencePackV2,
  validSourceRefs: ReadonlySet<string>
): readonly SourceTextEvidence[] {
  const candidates: SourceTextEvidence[] = [];
  const seen = new Set<string>();

  const addText = (text: string, sourceRef: string): void => {
    const normalized = text.trim();
    if (normalized.length === 0 || !validSourceRefs.has(sourceRef)) {
      return;
    }

    const segments = splitEvidenceText(normalized);
    for (const segment of segments) {
      const key = `${segment}|${sourceRef}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      candidates.push({ text: segment, sourceRef });
    }
  };

  addText(evidencePack.issue.summary, evidencePack.issue.sourceRef);
  addText(evidencePack.issue.description, evidencePack.issue.sourceRef);

  for (const comment of evidencePack.comments) {
    addText(comment.body, comment.sourceRef);
  }

  for (const attachment of evidencePack.attachments) {
    addText(attachment.filename, attachment.sourceRef);
  }

  for (const media of evidencePack.mediaEvidence) {
    addText(media.filename, media.sourceRef);
  }

  for (const fieldValue of evidencePack.fieldValues) {
    const text = flattenFieldValue(fieldValue);
    if (text.length > 0) {
      addText(text, fieldValue.sourceRef);
    }
  }

  return candidates;
}

function splitEvidenceText(text: string): readonly string[] {
  const normalized = text.replace(/\r/g, '\n');
  const roughSegments = normalized
    .split(/[\n]+/)
    .flatMap((line) => line.split(/[。！？!?:；;]+/))
    .map((line) => line.trim())
    .filter((line) => line.length > 1);

  return dedupeStrings([text, ...roughSegments]).slice(0, 8);
}

function flattenFieldValue(fieldValue: JiraEvidenceFieldValueV2): string {
  if (fieldValue.valueKind === 'string') {
    return fieldValue.valueString?.trim() ?? '';
  }

  if (fieldValue.valueKind === 'string_list') {
    return (fieldValue.valueStrings ?? []).join(' ').trim();
  }

  if (fieldValue.valueKind === 'time_tracking') {
    const chunks: string[] = [];
    const tracking = fieldValue.valueTimeTracking;
    if (tracking?.originalEstimateSeconds !== undefined) {
      chunks.push(`original=${tracking.originalEstimateSeconds}`);
    }
    if (tracking?.remainingEstimateSeconds !== undefined) {
      chunks.push(`remaining=${tracking.remainingEstimateSeconds}`);
    }
    if (tracking?.timeSpentSeconds !== undefined) {
      chunks.push(`spent=${tracking.timeSpentSeconds}`);
    }

    return chunks.join(' ');
  }

  return '';
}

function matchTextEvidence(
  evidence: readonly SourceTextEvidence[],
  keywords: readonly string[]
): readonly TraceableTextValueV0[] {
  const matches: TraceableTextValueV0[] = [];
  const seen = new Set<string>();

  for (const entry of evidence) {
    const normalizedText = normalizeText(entry.text);
    if (normalizedText.length === 0) {
      continue;
    }

    const hit = keywords.some((keyword) => normalizedText.includes(normalizeText(keyword)));
    if (!hit) {
      continue;
    }

    const key = `${entry.text}|${entry.sourceRef}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    matches.push({
      text: entry.text,
      sourceRef: entry.sourceRef
    });
  }

  return matches;
}

function collectVisualEvidence(
  evidencePack: JiraEvidencePackV2,
  validSourceRefs: ReadonlySet<string>
): readonly VisualEvidenceItemV0[] {
  const matches: VisualEvidenceItemV0[] = [];
  const seen = new Set<string>();

  for (const attachment of evidencePack.attachments) {
    if (!startsWithImageMimeType(attachment.mimeType) || !validSourceRefs.has(attachment.sourceRef)) {
      continue;
    }

    const key = `attachment|${attachment.id}|${attachment.sourceRef}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    matches.push({
      evidenceType: 'attachment',
      attachmentId: attachment.id,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      byteLength: attachment.size,
      sourceRef: attachment.sourceRef
    });
  }

  for (const media of evidencePack.mediaEvidence) {
    if (!startsWithImageMimeType(media.mimeType) || !validSourceRefs.has(media.sourceRef)) {
      continue;
    }

    const key = `media|${media.attachmentId}|${media.sourceRef}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    matches.push({
      evidenceType: 'media',
      attachmentId: media.attachmentId,
      filename: media.filename,
      mimeType: media.mimeType,
      byteLength: media.byteLength,
      sourceRef: media.sourceRef
    });
  }

  return matches;
}

function extractViewportEvidence(evidence: readonly SourceTextEvidence[]): readonly TraceableTextValueV0[] {
  const matches: TraceableTextValueV0[] = [];
  const seen = new Set<string>();

  const viewportPattern = /\b\d{3,4}\s*[x×]\s*\d{3,4}\b|\bviewport\b|\bresolution\b|分辨率/i;

  for (const entry of evidence) {
    if (!viewportPattern.test(entry.text)) {
      continue;
    }

    const key = `${entry.text}|${entry.sourceRef}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    matches.push({
      text: entry.text,
      sourceRef: entry.sourceRef
    });
  }

  return matches;
}

function buildAssertions(
  evidence: readonly SourceTextEvidence[]
): readonly RequirementAcceptanceAssertionV0[] {
  const assertions: RequirementAcceptanceAssertionV0[] = [];
  const seen = new Set<string>();

  for (const entry of evidence) {
    const normalizedText = normalizeText(entry.text);
    if (normalizedText.length < 2) {
      continue;
    }

    const hit = ASSERTION_KEYWORDS.some((keyword) => normalizedText.includes(normalizeText(keyword)));
    if (!hit) {
      continue;
    }

    const key = `${entry.text}|${entry.sourceRef}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    assertions.push({
      assertion: entry.text,
      sourceRef: entry.sourceRef
    });
  }

  return assertions;
}

function finalizeResult(
  profile: RequirementProfileKind,
  status: 'spec_ready' | 'gap_blocked',
  spec: RequirementProfileSpecV0,
  gaps: readonly RequirementProfileGapV0[],
  validSourceRefs: ReadonlySet<string>
): RequirementProfileSpecResultV0 {
  const sourceRefs = dedupeStrings([
    ...collectSpecSourceRefs(spec),
    ...gaps.flatMap((gap) => gap.sourceRefs)
  ]).filter((sourceRef) => validSourceRefs.has(sourceRef));

  return {
    schemaVersion: 'RequirementProfileSpecV0',
    profile,
    status,
    spec,
    gaps,
    sourceRefs
  };
}

function collectSpecSourceRefs(spec: RequirementProfileSpecV0): readonly string[] {
  if (spec.kind === 'UnsupportedProfileSpecV0') {
    return spec.sourceRefs;
  }

  if (spec.kind === 'VisualDefectSpecV0') {
    return [
      ...spec.pageOrComponent.map((item) => item.sourceRef),
      ...spec.actualBehavior.map((item) => item.sourceRef),
      ...spec.expectedBehavior.map((item) => item.sourceRef),
      ...spec.visualEvidence.map((item) => item.sourceRef),
      ...spec.baselineEvidence.map((item) => item.sourceRef),
      ...spec.viewport.map((item) => item.sourceRef),
      ...spec.acceptanceAssertions.map((item) => item.sourceRef)
    ];
  }

  if (spec.kind === 'IntegrationSpecV0') {
    return [
      ...spec.upstreamSystem.map((item) => item.sourceRef),
      ...spec.downstreamSystem.map((item) => item.sourceRef),
      ...spec.apiContract.map((item) => item.sourceRef),
      ...spec.fieldMapping.map((item) => item.sourceRef),
      ...spec.authBoundary.map((item) => item.sourceRef),
      ...spec.failureHandling.map((item) => item.sourceRef),
      ...spec.testFixtures.map((item) => item.sourceRef),
      ...spec.acceptanceAssertions.map((item) => item.sourceRef)
    ];
  }

  return [
    ...spec.roles.map((item) => item.sourceRef),
    ...spec.triggerConditions.map((item) => item.sourceRef),
    ...spec.processSteps.map((item) => item.sourceRef),
    ...spec.businessRules.map((item) => item.sourceRef),
    ...spec.exceptionPaths.map((item) => item.sourceRef),
    ...spec.auditTrail.map((item) => item.sourceRef),
    ...spec.acceptanceAssertions.map((item) => item.sourceRef)
  ];
}

function dedupeStrings(values: readonly string[]): readonly string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const normalized = value.trim();
    if (normalized.length === 0 || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

function startsWithImageMimeType(mimeType: string): boolean {
  return mimeType.trim().toLowerCase().startsWith('image/');
}

function normalizeText(text: string): string {
  return text.toLowerCase().trim();
}
