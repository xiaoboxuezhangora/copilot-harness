import type {
  ConfigSnapshot,
  JiraModelRouteConfig,
  ProviderConstraintConfig,
  RouteConfig,
  RouteTargetConfig
} from '../configCenter/index.js';
import type {
  ModelRef,
  RuntimeAuditAttributeValue,
  RuntimeModelRouteDecision
} from '../runtime/index.js';
import type { JiraEvidencePackV2 } from '../jira/evidence.js';

export interface JiraFeatureInput {
  readonly projectKey?: string;
  readonly issueType?: string;
  readonly labels?: readonly string[];
  readonly components?: readonly (string | { readonly name?: string })[];
  readonly priority?: string;
  readonly customFields?: Readonly<Record<string, unknown>>;
  readonly riskLevel?: string;
  readonly businessDomain?: string;
  readonly dataClassification?: string;
}

export interface JiraFeatures {
  readonly projectKey?: string;
  readonly issueType?: string;
  readonly labels: readonly string[];
  readonly components: readonly string[];
  readonly priority?: string;
  readonly customFields: Readonly<Record<string, string | readonly string[]>>;
  readonly riskLevel?: string;
  readonly businessDomain?: string;
  readonly dataClassification?: string;
}

export interface ModelRouterInput {
  readonly jira?: JiraFeatureInput;
  readonly jiraEvidencePack?: JiraEvidencePackV2;
  readonly profile?: string;
  readonly taskType?: string;
  readonly riskLevel?: string;
  readonly businessDomain?: string;
  readonly dataClassification?: string;
  readonly estimatedInputTokens?: number;
  readonly estimatedOutputTokens?: number;
}

export interface ModelRouteDecision extends RuntimeModelRouteDecision {
  readonly matchedRuleId: string;
  readonly routeReason: string;
  readonly fallbackChain: readonly ModelRef[];
  readonly estimatedCostCny: number;
  readonly auditAttrs: Readonly<Record<string, RuntimeAuditAttributeValue>>;
}

export interface ResolvedRouteCandidate {
  readonly source: NonNullable<ModelRouteDecision['routeSource']>;
  readonly ruleId: string;
  readonly reason: string;
  readonly route: RouteConfig;
  readonly rule?: JiraModelRouteConfig | ProviderConstraintConfig;
}

export interface ModelRouterOptions {
  readonly snapshot: ConfigSnapshot;
}

export class ModelRouteRejectedError extends Error {
  readonly providerId: string;
  readonly model: string;
  readonly ruleId: string;
  readonly reason: string;

  constructor(input: {
    readonly providerId: string;
    readonly model: string;
    readonly ruleId: string;
    readonly reason: string;
  }) {
    super(`Model route rejected for ${input.providerId}/${input.model}: ${input.reason}`);
    this.name = 'ModelRouteRejectedError';
    this.providerId = input.providerId;
    this.model = input.model;
    this.ruleId = input.ruleId;
    this.reason = input.reason;
  }
}

export type ConstraintMatch = {
  readonly constraint: ProviderConstraintConfig;
  readonly route?: RouteConfig;
};

export type RouteLike = RouteConfig | RouteTargetConfig;
