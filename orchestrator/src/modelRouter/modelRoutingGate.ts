import type {
  ConfigSnapshot,
  ProviderConfig,
  ProviderConstraintConfig,
  RouteConfig,
  RouteTargetConfig
} from '../configCenter/index.js';
import {
  ModelRoutingGateError,
  type ModelRef,
  type RouteSource,
  type RuntimeAdapterName,
  type RuntimeAuditAttributeValue,
  type RuntimeModelRouteDecision,
  type RuntimeModelRoutingGate,
  type RuntimeModelRoutingGateInput
} from '../runtime/index.js';

interface ExpectedRoute {
  readonly ruleId: string;
  readonly source: RouteSource;
  readonly route: RouteConfig;
  readonly reason: string;
  readonly constraint?: ProviderConstraintConfig;
}

interface TargetValidationContext {
  readonly ruleId: string;
  readonly constraints: readonly ProviderConstraintConfig[];
}

export class ConfigSnapshotModelRoutingGate implements RuntimeModelRoutingGate {
  constructor(private readonly snapshot: ConfigSnapshot) {}

  validate(input: RuntimeModelRoutingGateInput): RuntimeModelRouteDecision {
    const decision = input.decision;
    const provider = this.validateTarget(decision, {
      ruleId: decision.matchedRuleId ?? 'runtime_route_decision',
      constraints: []
    });

    if (decision.runtime !== input.runtimeName) {
      this.reject(
        decision,
        `route runtime ${decision.runtime} cannot execute on runtime ${input.runtimeName}`
      );
    }

    if (
      decision.snapshotVersion !== undefined &&
      decision.snapshotVersion !== this.snapshot.version
    ) {
      this.reject(decision, 'routeDecision snapshotVersion does not match current config snapshot');
    }

    const expectedRoute = this.resolveExpectedRoute(decision);
    if (expectedRoute !== undefined) {
      this.assertDecisionMatchesExpectedRoute(decision, expectedRoute);
    } else if (!this.isDefaultRouteDecision(decision)) {
      this.reject(decision, 'matchedRuleId is not registered in current routing config');
    }

    if (!this.isDefaultRouteDecision(decision)) {
      this.assertNonDefaultDecisionAuditable(decision);
    }

    const constraints = this.resolveConstraints(decision, expectedRoute);
    this.validateTarget(decision, {
      ruleId: decision.matchedRuleId ?? expectedRoute?.ruleId ?? 'runtime_route_decision',
      constraints
    });
    for (const fallback of decision.fallbackChain ?? []) {
      this.validateTarget(fallback, {
        ruleId: decision.matchedRuleId ?? expectedRoute?.ruleId ?? 'runtime_route_decision',
        constraints
      });
    }

    return {
      ...decision,
      runtime: provider.runtime
    };
  }

  private resolveExpectedRoute(
    decision: RuntimeModelRouteDecision
  ): ExpectedRoute | undefined {
    const ruleId = decision.matchedRuleId;
    if (ruleId === undefined || ruleId === 'defaults.default_route' || ruleId === 'default_route') {
      const route = this.snapshot.routing.defaults.defaultRoute;
      return {
        ruleId: 'defaults.default_route',
        source: 'default_route',
        route,
        reason: route.reason ?? 'DEFAULT_MODEL fallback'
      };
    }

    const constraint = this.snapshot.routing.providerConstraints.find((item) => item.id === ruleId);
    if (constraint?.route !== undefined) {
      return {
        ruleId: constraint.id,
        source: 'provider_constraints',
        route: constraint.route,
        reason: constraint.route.reason ?? `provider constraint ${constraint.id}`,
        constraint
      };
    }

    const jiraRoute = this.snapshot.routing.jiraModelRoutes.find((item) => item.id === ruleId);
    if (jiraRoute !== undefined) {
      return {
        ruleId: jiraRoute.id,
        source: 'jira_model_routes',
        route: jiraRoute.route,
        reason: jiraRoute.route.reason ?? jiraRoute.reason
      };
    }

    const profileRoute = this.snapshot.routing.profileRoutes.find((item) => item.id === ruleId);
    if (profileRoute !== undefined) {
      return {
        ruleId: profileRoute.id,
        source: 'profile_routes',
        route: profileRoute.route,
        reason: profileRoute.route.reason ?? profileRoute.reason
      };
    }

    const taskRoute = this.snapshot.routing.taskRoutes.find((item) => item.id === ruleId);
    if (taskRoute !== undefined) {
      return {
        ruleId: taskRoute.id,
        source: 'task_routes',
        route: taskRoute.route,
        reason: taskRoute.route.reason ?? taskRoute.reason
      };
    }

    return undefined;
  }

