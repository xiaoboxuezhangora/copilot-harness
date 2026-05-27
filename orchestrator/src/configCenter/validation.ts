import { createHash } from 'node:crypto';

import { parse as parseYaml } from 'yaml';

import type { ModelCatalogEntry, RuntimeAdapterName, RuntimeModel } from '../runtime/index.js';
import {
  CONFIG_CENTER_SCHEMA_VERSION,
  type AccountConfig,
  type AccountsConfigV4,
  type ConfigBundleRaw,
  type ConfigSnapshot,
  type ConfigValidationIssue,
  type FeatureFlagConfig,
  type JiraModelRouteConfig,
  type JiraRouteMatchConfig,
  type PricingTierConfig,
  type ProviderAuthMode,
  type ProviderCapabilitiesConfig,
  type ProviderConfig,
  type ProviderConstraintConfig,
  type ProvidersConfigV4,
  type ProviderType,
  type RouteConfig,
  type RoutePrecedenceItem,
  type RouteTargetConfig,
  type RoutingConfigV4,
  type StructuredOutputCapability,
  type TaskRouteConfig,
  type ToolCallingCapability,
  type ProfileRouteConfig
} from './types.js';

type ConfigFileName = ConfigValidationIssue['file'];

const ROUTE_PRECEDENCE: readonly RoutePrecedenceItem[] = [
  'provider_constraints',
  'jira_model_routes',
  'profile_routes',
  'task_routes',
  'default_route'
];

export class ConfigCenterValidationError extends Error {
  readonly issues: readonly ConfigValidationIssue[];

  constructor(issues: readonly ConfigValidationIssue[]) {
    super(issues.map((issue) => `${issue.file}:${issue.path} ${issue.message}`).join('; '));
    this.name = 'ConfigCenterValidationError';
    this.issues = issues;
  }
}

export function parseConfigSnapshot(raw: ConfigBundleRaw): ConfigSnapshot {
  const providers = parseProvidersYaml(raw.providersYaml);
  const accounts = parseAccountsYaml(raw.accountsYaml);
  const routing = parseRoutingYaml(raw.routingYaml);
  validateConfigBundle(providers, accounts, routing);

  return deepFreeze({
    version: raw.version ?? snapshotVersion(raw),
    loadedAt: raw.loadedAt ?? new Date().toISOString(),
    providers,
    accounts,
    routing,
    modelCatalog: {
      snapshotVersion: raw.version ?? snapshotVersion(raw),
      defaultModel: {
        providerId: routing.defaults.defaultRoute.providerId,
        model: routing.defaults.defaultRoute.model,
        runtime:
          routing.defaults.defaultRoute.runtime ??
          requireProvider(providers, routing.defaults.defaultRoute.providerId).runtime
      },
      models: providers.providers.flatMap((provider): readonly ModelCatalogEntry[] =>
        provider.models.map((model) => ({
          providerId: provider.id,
          model,
          runtime: provider.runtime,
          enabled: provider.enabled,
          displayName: `${provider.displayName} / ${model}`
        }))
      )
    }
  });
}

export function parseProvidersYaml(raw: string): ProvidersConfigV4 {
  const root = readYamlRecord(raw, 'providers.yaml');
  assertVersion(root, 'providers.yaml');
  const providers = readArray(root, 'providers.yaml', 'providers').map((item, index) =>
    parseProvider(readRecord(item, 'providers.yaml', `providers[${index}]`), index)
  );

  return {
    version: CONFIG_CENTER_SCHEMA_VERSION,
    featureFlags: parseFeatureFlags(readOptionalRecord(root, 'feature_flags'), 'providers.yaml'),
    providers
  };
}

