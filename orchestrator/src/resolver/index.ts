export const RESOLVER_PACKET_SCHEMA_VERSION = 'resolver_packet.v1';

export type ResolverRiskLevel = 'L0' | 'L1' | 'L2' | 'L3';
export type ResolverNextAction = 'shadow_ready' | 'need_more_context' | 'ask_human' | 'await_human';
export type ResolverIntentKind = 'bugfix' | 'feature' | 'investigation' | 'maintenance' | 'unknown';
export type ResolverRepoHintLocator = 'historical_evidence' | 'source_ref' | 'retrieval_hint';

export interface ResolverJiraWorkItem {
  readonly issueKey: string;
  readonly summary: string;
  readonly description: string;
  readonly labels: readonly string[];
  readonly status?: string | undefined;
  readonly priority?: string | undefined;
  readonly sourceRef: string;
}

export interface ResolverHistoricalRepoHint {
  readonly project: string;
  readonly module: string;
  readonly confidence: number;
  readonly sourceRefs: readonly string[];
}

export interface ResolverInput {
  readonly jira: ResolverJiraWorkItem;
  readonly evidenceRefs?: readonly string[] | undefined;
  readonly historicalRepoHints?: readonly ResolverHistoricalRepoHint[] | undefined;
  readonly constraints?: readonly string[] | undefined;
  readonly knownHighRisk?: boolean | undefined;
}

export interface ResolverIntent {
  readonly issue_key: string;
  readonly summary: string;
  readonly kind: ResolverIntentKind;
  readonly source_refs: readonly string[];
}

export interface ResolverRepoHint {
  readonly project: string;
  readonly module: string;
  readonly confidence: number;
  readonly locator: ResolverRepoHintLocator;
  readonly source_refs: readonly string[];
  readonly retrieval_query: string | null;
}

export interface ResolverPacketV1 {
  readonly schema_version: typeof RESOLVER_PACKET_SCHEMA_VERSION;
  readonly intent: ResolverIntent;
  readonly constraints: readonly string[];
  readonly repo_hints: readonly ResolverRepoHint[];
  readonly risk_level: ResolverRiskLevel;
  readonly missing_info: readonly string[];
  readonly next_action: ResolverNextAction;
  readonly source_refs: readonly string[];
}

export interface ResolverRiskClassification {
  readonly riskLevel: ResolverRiskLevel;
  readonly reasons: readonly string[];
  readonly highRiskDomain: boolean;
}

export interface ResolverPacketValidationIssue {
  readonly field: string;
  readonly message: string;
}

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | readonly JsonValue[] | JsonObject;
interface JsonObject {
  readonly [key: string]: JsonValue;
}

export const RESOLVER_PACKET_V1_JSON_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'resolver_packet.v1.schema.json',
  title: 'resolver_packet v1',
  type: 'object',
  additionalProperties: false,
  required: [
    'schema_version',
    'intent',
    'constraints',
    'repo_hints',
    'risk_level',
    'missing_info',
    'next_action',
    'source_refs'
  ],
  properties: {
    schema_version: { const: RESOLVER_PACKET_SCHEMA_VERSION },
    intent: {
      type: 'object',
      additionalProperties: false,
      required: ['issue_key', 'summary', 'kind', 'source_refs'],
      properties: {
        issue_key: { type: 'string', minLength: 1 },
        summary: { type: 'string', minLength: 1 },
        kind: {
          enum: ['bugfix', 'feature', 'investigation', 'maintenance', 'unknown']
        },
        source_refs: {
          type: 'array',
          items: { type: 'string', minLength: 1 }
        }
      }
    },
    constraints: {
      type: 'array',
      items: { type: 'string', minLength: 1 }
    },
    repo_hints: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['project', 'module', 'confidence', 'locator', 'source_refs', 'retrieval_query'],
        properties: {
          project: { type: 'string', minLength: 1 },
          module: { type: 'string', minLength: 1 },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          locator: {
            enum: ['historical_evidence', 'source_ref', 'retrieval_hint']
          },
          source_refs: {
            type: 'array',
            items: { type: 'string', minLength: 1 }
          },
          retrieval_query: {
            type: ['string', 'null']
          }
        }
      }
    },
    risk_level: { enum: ['L0', 'L1', 'L2', 'L3'] },
    missing_info: {
      type: 'array',
      items: { type: 'string', minLength: 1 }
    },
    next_action: {
      enum: ['shadow_ready', 'need_more_context', 'ask_human', 'await_human']
    },
    source_refs: {
      type: 'array',
      items: { type: 'string', minLength: 1 }
    }
  }
} as const satisfies JsonObject;

