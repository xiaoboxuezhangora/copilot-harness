import type { JiraEvidencePackV2 } from '../jira/evidence.js';
import {
  buildRequirementProfileSpecV0,
  type IntegrationSpecV0,
  type RequirementProfileKind,
  type RequirementProfileSpecResultV0,
  type UnsupportedProfileSpecV0,
  type VisualDefectSpecV0,
  type WorkflowRequirementSpecV0
} from './profiles.js';
import type { IssueTypeRouterResult } from './router.js';

export type RequirementGateAxis =
  | 'Goal'
  | 'Evidence'
  | 'Scope'
  | 'Testability'
  | 'Profile'
  | 'Policy';

export type RequirementGateLight = 'green' | 'yellow' | 'red';

export interface RequirementGateRuntimeFlagsV0 {
  readonly attemptedJiraWrite?: boolean;
  readonly highRiskMedicalDomain?: boolean;
}

export interface BuildRequirementGateInputV0 {
  readonly evidencePack: JiraEvidencePackV2;
  readonly profileSpecResult?: RequirementProfileSpecResultV0;
  readonly routerResult?: IssueTypeRouterResult;
  readonly runtimeFlags?: RequirementGateRuntimeFlagsV0;
}

export interface RequirementGateAxisResultV0 {
  readonly axis: RequirementGateAxis;
  readonly light: RequirementGateLight;
  readonly reason: string;
  readonly sourceRefs: readonly string[];
}

export interface RequirementGateLayerResultV0 {
  readonly light: RequirementGateLight;
  readonly reason: string;
  readonly axisResults: readonly RequirementGateAxisResultV0[];
  readonly sourceRefs: readonly string[];
}

export interface RequirementGateGapV0 {
  readonly axis: RequirementGateAxis;
  readonly field: string;
  readonly severity: 'blocking' | 'warning';
  readonly reason: string;
  readonly clarificationQuestion: string;
  readonly turnGreenCondition: string;
  readonly sourceRefs: readonly string[];
}

export interface RequirementGateHardBlockV0 {
  readonly ruleId: string;
  readonly reason: string;
  readonly sourceRefs: readonly string[];
}

export interface RequirementGateRuleEvaluationV0 {
  readonly ruleId: string;
  readonly passed: boolean;
  readonly reason: string;
  readonly sourceRefs: readonly string[];
}

export interface RequirementGateAuditPayloadV0 {
  readonly schemaVersion: 'RequirementGateAuditPayloadV0';
  readonly profileSpecStatus: RequirementProfileSpecResultV0['status'];
  readonly usedFallbackProfileSpec: boolean;
  readonly runtimeFlags: RequirementGateRuntimeFlagsV0;
  readonly ruleEvaluations: readonly RequirementGateRuleEvaluationV0[];
  readonly sourceRefs: readonly string[];
}

export interface RequirementGateResultV0 {
  readonly schemaVersion: 'RequirementGateResultV0';
  readonly profile: RequirementProfileKind;
  readonly investigationReady: RequirementGateLayerResultV0;
  readonly implementationReady: RequirementGateLayerResultV0;
  readonly gaps: readonly RequirementGateGapV0[];
  readonly clarificationQuestions: readonly string[];
  readonly hardBlocks: readonly RequirementGateHardBlockV0[];
  readonly sourceRefs: readonly string[];
  readonly auditPayload: RequirementGateAuditPayloadV0;
}

interface EvaluatedAxis {
  readonly investigation: RequirementGateAxisResultV0;
  readonly implementation: RequirementGateAxisResultV0;
}

interface HardRuleEvaluationResult {
  readonly hardBlocks: readonly RequirementGateHardBlockV0[];
  readonly ruleEvaluations: readonly RequirementGateRuleEvaluationV0[];
}

interface ProfileSpecTraceabilityReport {
  readonly hasMismatch: boolean;
  readonly invalidSourceRefs: readonly string[];
  readonly validSourceRefs: readonly string[];
}

const RULE_ATTEMPTED_JIRA_WRITE = 'REQ-HARD-001-NO-JIRA-WRITE';
const RULE_VISUAL_MEDIA_ATTACHMENT_BACKING = 'REQ-HARD-002-VISUAL-MEDIA-ATTACHMENT-BACKING';
const RULE_HIGH_RISK_MEDICAL_MANUAL_REVIEW = 'REQ-HARD-003-HIGH-RISK-MEDICAL-MANUAL-REVIEW';
const RULE_PROFILE_SPEC_SOURCE_REF_MISMATCH = 'REQ-HARD-004-PROFILE-SPEC-SOURCE-REF-MISMATCH';

const SUPPORTED_PROFILES = new Set<RequirementProfileKind>(['Visual', 'Integration', 'Workflow']);

