import type {
  ConfigSnapshot,
  JiraModelRouteConfig,
  JiraRouteMatchConfig,
  ProfileRouteConfig,
  ProviderConfig,
  ProviderConstraintConfig,
  RouteConfig,
  RoutePrecedenceItem,
  RouteTargetConfig,
  TaskRouteConfig
} from '../configCenter/index.js';
import type { ModelRef, RuntimeAuditAttributeValue } from '../runtime/index.js';
import { DEFAULT_MODEL, DEFAULT_MODEL_REF } from '../runtime/index.js';
import { JiraFeatureExtractor } from './jiraFeatureExtractor.js';
import type {
  ConstraintMatch,
  JiraFeatures,
  ModelRouteDecision,
  ModelRouterInput,
  ModelRouterOptions,
  ResolvedRouteCandidate,
  RouteLike
} from './types.js';
import { ModelRouteRejectedError } from './types.js';

export class ModelRouter {
  private readonly snapshot: ConfigSnapshot;
  private readonly extractor = new JiraFeatureExtractor();

  constructor(options: ModelRouterOptions) {
    this.snapshot = options.snapshot;
  }

  route(input: ModelRouterInput): ModelRouteDecision {
    const features = this.resolveFeatures(input);
    const constraints = this.matchProviderConstraints(features, input);
    for (const precedence of effectiveRoutePrecedence(this.snapshot.routing.routePrecedence)) {
      const candidate = this.matchByPrecedence(precedence, features, input, constraints);
      if (candidate !== undefined) {
        return this.buildDecision(candidate, features, input, constraints);
      }
    }

    return this.buildDecision(this.defaultRoute(), features, input, constraints);
  }

  private resolveFeatures(input: ModelRouterInput): JiraFeatures {
    const extracted =
      input.jiraEvidencePack !== undefined
        ? this.extractor.fromJiraEvidencePackV2(input.jiraEvidencePack)
        : this.extractor.extract(input.jira ?? {});
    return {
      ...extracted,
      ...(input.riskLevel !== undefined ? { riskLevel: input.riskLevel } : {}),
      ...(input.businessDomain !== undefined ? { businessDomain: input.businessDomain } : {}),
      ...(input.dataClassification !== undefined
        ? { dataClassification: input.dataClassification }
        : {})
    };
  }

  private matchProviderConstraints(
    features: JiraFeatures,
    input: ModelRouterInput
  ): readonly ConstraintMatch[] {
    const dataClassification = input.dataClassification ?? features.dataClassification;
    if (dataClassification === undefined) return [];
    return this.snapshot.routing.providerConstraints
      .filter(
        (constraint) =>
          constraint.dataClassification !== undefined &&
          equalsNormalized(constraint.dataClassification, dataClassification)
      )
      .map((constraint) => ({
        constraint,
        ...(constraint.route !== undefined ? { route: constraint.route } : {})
      }));
  }

  private matchJiraRoute(features: JiraFeatures): ResolvedRouteCandidate | undefined {
    for (const route of this.snapshot.routing.jiraModelRoutes) {
      if (matchesJiraRoute(route.match, features)) {
        return {
          source: 'jira_model_routes',
          ruleId: route.id,
          reason: route.route.reason ?? route.reason,
          route: route.route,
          rule: route
        };
      }
    }
    return undefined;
  }

  private matchByPrecedence(
    precedence: RoutePrecedenceItem,
    features: JiraFeatures,
    input: ModelRouterInput,
    constraints: readonly ConstraintMatch[]
  ): ResolvedRouteCandidate | undefined {
    if (precedence === 'provider_constraints' || precedence === 'data_classification') {
      return this.matchConstraintRoute(constraints);
    }
    if (precedence === 'jira_model_routes') {
      return this.matchJiraRoute(features);
    }
    if (precedence === 'profile_routes') {
      return this.matchProfileRoute(input, features);
    }
    if (precedence === 'task_routes') {
      return this.matchTaskRoute(input);
    }
    return this.defaultRoute();
  }