export function parseAccountsYaml(raw: string): AccountsConfigV4 {
  const root = readYamlRecord(raw, 'accounts.yaml');
  assertVersion(root, 'accounts.yaml');
  const accounts = readArray(root, 'accounts.yaml', 'accounts').map((item, index) =>
    parseAccount(readRecord(item, 'accounts.yaml', `accounts[${index}]`), index)
  );

  return {
    version: CONFIG_CENTER_SCHEMA_VERSION,
    accounts
  };
}

export function parseRoutingYaml(raw: string): RoutingConfigV4 {
  const root = readYamlRecord(raw, 'routing.yaml');
  assertVersion(root, 'routing.yaml');
  const defaults = readRecord(root.defaults, 'routing.yaml', 'defaults');
  const totalBudgetMs = readOptionalNumber(root, 'total_budget_ms');

  return {
    version: CONFIG_CENTER_SCHEMA_VERSION,
    defaults: {
      defaultRoute: parseRoute(
        readRecord(defaults.default_route, 'routing.yaml', 'defaults.default_route'),
        'defaults.default_route'
      )
    },
    providerConstraints: readOptionalArray(root, 'provider_constraints').map((item, index) =>
      parseProviderConstraint(
        readRecord(item, 'routing.yaml', `provider_constraints[${index}]`),
        index
      )
    ),
    jiraModelRoutes: readOptionalArray(root, 'jira_model_routes').map((item, index) =>
      parseJiraModelRoute(readRecord(item, 'routing.yaml', `jira_model_routes[${index}]`), index)
    ),
    profileRoutes: readOptionalArray(root, 'profile_routes').map((item, index) =>
      parseProfileRoute(readRecord(item, 'routing.yaml', `profile_routes[${index}]`), index)
    ),
    taskRoutes: readOptionalArray(root, 'task_routes').map((item, index) =>
      parseTaskRoute(readRecord(item, 'routing.yaml', `task_routes[${index}]`), index)
    ),
    routePrecedence: parseRoutePrecedenceList(root),
    ...(totalBudgetMs !== undefined ? { totalBudgetMs } : {})
  };
}

function parseProvider(raw: Record<string, unknown>, index: number): ProviderConfig {
  const baseUrl = readOptionalString(raw, 'base_url');
  return {
    id: readNonEmptyString(raw, 'id', 'providers.yaml', `providers[${index}].id`),
    type: parseProviderType(
      readNonEmptyString(raw, 'type', 'providers.yaml', `providers[${index}].type`)
    ),
    enabled: readBoolean(raw, 'enabled', 'providers.yaml', `providers[${index}].enabled`),
    displayName:
      readOptionalString(raw, 'display_name') ??
      readNonEmptyString(raw, 'id', 'providers.yaml', `providers[${index}].id`),
    runtime: normalizeRuntime(
      readNonEmptyString(raw, 'runtime', 'providers.yaml', `providers[${index}].runtime`)
    ),
    authMode: parseAuthMode(
      readNonEmptyString(raw, 'auth_mode', 'providers.yaml', `providers[${index}].auth_mode`)
    ),
    ...(baseUrl !== undefined ? { baseUrl } : {}),
    capabilities: parseCapabilities(
      readRecord(raw.capabilities, 'providers.yaml', `providers[${index}].capabilities`),
      `providers[${index}].capabilities`
    ),
    pricing: {
      currency: parseCurrency(
        readNonEmptyString(
          readRecord(raw.pricing, 'providers.yaml', `providers[${index}].pricing`),
          'currency',
          'providers.yaml',
          `providers[${index}].pricing.currency`
        )
      ),
      tiers: readArray(
        readRecord(raw.pricing, 'providers.yaml', `providers[${index}].pricing`),
        'providers.yaml',
        'tiers',
        `providers[${index}].pricing.tiers`
      ).map((tier, tierIndex) =>
        parsePricingTier(
          readRecord(tier, 'providers.yaml', `providers[${index}].pricing.tiers[${tierIndex}]`),
          `providers[${index}].pricing.tiers[${tierIndex}]`
        )
      )
    },
    models: readStringArray(raw, 'models', 'providers.yaml', `providers[${index}].models`)
  };
}