const SHADOW_CONSTRAINTS = [
  'shadow_only',
  'no_external_write',
  'no_auto_merge',
  'no_jira_status_change',
  'real_fanout_disabled'
] as const;

const HIGH_RISK_PATTERNS = [
  '输血',
  '血袋',
  '配血',
  '取血',
  '输注',
  'transfusion',
  'blood bag',
  'bloodtransfusion',
  '病案',
  '病历',
  'patient',
  'medical record',
  '收费',
  '计费',
  'billing',
  'payment',
  'ca签名',
  'ca 签名',
  'signature',
  '电子签名',
  'token',
  'secret',
  'credential',
  'auth bypass',
  'sso',
  'oauth',
  '权限'
] as const;

const L2_PATTERNS = [
  'database',
  'migration',
  'schema',
  'external',
  'integration',
  'pipeline',
  'runner',
  'webhook',
  'scheduler',
  'cron',
  '生产',
  'prod',
  'db',
  '接口'
] as const;

const LOW_RISK_PATTERNS = [
  'copy',
  'style',
  'css',
  'docs',
  'readme',
  '文案',
  '样式',
  '只调整',
  'only update'
] as const;

const BUGFIX_PATTERNS = [
  'bug',
  'fix',
  'broken',
  'error',
  'regression',
  'fail',
  '修复',
  '异常',
  '报错',
  '错误'
] as const;

const FEATURE_PATTERNS = ['add', 'support', 'feature', '新增', '增加', '支持'] as const;
const INVESTIGATION_PATTERNS = [
  'investigate',
  'root cause',
  'cross-module',
  'uncertain',
  '排查',
  '定位',
  '待确认',
  '不明确'
] as const;
const MAINTENANCE_PATTERNS = ['cleanup', 'refactor', 'docs', 'style', '文案', '样式'] as const;
const ACCEPTANCE_PATTERNS = [
  'acceptance',
  'criteria',
  'expected',
  'verify',
  'repro',
  'steps',
  'test',
  '验收',
  '期望',
  '复现',
  '验证',
  '测试'
] as const;
const AMBIGUOUS_PATTERNS = ['fix it', 'broken page', '有问题', '坏了', '异常', '不明确'] as const;

export function buildResolverPacketV1(input: ResolverInput): ResolverPacketV1 {
  const sourceRefs = collectInputSourceRefs(input);
  const repoHints = locateRepoHints(input, sourceRefs);
  const risk = classifyResolverRisk(input);
  const hasRepoEvidence = sourceRefs.some(isRepoEvidenceSourceRef);
  const missingInfo = buildMissingInfoQuestions(input, repoHints, risk);
  const nextAction = chooseNextAction({
    input,
    risk,
    hasRepoEvidence
  });
  const constraints = dedupe([
    ...SHADOW_CONSTRAINTS,
    ...(risk.riskLevel === 'L3' ? ['high_risk_requires_human_approval'] : []),
    ...(input.constraints ?? []).map((constraint) => constraint.trim()).filter(Boolean)
  ]);

  return {
    schema_version: RESOLVER_PACKET_SCHEMA_VERSION,
    intent: {
      issue_key: input.jira.issueKey.trim(),
      summary: summarizeIntent(input.jira),
      kind: classifyIntent(input.jira),
      source_refs: input.jira.sourceRef.trim().length > 0 ? [input.jira.sourceRef.trim()] : []
    },
    constraints,
    repo_hints: repoHints,
    risk_level: risk.riskLevel,
    missing_info: missingInfo,
    next_action: nextAction,
    source_refs: sourceRefs
  };
}

