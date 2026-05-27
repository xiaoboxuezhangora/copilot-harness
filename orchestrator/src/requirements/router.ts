import type {
  JiraEvidenceFieldValueV2,
  JiraEvidencePackV2,
  JiraProjectMetadataV2
} from '../jira/evidence.js';

export type IssueProfile =
  | 'Visual'
  | 'Integration'
  | 'Workflow'
  | 'Billing'
  | 'AccessControl'
  | 'General';

type RoutedIssueProfile = Exclude<IssueProfile, 'General'>;

export interface IssueTypeRouterOptions {
  readonly ambiguityScoreGap?: number;
  readonly ambiguityMarginRatio?: number;
  readonly minimumDecisionScore?: number;
}

export interface IssueTypeRouterResult {
  readonly profile: IssueProfile;
  readonly confidence: number;
  readonly matchedSignals: readonly IssueTypeMatchedSignal[];
  readonly sourceRefs: readonly string[];
  readonly rationale: string;
  readonly fallbackReason: string | null;
}

export interface IssueTypeMatchedSignal {
  readonly kind:
    | 'issue_type'
    | 'summary_keyword'
    | 'description_keyword'
    | 'comment_keyword'
    | 'attachment_mime'
    | 'project_metadata'
    | 'field_value'
    | 'historical_mapping';
  readonly profile: IssueProfile;
  readonly value: string;
  readonly weight: number;
  readonly sourceRef: string;
}

export interface IssueTypeRouterEvalSample {
  readonly id: string;
  readonly expectedProfile: IssueProfile;
  readonly evidencePack: JiraEvidencePackV2;
}

export interface IssueTypeRouterEvalFailure {
  readonly id: string;
  readonly expectedProfile: IssueProfile;
  readonly predictedProfile: IssueProfile;
  readonly confidence: number;
  readonly fallbackReason: string | null;
}

export interface IssueTypeRouterEvalResult {
  readonly sampleCount: number;
  readonly passedCount: number;
  readonly top1Accuracy: number;
  readonly sourceRefCoverage: number;
  readonly failures: readonly IssueTypeRouterEvalFailure[];
}

interface InternalSignal extends IssueTypeMatchedSignal {
  readonly profile: RoutedIssueProfile;
}

interface CollectSignalsResult {
  readonly signals: readonly InternalSignal[];
  readonly droppedByInvalidSourceRefCount: number;
}

interface ProfileKeywordRule {
  readonly profile: RoutedIssueProfile;
  readonly keywords: readonly string[];
}

interface ProfileScore {
  readonly profile: RoutedIssueProfile;
  readonly score: number;
}

const ROUTED_PROFILES: readonly RoutedIssueProfile[] = [
  'Visual',
  'Integration',
  'Workflow',
  'Billing',
  'AccessControl'
];

const PROFILE_KEYWORDS: readonly ProfileKeywordRule[] = [
  {
    profile: 'Visual',
    keywords: [
      '样式',
      '图标',
      '颜色',
      '布局',
      '空白页',
      '对齐',
      '显示异常',
      '显示不全',
      '显示为空',
      '缺少一部分数据',
      '错位',
      '遮挡',
      '重叠',
      '不一致',
      '变形',
      '视觉',
      'viewport',
      '分辨率',
      '设计稿',
      '基线',
      'ui',
      'screenshot'
    ]
  },
  {
    profile: 'Integration',
    keywords: [
      '对接',
      'rs7',
      '接口',
      'api',
      'http',
      '回调',
      'webhook',
      '闭环',
      '同步',
      '第三方',
      '上游',
      '下游',
      '字段映射',
      '报文',
      'token',
      '签名',
      '签名组件',
      '返回失败',
      '超时',
      '重试',
      'integration'
    ]
  },
  {
    profile: 'Workflow',
    keywords: [
      '流程',
      '审批',
      '状态流转',
      '节点',
      '步骤',
      '点击',
      '提交',
      '保存',
      '打印',
      '加载中',
      '加载失败',
      '加载不出来',
      '查看外屏',
      '提示失败',
      '返回失败',
      '未生效',
      '缺失校验',
      '拦截',
      '重新进入',
      '仍显示',
      '仍不变',
      '超时',
      '角色',
      '触发条件',
      '业务规则',
      '异常路径',
      '留痕',
      '审计',
      '任务流',
      '工单流',
      'workflow'
    ]
  },
  {
    profile: 'Billing',
    keywords: [
      '收费',
      '计费',
      '金额',
      '时长计算',
      '麻醉时长',
      '支付',
      '退款',
      '发票',
      '账单',
      '价格',
      '结算',
      '医保',
      '费用',
      'billing',
      'invoice',
      'payment'
    ]
  },
  {
    profile: 'AccessControl',
    keywords: [
      '权限',
      '角色',
      '菜单',
      '登录',
      'sso',
      'oauth',
      '认证',
      '授权',
      '账号',
      '组织',
      '租户',
      'ca 签名',
      '电子签名',
      'access',
      'auth'
    ]
  }
];