export function buildRequirementGateV0(input: BuildRequirementGateInputV0): RequirementGateResultV0 {
  const evidencePack = input.evidencePack;
  const validSourceRefs = new Set(evidencePack.sourceRefs);
  const runtimeFlags = input.runtimeFlags ?? {};

  const profileSpecResult =
    input.profileSpecResult ??
    buildRequirementProfileSpecV0({
      evidencePack,
      ...(input.routerResult !== undefined ? { routerResult: input.routerResult } : {})
    });

  const sourceRefPool = createSourceRefPool(validSourceRefs, evidencePack.issue.sourceRef);
  const profileSpecTraceability = validateProfileSpecTraceability(profileSpecResult, sourceRefPool);
  const hardRuleResult = evaluateHardRules({
    evidencePack,
    profileSpecResult,
    runtimeFlags,
    sourceRefPool,
    profileSpecTraceability
  });

  const goalAxis = evaluateGoalAxis(profileSpecResult, evidencePack, sourceRefPool);
  const evidenceAxis = evaluateEvidenceAxis(evidencePack, sourceRefPool);
  const scopeAxis = evaluateScopeAxis(
    profileSpecResult,
    evidencePack,
    sourceRefPool,
    profileSpecTraceability
  );
  const testabilityAxis = evaluateTestabilityAxis(
    profileSpecResult,
    sourceRefPool,
    profileSpecTraceability
  );
  const profileAxis = evaluateProfileAxis(profileSpecResult, sourceRefPool, profileSpecTraceability);
  const policyAxis = evaluatePolicyAxis(hardRuleResult.hardBlocks, runtimeFlags, sourceRefPool);

  const investigationAxisResults = [
    goalAxis.investigation,
    evidenceAxis.investigation,
    scopeAxis.investigation,
    testabilityAxis.investigation,
    profileAxis.investigation,
    policyAxis.investigation
  ] as const;

  const implementationAxisResults = [
    goalAxis.implementation,
    evidenceAxis.implementation,
    scopeAxis.implementation,
    testabilityAxis.implementation,
    profileAxis.implementation,
    policyAxis.implementation
  ] as const;

  const investigationReady = buildLayerResult('investigation', investigationAxisResults, sourceRefPool);
  const implementationReady = buildLayerResult(
    'implementation',
    implementationAxisResults,
    sourceRefPool
  );

  const gaps = buildRequirementGaps({
    profileSpecResult,
    evidencePack,
    runtimeFlags,
    hardBlocks: hardRuleResult.hardBlocks,
    investigationAxisResults,
    implementationAxisResults,
    sourceRefPool,
    profileSpecTraceability
  });

  const clarificationQuestions = dedupeStrings(
    gaps
      .map((gap) => gap.clarificationQuestion.trim())
      .filter((question) => question.length > 0)
  );

  const auditPayloadSourceRefs = sourceRefPool.strictPick(
    collectSourceRefs([
      ...hardRuleResult.ruleEvaluations.flatMap((rule) => rule.sourceRefs),
      ...investigationAxisResults.flatMap((axis) => axis.sourceRefs),
      ...implementationAxisResults.flatMap((axis) => axis.sourceRefs),
      ...gaps.flatMap((gap) => gap.sourceRefs),
      ...profileSpecResult.sourceRefs
    ])
  );

  const auditPayload: RequirementGateAuditPayloadV0 = {
    schemaVersion: 'RequirementGateAuditPayloadV0',
    profileSpecStatus: profileSpecResult.status,
    usedFallbackProfileSpec: input.profileSpecResult === undefined,
    runtimeFlags: {
      ...(runtimeFlags.attemptedJiraWrite === true ? { attemptedJiraWrite: true } : {}),
      ...(runtimeFlags.highRiskMedicalDomain === true ? { highRiskMedicalDomain: true } : {})
    },
    ruleEvaluations: hardRuleResult.ruleEvaluations,
    sourceRefs: auditPayloadSourceRefs
  };

  const resultSourceRefs = sourceRefPool.strictPick(
    collectSourceRefs([
      ...profileSpecResult.sourceRefs,
      ...investigationReady.sourceRefs,
      ...implementationReady.sourceRefs,
      ...gaps.flatMap((gap) => gap.sourceRefs),
      ...hardRuleResult.hardBlocks.flatMap((block) => block.sourceRefs),
      ...auditPayload.sourceRefs
    ])
  );

  return {
    schemaVersion: 'RequirementGateResultV0',
    profile: profileSpecResult.profile,
    investigationReady,
    implementationReady,
    gaps,
    clarificationQuestions,
    hardBlocks: hardRuleResult.hardBlocks,
    sourceRefs: resultSourceRefs,
    auditPayload
  };
}

function evaluateHardRules(input: {
  readonly evidencePack: JiraEvidencePackV2;
  readonly profileSpecResult: RequirementProfileSpecResultV0;
  readonly runtimeFlags: RequirementGateRuntimeFlagsV0;
  readonly sourceRefPool: SourceRefPool;
  readonly profileSpecTraceability: ProfileSpecTraceabilityReport;
}): HardRuleEvaluationResult {
  const ruleEvaluations: RequirementGateRuleEvaluationV0[] = [];
  const hardBlocks: RequirementGateHardBlockV0[] = [];

  if (input.runtimeFlags.attemptedJiraWrite === true) {
    const sourceRefs = input.sourceRefPool.pickWithFallback([input.evidencePack.issue.sourceRef]);
    ruleEvaluations.push({
      ruleId: RULE_ATTEMPTED_JIRA_WRITE,
      passed: false,
      reason: '检测到 attemptedJiraWrite=true，违反只读硬规则。',
      sourceRefs
    });
    hardBlocks.push({
      ruleId: RULE_ATTEMPTED_JIRA_WRITE,
      reason: '请求链路出现 Jira 写入尝试，ReqGate 直接阻断。',
      sourceRefs
    });
  } else {
    ruleEvaluations.push({
      ruleId: RULE_ATTEMPTED_JIRA_WRITE,
      passed: true,
      reason: '未检测到 Jira 写入尝试。',
      sourceRefs: []
    });
  }

  const visualMediaFailures = detectVisualMediaAttachmentBackedFailures(
    input.evidencePack,
    input.profileSpecResult,
    input.sourceRefPool
  );
  if (visualMediaFailures.length > 0) {
    const sourceRefs = input.sourceRefPool.pickWithFallback(
      visualMediaFailures.flatMap((failure) => failure.sourceRefs)
    );
    ruleEvaluations.push({
      ruleId: RULE_VISUAL_MEDIA_ATTACHMENT_BACKING,
      passed: false,
      reason: '存在 jira.media:* 证据无法映射回 jira.attachment:*。',
      sourceRefs
    });
    hardBlocks.push({
      ruleId: RULE_VISUAL_MEDIA_ATTACHMENT_BACKING,
      reason: '视觉证据存在未落地 attachment-backed 的 media 引用。',
      sourceRefs
    });
  } else {
    ruleEvaluations.push({
      ruleId: RULE_VISUAL_MEDIA_ATTACHMENT_BACKING,
      passed: true,
      reason: '视觉 media 证据均可映射到 Jira attachment。',
      sourceRefs: []
    });
  }

  if (input.runtimeFlags.highRiskMedicalDomain === true) {
    const sourceRefs = input.sourceRefPool.pickWithFallback([input.evidencePack.issue.sourceRef]);
    ruleEvaluations.push({
      ruleId: RULE_HIGH_RISK_MEDICAL_MANUAL_REVIEW,
      passed: false,
      reason: '检测到 highRiskMedicalDomain=true，必须人工复核。',
      sourceRefs
    });
    hardBlocks.push({
      ruleId: RULE_HIGH_RISK_MEDICAL_MANUAL_REVIEW,
      reason: '医疗高风险场景禁止 implementation_ready=green，需人工复核。',
      sourceRefs
    });
  } else {
    ruleEvaluations.push({
      ruleId: RULE_HIGH_RISK_MEDICAL_MANUAL_REVIEW,
      passed: true,
      reason: '未命中医疗高风险人工复核规则。',
      sourceRefs: []
    });
  }

  if (input.profileSpecTraceability.hasMismatch) {
    ruleEvaluations.push({
      ruleId: RULE_PROFILE_SPEC_SOURCE_REF_MISMATCH,
      passed: false,
      reason: '外部 profileSpecResult 存在不属于当前 evidencePack 的 sourceRef。',
      sourceRefs: input.sourceRefPool.pickWithFallback(input.profileSpecTraceability.validSourceRefs)
    });
  } else {
    ruleEvaluations.push({
      ruleId: RULE_PROFILE_SPEC_SOURCE_REF_MISMATCH,
      passed: true,
      reason: 'profileSpecResult sourceRef 与当前 evidencePack 一致。',
      sourceRefs: []
    });
  }

  return {
    hardBlocks: dedupeHardBlocks(hardBlocks),
    ruleEvaluations
  };
}