export function buildMissingInfoQuestions(
  input: ResolverInput,
  repoHints: readonly ResolverRepoHint[] = locateRepoHints(input, collectInputSourceRefs(input)),
  risk: ResolverRiskClassification = classifyResolverRisk(input)
): readonly string[] {
  const questions: string[] = [];
  const text = normalizeText(buildIssueText(input.jira));
  const hasRepoEvidence = collectInputSourceRefs(input).some(isRepoEvidenceSourceRef);
  const retrievalHint = repoHints.find((hint) => hint.locator === 'retrieval_hint');

  if (input.jira.issueKey.trim().length === 0) {
    questions.push('请提供 Jira work item key 是什么？');
  }

  if (input.jira.summary.trim().length === 0 && input.jira.description.trim().length < 20) {
    questions.push('请提供该 Jira 的目标行为、当前行为或验收标准是什么？');
  }

  if (!hasRepoEvidence) {
    const retrievalQuery = retrievalHint?.retrieval_query;
    questions.push(
      retrievalQuery === null || retrievalQuery === undefined || retrievalQuery.length === 0
        ? '请提供可验证的 gitlab: 或 local: source_ref 是什么？'
        : `请提供与检索提示 "${retrievalQuery}" 匹配的 gitlab: 或 local: source_ref 是什么？`
    );
  }

  if (containsAny(text, AMBIGUOUS_PATTERNS) && !containsAny(text, ACCEPTANCE_PATTERNS)) {
    questions.push('请确认可复现步骤、受影响页面或接口、期望结果分别是什么？');
  }

  if (!containsAny(text, ACCEPTANCE_PATTERNS)) {
    questions.push('请确认验收标准或验证方式是什么？');
  }

  if (risk.riskLevel === 'L3') {
    questions.push(
      '请确认该高风险域是否已有人工审批，以及允许 Resolver 审阅的脱敏证据范围是什么？'
    );
  }

  return dedupe(questions.map(ensureQuestion));
}

export function locateRepoHints(
  input: ResolverInput,
  allowedSourceRefs: readonly string[] = collectInputSourceRefs(input)
): readonly ResolverRepoHint[] {
  const allowed = new Set(allowedSourceRefs);
  const historicalHints = (input.historicalRepoHints ?? [])
    .map((hint) => normalizeHistoricalRepoHint(hint, allowed))
    .filter((hint): hint is ResolverRepoHint => hint !== null)
    .sort((left, right) => right.confidence - left.confidence);

  if (historicalHints.length > 0) {
    return historicalHints;
  }

  const parsedEvidence = allowedSourceRefs.map(parseRepoEvidenceSourceRef).filter(isParsedRepoRef);
  if (parsedEvidence.length > 0) {
    return groupParsedRepoRefs(parsedEvidence);
  }

  return [
    {
      project: 'unknown',
      module: 'unknown',
      confidence: 0.2,
      locator: 'retrieval_hint',
      source_refs: [],
      retrieval_query: buildRetrievalQuery(input.jira)
    }
  ];
}

export function classifyResolverRisk(input: ResolverInput): ResolverRiskClassification {
  const text = normalizeText(
    `${buildIssueText(input.jira)} ${(input.constraints ?? []).join(' ')} ${(input.evidenceRefs ?? []).join(' ')}`
  );

  if (input.knownHighRisk === true) {
    return {
      riskLevel: 'L3',
      reasons: ['input.high_risk'],
      highRiskDomain: true
    };
  }

  const highRiskHits = matchingPatterns(text, HIGH_RISK_PATTERNS);
  if (highRiskHits.length > 0) {
    return {
      riskLevel: 'L3',
      reasons: highRiskHits.map((hit) => `high_risk_domain:${hit}`),
      highRiskDomain: true
    };
  }

  const l2Hits = matchingPatterns(text, L2_PATTERNS);
  if (l2Hits.length > 0) {
    return {
      riskLevel: 'L2',
      reasons: l2Hits.map((hit) => `controlled_surface:${hit}`),
      highRiskDomain: false
    };
  }

  if (containsAny(text, LOW_RISK_PATTERNS)) {
    return {
      riskLevel: 'L0',
      reasons: ['low_risk_surface'],
      highRiskDomain: false
    };
  }

  return {
    riskLevel: 'L1',
    reasons: ['default_application_change'],
    highRiskDomain: false
  };
}