function parseCapabilities(
  raw: Record<string, unknown>,
  path: string
): ProviderCapabilitiesConfig {
  return {
    toolCalling: parseToolCalling(
      readNonEmptyString(raw, 'tool_calling', 'providers.yaml', `${path}.tool_calling`)
    ),
    reasoningEffort: readBoolean(raw, 'reasoning_effort', 'providers.yaml', `${path}.reasoning_effort`),
    streaming: readBoolean(raw, 'streaming', 'providers.yaml', `${path}.streaming`),
    structuredOutput: parseStructuredOutput(
      readNonEmptyString(raw, 'structured_output', 'providers.yaml', `${path}.structured_output`)
    ),
    vision: readBoolean(raw, 'vision', 'providers.yaml', `${path}.vision`)
  };
}

function parsePricingTier(raw: Record<string, unknown>, path: string): PricingTierConfig {
  const name = readNonEmptyString(raw, 'name', 'providers.yaml', `${path}.name`);
  if (name !== 'cache_hit' && name !== 'standard' && name !== 'long_context') {
    fail('providers.yaml', `${path}.name`, 'tier name must be cache_hit, standard, or long_context');
  }
  return {
    name,
    inputPer1k: readNumber(raw, 'input_per_1k', 'providers.yaml', `${path}.input_per_1k`),
    outputPer1k: readNumber(raw, 'output_per_1k', 'providers.yaml', `${path}.output_per_1k`)
  };
}

function parseAccount(raw: Record<string, unknown>, index: number): AccountConfig {
  const quota = readOptionalRecord(raw, 'quota');
  return {
    id: readNonEmptyString(raw, 'id', 'accounts.yaml', `accounts[${index}].id`),
    providerId: readNonEmptyString(
      raw,
      'provider_id',
      'accounts.yaml',
      `accounts[${index}].provider_id`
    ),
    enabled: readBoolean(raw, 'enabled', 'accounts.yaml', `accounts[${index}].enabled`),
    credentialRef: readNonEmptyString(
      raw,
      'credential_ref',
      'accounts.yaml',
      `accounts[${index}].credential_ref`
    ),
    ...(quota !== undefined ? { quota: parseQuota(quota, `accounts[${index}].quota`) } : {})
  };
}

function parseQuota(raw: Record<string, unknown>, path: string): {
  readonly rpm?: number;
  readonly tpm?: number;
  readonly dailyCny?: number;
} {
  const rpm = readOptionalNumber(raw, 'rpm');
  const tpm = readOptionalNumber(raw, 'tpm');
  const dailyCny = readOptionalNumber(raw, 'daily_cny');
  if (rpm === undefined && tpm === undefined && dailyCny === undefined) {
    fail('accounts.yaml', path, 'quota must define at least one limit');
  }
  return {
    ...(rpm !== undefined ? { rpm } : {}),
    ...(tpm !== undefined ? { tpm } : {}),
    ...(dailyCny !== undefined ? { dailyCny } : {})
  };
}

function parseProviderConstraint(
  raw: Record<string, unknown>,
  index: number
): ProviderConstraintConfig {
  const dataClassification = readOptionalString(raw, 'data_classification');
  const routeRaw = readOptionalRecord(raw, 'route');
  const onUnavailable = readOptionalString(raw, 'on_unavailable') ?? 'deny';
  if (onUnavailable !== 'deny' && onUnavailable !== 'fallback') {
    fail(
      'routing.yaml',
      `provider_constraints[${index}].on_unavailable`,
      'on_unavailable must be deny or fallback'
    );
  }

  return {
    id: readNonEmptyString(raw, 'id', 'routing.yaml', `provider_constraints[${index}].id`),
    ...(dataClassification !== undefined ? { dataClassification } : {}),
    mustUseProviders: readOptionalStringArray(raw, 'must_use_providers', []),
    deniedProviders: readOptionalStringArray(raw, 'denied_providers', []),
    ...(routeRaw !== undefined
      ? { route: parseRoute(routeRaw, `provider_constraints[${index}].route`) }
      : {}),
    onUnavailable
  };
}