function detectVisualMediaAttachmentBackedFailures(
  evidencePack: JiraEvidencePackV2,
  profileSpecResult: RequirementProfileSpecResultV0,
  sourceRefPool: SourceRefPool
): readonly RequirementGateHardBlockV0[] {
  if (profileSpecResult.spec.kind !== 'VisualDefectSpecV0') {
    return [];
  }

  const attachmentById = new Map(evidencePack.attachments.map((attachment) => [attachment.id, attachment]));
  const failures: RequirementGateHardBlockV0[] = [];

  for (const evidence of profileSpecResult.spec.visualEvidence) {
    if (!evidence.sourceRef.startsWith('jira.media:')) {
      continue;
    }

    const matchedAttachment = attachmentById.get(evidence.attachmentId);
    const validAttachment =
      matchedAttachment !== undefined &&
      matchedAttachment.sourceRef.startsWith('jira.attachment:') &&
      sourceRefPool.has(matchedAttachment.sourceRef);

    if (!validAttachment) {
      failures.push({
        ruleId: RULE_VISUAL_MEDIA_ATTACHMENT_BACKING,
        reason: `media 证据 ${evidence.attachmentId} 缺少 attachment-backed 映射。`,
        sourceRefs: sourceRefPool.pickWithFallback([evidence.sourceRef, evidencePack.issue.sourceRef])
      });
    }
  }

  return failures;
}

function evaluateGoalAxis(
  profileSpecResult: RequirementProfileSpecResultV0,
  evidencePack: JiraEvidencePackV2,
  sourceRefPool: SourceRefPool
): EvaluatedAxis {
  const hasGoal =
    evidencePack.issue.summary.trim().length > 0 ||
    evidencePack.issue.description.trim().length > 0 ||
    collectGoalSourceRefs(profileSpecResult).length > 0;

  const sourceRefs = sourceRefPool.pickWithFallback([
    evidencePack.issue.sourceRef,
    ...collectGoalSourceRefs(profileSpecResult)
  ]);

  if (hasGoal) {
    return {
      investigation: {
        axis: 'Goal',
        light: 'green',
        reason: '已具备目标描述（issue 或 spec 字段可解释要解决的问题）。',
        sourceRefs
      },
      implementation: {
        axis: 'Goal',
        light: 'green',
        reason: '目标描述可用于实现阶段对齐。',
        sourceRefs
      }
    };
  }

  return {
    investigation: {
      axis: 'Goal',
      light: 'red',
      reason: '缺少明确目标描述，无法判断需求要解决的问题。',
      sourceRefs
    },
    implementation: {
      axis: 'Goal',
      light: 'red',
      reason: '目标描述缺失，无法进入实现。',
      sourceRefs
    }
  };
}

function evaluateEvidenceAxis(evidencePack: JiraEvidencePackV2, sourceRefPool: SourceRefPool): EvaluatedAxis {
  const traceableEvidenceRefSet = new Set<string>();

  addIfTraceable(traceableEvidenceRefSet, evidencePack.issue.sourceRef, sourceRefPool);
  for (const comment of evidencePack.comments) {
    addIfTraceable(traceableEvidenceRefSet, comment.sourceRef, sourceRefPool);
  }
  for (const field of evidencePack.fields) {
    addIfTraceable(traceableEvidenceRefSet, field.sourceRef, sourceRefPool);
  }
  for (const attachment of evidencePack.attachments) {
    addIfTraceable(traceableEvidenceRefSet, attachment.sourceRef, sourceRefPool);
  }

  const evidenceRefs = [...traceableEvidenceRefSet];
  if (evidenceRefs.length > 0) {
    return {
      investigation: {
        axis: 'Evidence',
        light: 'green',
        reason: '存在可追溯 Jira 证据链。',
        sourceRefs: evidenceRefs
      },
      implementation: {
        axis: 'Evidence',
        light: 'green',
        reason: '证据可追溯，可作为实现输入。',
        sourceRefs: evidenceRefs
      }
    };
  }

  return {
    investigation: {
      axis: 'Evidence',
      light: 'red',
      reason: '缺少可追溯 issue/comment/field/attachment 证据。',
      sourceRefs: []
    },
    implementation: {
      axis: 'Evidence',
      light: 'red',
      reason: '无可追溯证据，禁止实现。',
      sourceRefs: []
    }
  };
}