export function validateResolverPacketV1(
  value: unknown,
  options: { readonly allowedSourceRefs?: readonly string[] | undefined } = {}
): readonly ResolverPacketValidationIssue[] {
  const issues: ResolverPacketValidationIssue[] = [];
  if (!isRecord(value)) {
    return [{ field: '$', message: 'resolver_packet must be an object' }];
  }

  const schemaVersion = readStringField(value, 'schema_version', issues);
  if (schemaVersion !== RESOLVER_PACKET_SCHEMA_VERSION) {
    issues.push({
      field: 'schema_version',
      message: `schema_version must be ${RESOLVER_PACKET_SCHEMA_VERSION}`
    });
  }

  const intent = readRecordField(value, 'intent', issues);
  if (intent !== null) {
    const intentKind = readStringField(intent, 'kind', issues, 'intent.kind');
    readRequiredNonBlankString(intent, 'issue_key', issues, 'intent.issue_key');
    readRequiredNonBlankString(intent, 'summary', issues, 'intent.summary');
    if (!isResolverIntentKind(intentKind)) {
      issues.push({ field: 'intent.kind', message: 'intent.kind is invalid' });
    }
    validateSourceRefArrayField(intent, 'source_refs', issues, options.allowedSourceRefs);
  }

  validateStringArrayField(value, 'constraints', issues);
  const sourceRefs = validateSourceRefArrayField(
    value,
    'source_refs',
    issues,
    options.allowedSourceRefs
  );
  const riskLevel = readStringField(value, 'risk_level', issues);
  const nextAction = readStringField(value, 'next_action', issues);

  if (!isResolverRiskLevel(riskLevel)) {
    issues.push({ field: 'risk_level', message: 'risk_level is invalid' });
  }

  if (!isResolverNextAction(nextAction)) {
    issues.push({ field: 'next_action', message: 'next_action is invalid' });
  }

  if (riskLevel === 'L3' && nextAction !== 'await_human') {
    issues.push({
      field: 'next_action',
      message: 'L3 risk must set next_action=await_human'
    });
  }

  const hasRepoEvidence = sourceRefs.some(isRepoEvidenceSourceRef);
  if (
    !hasRepoEvidence &&
    riskLevel !== 'L3' &&
    nextAction !== 'need_more_context' &&
    nextAction !== 'ask_human'
  ) {
    issues.push({
      field: 'next_action',
      message: 'missing repository evidence requires need_more_context or ask_human'
    });
  }

  validateMissingInfo(value, issues);
  validateRepoHints(value, issues, options.allowedSourceRefs);

  return issues;
}

export function isRepoEvidenceSourceRef(value: string): boolean {
  return value.startsWith('gitlab:') || value.startsWith('local:');
}

function collectInputSourceRefs(input: ResolverInput): readonly string[] {
  return dedupe([
    input.jira.sourceRef,
    ...(input.evidenceRefs ?? []),
    ...(input.historicalRepoHints ?? []).flatMap((hint) => hint.sourceRefs)
  ]);
}

function chooseNextAction(input: {
  readonly input: ResolverInput;
  readonly risk: ResolverRiskClassification;
  readonly hasRepoEvidence: boolean;
}): ResolverNextAction {
  if (input.risk.riskLevel === 'L3') {
    return 'await_human';
  }

  if (!input.hasRepoEvidence) {
    return 'need_more_context';
  }

  if (hasBlockingMissingInfo(input.input)) {
    return 'ask_human';
  }

  return 'shadow_ready';
}

function hasBlockingMissingInfo(input: ResolverInput): boolean {
  const text = normalizeText(buildIssueText(input.jira));

  if (input.jira.issueKey.trim().length === 0) {
    return true;
  }

  if (input.jira.summary.trim().length === 0 && input.jira.description.trim().length < 20) {
    return true;
  }

  return containsAny(text, AMBIGUOUS_PATTERNS) && !containsAny(text, ACCEPTANCE_PATTERNS);
}

function summarizeIntent(jira: ResolverJiraWorkItem): string {
  const summary = jira.summary.trim();
  if (summary.length > 0) {
    return truncate(summary, 240);
  }
  const description = jira.description.trim();
  if (description.length > 0) {
    return truncate(description, 240);
  }
  return jira.issueKey.trim();
}