const ISSUE_TYPE_KEYWORDS: readonly ProfileKeywordRule[] = [
  { profile: 'Visual', keywords: ['ui', 'visual', '样式', '前端', '显示'] },
  { profile: 'Integration', keywords: ['integration', '接口', '集成', 'api'] },
  { profile: 'Workflow', keywords: ['workflow', '流程', '审批'] },
  { profile: 'Billing', keywords: ['billing', 'payment', '计费', '结算'] },
  { profile: 'AccessControl', keywords: ['auth', 'access', '权限', '认证', '授权'] }
];

const ATTACHMENT_FILENAME_KEYWORDS: readonly ProfileKeywordRule[] = [
  {
    profile: 'Visual',
    keywords: ['screenshot', 'screen', 'ui', 'visual', 'png', 'jpg', 'jpeg']
  },
  {
    profile: 'Integration',
    keywords: ['api', 'webhook', 'payload', 'mapping', 'integration']
  },
  {
    profile: 'AccessControl',
    keywords: ['sso', 'oauth', 'auth', 'permission', 'signature']
  }
];

const PROJECT_METADATA_KEYWORDS: readonly ProfileKeywordRule[] = [
  { profile: 'Integration', keywords: ['integration', 'api', 'gateway', 'adapter', 'connector'] },
  { profile: 'Workflow', keywords: ['workflow', 'approval', 'state', 'process', 'flow'] },
  { profile: 'Billing', keywords: ['billing', 'payment', 'invoice', 'settlement'] },
  { profile: 'AccessControl', keywords: ['auth', 'access', 'sso', 'oauth', 'permission'] },
  { profile: 'Visual', keywords: ['ui', 'frontend', 'portal', 'screen'] }
];

const HISTORICAL_MAPPING_KEYWORDS: readonly ProfileKeywordRule[] = [
  { profile: 'Visual', keywords: ['ui', 'visual', 'style', 'frontend'] },
  { profile: 'Integration', keywords: ['integration', 'api', 'webhook', 'mapping'] },
  { profile: 'Workflow', keywords: ['workflow', 'approval', 'process', 'flow'] },
  { profile: 'Billing', keywords: ['billing', 'payment', 'invoice', 'settlement'] },
  { profile: 'AccessControl', keywords: ['auth', 'access', 'permission', 'sso', 'oauth'] }
];

const DEFAULT_OPTIONS: Required<IssueTypeRouterOptions> = {
  ambiguityScoreGap: 1.2,
  ambiguityMarginRatio: 0.25,
  minimumDecisionScore: 1.6
};

const STRONG_VISUAL_TEXT_SIGNAL_VALUES = new Set(
  [
    '样式',
    '图标',
    '颜色',
    '布局',
    '空白页',
    '对齐',
    '显示异常',
    '显示不全',
    '缺少一部分数据',
    '错位',
    '遮挡',
    '重叠',
    '不一致',
    '变形',
    '视觉',
    'viewport',
    '分辨率',
    '设计稿',
    '基线',
    'screenshot'
  ].map((keyword) => normalizeText(keyword))
);