function evaluateScopeAxis(
  profileSpecResult: RequirementProfileSpecResultV0,
  evidencePack: JiraEvidencePackV2,
  sourceRefPool: SourceRefPool,
  profileSpecTraceability: ProfileSpecTraceabilityReport
): EvaluatedAxis {
  const scopeRefs = sourceRefPool.strictPick(collectScopeSourceRefs(profileSpecResult));
  if (scopeRefs.length > 0) {
    const sourceRefs = scopeRefs;
    return {
      investigation: {
        axis: 'Scope',
        light: 'green',
        reason: '需求范围已可定位到页面/系统/流程。',
        sourceRefs
      },
      implementation: {
        axis: 'Scope',
        light: 'green',
        reason: '实现范围定位充分。',
        sourceRefs
      }
    };
  }

  const hasIssueContext =
    evidencePack.issue.summary.trim().length > 0 || evidencePack.issue.description.trim().length > 0;
  const sourceRefs = sourceRefPool.pickWithFallback([
    evidencePack.issue.sourceRef,
    ...profileSpecTraceability.validSourceRefs
  ]);

  if (hasIssueContext) {
    return {
      investigation: {
        axis: 'Scope',
        light: 'yellow',
        reason: '存在需求描述，但尚未定位到明确页面/系统/流程范围。',
        sourceRefs
      },
      implementation: {
        axis: 'Scope',
        light: 'red',
        reason: '范围定位不足，暂不满足实现准入。',
        sourceRefs
      }
    };
  }

  return {
    investigation: {
      axis: 'Scope',
      light: 'red',
      reason: '缺少范围线索，无法定位影响面。',
      sourceRefs
    },
    implementation: {
      axis: 'Scope',
      light: 'red',
      reason: '范围缺失，禁止实现。',
      sourceRefs
    }
  };
}

function evaluateTestabilityAxis(
  profileSpecResult: RequirementProfileSpecResultV0,
  sourceRefPool: SourceRefPool,
  profileSpecTraceability: ProfileSpecTraceabilityReport
): EvaluatedAxis {
  const assertionRefs = sourceRefPool.strictPick(collectAssertionSourceRefs(profileSpecResult));
  if (assertionRefs.length > 0) {
    const sourceRefs = assertionRefs;
    return {
      investigation: {
        axis: 'Testability',
        light: 'green',
        reason: '存在可执行验收断言。',
        sourceRefs
      },
      implementation: {
        axis: 'Testability',
        light: 'green',
        reason: '实现验收断言充分。',
        sourceRefs
      }
    };
  }

  const fallbackSourceRefs = sourceRefPool.pickWithFallback(profileSpecTraceability.validSourceRefs);
  return {
    investigation: {
      axis: 'Testability',
      light: 'yellow',
      reason: '验收断言不足，调查可继续但需补充验证标准。',
      sourceRefs: fallbackSourceRefs
    },
    implementation: {
      axis: 'Testability',
      light: 'red',
      reason: '缺少可执行验收断言，implementation_ready 不可为 green。',
      sourceRefs: fallbackSourceRefs
    }
  };
}

function evaluateProfileAxis(
  profileSpecResult: RequirementProfileSpecResultV0,
  sourceRefPool: SourceRefPool,
  profileSpecTraceability: ProfileSpecTraceabilityReport
): EvaluatedAxis {
  if (profileSpecTraceability.hasMismatch) {
    const sourceRefs = sourceRefPool.pickWithFallback(profileSpecTraceability.validSourceRefs);
    return {
      investigation: {
        axis: 'Profile',
        light: 'red',
        reason: 'profileSpecResult 与当前 evidencePack 的 sourceRef 不一致。',
        sourceRefs
      },
      implementation: {
        axis: 'Profile',
        light: 'red',
        reason: 'profileSpecResult sourceRef 不一致，禁止放行实现。',
        sourceRefs
      }
    };
  }

  if (!SUPPORTED_PROFILES.has(profileSpecResult.profile)) {
    const sourceRefs = sourceRefPool.pickWithFallback(profileSpecResult.sourceRefs);
    return {
      investigation: {
        axis: 'Profile',
        light: 'yellow',
        reason: `${profileSpecResult.profile} Profile 在 W4 v0 为 unsupported/need_more_context。`,
        sourceRefs
      },
      implementation: {
        axis: 'Profile',
        light: 'red',
        reason: `${profileSpecResult.profile} Profile 当前不支持直接进入实现。`,
        sourceRefs
      }
    };
  }

  if (profileSpecResult.status === 'spec_ready') {
    const sourceRefs = sourceRefPool.pickWithFallback(profileSpecResult.sourceRefs);
    return {
      investigation: {
        axis: 'Profile',
        light: 'green',
        reason: `${profileSpecResult.profile} Profile Spec 已满足必填字段。`,
        sourceRefs
      },
      implementation: {
        axis: 'Profile',
        light: 'green',
        reason: `${profileSpecResult.profile} Profile Spec 可支持实现。`,
        sourceRefs
      }
    };
  }

  const sourceRefs = sourceRefPool.pickWithFallback(profileSpecResult.sourceRefs);
  return {
    investigation: {
      axis: 'Profile',
      light: 'yellow',
      reason: `${profileSpecResult.profile} Profile Spec 存在缺口，需补充。`,
      sourceRefs
    },
    implementation: {
      axis: 'Profile',
      light: 'red',
      reason: `${profileSpecResult.profile} Profile Spec 缺口阻断实现。`,
      sourceRefs
    }
  };
}