function classifyIntent(jira: ResolverJiraWorkItem): ResolverIntentKind {
  const text = normalizeText(buildIssueText(jira));
  if (containsAny(text, INVESTIGATION_PATTERNS)) return 'investigation';
  if (containsAny(text, BUGFIX_PATTERNS)) return 'bugfix';
  if (containsAny(text, FEATURE_PATTERNS)) return 'feature';
  if (containsAny(text, MAINTENANCE_PATTERNS)) return 'maintenance';
  return 'unknown';
}

function normalizeHistoricalRepoHint(
  hint: ResolverHistoricalRepoHint,
  allowedSourceRefs: ReadonlySet<string>
): ResolverRepoHint | null {
  const sourceRefs = dedupe(
    hint.sourceRefs.filter(
      (sourceRef) => allowedSourceRefs.has(sourceRef) && isRepoEvidenceSourceRef(sourceRef)
    )
  );

  if (sourceRefs.length === 0) {
    return null;
  }

  return {
    project: hint.project.trim() || 'unknown',
    module: hint.module.trim() || 'unknown',
    confidence: clamp01(hint.confidence),
    locator: 'historical_evidence',
    source_refs: sourceRefs,
    retrieval_query: null
  };
}

interface ParsedRepoRef {
  readonly project: string;
  readonly module: string;
  readonly sourceRef: string;
}

function parseRepoEvidenceSourceRef(sourceRef: string): ParsedRepoRef | null {
  if (!isRepoEvidenceSourceRef(sourceRef)) {
    return null;
  }

  const prefixEnd = sourceRef.indexOf(':');
  if (prefixEnd < 0) {
    return null;
  }

  const fileMarker = '#file:';
  const fileMarkerIndex = sourceRef.indexOf(fileMarker);
  if (fileMarkerIndex < 0) {
    const projectOnly =
      sourceRef
        .slice(prefixEnd + 1)
        .split('#')[0]
        ?.trim() ?? '';
    if (projectOnly.length === 0) return null;
    return {
      project: projectOnly,
      module: 'unknown',
      sourceRef
    };
  }

  const project = sourceRef.slice(prefixEnd + 1, fileMarkerIndex).trim();
  const fileStart = fileMarkerIndex + fileMarker.length;
  const fileAndSuffix = sourceRef.slice(fileStart);
  const suffixIndex = firstExistingIndex([fileAndSuffix.indexOf('@'), fileAndSuffix.indexOf('#')]);
  const filePath =
    suffixIndex === null ? fileAndSuffix.trim() : fileAndSuffix.slice(0, suffixIndex).trim();

  if (project.length === 0) {
    return null;
  }

  return {
    project,
    module: moduleFromPath(filePath),
    sourceRef
  };
}

function groupParsedRepoRefs(parsedRefs: readonly ParsedRepoRef[]): readonly ResolverRepoHint[] {
  const groups = new Map<string, ParsedRepoRef[]>();
  for (const parsedRef of parsedRefs) {
    const key = `${parsedRef.project}\n${parsedRef.module}`;
    const existing = groups.get(key) ?? [];
    groups.set(key, [...existing, parsedRef]);
  }

  return [...groups.values()]
    .map((group): ResolverRepoHint => {
      const first = group[0];
      if (first === undefined) {
        return {
          project: 'unknown',
          module: 'unknown',
          confidence: 0.2,
          locator: 'retrieval_hint',
          source_refs: [],
          retrieval_query: null
        };
      }
      return {
        project: first.project,
        module: first.module,
        confidence: 0.72,
        locator: 'source_ref',
        source_refs: dedupe(group.map((item) => item.sourceRef)),
        retrieval_query: null
      };
    })
    .sort((left, right) => right.source_refs.length - left.source_refs.length);
}

function buildRetrievalQuery(jira: ResolverJiraWorkItem): string {
  const tokens = tokenize(`${jira.summary} ${jira.description} ${jira.labels.join(' ')}`);
  if (tokens.length === 0) {
    return jira.issueKey.trim();
  }
  return tokens.slice(0, 8).join(' ');
}