function parseJiraModelRoute(raw: Record<string, unknown>, index: number): JiraModelRouteConfig {
  return {
    id: readNonEmptyString(raw, 'id', 'routing.yaml', `jira_model_routes[${index}].id`),
    match: parseJiraMatch(
      readRecord(raw.match, 'routing.yaml', `jira_model_routes[${index}].match`),
      `jira_model_routes[${index}].match`
    ),
    route: parseRoute(
      readRecord(raw.route, 'routing.yaml', `jira_model_routes[${index}].route`),
      `jira_model_routes[${index}].route`
    ),
    reason: readNonEmptyString(raw, 'reason', 'routing.yaml', `jira_model_routes[${index}].reason`)
  };
}

function parseProfileRoute(raw: Record<string, unknown>, index: number): ProfileRouteConfig {
  return {
    id: readNonEmptyString(raw, 'id', 'routing.yaml', `profile_routes[${index}].id`),
    profiles: readOptionalStringArray(raw, 'profiles', []),
    businessDomains: readOptionalStringArray(raw, 'business_domains', []),
    route: parseRoute(
      readRecord(raw.route, 'routing.yaml', `profile_routes[${index}].route`),
      `profile_routes[${index}].route`
    ),
    reason: readNonEmptyString(raw, 'reason', 'routing.yaml', `profile_routes[${index}].reason`)
  };
}

function parseTaskRoute(raw: Record<string, unknown>, index: number): TaskRouteConfig {
  return {
    id: readNonEmptyString(raw, 'id', 'routing.yaml', `task_routes[${index}].id`),
    taskTypes: readOptionalStringArray(raw, 'task_types', []),
    route: parseRoute(
      readRecord(raw.route, 'routing.yaml', `task_routes[${index}].route`),
      `task_routes[${index}].route`
    ),
    reason: readNonEmptyString(raw, 'reason', 'routing.yaml', `task_routes[${index}].reason`)
  };
}

function parseJiraMatch(raw: Record<string, unknown>, path: string): JiraRouteMatchConfig {
  return {
    projectKeys: readOptionalStringArray(raw, 'project_keys', []),
    issueTypes: readOptionalStringArray(raw, 'issue_types', []),
    labelsAny: readOptionalStringArray(raw, 'labels_any', []),
    labelsAll: readOptionalStringArray(raw, 'labels_all', []),
    componentsAny: readOptionalStringArray(raw, 'components_any', []),
    priorities: readOptionalStringArray(raw, 'priorities', []),
    riskLevels: readOptionalStringArray(raw, 'risk_levels', []),
    businessDomains: readOptionalStringArray(raw, 'business_domains', []),
    dataClassifications: readOptionalStringArray(raw, 'data_classifications', []),
    customFields: parseCustomFields(readOptionalRecord(raw, 'custom_fields'), path)
  };
}

function parseCustomFields(
  raw: Record<string, unknown> | undefined,
  path: string
): Readonly<Record<string, string | readonly string[]>> {
  if (raw === undefined) return {};
  const output: Record<string, string | readonly string[]> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string') {
      output[key] = value;
    } else if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
      output[key] = [...value];
    } else {
      fail('routing.yaml', `${path}.custom_fields.${key}`, 'custom field match must be string or string[]');
    }
  }
  return output;
}