function evaluatePolicyAxis(
  hardBlocks: readonly RequirementGateHardBlockV0[],
  runtimeFlags: RequirementGateRuntimeFlagsV0,
  sourceRefPool: SourceRefPool
): EvaluatedAxis {
  if (hardBlocks.length === 0) {
    return {
      investigation: {
        axis: 'Policy',
        light: 'green',
        reason: '未命中硬规则阻断。',
        sourceRefs: []
      },
      implementation: {
        axis: 'Policy',
        light: 'green',
        reason: '未命中硬规则阻断。',
        sourceRefs: []
      }
    };
  }

  const sourceRefs = sourceRefPool.pickWithFallback(hardBlocks.flatMap((block) => block.sourceRefs));
  if (runtimeFlags.highRiskMedicalDomain === true && hardBlocks.length === 1) {
    return {
      investigation: {
        axis: 'Policy',
        light: 'yellow',
        reason: '医疗高风险场景需人工复核，调查可继续。',
        sourceRefs
      },
      implementation: {
        axis: 'Policy',
        light: 'red',
        reason: '医疗高风险场景需人工复核，禁止自动放行实现。',
        sourceRefs
      }
    };
  }

  return {
    investigation: {
      axis: 'Policy',
      light: 'red',
      reason: '命中硬规则阻断。',
      sourceRefs
    },
    implementation: {
      axis: 'Policy',
      light: 'red',
      reason: '命中硬规则阻断。',
      sourceRefs
    }
  };
}

function buildLayerResult(
  layer: 'investigation' | 'implementation',
  axisResults: readonly RequirementGateAxisResultV0[],
  sourceRefPool: SourceRefPool
): RequirementGateLayerResultV0 {
  const light = aggregateLight(axisResults);
  const redAxes = axisResults.filter((axis) => axis.light === 'red').map((axis) => axis.axis);
  const yellowAxes = axisResults.filter((axis) => axis.light === 'yellow').map((axis) => axis.axis);
  const reason =
    light === 'green'
      ? `${layer} 所有轴均为 green。`
      : light === 'yellow'
        ? `${layer} 存在 yellow 轴：${yellowAxes.join(', ')}。`
        : `${layer} 存在 red 轴：${redAxes.join(', ')}。`;

  return {
    light,
    reason,
    axisResults,
    sourceRefs: sourceRefPool.strictPick(axisResults.flatMap((axis) => axis.sourceRefs))
  };
}