  private assertDecisionMatchesExpectedRoute(
    decision: RuntimeModelRouteDecision,
    expected: ExpectedRoute
  ): void {
    const expectedRef = this.toModelRef(expected.route);
    if (!sameModelRef(decision, expectedRef)) {
      this.reject(decision, `routeDecision does not match configured route ${expected.ruleId}`);
    }
    if (decision.routeSource !== undefined && decision.routeSource !== expected.source) {
      this.reject(decision, `routeSource must be ${expected.source} for ${expected.ruleId}`);
    }
    if (
      !this.isDefaultRouteDecision(decision) &&
      decision.routeReason !== undefined &&
      decision.routeReason !== expected.reason
    ) {
      this.reject(decision, `routeReason must match configured route ${expected.ruleId}`);
    }
    if (!sameFallbackChain(decision.fallbackChain ?? [], this.toFallbackChain(expected.route))) {
      this.reject(decision, `fallbackChain must match configured route ${expected.ruleId}`);
    }
  }

  private assertNonDefaultDecisionAuditable(decision: RuntimeModelRouteDecision): void {
    if (decision.matchedRuleId === undefined || decision.matchedRuleId.trim().length === 0) {
      this.reject(decision, 'non-default model route is missing matchedRuleId');
    }
    if (decision.routeReason === undefined || decision.routeReason.trim().length === 0) {
      this.reject(decision, 'non-default model route is missing routeReason');
    }
    if (decision.routeSource === undefined) {
      this.reject(decision, 'non-default model route is missing routeSource');
    }
    if (decision.fallbackChain === undefined) {
      this.reject(decision, 'non-default model route is missing fallbackChain');
    }
    if (
      decision.estimatedCostCny === undefined ||
      !Number.isFinite(decision.estimatedCostCny)
    ) {
      this.reject(decision, 'non-default model route is missing estimatedCostCny');
    }
    if (decision.snapshotVersion !== this.snapshot.version) {
      this.reject(decision, 'non-default model route must carry current snapshotVersion');
    }
    for (const attr of requiredNonDefaultAuditAttrs()) {
      if (decision.auditAttrs?.[attr] === undefined) {
        this.reject(decision, `non-default model route is missing audit attr ${attr}`);
      }
    }
    this.assertAuditAttr(decision, 'harness.routing.rule_id', decision.matchedRuleId);
    this.assertAuditAttr(decision, 'harness.routing.source', decision.routeSource);
    this.assertAuditAttr(decision, 'harness.routing.reason', decision.routeReason);
    this.assertAuditAttr(decision, 'harness.model.id', `${decision.providerId}/${decision.model}`);
    this.assertAuditAttr(decision, 'harness.model.is_default', false);
    this.assertAuditAttr(decision, 'harness.provider.id', decision.providerId);
    this.assertAuditAttr(decision, 'harness.runtime.adapter', decision.runtime);
    this.assertAuditAttr(decision, 'harness.budget.cost_cny', decision.estimatedCostCny);
    this.assertAuditAttr(decision, 'harness.config.snapshot_version', this.snapshot.version);
  }

  private assertAuditAttr(
    decision: RuntimeModelRouteDecision,
    key: string,
    expected: RuntimeAuditAttributeValue
  ): void {
    if (decision.auditAttrs?.[key] !== expected) {
      this.reject(decision, `audit attr ${key} must match routeDecision`);
    }
  }