  private matchConstraintRoute(
    constraints: readonly ConstraintMatch[]
  ): ResolvedRouteCandidate | undefined {
    const constraintRoute = constraints.find((constraint) => constraint.route !== undefined);
    if (constraintRoute?.route === undefined) return undefined;
    return {
      source: 'provider_constraints',
      ruleId: constraintRoute.constraint.id,
      reason:
        constraintRoute.route.reason ?? `provider constraint ${constraintRoute.constraint.id}`,
      route: constraintRoute.route,
      rule: constraintRoute.constraint
    };
  }

  private matchProfileRoute(
    input: ModelRouterInput,
    features: JiraFeatures
  ): ResolvedRouteCandidate | undefined {
    for (const route of this.snapshot.routing.profileRoutes) {
      if (matchesProfileRoute(route, input.profile, input.businessDomain ?? features.businessDomain)) {
        return {
          source: 'profile_routes',
          ruleId: route.id,
          reason: route.route.reason ?? route.reason,
          route: route.route
        };
      }
    }
    return undefined;
  }

  private matchTaskRoute(input: ModelRouterInput): ResolvedRouteCandidate | undefined {
    for (const route of this.snapshot.routing.taskRoutes) {
      if (input.taskType !== undefined && containsNormalized(route.taskTypes, input.taskType)) {
        return {
          source: 'task_routes',
          ruleId: route.id,
          reason: route.route.reason ?? route.reason,
          route: route.route
        };
      }
    }
    return undefined;
  }

  private defaultRoute(): ResolvedRouteCandidate {
    const route = this.snapshot.routing.defaults.defaultRoute;
    return {
      source: 'default_route',
      ruleId: 'defaults.default_route',
      reason: route.reason ?? 'DEFAULT_MODEL fallback',
      route
    };
  }

  private buildDecision(
    candidate: ResolvedRouteCandidate,
    features: JiraFeatures,
    input: ModelRouterInput,
    constraints: readonly ConstraintMatch[]
  ): ModelRouteDecision {
    this.assertRouteAllowed(candidate.route, candidate.ruleId, constraints);
    const provider = this.requireEnabledProvider(candidate.route.providerId, candidate.route.model, candidate.ruleId);
    const fallbackChain = candidate.route.fallbackChain.map((target) => {
      this.assertTargetAllowed(target, candidate.ruleId, constraints);
      return this.toModelRef(target);
    });
    const estimatedCostCny = estimateCostCny(provider, {
      inputTokens: input.estimatedInputTokens ?? 1000,
      outputTokens: input.estimatedOutputTokens ?? 1000
    });
    const routeReason = candidate.reason;
    const decision: ModelRouteDecision = {
      providerId: candidate.route.providerId,
      model: candidate.route.model,
      runtime: candidate.route.runtime ?? provider.runtime,
      matchedRuleId: candidate.ruleId,
      routeReason,
      routeSource: candidate.source,
      fallbackChain,
      estimatedCostCny,
      snapshotVersion: this.snapshot.version,
      auditAttrs: buildAuditAttrs({
        candidate,
        features,
        input,
        provider,
        fallbackChain,
        estimatedCostCny,
        constraints,
        routeReason,
        snapshotVersion: this.snapshot.version
      })
    };
    return decision;
  }

  private assertRouteAllowed(
    route: RouteConfig,
    ruleId: string,
    constraints: readonly ConstraintMatch[]
  ): void {
    this.assertTargetAllowed(route, ruleId, constraints);
    route.fallbackChain.forEach((target) => this.assertTargetAllowed(target, ruleId, constraints));
  }