function buildRequirementGaps(input: {
  readonly profileSpecResult: RequirementProfileSpecResultV0;
  readonly evidencePack: JiraEvidencePackV2;
  readonly runtimeFlags: RequirementGateRuntimeFlagsV0;
  readonly hardBlocks: readonly RequirementGateHardBlockV0[];
  readonly investigationAxisResults: readonly RequirementGateAxisResultV0[];
  readonly implementationAxisResults: readonly RequirementGateAxisResultV0[];
  readonly sourceRefPool: SourceRefPool;
  readonly profileSpecTraceability: ProfileSpecTraceabilityReport;
}): readonly RequirementGateGapV0[] {
  const gaps: RequirementGateGapV0[] = [];

  const issueSourceRefs = input.sourceRefPool.pickWithFallback([input.evidencePack.issue.sourceRef]);

  const goalAxis = findAxisResult(input.implementationAxisResults, 'Goal');
  if (goalAxis.light === 'red') {
    gaps.push({
      axis: 'Goal',
      field: 'issue.summary_or_description',
      severity: 'blocking',
      reason: '缺少明确目标描述。',
      clarificationQuestion: '该需求要解决的核心问题是什么？请用一句话说明。',
      turnGreenCondition: '补充可追溯的问题目标描述（issue summary/description 或等价规格字段）。',
      sourceRefs: issueSourceRefs
    });
  }

  const evidenceAxis = findAxisResult(input.implementationAxisResults, 'Evidence');
  if (evidenceAxis.light === 'red') {
    gaps.push({
      axis: 'Evidence',
      field: 'traceableEvidence',
      severity: 'blocking',
      reason: '缺少可追溯的 Jira 证据。',
      clarificationQuestion: '请补充至少一条带 sourceRef 的 issue/comment/field/attachment 证据。',
      turnGreenCondition: '新增并保留可追溯 sourceRef 的 Jira 证据条目。',
      sourceRefs: issueSourceRefs
    });
  }

  const scopeInvestigationAxis = findAxisResult(input.investigationAxisResults, 'Scope');
  const scopeImplementationAxis = findAxisResult(input.implementationAxisResults, 'Scope');
  if (scopeInvestigationAxis.light === 'yellow' || scopeImplementationAxis.light === 'red') {
    gaps.push({
      axis: 'Scope',
      field: 'impactScope',
      severity: scopeImplementationAxis.light === 'red' ? 'blocking' : 'warning',
      reason:
        scopeImplementationAxis.light === 'red'
          ? '范围定位不足，无法稳定进入实现。'
          : '范围定位不充分，建议补充后再实现。',
      clarificationQuestion: '请明确影响范围（页面/系统/流程/模块）及边界。',
      turnGreenCondition: '补充可追溯范围信息并定位到具体页面、系统或流程节点。',
      sourceRefs: issueSourceRefs
    });
  }

  const testabilityInvestigationAxis = findAxisResult(input.investigationAxisResults, 'Testability');
  const testabilityImplementationAxis = findAxisResult(input.implementationAxisResults, 'Testability');
  if (
    testabilityInvestigationAxis.light === 'yellow' ||
    testabilityImplementationAxis.light === 'red'
  ) {
    gaps.push({
      axis: 'Testability',
      field: 'acceptanceAssertions',
      severity: 'blocking',
      reason: '缺少可执行验收断言。',
      clarificationQuestion: '请补充可验证通过/失败的验收断言。',
      turnGreenCondition: '至少补充一条带 sourceRef 的验收断言。',
      sourceRefs: input.sourceRefPool.pickWithFallback(input.profileSpecTraceability.validSourceRefs)
    });
  }

  if (input.profileSpecResult.profile === 'Integration') {
    appendIntegrationRiskWarnings(gaps, input.profileSpecResult, input.sourceRefPool);
  }

  if (input.profileSpecResult.profile === 'Workflow') {
    appendWorkflowRiskWarnings(gaps, input.profileSpecResult, input.sourceRefPool);
  }

  if (input.profileSpecTraceability.hasMismatch) {
    gaps.push({
      axis: 'Profile',
      field: 'profileSpecSourceRefs',
      severity: 'blocking',
      reason: 'profileSpecResult 含有不属于当前 evidencePack 的 sourceRef。',
      clarificationQuestion: '请重新构建与当前 JiraEvidencePackV2 一致的 profileSpecResult。',
      turnGreenCondition: 'profileSpecResult 全量 sourceRef 与当前 evidencePack.sourceRefs 完全匹配。',
      sourceRefs: issueSourceRefs
    });
  }

  for (const specGap of input.profileSpecResult.gaps) {
    gaps.push({
      axis: 'Profile',
      field: specGap.field,
      severity: 'blocking',
      reason: specGap.reason,
      clarificationQuestion: specGap.clarificationQuestion,
      turnGreenCondition: `补齐 ${specGap.field} 的可追溯证据。`,
      sourceRefs: input.sourceRefPool.strictPick(specGap.sourceRefs)
    });
  }

  if (!SUPPORTED_PROFILES.has(input.profileSpecResult.profile)) {
    const unsupportedSpec = input.profileSpecResult.spec;
    const unsupportedMessage =
      unsupportedSpec.kind === 'UnsupportedProfileSpecV0' ? unsupportedSpec.message : '当前 profile 暂不支持';

    gaps.push({
      axis: 'Profile',
      field: 'profileSupport',
      severity: 'blocking',
      reason: unsupportedMessage,
      clarificationQuestion: '请确认是否切换到 Visual/Integration/Workflow，或等待后续里程碑支持。',
      turnGreenCondition: '需求可映射到已支持 Profile，且 Profile Spec 补齐必填字段。',
      sourceRefs: input.sourceRefPool.pickWithFallback(input.profileSpecTraceability.validSourceRefs)
    });
  }

  if (input.runtimeFlags.highRiskMedicalDomain === true) {
    gaps.push({
      axis: 'Policy',
      field: 'highRiskMedicalDomain',
      severity: 'blocking',
      reason: '医疗高风险场景必须人工复核。',
      clarificationQuestion: '请指定人工复核责任人和复核结论记录位置。',
      turnGreenCondition: '完成人工复核并记录结论后，方可评估实现准入。',
      sourceRefs: issueSourceRefs
    });
  }

  if (input.runtimeFlags.attemptedJiraWrite === true) {
    gaps.push({
      axis: 'Policy',
      field: 'attemptedJiraWrite',
      severity: 'blocking',
      reason: '检测到 Jira 写入尝试。',
      clarificationQuestion: '请移除写入动作，仅保留 read-only 证据采集链路。',
      turnGreenCondition: '运行时标记 attemptedJiraWrite=false，且审计链确认无写入调用。',
      sourceRefs: issueSourceRefs
    });
  }

  for (const block of input.hardBlocks) {
    if (block.ruleId === RULE_VISUAL_MEDIA_ATTACHMENT_BACKING) {
      gaps.push({
        axis: 'Policy',
        field: 'visualEvidence.attachmentBacked',
        severity: 'blocking',
        reason: '视觉 media 证据缺少 attachment-backed 映射。',
        clarificationQuestion: '请补齐对应 attachment 元数据或改用可追溯附件证据。',
        turnGreenCondition: '所有 jira.media:* 均可通过 attachmentId 映射到 jira.attachment:*。',
        sourceRefs: block.sourceRefs
      });
    }
  }

  return dedupeGaps(gaps, input.sourceRefPool);
}

function appendIntegrationRiskWarnings(
  gaps: RequirementGateGapV0[],
  profileSpecResult: RequirementProfileSpecResultV0,
  sourceRefPool: SourceRefPool
): void {
  if (profileSpecResult.spec.kind !== 'IntegrationSpecV0') {
    return;
  }

  addOptionalProfileGap(gaps, {
    axis: 'Profile',
    field: 'authBoundary',
    values: profileSpecResult.spec.authBoundary,
    reason: 'authBoundary 缺失，集成风险评估不完整。',
    question: '请补充鉴权边界（token/signature/oauth 等）。',
    condition: '补充鉴权边界证据后可消除该风险 warning。',
    sourceRefPool,
    fallbackSourceRefs: profileSpecResult.sourceRefs
  });

  addOptionalProfileGap(gaps, {
    axis: 'Profile',
    field: 'failureHandling',
    values: profileSpecResult.spec.failureHandling,
    reason: 'failureHandling 缺失，失败回退路径不明确。',
    question: '请补充超时/重试/回滚等失败处理策略。',
    condition: '补充失败处理证据后可消除该风险 warning。',
    sourceRefPool,
    fallbackSourceRefs: profileSpecResult.sourceRefs
  });

  addOptionalProfileGap(gaps, {
    axis: 'Profile',
    field: 'testFixtures',
    values: profileSpecResult.spec.testFixtures,
    reason: 'testFixtures 缺失，集成回归样例不足。',
    question: '请补充可复用的测试样例或 payload fixture。',
    condition: '补充 fixture 证据后可消除该风险 warning。',
    sourceRefPool,
    fallbackSourceRefs: profileSpecResult.sourceRefs
  });
}