function parseRoute(raw: Record<string, unknown>, path: string): RouteConfig {
  const runtimeRaw = readOptionalString(raw, 'runtime');
  const reason = readOptionalString(raw, 'reason');
  return {
    providerId: readNonEmptyString(raw, 'provider_id', 'routing.yaml', `${path}.provider_id`),
    model: readNonEmptyString(raw, 'model', 'routing.yaml', `${path}.model`),
    ...(runtimeRaw !== undefined ? { runtime: normalizeRuntime(runtimeRaw) } : {}),
    ...(reason !== undefined ? { reason } : {}),
    fallbackChain: readOptionalArray(raw, 'fallback_chain').map((item, index) =>
      parseRouteTarget(readRecord(item, 'routing.yaml', `${path}.fallback_chain[${index}]`), `${path}.fallback_chain[${index}]`)
    )
  };
}

function parseRouteTarget(raw: Record<string, unknown>, path: string): RouteTargetConfig {
  const runtimeRaw = readOptionalString(raw, 'runtime');
  return {
    providerId: readNonEmptyString(raw, 'provider_id', 'routing.yaml', `${path}.provider_id`),
    model: readNonEmptyString(raw, 'model', 'routing.yaml', `${path}.model`),
    ...(runtimeRaw !== undefined ? { runtime: normalizeRuntime(runtimeRaw) } : {})
  };
}

function validateConfigBundle(
  providersConfig: ProvidersConfigV4,
  accountsConfig: AccountsConfigV4,
  routingConfig: RoutingConfigV4
): void {
  const issues: ConfigValidationIssue[] = [];
  checkUnique(providersConfig.providers.map((provider) => provider.id), 'providers.yaml', 'providers', issues);
  checkUnique(accountsConfig.accounts.map((account) => account.id), 'accounts.yaml', 'accounts', issues);
  checkProviderRules(providersConfig, issues);
  checkAccounts(accountsConfig, providersConfig, issues);
  checkRoutePrecedence(routingConfig, issues);
  checkRoutes(routingConfig, providersConfig, issues);

  if (issues.length > 0) {
    throw new ConfigCenterValidationError(issues);
  }
}

function checkProviderRules(config: ProvidersConfigV4, issues: ConfigValidationIssue[]): void {
  for (const [index, provider] of config.providers.entries()) {
    if (provider.id === 'copilot' && provider.authMode !== 'user_passthrough') {
      issues.push({
        file: 'providers.yaml',
        path: `providers[${index}].auth_mode`,
        message: 'copilot provider must use user_passthrough'
      });
    }
    if (provider.authMode === 'pool' && provider.id === 'copilot') {
      issues.push({
        file: 'providers.yaml',
        path: `providers[${index}].auth_mode`,
        message: 'copilot must not be pooled'
      });
    }
    if (provider.models.length === 0) {
      issues.push({
        file: 'providers.yaml',
        path: `providers[${index}].models`,
        message: 'provider must register at least one model'
      });
    }
  }
}

function checkAccounts(
  accountsConfig: AccountsConfigV4,
  providersConfig: ProvidersConfigV4,
  issues: ConfigValidationIssue[]
): void {
  for (const [index, account] of accountsConfig.accounts.entries()) {
    const provider = providersConfig.providers.find((item) => item.id === account.providerId);
    if (account.providerId === 'copilot') {
      issues.push({
        file: 'accounts.yaml',
        path: `accounts[${index}].provider_id`,
        message: 'copilot user_passthrough must not appear in accounts.yaml'
      });
    }
    if (provider === undefined) {
      issues.push({
        file: 'accounts.yaml',
        path: `accounts[${index}].provider_id`,
        message: 'account references unknown provider'
      });
    } else if (provider.authMode !== 'pool') {
      issues.push({
        file: 'accounts.yaml',
        path: `accounts[${index}].provider_id`,
        message: 'accounts.yaml may only reference provider pool providers'
      });
    }
    if (!isCredentialRef(account.credentialRef)) {
      issues.push({
        file: 'accounts.yaml',
        path: `accounts[${index}].credential_ref`,
        message: 'credential_ref must use vault:// or kms://'
      });
    }
  }
}