const VISUAL_ATTACHMENT_IMAGE_WEIGHT_STRONG = 2.2;
const VISUAL_ATTACHMENT_IMAGE_WEIGHT_WEAK = 0.25;
const VISUAL_ATTACHMENT_FILENAME_WEIGHT_STRONG = 1.2;
const VISUAL_ATTACHMENT_FILENAME_WEIGHT_WEAK = 0.15;
const ATTACHMENT_FILENAME_WEIGHT_NON_VISUAL = 1.2;

export function routeIssueProfile(
  evidencePack: JiraEvidencePackV2,
  options?: IssueTypeRouterOptions
): IssueTypeRouterResult {
  const resolvedOptions = {
    ...DEFAULT_OPTIONS,
    ...options
  };
  const { signals, droppedByInvalidSourceRefCount } = collectSignals(evidencePack);

  if (signals.length === 0) {
    return buildGeneralResult({
      matchedSignals: [],
      confidence: 0.35,
      rationale:
        droppedByInvalidSourceRefCount > 0
          ? '检测到候选信号，但缺少可追溯 sourceRef，按 General 回退。'
          : '未检测到任何可路由信号，按 General 回退。',
      fallbackReason:
        droppedByInvalidSourceRefCount > 0
          ? 'no_traceable_signal_source_ref'
          : 'insufficient_evidence'
    });
  }

  const profileScores = scoreByProfile(signals);
  const [top, second] = rankProfiles(profileScores);

  if (top === undefined || top.score < resolvedOptions.minimumDecisionScore) {
    return buildGeneralResult({
      matchedSignals: signals,
      confidence: 0.38,
      rationale: `存在信号但分数不足（top=${formatScore(top?.score ?? 0)}，threshold=${formatScore(resolvedOptions.minimumDecisionScore)}），按 General 回退。`,
      fallbackReason: 'insufficient_evidence'
    });
  }

  const ambiguous =
    second !== undefined &&
    second.score > 0 &&
    top.score - second.score <= resolvedOptions.ambiguityScoreGap &&
    (top.score - second.score) / top.score <= resolvedOptions.ambiguityMarginRatio;

  if (ambiguous) {
    const ambiguousSignals = signals.filter(
      (signal) => signal.profile === top.profile || signal.profile === second.profile
    );
    return buildGeneralResult({
      matchedSignals: ambiguousSignals,
      confidence: 0.34,
      rationale: `存在分型歧义：${top.profile}(${formatScore(top.score)}) 与 ${second.profile}(${formatScore(second.score)}) 分数接近，按 General 回退。`,
      fallbackReason: 'ambiguous_profile_scores'
    });
  }

  const topSignals = signals.filter((signal) => signal.profile === top.profile);
  const confidence = computeConfidence(top.score, second?.score ?? 0, topSignals.length);
  const sourceRefs = dedupeSourceRefs(topSignals);

  return {
    profile: top.profile,
    confidence,
    matchedSignals: topSignals,
    sourceRefs,
    rationale: `命中 ${topSignals.length} 个 ${top.profile} 信号，top=${formatScore(top.score)}，second=${formatScore(second?.score ?? 0)}。`,
    fallbackReason: null
  };
}