  private assertTargetAllowed(
    target: RouteLike,
    ruleId: string,
    constraints: readonly ConstraintMatch[]
  ): void {
    this.requireEnabledProvider(target.providerId, target.model, ruleId);
    for (const item of constraints) {
      const constraint = item.constraint;
      if (
        constraint.mustUseProviders.length > 0 &&
        !constraint.mustUseProviders.includes(target.providerId)
      ) {
        throw new ModelRouteRejectedError({
          providerId: target.providerId,
          model: target.model,
          ruleId,
          reason: `provider_constraints ${constraint.id} requires ${constraint.mustUseProviders.join(',')}`
        });
      }
      if (constraint.deniedProviders.includes(target.providerId)) {
        throw new ModelRouteRejectedError({
          providerId: target.providerId,
          model: target.model,
          ruleId,
          reason: `provider_constraints ${constraint.id} denies provider ${target.providerId}`
        });
      }
    }
  }

  private requireEnabledProvider(providerId: string, model: string, ruleId: string): ProviderConfig {
    const provider = this.snapshot.providers.providers.find((item) => item.id === providerId);
    if (provider === undefined) {
      throw new ModelRouteRejectedError({
        providerId,
        model,
        ruleId,
        reason: 'provider is not registered'
      });
    }
    if (!provider.enabled) {
      throw new ModelRouteRejectedError({
        providerId,
        model,
        ruleId,
        reason: 'provider is disabled'
      });
    }
    if (!provider.models.includes(model)) {
      throw new ModelRouteRejectedError({
        providerId,
        model,
        ruleId,
        reason: 'model is not registered for provider'
      });
    }
    return provider;
  }

  private toModelRef(target: RouteTargetConfig): ModelRef {
    const provider = this.requireEnabledProvider(
      target.providerId,
      target.model,
      'fallback_chain'
    );
    return {
      providerId: target.providerId,
      model: target.model,
      runtime: target.runtime ?? provider.runtime
    };
  }
}

function matchesJiraRoute(match: JiraRouteMatchConfig, features: JiraFeatures): boolean {
  if (!matchesOptional(match.projectKeys, features.projectKey)) return false;
  if (!matchesOptional(match.issueTypes, features.issueType)) return false;
  if (!matchesOptional(match.priorities, features.priority)) return false;
  if (!matchesOptional(match.riskLevels, features.riskLevel)) return false;
  if (!matchesOptional(match.businessDomains, features.businessDomain)) return false;
  if (!matchesOptional(match.dataClassifications, features.dataClassification)) return false;
  if (!intersectsOptional(match.labelsAny, features.labels)) return false;
  if (!containsAll(match.labelsAll, features.labels)) return false;
  if (!intersectsOptional(match.componentsAny, features.components)) return false;
  return matchesCustomFields(match.customFields, features.customFields);
}

function matchesProfileRoute(
  route: ProfileRouteConfig,
  profile: string | undefined,
  businessDomain: string | undefined
): boolean {
  const profileMatches =
    route.profiles.length === 0 || (profile !== undefined && containsNormalized(route.profiles, profile));
  const domainMatches =
    route.businessDomains.length === 0 ||
    (businessDomain !== undefined && containsNormalized(route.businessDomains, businessDomain));
  return profileMatches && domainMatches;
}

function matchesCustomFields(
  expected: Readonly<Record<string, string | readonly string[]>>,
  actual: Readonly<Record<string, string | readonly string[]>>
): boolean {
  for (const [key, expectedValue] of Object.entries(expected)) {
    const actualValue = actual[key];
    if (actualValue === undefined) return false;
    const expectedValues = Array.isArray(expectedValue) ? expectedValue : [expectedValue];
    const actualValues = Array.isArray(actualValue) ? actualValue : [actualValue];
    if (!expectedValues.some((value) => containsNormalized(actualValues, value))) {
      return false;
    }
  }
  return true;
}

function matchesOptional(expected: readonly string[], actual: string | undefined): boolean {
  return expected.length === 0 || (actual !== undefined && containsNormalized(expected, actual));
}