function appendWorkflowRiskWarnings(
  gaps: RequirementGateGapV0[],
  profileSpecResult: RequirementProfileSpecResultV0,
  sourceRefPool: SourceRefPool
): void {
  if (profileSpecResult.spec.kind !== 'WorkflowRequirementSpecV0') {
    return;
  }

  addOptionalProfileGap(gaps, {
    axis: 'Profile',
    field: 'businessRules',
    values: profileSpecResult.spec.businessRules,
    reason: 'businessRules 缺失，规则边界不明确。',
    question: '请补充流程业务规则与约束条件。',
    condition: '补充业务规则证据后可消除该风险 warning。',
    sourceRefPool,
    fallbackSourceRefs: profileSpecResult.sourceRefs
  });

  addOptionalProfileGap(gaps, {
    axis: 'Profile',
    field: 'exceptionPaths',
    values: profileSpecResult.spec.exceptionPaths,
    reason: 'exceptionPaths 缺失，异常路径不可验证。',
    question: '请补充驳回/失败/回退等异常处理路径。',
    condition: '补充异常路径证据后可消除该风险 warning。',
    sourceRefPool,
    fallbackSourceRefs: profileSpecResult.sourceRefs
  });

  addOptionalProfileGap(gaps, {
    axis: 'Profile',
    field: 'auditTrail',
    values: profileSpecResult.spec.auditTrail,
    reason: 'auditTrail 缺失，留痕要求不完整。',
    question: '请补充流程留痕/审计日志要求。',
    condition: '补充留痕证据后可消除该风险 warning。',
    sourceRefPool,
    fallbackSourceRefs: profileSpecResult.sourceRefs
  });
}

function addOptionalProfileGap(
  gaps: RequirementGateGapV0[],
  input: {
    readonly axis: RequirementGateAxis;
    readonly field: string;
    readonly values: readonly {
      readonly sourceRef: string;
    }[];
    readonly reason: string;
    readonly question: string;
    readonly condition: string;
    readonly sourceRefPool: SourceRefPool;
    readonly fallbackSourceRefs: readonly string[];
  }
): void {
  if (input.values.length > 0) {
    return;
  }

  const sourceRefs = input.sourceRefPool.pickWithFallback(input.fallbackSourceRefs);
  gaps.push({
    axis: input.axis,
    field: input.field,
    severity: 'warning',
    reason: input.reason,
    clarificationQuestion: input.question,
    turnGreenCondition: input.condition,
    sourceRefs
  });
}

function collectGoalSourceRefs(profileSpecResult: RequirementProfileSpecResultV0): readonly string[] {
  if (profileSpecResult.spec.kind === 'UnsupportedProfileSpecV0') {
    return profileSpecResult.spec.sourceRefs;
  }

  if (profileSpecResult.spec.kind === 'VisualDefectSpecV0') {
    return [
      ...profileSpecResult.spec.actualBehavior.map((item) => item.sourceRef),
      ...profileSpecResult.spec.expectedBehavior.map((item) => item.sourceRef)
    ];
  }

  if (profileSpecResult.spec.kind === 'IntegrationSpecV0') {
    return [
      ...profileSpecResult.spec.upstreamSystem.map((item) => item.sourceRef),
      ...profileSpecResult.spec.downstreamSystem.map((item) => item.sourceRef),
      ...profileSpecResult.spec.apiContract.map((item) => item.sourceRef)
    ];
  }

  return [
    ...profileSpecResult.spec.roles.map((item) => item.sourceRef),
    ...profileSpecResult.spec.triggerConditions.map((item) => item.sourceRef),
    ...profileSpecResult.spec.processSteps.map((item) => item.sourceRef)
  ];
}

function collectScopeSourceRefs(profileSpecResult: RequirementProfileSpecResultV0): readonly string[] {
  const spec = profileSpecResult.spec;

  if (spec.kind === 'VisualDefectSpecV0') {
    return spec.pageOrComponent.map((item) => item.sourceRef);
  }

  if (spec.kind === 'IntegrationSpecV0') {
    return [
      ...spec.upstreamSystem.map((item) => item.sourceRef),
      ...spec.downstreamSystem.map((item) => item.sourceRef)
    ];
  }

  if (spec.kind === 'WorkflowRequirementSpecV0') {
    return [
      ...spec.roles.map((item) => item.sourceRef),
      ...spec.triggerConditions.map((item) => item.sourceRef),
      ...spec.processSteps.map((item) => item.sourceRef)
    ];
  }

  return spec.sourceRefs;
}

function collectAssertionSourceRefs(profileSpecResult: RequirementProfileSpecResultV0): readonly string[] {
  const spec = profileSpecResult.spec;

  if (spec.kind === 'UnsupportedProfileSpecV0') {
    return [];
  }

  return spec.acceptanceAssertions.map((item) => item.sourceRef);
}

function validateProfileSpecTraceability(
  profileSpecResult: RequirementProfileSpecResultV0,
  sourceRefPool: SourceRefPool
): ProfileSpecTraceabilityReport {
  const allProfileSpecRefs = dedupeStrings(collectAllProfileSpecSourceRefs(profileSpecResult));
  const validSourceRefs = sourceRefPool.strictPick(allProfileSpecRefs);
  const validRefSet = new Set(validSourceRefs);
  const invalidSourceRefs = allProfileSpecRefs.filter((sourceRef) => !validRefSet.has(sourceRef));

  return {
    hasMismatch: invalidSourceRefs.length > 0,
    invalidSourceRefs,
    validSourceRefs
  };
}