function tokenize(text: string): readonly string[] {
  return dedupe(
    normalizeText(text)
      .replace(/[^\p{L}\p{N}\s_-]/gu, ' ')
      .split(/\s+/u)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2)
  );
}

function moduleFromPath(filePath: string): string {
  if (filePath.length === 0) {
    return 'unknown';
  }
  const parts = filePath.split('/').filter((part) => part.length > 0);
  if (parts.length <= 1) {
    return parts[0] ?? filePath;
  }
  return parts.slice(0, Math.max(parts.length - 1, 1)).join('/');
}

function buildIssueText(jira: ResolverJiraWorkItem): string {
  return [
    jira.issueKey,
    jira.summary,
    jira.description,
    jira.labels.join(' '),
    jira.status,
    jira.priority
  ]
    .filter((part): part is string => typeof part === 'string')
    .join(' ');
}

function validateRepoHints(
  value: Readonly<Record<string, unknown>>,
  issues: ResolverPacketValidationIssue[],
  allowedSourceRefs: readonly string[] | undefined
): void {
  const repoHintsValue = value.repo_hints;
  if (!Array.isArray(repoHintsValue)) {
    issues.push({ field: 'repo_hints', message: 'repo_hints must be an array' });
    return;
  }

  for (const [index, hintValue] of repoHintsValue.entries()) {
    const field = `repo_hints[${index}]`;
    if (!isRecord(hintValue)) {
      issues.push({ field, message: 'repo hint must be an object' });
      continue;
    }

    readRequiredNonBlankString(hintValue, 'project', issues, `${field}.project`);
    readRequiredNonBlankString(hintValue, 'module', issues, `${field}.module`);
    const confidence = readNumberField(hintValue, 'confidence', issues, `${field}.confidence`);
    if (confidence < 0 || confidence > 1) {
      issues.push({ field: `${field}.confidence`, message: 'confidence must be in [0, 1]' });
    }

    const locator = readStringField(hintValue, 'locator', issues, `${field}.locator`);
    if (!isResolverRepoHintLocator(locator)) {
      issues.push({ field: `${field}.locator`, message: 'locator is invalid' });
    }

    const sourceRefs = validateSourceRefArrayField(
      hintValue,
      'source_refs',
      issues,
      allowedSourceRefs,
      `${field}.source_refs`
    );
    if (locator !== 'retrieval_hint' && sourceRefs.length === 0) {
      issues.push({
        field: `${field}.source_refs`,
        message: 'evidence-backed repo hints require source_refs'
      });
    }

    if (sourceRefs.some((sourceRef) => !isRepoEvidenceSourceRef(sourceRef))) {
      issues.push({
        field: `${field}.source_refs`,
        message: 'repo hint source_refs must be gitlab: or local: refs'
      });
    }

    if (locator === 'retrieval_hint') {
      if (sourceRefs.length > 0) {
        issues.push({
          field: `${field}.source_refs`,
          message: 'retrieval hints must not claim source_refs'
        });
      }
      readRequiredNonBlankString(hintValue, 'retrieval_query', issues, `${field}.retrieval_query`);
    }

    if (sourceRefs.length === 0 && confidence > 0.4) {
      issues.push({
        field: `${field}.confidence`,
        message: 'hints without source_refs must have confidence <= 0.4'
      });
    }
  }
}

function validateMissingInfo(
  value: Readonly<Record<string, unknown>>,
  issues: ResolverPacketValidationIssue[]
): void {
  const questions = validateStringArrayField(value, 'missing_info', issues);
  for (const [index, question] of questions.entries()) {
    if (!/[?？]$/u.test(question.trim())) {
      issues.push({
        field: `missing_info[${index}]`,
        message: 'missing_info entries must be questions only'
      });
    }
  }
}

function validateSourceRefArrayField(
  value: Readonly<Record<string, unknown>>,
  fieldName: string,
  issues: ResolverPacketValidationIssue[],
  allowedSourceRefs: readonly string[] | undefined,
  field = fieldName
): readonly string[] {
  const sourceRefs = validateStringArrayField(value, fieldName, issues, field);
  const allowed = allowedSourceRefs === undefined ? null : new Set(allowedSourceRefs);

  for (const [index, sourceRef] of sourceRefs.entries()) {
    if (allowed !== null && !allowed.has(sourceRef)) {
      issues.push({
        field: `${field}[${index}]`,
        message: 'source_ref must come from resolver input'
      });
    }
  }

  return sourceRefs;
}