function checkRoutes(
  routingConfig: RoutingConfigV4,
  providersConfig: ProvidersConfigV4,
  issues: ConfigValidationIssue[]
): void {
  validateRoute(routingConfig.defaults.defaultRoute, 'defaults.default_route', providersConfig, issues);
  routingConfig.jiraModelRoutes.forEach((route, index) => {
    validateRoute(route.route, `jira_model_routes[${index}].route`, providersConfig, issues);
  });
  routingConfig.profileRoutes.forEach((route, index) => {
    validateRoute(route.route, `profile_routes[${index}].route`, providersConfig, issues);
  });
  routingConfig.taskRoutes.forEach((route, index) => {
    validateRoute(route.route, `task_routes[${index}].route`, providersConfig, issues);
  });
  routingConfig.providerConstraints.forEach((constraint, index) => {
    for (const providerId of [...constraint.mustUseProviders, ...constraint.deniedProviders]) {
      if (providersConfig.providers.find((provider) => provider.id === providerId) === undefined) {
        issues.push({
          file: 'routing.yaml',
          path: `provider_constraints[${index}]`,
          message: `provider constraint references unknown provider ${providerId}`
        });
      }
    }
    if (constraint.route !== undefined) {
      validateRoute(constraint.route, `provider_constraints[${index}].route`, providersConfig, issues);
      if (
        constraint.mustUseProviders.length > 0 &&
        !constraint.mustUseProviders.includes(constraint.route.providerId)
      ) {
        issues.push({
          file: 'routing.yaml',
          path: `provider_constraints[${index}].route.provider_id`,
          message: 'constraint route must use a must_use_providers provider'
        });
      }
    }
  });
}

function validateRoute(
  route: RouteConfig,
  path: string,
  providersConfig: ProvidersConfigV4,
  issues: ConfigValidationIssue[]
): void {
  validateTarget(route, path, providersConfig, issues);
  route.fallbackChain.forEach((target, index) => {
    validateTarget(target, `${path}.fallback_chain[${index}]`, providersConfig, issues);
  });
}

function validateTarget(
  target: RouteTargetConfig,
  path: string,
  providersConfig: ProvidersConfigV4,
  issues: ConfigValidationIssue[]
): void {
  const provider = providersConfig.providers.find((item) => item.id === target.providerId);
  if (provider === undefined) {
    issues.push({
      file: 'routing.yaml',
      path: `${path}.provider_id`,
      message: 'route references unknown provider'
    });
    return;
  }
  if (!provider.enabled) {
    issues.push({
      file: 'routing.yaml',
      path: `${path}.provider_id`,
      message: 'route references disabled provider'
    });
  }
  if (!provider.models.includes(target.model)) {
    issues.push({
      file: 'routing.yaml',
      path: `${path}.model`,
      message: 'route references model not registered in provider catalog'
    });
  }
  if (target.runtime !== undefined && target.runtime !== provider.runtime) {
    issues.push({
      file: 'routing.yaml',
      path: `${path}.runtime`,
      message: `route runtime ${target.runtime} must match provider runtime ${provider.runtime}`
    });
  }
}

function parseFeatureFlags(
  raw: Record<string, unknown> | undefined,
  file: ConfigFileName
): Readonly<Record<string, FeatureFlagConfig>> {
  if (raw === undefined) return {};
  const flags: Record<string, FeatureFlagConfig> = {};
  for (const [key, value] of Object.entries(raw)) {
    const record = readRecord(value, file, `feature_flags.${key}`);
    const rolloutPct = readOptionalNumber(record, 'rollout_pct');
    flags[key] = {
      enabled: readBoolean(record, 'enabled', file, `feature_flags.${key}.enabled`),
      ...(rolloutPct !== undefined ? { rolloutPct } : {})
    };
  }
  return flags;
}

