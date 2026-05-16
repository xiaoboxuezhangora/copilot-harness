export const W16_SECURITY_SCHEMA_VERSION = 'w16-security-hardening@1';

export type ToolActionClass = 'read' | 'write' | 'exec';
export type ToolPolicyDecision = 'allow' | 'deny' | 'pending_human' | 'blocked';
export type InjectionSourceKind =
  | 'issue_comment'
  | 'mr_description'
  | 'tool_output'
  | 'public_repo';
export type InjectionSeverity = 'none' | 'low' | 'medium' | 'high' | 'critical';
export type InjectionAction = 'allow' | 'sanitize' | 'interrupt';
export type WriteIntentState = 'proposed' | 'pending_human' | 'approved' | 'rejected';
export type WriteIntentEvent = 'propose' | 'request_human' | 'approve' | 'reject';

export interface ToolPolicyMatrixEntry {
  readonly toolName: string;
  readonly action: ToolActionClass;
  readonly minimumApproval: 'none' | 'human';
  readonly allowed: boolean;
  readonly reason: string;
}

export interface ToolPolicyEvaluationInput {
  readonly toolName: string;
  readonly action: ToolActionClass;
  readonly traceRef: string;
  readonly approvedWriteIntentId?: string | undefined;
}

export interface ToolPolicyEvaluation {
  readonly schema_version: typeof W16_SECURITY_SCHEMA_VERSION;
  readonly trace_ref: string;
  readonly tool_name: string;
  readonly action: ToolActionClass;
  readonly decision: ToolPolicyDecision;
  readonly reason: string;
  readonly audit_event: SecurityAuditEvent;
}

export interface InjectionFinding {
  readonly rule_id: string;
  readonly severity: Exclude<InjectionSeverity, 'none'>;
  readonly category: 'instruction_override' | 'tool_abuse' | 'exfiltration' | 'hidden_payload';
  readonly description: string;
}

export interface InjectionScanResult {
  readonly schema_version: typeof W16_SECURITY_SCHEMA_VERSION;
  readonly trace_ref: string;
  readonly source_kind: InjectionSourceKind;
  readonly severity: InjectionSeverity;
  readonly action: InjectionAction;
  readonly sanitized_text: string;
  readonly findings: readonly InjectionFinding[];
  readonly audit_event: SecurityAuditEvent;
}

export interface WriteIntent {
  readonly id: string;
  readonly trace_ref: string;
  readonly operation: string;
  readonly source_refs: readonly string[];
  readonly state: WriteIntentState;
  readonly history: readonly WriteIntentTransitionRecord[];
}

export interface WriteIntentTransitionRecord {
  readonly event: WriteIntentEvent;
  readonly from: WriteIntentState;
  readonly to: WriteIntentState;
  readonly trace_ref: string;
  readonly reason: string;
}

export interface SecurityAuditEvent {
  readonly schema_version: typeof W16_SECURITY_SCHEMA_VERSION;
  readonly event_name:
    | 'tool_policy.decision'
    | 'injection.scan'
    | 'write_intent.transition'
    | 'audit.redaction';
  readonly trace_ref: string;
  readonly decision: string;
  readonly reason: string;
  readonly redaction_applied?: boolean | undefined;
  readonly source_refs?: readonly string[] | undefined;
}

interface InjectionRule {
  readonly id: string;
  readonly severity: Exclude<InjectionSeverity, 'none'>;
  readonly category: InjectionFinding['category'];
  readonly pattern: RegExp;
  readonly description: string;
}

const READ_TOOLS = [
  'getIssue',
  'searchIssues',
  'getComments',
  'searchCode',
  'readFile',
  'listRepositoryTree',
  'listMergeRequests',
  'listCommits',
  'getDiff',
  'listPipelines'
] as const;

const WRITE_TOOLS = [
  'updateIssue',
  'transitionIssue',
  'createMergeRequest',
  'updateMergeRequest',
  'mergeMergeRequest',
  'gitPush',
  'writeMemory',
  'createBranch'
] as const;