export function evaluateIssueTypeRouter(
  samples: readonly IssueTypeRouterEvalSample[],
  options?: IssueTypeRouterOptions
): IssueTypeRouterEvalResult {
  const failures: IssueTypeRouterEvalFailure[] = [];
  let passedCount = 0;
  let matchedSignalCount = 0;
  let validSignalSourceRefCount = 0;

  for (const sample of samples) {
    const result = routeIssueProfile(sample.evidencePack, options);
    if (result.profile === sample.expectedProfile) {
      passedCount += 1;
    } else {
      failures.push({
        id: sample.id,
        expectedProfile: sample.expectedProfile,
        predictedProfile: result.profile,
        confidence: result.confidence,
        fallbackReason: result.fallbackReason
      });
    }

    matchedSignalCount += result.matchedSignals.length;
    for (const signal of result.matchedSignals) {
      if (sample.evidencePack.sourceRefs.includes(signal.sourceRef)) {
        validSignalSourceRefCount += 1;
      }
    }
  }

  return {
    sampleCount: samples.length,
    passedCount,
    top1Accuracy: round(samples.length === 0 ? 0 : passedCount / samples.length),
    sourceRefCoverage: round(
      matchedSignalCount === 0 ? 1 : validSignalSourceRefCount / matchedSignalCount
    ),
    failures
  };
}

function collectSignals(evidencePack: JiraEvidencePackV2): CollectSignalsResult {
  const validSourceRefs = new Set(evidencePack.sourceRefs);
  const signals: InternalSignal[] = [];
  let droppedByInvalidSourceRefCount = 0;

  const seenKeys = new Set<string>();
  const addSignal = (signal: InternalSignal): void => {
    if (!validSourceRefs.has(signal.sourceRef)) {
      droppedByInvalidSourceRefCount += 1;
      return;
    }
    const key = `${signal.kind}|${signal.profile}|${signal.value}|${signal.sourceRef}`;
    if (seenKeys.has(key)) {
      return;
    }
    seenKeys.add(key);
    signals.push(signal);
  };

  addTextSignals(
    addSignal,
    evidencePack.issue.issueType,
    evidencePack.issue.sourceRef,
    'issue_type',
    2.4,
    ISSUE_TYPE_KEYWORDS
  );
  addTextSignals(
    addSignal,
    evidencePack.issue.summary,
    evidencePack.issue.sourceRef,
    'summary_keyword',
    1.6,
    PROFILE_KEYWORDS
  );
  addTextSignals(
    addSignal,
    evidencePack.issue.description,
    evidencePack.issue.sourceRef,
    'description_keyword',
    1.2,
    PROFILE_KEYWORDS
  );

  for (const comment of evidencePack.comments) {
    addTextSignals(
      addSignal,
      comment.body,
      comment.sourceRef,
      'comment_keyword',
      0.9,
      PROFILE_KEYWORDS
    );
  }

  const hasStrongVisualTextSignal = signals.some(
    (signal) =>
      signal.profile === 'Visual' &&
      signal.kind !== 'attachment_mime' &&
      STRONG_VISUAL_TEXT_SIGNAL_VALUES.has(signal.value)
  );

  const visualAttachmentImageWeight = hasStrongVisualTextSignal
    ? VISUAL_ATTACHMENT_IMAGE_WEIGHT_STRONG
    : VISUAL_ATTACHMENT_IMAGE_WEIGHT_WEAK;
  const visualAttachmentFilenameWeight = hasStrongVisualTextSignal
    ? VISUAL_ATTACHMENT_FILENAME_WEIGHT_STRONG
    : VISUAL_ATTACHMENT_FILENAME_WEIGHT_WEAK;

  for (const attachment of evidencePack.attachments) {
    addAttachmentSignals(addSignal, {
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      sourceRef: attachment.sourceRef,
      visualImageWeight: visualAttachmentImageWeight,
      visualFilenameWeight: visualAttachmentFilenameWeight
    });
  }

  for (const media of evidencePack.mediaEvidence) {
    addAttachmentSignals(addSignal, {
      filename: media.filename,
      mimeType: media.mimeType,
      sourceRef: media.sourceRef,
      visualImageWeight: visualAttachmentImageWeight,
      visualFilenameWeight: visualAttachmentFilenameWeight
    });
  }

  if (evidencePack.projectMetadata !== null) {
    const metadataText = collectProjectMetadataText(evidencePack.projectMetadata);
    addTextSignals(
      addSignal,
      metadataText,
      evidencePack.projectMetadata.sourceRef,
      'project_metadata',
      1.4,
      PROJECT_METADATA_KEYWORDS
    );
  }

  for (const fieldValue of evidencePack.fieldValues) {
    const normalized = extractFieldValueText(fieldValue);
    if (normalized.length === 0) {
      continue;
    }

    addTextSignals(
      addSignal,
      normalized,
      fieldValue.sourceRef,
      'field_value',
      1.1,
      PROFILE_KEYWORDS
    );

    if (
      fieldValue.fieldKey === 'issueCategory' ||
      fieldValue.fieldKey === 'defectCategory' ||
      fieldValue.fieldKey === 'productModule' ||
      fieldValue.fieldKey === 'projectSource'
    ) {
      addTextSignals(
        addSignal,
        normalized,
        fieldValue.sourceRef,
        'historical_mapping',
        1.7,
        HISTORICAL_MAPPING_KEYWORDS
      );
    }
  }

  addTextSignals(
    addSignal,
    evidencePack.issue.labels.join(' '),
    evidencePack.issue.sourceRef,
    'historical_mapping',
    1.2,
    HISTORICAL_MAPPING_KEYWORDS
  );

  return {
    signals,
    droppedByInvalidSourceRefCount
  };
}