  private resolveConstraints(
    decision: RuntimeModelRouteDecision,
    expectedRoute: ExpectedRoute | undefined
  ): readonly ProviderConstraintConfig[] {
    const constraints = new Map<string, ProviderConstraintConfig>();
    if (expectedRoute?.constraint !== undefined) {
      constraints.set(expectedRoute.constraint.id, expectedRoute.constraint);
    }

    const matchedConstraintAttr = readStringAttr(decision.auditAttrs, 'harness.constraint.matched');
    if (matchedConstraintAttr !== undefined) {
      for (const id of matchedConstraintAttr.split(',').map((item) => item.trim()).filter(Boolean)) {
        const constraint = this.snapshot.routing.providerConstraints.find((item) => item.id === id);
        if (constraint !== undefined) {
          constraints.set(constraint.id, constraint);
        }
      }
    }

    const dataClassification = readStringAttr(
      decision.auditAttrs,
      'harness.jira.data_classification'
    );
    if (dataClassification !== undefined) {
      for (const constraint of this.snapshot.routing.providerConstraints) {
        if (
          constraint.dataClassification !== undefined &&
          equalsNormalized(constraint.dataClassification, dataClassification)
        ) {
          constraints.set(constraint.id, constraint);
        }
      }
    }

    return [...constraints.values()];
  }

  private validateTarget(
    target: RouteTargetConfig,
    context: TargetValidationContext
  ): ProviderConfig {
    const provider = this.snapshot.providers.providers.find((item) => item.id === target.providerId);
    if (provider === undefined) {
      this.rejectTarget(target, 'provider is not registered');
    }
    if (!provider.enabled) {
      this.rejectTarget(target, 'provider is disabled');
    }
    if (!provider.models.includes(target.model)) {
      this.rejectTarget(target, 'model is not registered for provider');
    }
    if (target.runtime !== undefined && target.runtime !== provider.runtime) {
      this.rejectTarget(target, `route runtime ${target.runtime} must match provider runtime ${provider.runtime}`);
    }

    for (const constraint of context.constraints) {
      if (
        constraint.mustUseProviders.length > 0 &&
        !constraint.mustUseProviders.includes(target.providerId)
      ) {
        this.rejectTarget(
          target,
          `provider_constraints ${constraint.id} requires ${constraint.mustUseProviders.join(',')}`
        );
      }
      if (constraint.deniedProviders.includes(target.providerId)) {
        this.rejectTarget(
          target,
          `provider_constraints ${constraint.id} denies provider ${target.providerId}`
        );
      }
    }

    return provider;
  }

  private isDefaultRouteDecision(decision: RuntimeModelRouteDecision): boolean {
    const defaultRoute = this.snapshot.routing.defaults.defaultRoute;
    return decision.providerId === defaultRoute.providerId && decision.model === defaultRoute.model;
  }

  private toModelRef(target: RouteTargetConfig): ModelRef {
    const provider = this.validateTarget(target, {
      ruleId: 'configured_route',
      constraints: []
    });
    return {
      providerId: target.providerId,
      model: target.model,
      runtime: target.runtime ?? provider.runtime
    };
  }

  private toFallbackChain(route: RouteConfig): readonly ModelRef[] {
    return route.fallbackChain.map((target) => this.toModelRef(target));
  }

  private reject(decision: RuntimeModelRouteDecision, reason: string): never {
    throw new ModelRoutingGateError({
      schema_version: 'model-routing-gate-error@1',
      policy_decision: 'deny',
      gate: 'ModelRoutingGate',
      provider_id: decision.providerId,
      model: decision.model,
      reason
    });
  }

  private rejectTarget(target: RouteTargetConfig, reason: string): never {
    throw new ModelRoutingGateError({
      schema_version: 'model-routing-gate-error@1',
      policy_decision: 'deny',
      gate: 'ModelRoutingGate',
      provider_id: target.providerId,
      model: target.model,
      reason
    });
  }
}

function sameFallbackChain(
  left: readonly ModelRef[],
  right: readonly ModelRef[]
): boolean {
  return left.length === right.length && left.every((item, index) => sameModelRef(item, right[index]));
}

function sameModelRef(left: RouteTargetConfig, right: ModelRef | undefined): boolean {
  return (
    right !== undefined &&
    left.providerId === right.providerId &&
    left.model === right.model &&
    left.runtime === right.runtime
  );
}

function requiredNonDefaultAuditAttrs(): readonly string[] {
  return [
    'harness.routing.rule_id',
    'harness.routing.source',
    'harness.routing.reason',
    'harness.model.id',
    'harness.model.is_default',
    'harness.provider.id',
    'harness.runtime.adapter',
    'harness.budget.cost_cny',
    'harness.config.snapshot_version'
  ];
}

function readStringAttr(
  attrs: Readonly<Record<string, RuntimeAuditAttributeValue>> | undefined,
  key: string
): string | undefined {
  const value = attrs?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function equalsNormalized(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}