const EXEC_TOOLS = ['shell', 'exec', 'runCommand', 'spawnProcess'] as const;

export const W16_TOOL_POLICY_MATRIX: readonly ToolPolicyMatrixEntry[] = [
  ...READ_TOOLS.map(
    (toolName): ToolPolicyMatrixEntry => ({
      toolName,
      action: 'read',
      minimumApproval: 'none',
      allowed: true,
      reason: 'Read-only MCP/tool call in explicit allowlist.'
    })
  ),
  ...WRITE_TOOLS.map(
    (toolName): ToolPolicyMatrixEntry => ({
      toolName,
      action: 'write',
      minimumApproval: 'human',
      allowed: false,
      reason: 'External or durable write requires write-intent approval.'
    })
  ),
  ...EXEC_TOOLS.map(
    (toolName): ToolPolicyMatrixEntry => ({
      toolName,
      action: 'exec',
      minimumApproval: 'human',
      allowed: false,
      reason: 'Process execution is denied by default and must be explicitly scoped.'
    })
  )
] as const;

const INJECTION_RULES: readonly InjectionRule[] = [
  {
    id: 'ignore_previous_instructions',
    severity: 'high',
    category: 'instruction_override',
    pattern:
      /\b(ignore|forget|override)\s+(all\s+)?(previous|prior|system|developer)\s+instructions?\b/i,
    description: 'Attempts to override higher-priority instructions.'
  },
  {
    id: 'reveal_system_prompt',
    severity: 'high',
    category: 'exfiltration',
    pattern:
      /\b(reveal|print|dump|show)\s+(the\s+)?(system|developer)\s+(prompt|message|instructions?)\b/i,
    description: 'Attempts to exfiltrate system/developer instructions.'
  },
  {
    id: 'unauthorized_write',
    severity: 'critical',
    category: 'tool_abuse',
    pattern:
      /\b(push|merge|create\s+(a\s+)?(mr|merge request|pull request)|transition\s+jira|update\s+jira)\b/i,
    description: 'Requests an unauthorized external write.'
  },
  {
    id: 'hidden_tool_payload',
    severity: 'high',
    category: 'hidden_payload',
    pattern:
      /(<!--[\s\S]*?(ignore|push|merge|system prompt)[\s\S]*?-->|<script[\s\S]*?>[\s\S]*?<\/script>)/i,
    description: 'Hidden markup or script carries tool or instruction payload.'
  },
  {
    id: 'tool_output_claims_authority',
    severity: 'high',
    category: 'instruction_override',
    pattern:
      /\b(tool output|repository file|public repo)\s+(says|requires|instructs)\s+you\s+to\b/i,
    description: 'Untrusted content claims authority over the agent.'
  }
] as const;