function addTextSignals(
  addSignal: (_signal: InternalSignal) => void,
  text: string,
  sourceRef: string,
  kind: InternalSignal['kind'],
  weight: number,
  keywordRules: readonly ProfileKeywordRule[]
): void {
  const normalizedText = normalizeText(text);
  if (normalizedText.length === 0 || sourceRef.trim().length === 0) {
    return;
  }

  for (const rule of keywordRules) {
    const matchedKeywords = findMatchedKeywords(normalizedText, rule.keywords);
    for (const keyword of matchedKeywords) {
      addSignal({
        kind,
        profile: rule.profile,
        value: keyword,
        weight,
        sourceRef
      });
    }
  }
}

function addAttachmentSignals(
  addSignal: (_signal: InternalSignal) => void,
  input: {
    readonly filename: string;
    readonly mimeType: string;
    readonly sourceRef: string;
    readonly visualImageWeight: number;
    readonly visualFilenameWeight: number;
  }
): void {
  if (startsWithImageMimeType(input.mimeType)) {
    addSignal({
      kind: 'attachment_mime',
      profile: 'Visual',
      value: input.mimeType,
      weight: input.visualImageWeight,
      sourceRef: input.sourceRef
    });
  }

  const normalizedText = normalizeText(input.filename);
  if (normalizedText.length === 0 || input.sourceRef.trim().length === 0) {
    return;
  }

  for (const rule of ATTACHMENT_FILENAME_KEYWORDS) {
    const matchedKeywords = findMatchedKeywords(normalizedText, rule.keywords);
    for (const keyword of matchedKeywords) {
      addSignal({
        kind: 'attachment_mime',
        profile: rule.profile,
        value: keyword,
        weight:
          rule.profile === 'Visual'
            ? input.visualFilenameWeight
            : ATTACHMENT_FILENAME_WEIGHT_NON_VISUAL,
        sourceRef: input.sourceRef
      });
    }
  }
}

function findMatchedKeywords(text: string, keywords: readonly string[]): readonly string[] {
  const matched = new Set<string>();
  for (const keyword of keywords) {
    const normalizedKeyword = normalizeText(keyword);
    if (normalizedKeyword.length === 0) {
      continue;
    }
    if (text.includes(normalizedKeyword)) {
      matched.add(normalizedKeyword);
    }
  }

  return [...matched];
}

function scoreByProfile(signals: readonly InternalSignal[]): Readonly<Record<RoutedIssueProfile, number>> {
  const scores: Record<RoutedIssueProfile, number> = {
    Visual: 0,
    Integration: 0,
    Workflow: 0,
    Billing: 0,
    AccessControl: 0
  };

  for (const signal of signals) {
    scores[signal.profile] += signal.weight;
  }

  return scores;
}