export function normalizeRuntime(value: string): RuntimeAdapterName {
  const normalized = value.replaceAll('-', '_');
  if (
    normalized === 'copilot_sdk' ||
    normalized === 'copilot_cli' ||
    normalized === 'openai_compatible' ||
    normalized === 'contract_stub'
  ) {
    return normalized;
  }
  fail('providers.yaml', 'runtime', 'runtime must be copilot_sdk, copilot_cli, openai_compatible, or contract_stub');
}

function parseProviderType(value: string): ProviderType {
  const normalized = normalizeRuntime(value);
  if (normalized === 'copilot_sdk' || normalized === 'copilot_cli' || normalized === 'openai_compatible' || normalized === 'contract_stub') {
    return normalized;
  }
  fail('providers.yaml', 'type', 'provider type is unsupported');
}

function parseAuthMode(value: string): ProviderAuthMode {
  if (value === 'user_passthrough' || value === 'pool') return value;
  fail('providers.yaml', 'auth_mode', 'auth_mode must be user_passthrough or pool');
}

function parseToolCalling(value: string): ToolCallingCapability {
  if (value === 'openai_v2' || value === 'openai_v1' || value === 'json_mode' || value === 'unsupported') {
    return value;
  }
  fail('providers.yaml', 'capabilities.tool_calling', 'unsupported tool_calling capability');
}

function parseStructuredOutput(value: string): StructuredOutputCapability {
  if (value === 'json_schema' || value === 'json_mode' || value === 'none') return value;
  fail('providers.yaml', 'capabilities.structured_output', 'unsupported structured_output capability');
}

function parseCurrency(value: string): 'CNY' | 'USD' {
  if (value === 'CNY' || value === 'USD') return value;
  fail('providers.yaml', 'pricing.currency', 'currency must be CNY or USD');
}

function parseRoutePrecedenceList(root: Record<string, unknown>): readonly RoutePrecedenceItem[] {
  const raw = root.route_precedence;
  if (raw === undefined) return [...ROUTE_PRECEDENCE];
  if (!Array.isArray(raw)) {
    fail('routing.yaml', 'route_precedence', 'must be a string array');
  }
  if (raw.length === 0) return [...ROUTE_PRECEDENCE];
  return raw.map((item, index) => {
    if (typeof item !== 'string') {
      fail('routing.yaml', `route_precedence[${index}]`, 'must be a string');
    }
    return parseRoutePrecedence(item, index);
  });
}

function parseRoutePrecedence(value: string, index: number): RoutePrecedenceItem {
  const normalized = value === 'defaults.default_route' ? 'default_route' : value;
  if (
    normalized === 'provider_constraints' ||
    normalized === 'data_classification' ||
    normalized === 'jira_model_routes' ||
    normalized === 'profile_routes' ||
    normalized === 'task_routes' ||
    normalized === 'default_route'
  ) {
    return normalized;
  }
  fail('routing.yaml', `route_precedence[${index}]`, 'unsupported route precedence item');
}

function checkRoutePrecedence(
  routingConfig: RoutingConfigV4,
  issues: ConfigValidationIssue[]
): void {
  const seen = new Set<RoutePrecedenceItem>();
  for (const [index, item] of routingConfig.routePrecedence.entries()) {
    if (seen.has(item)) {
      issues.push({
        file: 'routing.yaml',
        path: `route_precedence[${index}]`,
        message: `duplicate route precedence item ${item}`
      });
    }
    seen.add(item);
  }

  if (!seen.has('default_route')) {
    issues.push({
      file: 'routing.yaml',
      path: 'route_precedence',
      message: 'route_precedence must include default_route'
    });
  }
}

function assertVersion(root: Record<string, unknown>, file: ConfigFileName): void {
  const version = root.version;
  if (version !== CONFIG_CENTER_SCHEMA_VERSION) {
    fail(file, 'version', `version must be ${CONFIG_CENTER_SCHEMA_VERSION}`);
  }
}

function readYamlRecord(raw: string, file: ConfigFileName): Record<string, unknown> {
  const parsed = parseYaml(raw) as unknown;
  return readRecord(parsed, file, '$');
}