const REDACTION_RULES: readonly {
  readonly id: string;
  readonly pattern: RegExp;
  readonly replacement: string;
}[] = [
  {
    id: 'authorization_bearer',
    pattern: /\b(?:authorization\s*:\s*)?bearer\s+[a-z0-9\-._~+/]{8,}=*/gi,
    replacement: '[redacted-credential]'
  },
  {
    id: 'api_key_assignment',
    pattern:
      /\b(?:token|secret|api[_-]?key|client_secret|app_secret|access_key|secret_key)\s*[:=]\s*["']?[^"'\s,;]+/gi,
    replacement: '[redacted-secret]'
  },
  {
    id: 'gitlab_token',
    pattern: /glpat-[A-Za-z0-9_-]{12,}/g,
    replacement: '[redacted-gitlab-token]'
  },
  {
    id: 'openai_key',
    pattern: /sk-[A-Za-z0-9_-]{12,}/g,
    replacement: '[redacted-api-key]'
  },
  {
    id: 'email',
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    replacement: '[redacted-email]'
  },
  {
    id: 'phone',
    pattern: /\b(?:\+?86[-\s]?)?1[3-9]\d{9}\b/g,
    replacement: '[redacted-phone]'
  },
  {
    id: 'patient_identifier',
    pattern:
      /\b(?:patient(?:_?id|_?no)?|inpatient(?:_?id|_?no)?|患者(?:编号|标识|姓名|证件)|身份证号?|住院号)\s*[:=：]\s*\S{2,}/gi,
    replacement: '[redacted-patient-id]'
  }
] as const;

export function evaluateToolActionPolicy(input: ToolPolicyEvaluationInput): ToolPolicyEvaluation {
  const matrixEntry = W16_TOOL_POLICY_MATRIX.find(
    (entry) => entry.toolName === input.toolName && entry.action === input.action
  );
  const decision = decideToolPolicy(input, matrixEntry);
  const reason =
    matrixEntry?.reason ?? `Tool ${input.toolName}/${input.action} is not allowlisted.`;

  return {
    schema_version: W16_SECURITY_SCHEMA_VERSION,
    trace_ref: input.traceRef,
    tool_name: input.toolName,
    action: input.action,
    decision,
    reason,
    audit_event: {
      schema_version: W16_SECURITY_SCHEMA_VERSION,
      event_name: 'tool_policy.decision',
      trace_ref: input.traceRef,
      decision,
      reason
    }
  };
}

export function scanForInjection(input: {
  readonly traceRef: string;
  readonly sourceKind: InjectionSourceKind;
  readonly text: string;
}): InjectionScanResult {
  const findings = INJECTION_RULES.filter((rule) => rule.pattern.test(input.text)).map(
    (rule): InjectionFinding => ({
      rule_id: rule.id,
      severity: rule.severity,
      category: rule.category,
      description: rule.description
    })
  );
  const severity = highestInjectionSeverity(findings);
  const action = actionForSeverity(severity);
  const sanitizedText = sanitizeInjectionText(input.text, findings);

  return {
    schema_version: W16_SECURITY_SCHEMA_VERSION,
    trace_ref: input.traceRef,
    source_kind: input.sourceKind,
    severity,
    action,
    sanitized_text: sanitizedText,
    findings,
    audit_event: {
      schema_version: W16_SECURITY_SCHEMA_VERSION,
      event_name: 'injection.scan',
      trace_ref: input.traceRef,
      decision: action,
      reason:
        findings.length === 0
          ? 'No prompt-injection indicators detected.'
          : findings.map((finding) => finding.rule_id).join(',')
    }
  };
}

export function sanitizeToolOutput(input: {
  readonly traceRef: string;
  readonly text: string;
}): InjectionScanResult {
  return scanForInjection({
    traceRef: input.traceRef,
    sourceKind: 'tool_output',
    text: input.text
  });
}

export function createWriteIntent(input: {
  readonly id: string;
  readonly traceRef: string;
  readonly operation: string;
  readonly sourceRefs: readonly string[];
}): WriteIntent {
  return {
    id: input.id,
    trace_ref: input.traceRef,
    operation: input.operation,
    source_refs: input.sourceRefs,
    state: 'proposed',
    history: []
  };
}

export function transitionWriteIntent(input: {
  readonly intent: WriteIntent;
  readonly event: WriteIntentEvent;
  readonly traceRef: string;
  readonly reason: string;
}): { readonly intent: WriteIntent; readonly audit_event: SecurityAuditEvent } {
  const nextState = nextWriteIntentState(input.intent.state, input.event);
  const record: WriteIntentTransitionRecord = {
    event: input.event,
    from: input.intent.state,
    to: nextState,
    trace_ref: input.traceRef,
    reason: input.reason
  };
  const intent: WriteIntent = {
    ...input.intent,
    state: nextState,
    history: [...input.intent.history, record]
  };

  return {
    intent,
    audit_event: {
      schema_version: W16_SECURITY_SCHEMA_VERSION,
      event_name: 'write_intent.transition',
      trace_ref: input.traceRef,
      decision: nextState,
      reason: input.reason,
      source_refs: input.intent.source_refs
    }
  };
}

export function redactSensitiveAuditText(value: string): {
  readonly value: string;
  readonly redacted: boolean;
} {
  let redacted = false;
  let sanitized = value;
  for (const rule of REDACTION_RULES) {
    const next = sanitized.replace(rule.pattern, rule.replacement);
    if (next !== sanitized) {
      redacted = true;
      sanitized = next;
    }
  }
  return { value: sanitized, redacted };
}

export function redactAuditExport<T>(value: T): { readonly value: T; readonly redacted: boolean } {
  const redacted = redactUnknown(value);
  return {
    value: redacted.value as T,
    redacted: redacted.redacted
  };
}

function decideToolPolicy(
  input: ToolPolicyEvaluationInput,
  matrixEntry: ToolPolicyMatrixEntry | undefined
): ToolPolicyDecision {
  if (matrixEntry === undefined) {
    return 'deny';
  }
  if (matrixEntry.allowed && matrixEntry.minimumApproval === 'none') {
    return 'allow';
  }
  if (input.action === 'write' && input.approvedWriteIntentId !== undefined) {
    return 'allow';
  }
  if (matrixEntry.minimumApproval === 'human') {
    return input.action === 'exec' ? 'blocked' : 'pending_human';
  }
  return 'deny';
}

function highestInjectionSeverity(findings: readonly InjectionFinding[]): InjectionSeverity {
  if (findings.some((finding) => finding.severity === 'critical')) return 'critical';
  if (findings.some((finding) => finding.severity === 'high')) return 'high';
  if (findings.some((finding) => finding.severity === 'medium')) return 'medium';
  if (findings.some((finding) => finding.severity === 'low')) return 'low';
  return 'none';
}

function actionForSeverity(severity: InjectionSeverity): InjectionAction {
  switch (severity) {
    case 'none':
      return 'allow';
    case 'low':
    case 'medium':
      return 'sanitize';
    case 'high':
    case 'critical':
      return 'interrupt';
  }
}

function sanitizeInjectionText(text: string, findings: readonly InjectionFinding[]): string {
  if (findings.length === 0) {
    return redactSensitiveAuditText(text).value;
  }
  let sanitized = text;
  for (const rule of INJECTION_RULES) {
    sanitized = sanitized.replace(rule.pattern, `[blocked-injection:${rule.id}]`);
  }
  return redactSensitiveAuditText(sanitized).value;
}

function nextWriteIntentState(state: WriteIntentState, event: WriteIntentEvent): WriteIntentState {
  if (event === 'propose') {
    return state === 'proposed' ? 'proposed' : invalidTransition(state, event);
  }
  if (event === 'request_human') {
    return state === 'proposed' ? 'pending_human' : invalidTransition(state, event);
  }
  if (event === 'approve') {
    return state === 'pending_human' ? 'approved' : invalidTransition(state, event);
  }
  if (event === 'reject') {
    return state === 'pending_human' || state === 'proposed'
      ? 'rejected'
      : invalidTransition(state, event);
  }
  return invalidTransition(state, event);
}

function invalidTransition(state: WriteIntentState, event: WriteIntentEvent): never {
  throw new Error(`Invalid write intent transition ${state} -> ${event}`);
}

function redactUnknown(value: unknown): { readonly value: unknown; readonly redacted: boolean } {
  if (typeof value === 'string') {
    return redactSensitiveAuditText(value);
  }
  if (Array.isArray(value)) {
    let redacted = false;
    const mapped = value.map((item) => {
      const result = redactUnknown(item);
      redacted = redacted || result.redacted;
      return result.value;
    });
    return { value: mapped, redacted };
  }
  if (typeof value === 'object' && value !== null) {
    let redacted = false;
    const entries = Object.entries(value).map(([key, item]) => {
      const result = redactUnknown(item);
      redacted = redacted || result.redacted;
      return [key, result.value] as const;
    });
    return { value: Object.fromEntries(entries), redacted };
  }
  return { value, redacted: false };
}