function intersectsOptional(expected: readonly string[], actual: readonly string[]): boolean {
  return expected.length === 0 || expected.some((value) => containsNormalized(actual, value));
}

function containsAll(expected: readonly string[], actual: readonly string[]): boolean {
  return expected.every((value) => containsNormalized(actual, value));
}

function containsNormalized(values: readonly string[], value: string): boolean {
  return values.some((item) => equalsNormalized(item, value));
}

function equalsNormalized(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function estimateCostCny(
  provider: ProviderConfig,
  usage: { readonly inputTokens: number; readonly outputTokens: number }
): number {
  if (provider.pricing.currency !== 'CNY') return 0;
  const tier =
    provider.pricing.tiers.find((item) => item.name === 'standard') ?? provider.pricing.tiers[0];
  if (tier === undefined) return 0;
  return roundCny(
    (usage.inputTokens / 1000) * tier.inputPer1k +
      (usage.outputTokens / 1000) * tier.outputPer1k
  );
}

function roundCny(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function buildAuditAttrs(input: {
  readonly candidate: ResolvedRouteCandidate;
  readonly features: JiraFeatures;
  readonly input: ModelRouterInput;
  readonly provider: ProviderConfig;
  readonly fallbackChain: readonly ModelRef[];
  readonly estimatedCostCny: number;
  readonly constraints: readonly ConstraintMatch[];
  readonly routeReason: string;
  readonly snapshotVersion: string;
}): Readonly<Record<string, RuntimeAuditAttributeValue>> {
  const isDefault =
    input.candidate.route.providerId === DEFAULT_MODEL_REF.providerId &&
    input.candidate.route.model === DEFAULT_MODEL;
  const attrs: Record<string, RuntimeAuditAttributeValue> = {
    'harness.routing.rule_id': input.candidate.ruleId,
    'harness.routing.source': input.candidate.source ?? 'default_route',
    'harness.routing.reason': input.routeReason,
    'harness.routing.fallback_chain': input.fallbackChain
      .map((item) => `${item.providerId}/${item.model}`)
      .join(' -> '),
    'harness.model.id': `${input.candidate.route.providerId}/${input.candidate.route.model}`,
    'harness.model.name': input.candidate.route.model,
    'harness.model.is_default': isDefault,
    'harness.provider.id': input.candidate.route.providerId,
    'harness.runtime.adapter': input.candidate.route.runtime ?? input.provider.runtime,
    'harness.budget.cost_cny': input.estimatedCostCny,
    'harness.config.snapshot_version': input.snapshotVersion
  };

  addOptional(attrs, 'harness.jira.project_key', input.features.projectKey);
  addOptional(attrs, 'harness.jira.issue_type', input.features.issueType);
  addOptional(attrs, 'harness.jira.priority', input.features.priority);
  addOptional(attrs, 'harness.jira.labels', input.features.labels.join(','));
  addOptional(attrs, 'harness.jira.components', input.features.components.join(','));
  addOptional(attrs, 'harness.jira.risk_level', input.features.riskLevel);
  addOptional(attrs, 'harness.jira.business_domain', input.features.businessDomain);
  addOptional(attrs, 'harness.jira.data_classification', input.features.dataClassification);

  const constraintIds = input.constraints.map((item) => item.constraint.id).join(',');
  if (constraintIds.length > 0) {
    attrs['harness.constraint.matched'] = constraintIds;
  }
  return attrs;
}

function addOptional(
  attrs: Record<string, RuntimeAuditAttributeValue>,
  key: string,
  value: string | undefined
): void {
  if (value !== undefined && value.length > 0) {
    attrs[key] = value;
  }
}

function effectiveRoutePrecedence(
  configured: readonly RoutePrecedenceItem[]
): readonly RoutePrecedenceItem[] {
  return configured.length > 0
    ? configured
    : ['provider_constraints', 'jira_model_routes', 'profile_routes', 'task_routes', 'default_route'];
}