function rankProfiles(
  scores: Readonly<Record<RoutedIssueProfile, number>>
): readonly [ProfileScore | undefined, ProfileScore | undefined] {
  const ranked = ROUTED_PROFILES.map((profile) => ({
    profile,
    score: scores[profile]
  })).sort((left, right) => right.score - left.score);

  return [ranked.at(0), ranked.at(1)];
}

function computeConfidence(topScore: number, secondScore: number, signalCount: number): number {
  const margin = topScore - secondScore;
  const dominance = topScore <= 0 ? 0 : clamp(margin / topScore, 0, 1);
  const scoreStrength = clamp(topScore / 12, 0, 1);
  const evidenceStrength = clamp(signalCount / 6, 0, 1);

  let confidence = 0.45 + scoreStrength * 0.35 + evidenceStrength * 0.2;
  confidence *= 0.7 + dominance * 0.3;

  if (signalCount <= 1) {
    confidence = Math.min(confidence, 0.72);
  }

  return round(clamp(confidence, 0, 1));
}

function buildGeneralResult(input: {
  readonly matchedSignals: readonly InternalSignal[];
  readonly confidence: number;
  readonly rationale: string;
  readonly fallbackReason: string;
}): IssueTypeRouterResult {
  const sourceRefs = dedupeSourceRefs(input.matchedSignals);
  return {
    profile: 'General',
    confidence: round(clamp(input.confidence, 0, 0.4)),
    matchedSignals: input.matchedSignals,
    sourceRefs,
    rationale: input.rationale,
    fallbackReason: input.fallbackReason
  };
}

function dedupeSourceRefs(
  signals: readonly {
    readonly sourceRef: string;
  }[]
): readonly string[] {
  const seen = new Set<string>();
  for (const signal of signals) {
    if (signal.sourceRef.trim().length > 0) {
      seen.add(signal.sourceRef);
    }
  }

  return [...seen];
}

function normalizeText(input: string): string {
  return input.trim().toLowerCase();
}

function startsWithImageMimeType(mimeType: string): boolean {
  return normalizeText(mimeType).startsWith('image/');
}

function collectProjectMetadataText(projectMetadata: JiraProjectMetadataV2): string {
  const componentsText = projectMetadata.components
    .map((component) => `${component.name} ${component.description}`)
    .join(' ');
  const versionsText = projectMetadata.versions.map((version) => version.name).join(' ');
  const statusesText = projectMetadata.statuses
    .map((status) => {
      const issueTypesText = status.issueTypes
        .map(
          (issueType) =>
            `${issueType.name} ${issueType.statuses.map((item) => item.name).join(' ')}`
        )
        .join(' ');
      return `${status.name} ${issueTypesText}`;
    })
    .join(' ');

  return [projectMetadata.projectKey, projectMetadata.projectName, componentsText, versionsText, statusesText]
    .join(' ')
    .trim();
}

function extractFieldValueText(fieldValue: JiraEvidenceFieldValueV2): string {
  if (fieldValue.valueKind === 'string') {
    return fieldValue.valueString ?? '';
  }

  if (fieldValue.valueKind === 'string_list') {
    return fieldValue.valueStrings?.join(' ') ?? '';
  }

  if (fieldValue.valueKind === 'time_tracking') {
    const parts: string[] = [];
    const tracking = fieldValue.valueTimeTracking;
    if (tracking?.originalEstimateSeconds !== undefined) {
      parts.push(String(tracking.originalEstimateSeconds));
    }
    if (tracking?.remainingEstimateSeconds !== undefined) {
      parts.push(String(tracking.remainingEstimateSeconds));
    }
    if (tracking?.timeSpentSeconds !== undefined) {
      parts.push(String(tracking.timeSpentSeconds));
    }

    return parts.join(' ');
  }

  return '';
}

function formatScore(score: number): string {
  return round(score).toFixed(2);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