function validateStringArrayField(
  value: Readonly<Record<string, unknown>>,
  fieldName: string,
  issues: ResolverPacketValidationIssue[],
  field = fieldName
): readonly string[] {
  const arrayValue = value[fieldName];
  if (!Array.isArray(arrayValue)) {
    issues.push({ field, message: `${field} must be an array` });
    return [];
  }

  const strings: string[] = [];
  for (const [index, item] of arrayValue.entries()) {
    if (typeof item !== 'string') {
      issues.push({ field: `${field}[${index}]`, message: 'array item must be a string' });
      continue;
    }
    if (item.trim().length === 0) {
      issues.push({ field: `${field}[${index}]`, message: 'array item must not be blank' });
      continue;
    }
    strings.push(item);
  }
  return strings;
}

function readRecordField(
  value: Readonly<Record<string, unknown>>,
  fieldName: string,
  issues: ResolverPacketValidationIssue[]
): Readonly<Record<string, unknown>> | null {
  const fieldValue = value[fieldName];
  if (!isRecord(fieldValue)) {
    issues.push({ field: fieldName, message: `${fieldName} must be an object` });
    return null;
  }
  return fieldValue;
}

function readRequiredNonBlankString(
  value: Readonly<Record<string, unknown>>,
  fieldName: string,
  issues: ResolverPacketValidationIssue[],
  field = fieldName
): string {
  const fieldValue = readStringField(value, fieldName, issues, field);
  if (fieldValue.trim().length === 0) {
    issues.push({ field, message: `${field} must not be blank` });
  }
  return fieldValue;
}

function readStringField(
  value: Readonly<Record<string, unknown>>,
  fieldName: string,
  issues: ResolverPacketValidationIssue[],
  field = fieldName
): string {
  const fieldValue = value[fieldName];
  if (typeof fieldValue !== 'string') {
    issues.push({ field, message: `${field} must be a string` });
    return '';
  }
  return fieldValue;
}

function readNumberField(
  value: Readonly<Record<string, unknown>>,
  fieldName: string,
  issues: ResolverPacketValidationIssue[],
  field = fieldName
): number {
  const fieldValue = value[fieldName];
  if (typeof fieldValue !== 'number' || Number.isNaN(fieldValue)) {
    issues.push({ field, message: `${field} must be a number` });
    return Number.NaN;
  }
  return fieldValue;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isParsedRepoRef(value: ParsedRepoRef | null): value is ParsedRepoRef {
  return value !== null;
}

function isResolverIntentKind(value: string): value is ResolverIntentKind {
  return (
    value === 'bugfix' ||
    value === 'feature' ||
    value === 'investigation' ||
    value === 'maintenance' ||
    value === 'unknown'
  );
}

function isResolverRiskLevel(value: string): value is ResolverRiskLevel {
  return value === 'L0' || value === 'L1' || value === 'L2' || value === 'L3';
}

function isResolverNextAction(value: string): value is ResolverNextAction {
  return (
    value === 'shadow_ready' ||
    value === 'need_more_context' ||
    value === 'ask_human' ||
    value === 'await_human'
  );
}

function isResolverRepoHintLocator(value: string): value is ResolverRepoHintLocator {
  return value === 'historical_evidence' || value === 'source_ref' || value === 'retrieval_hint';
}

function containsAny(text: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => text.includes(pattern));
}

function matchingPatterns(text: string, patterns: readonly string[]): readonly string[] {
  return patterns.filter((pattern) => text.includes(pattern));
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/gu, ' ').trim();
}

function ensureQuestion(value: string): string {
  const trimmed = value.trim();
  if (/[?？]$/u.test(trimmed)) {
    return trimmed;
  }
  return `${trimmed}？`;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return value.slice(0, Math.max(maxLength - 1, 0)).trimEnd();
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function dedupe(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

function firstExistingIndex(values: readonly number[]): number | null {
  const existing = values.filter((value) => value >= 0).sort((left, right) => left - right);
  return existing[0] ?? null;
}