function collectAllProfileSpecSourceRefs(
  profileSpecResult: RequirementProfileSpecResultV0
): readonly string[] {
  const refs: string[] = [];
  refs.push(...profileSpecResult.sourceRefs);
  refs.push(...profileSpecResult.gaps.flatMap((gap) => gap.sourceRefs));

  const spec = profileSpecResult.spec;
  if (spec.kind === 'VisualDefectSpecV0') {
    refs.push(
      ...spec.pageOrComponent.map((item) => item.sourceRef),
      ...spec.actualBehavior.map((item) => item.sourceRef),
      ...spec.expectedBehavior.map((item) => item.sourceRef),
      ...spec.visualEvidence.map((item) => item.sourceRef),
      ...spec.baselineEvidence.map((item) => item.sourceRef),
      ...spec.viewport.map((item) => item.sourceRef),
      ...spec.acceptanceAssertions.map((item) => item.sourceRef)
    );
  } else if (spec.kind === 'IntegrationSpecV0') {
    refs.push(
      ...spec.upstreamSystem.map((item) => item.sourceRef),
      ...spec.downstreamSystem.map((item) => item.sourceRef),
      ...spec.apiContract.map((item) => item.sourceRef),
      ...spec.fieldMapping.map((item) => item.sourceRef),
      ...spec.authBoundary.map((item) => item.sourceRef),
      ...spec.failureHandling.map((item) => item.sourceRef),
      ...spec.testFixtures.map((item) => item.sourceRef),
      ...spec.acceptanceAssertions.map((item) => item.sourceRef)
    );
  } else if (spec.kind === 'WorkflowRequirementSpecV0') {
    refs.push(
      ...spec.roles.map((item) => item.sourceRef),
      ...spec.triggerConditions.map((item) => item.sourceRef),
      ...spec.processSteps.map((item) => item.sourceRef),
      ...spec.businessRules.map((item) => item.sourceRef),
      ...spec.exceptionPaths.map((item) => item.sourceRef),
      ...spec.auditTrail.map((item) => item.sourceRef),
      ...spec.acceptanceAssertions.map((item) => item.sourceRef)
    );
  } else {
    refs.push(...spec.sourceRefs);
  }

  return refs;
}

function findAxisResult(
  axisResults: readonly RequirementGateAxisResultV0[],
  axis: RequirementGateAxis
): RequirementGateAxisResultV0 {
  const result = axisResults.find((item) => item.axis === axis);
  if (result === undefined) {
    throw new Error(`Missing axis result: ${axis}`);
  }

  return result;
}

function aggregateLight(axisResults: readonly RequirementGateAxisResultV0[]): RequirementGateLight {
  if (axisResults.some((axis) => axis.light === 'red')) {
    return 'red';
  }

  if (axisResults.some((axis) => axis.light === 'yellow')) {
    return 'yellow';
  }

  return 'green';
}

function collectSourceRefs(values: readonly string[]): readonly string[] {
  return values.filter((value) => value.trim().length > 0);
}

function dedupeHardBlocks(
  hardBlocks: readonly RequirementGateHardBlockV0[]
): readonly RequirementGateHardBlockV0[] {
  const byRuleId = new Map<string, RequirementGateHardBlockV0>();

  for (const block of hardBlocks) {
    const existing = byRuleId.get(block.ruleId);
    if (existing === undefined) {
      byRuleId.set(block.ruleId, {
        ...block,
        sourceRefs: dedupeStrings(block.sourceRefs)
      });
      continue;
    }

    byRuleId.set(block.ruleId, {
      ruleId: block.ruleId,
      reason: existing.reason,
      sourceRefs: dedupeStrings([...existing.sourceRefs, ...block.sourceRefs])
    });
  }

  return [...byRuleId.values()];
}

function dedupeGaps(
  gaps: readonly RequirementGateGapV0[],
  sourceRefPool: SourceRefPool
): readonly RequirementGateGapV0[] {
  const byKey = new Map<string, RequirementGateGapV0>();

  for (const gap of gaps) {
    const key = `${gap.axis}|${gap.field}|${gap.reason}`;
    const sanitized: RequirementGateGapV0 = {
      ...gap,
      sourceRefs: sourceRefPool.strictPick(gap.sourceRefs)
    };

    const existing = byKey.get(key);
    if (existing === undefined) {
      byKey.set(key, sanitized);
      continue;
    }

    byKey.set(key, {
      ...existing,
      severity: existing.severity === 'blocking' || sanitized.severity === 'blocking' ? 'blocking' : 'warning',
      sourceRefs: sourceRefPool.strictPick([...existing.sourceRefs, ...sanitized.sourceRefs])
    });
  }

  return [...byKey.values()];
}

function addIfTraceable(set: Set<string>, sourceRef: string, sourceRefPool: SourceRefPool): void {
  if (sourceRefPool.has(sourceRef)) {
    set.add(sourceRef);
  }
}

interface SourceRefPool {
  has(_sourceRef: string): boolean;
  strictPick(_sourceRefs: readonly string[]): readonly string[];
  pickWithFallback(_sourceRefs: readonly string[]): readonly string[];
}

function createSourceRefPool(
  validSourceRefs: ReadonlySet<string>,
  fallbackSourceRef: string
): SourceRefPool {
  return {
    has(sourceRef: string): boolean {
      return validSourceRefs.has(sourceRef);
    },
    strictPick(sourceRefs: readonly string[]): readonly string[] {
      const sanitized = dedupeStrings(sourceRefs).filter((sourceRef) => validSourceRefs.has(sourceRef));
      return sanitized;
    },
    pickWithFallback(sourceRefs: readonly string[]): readonly string[] {
      const sanitized = dedupeStrings(sourceRefs).filter((sourceRef) => validSourceRefs.has(sourceRef));
      if (sanitized.length > 0) {
        return sanitized;
      }

      if (validSourceRefs.has(fallbackSourceRef)) {
        return [fallbackSourceRef];
      }

      return [];
    }
  };
}

function dedupeStrings(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const result: string[] = [];

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

export type {
  IntegrationSpecV0,
  UnsupportedProfileSpecV0,
  VisualDefectSpecV0,
  WorkflowRequirementSpecV0
};