function readRecord(value: unknown, file: ConfigFileName, path: string): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  fail(file, path, 'must be an object');
}

function readOptionalRecord(
  raw: Record<string, unknown>,
  key: string
): Record<string, unknown> | undefined {
  const value = raw[key];
  if (value === undefined) return undefined;
  return readRecord(value, 'bundle', key);
}

function readArray(
  raw: Record<string, unknown>,
  file: ConfigFileName,
  key: string,
  path = key
): readonly unknown[] {
  const value = raw[key];
  if (Array.isArray(value)) return value;
  fail(file, path, 'must be an array');
}

function readOptionalArray(raw: Record<string, unknown>, key: string): readonly unknown[] {
  const value = raw[key];
  if (value === undefined) return [];
  if (Array.isArray(value)) return value;
  fail('routing.yaml', key, 'must be an array');
}

function readNonEmptyString(
  raw: Record<string, unknown>,
  key: string,
  file: ConfigFileName,
  path: string
): string {
  const value = raw[key];
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }
  fail(file, path, 'must be a non-empty string');
}

function readOptionalString(raw: Record<string, unknown>, key: string): string | undefined {
  const value = raw[key];
  if (value === undefined) return undefined;
  if (typeof value === 'string') return value;
  fail('bundle', key, 'must be a string');
}

function readStringArray(
  raw: Record<string, unknown>,
  key: string,
  file: ConfigFileName,
  path: string
): readonly string[] {
  const value = raw[key];
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    return [...value] as readonly string[];
  }
  fail(file, path, 'must be a string array');
}

function readOptionalStringArray(
  raw: Record<string, unknown>,
  key: string,
  fallback: readonly string[]
): readonly string[] {
  const value = raw[key];
  if (value === undefined) return [...fallback];
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    return [...value] as readonly string[];
  }
  fail('routing.yaml', key, 'must be a string array');
}

function readBoolean(
  raw: Record<string, unknown>,
  key: string,
  file: ConfigFileName,
  path: string
): boolean {
  const value = raw[key];
  if (typeof value === 'boolean') return value;
  fail(file, path, 'must be a boolean');
}

function readNumber(
  raw: Record<string, unknown>,
  key: string,
  file: ConfigFileName,
  path: string
): number {
  const value = raw[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  fail(file, path, 'must be a finite number');
}

function readOptionalNumber(raw: Record<string, unknown>, key: string): number | undefined {
  const value = raw[key];
  if (value === undefined) return undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  fail('bundle', key, 'must be a finite number');
}

function checkUnique(
  values: readonly string[],
  file: ConfigFileName,
  path: string,
  issues: ConfigValidationIssue[]
): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      issues.push({ file, path, message: `duplicate id ${value}` });
    }
    seen.add(value);
  }
}

function isCredentialRef(value: string): boolean {
  return value.startsWith('vault://') || value.startsWith('kms://');
}

function requireProvider(config: ProvidersConfigV4, providerId: string): ProviderConfig {
  const provider = config.providers.find((item) => item.id === providerId);
  if (provider === undefined) {
    fail('providers.yaml', 'providers', `missing provider ${providerId}`);
  }
  return provider;
}

function snapshotVersion(raw: ConfigBundleRaw): string {
  const hash = createHash('sha256')
    .update(raw.providersYaml)
    .update('\n---accounts---\n')
    .update(raw.accountsYaml)
    .update('\n---routing---\n')
    .update(raw.routingYaml)
    .digest('hex')
    .slice(0, 12);
  return `local-${hash}`;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value;
  Object.freeze(value);
  for (const item of Object.values(value as Record<string, unknown>)) {
    deepFreeze(item);
  }
  return value;
}

function fail(file: ConfigFileName, path: string, message: string): never {
  throw new ConfigCenterValidationError([{ file, path, message }]);
}
