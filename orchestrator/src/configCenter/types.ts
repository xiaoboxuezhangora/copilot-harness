import type { ModelCatalog, ModelRef, RuntimeAdapterName, RuntimeModel } from '../runtime/index.js';

export const CONFIG_CENTER_SCHEMA_VERSION = 4;

export type ProviderType = 'copilot_sdk' | 'copilot_cli' | 'openai_compatible' | 'contract_stub';
export type ProviderAuthMode = 'user_passthrough' | 'pool';
export type ToolCallingCapability = 'openai_v2' | 'openai_v1' | 'json_mode' | 'unsupported';
export type StructuredOutputCapability = 'json_schema' | 'json_mode' | 'none';
export type PricingCurrency = 'CNY' | 'USD';
export type PricingTierName = 'cache_hit' | 'standard' | 'long_context';
export type ProviderConstraintAction = 'deny' | 'fallback';

export interface FeatureFlagConfig {
  readonly enabled: boolean;
  readonly rolloutPct?: number;
}

export interface ProviderCapabilitiesConfig {
  readonly toolCalling: ToolCallingCapability;
  readonly reasoningEffort: boolean;
  readonly streaming: boolean;
  readonly structuredOutput: StructuredOutputCapability;
  readonly vision: boolean;
}

export interface PricingTierConfig {
  readonly name: PricingTierName;
  readonly inputPer1k: number;
  readonly outputPer1k: number;
}

export interface ProviderPricingConfig {
  readonly currency: PricingCurrency;
  readonly tiers: readonly PricingTierConfig[];
}

export interface ProviderConfig {
  readonly id: string;
  readonly type: ProviderType;
  readonly enabled: boolean;
  readonly displayName: string;
  readonly runtime: RuntimeAdapterName;
  readonly authMode: ProviderAuthMode;
  readonly baseUrl?: string;
  readonly capabilities: ProviderCapabilitiesConfig;
  readonly pricing: ProviderPricingConfig;
  readonly models: readonly RuntimeModel[];
}

export interface ProvidersConfigV4 {
  readonly version: typeof CONFIG_CENTER_SCHEMA_VERSION;
  readonly featureFlags: Readonly<Record<string, FeatureFlagConfig>>;
  readonly providers: readonly ProviderConfig[];
}

export interface AccountQuotaConfig {
  readonly rpm?: number;
  readonly tpm?: number;
  readonly dailyCny?: number;
}

export interface AccountConfig {
  readonly id: string;
  readonly providerId: string;
  readonly enabled: boolean;
  readonly credentialRef: string;
  readonly quota?: AccountQuotaConfig;
}

export interface AccountsConfigV4 {
  readonly version: typeof CONFIG_CENTER_SCHEMA_VERSION;
  readonly accounts: readonly AccountConfig[];
}

export interface RouteTargetConfig {
  readonly providerId: string;
  readonly model: RuntimeModel;
  readonly runtime?: RuntimeAdapterName;
}

export interface RouteConfig extends RouteTargetConfig {
  readonly reason?: string;
  readonly fallbackChain: readonly RouteTargetConfig[];
}

export interface DefaultsRoutingConfig {
  readonly defaultRoute: RouteConfig;
}

export interface ProviderConstraintConfig {
  readonly id: string;
  readonly dataClassification?: string;
  readonly mustUseProviders: readonly string[];
  readonly deniedProviders: readonly string[];
  readonly route?: RouteConfig;
  readonly onUnavailable: ProviderConstraintAction;
}

export interface JiraRouteMatchConfig {
  readonly projectKeys: readonly string[];
  readonly issueTypes: readonly string[];
  readonly labelsAny: readonly string[];
  readonly labelsAll: readonly string[];
  readonly componentsAny: readonly string[];
  readonly priorities: readonly string[];
  readonly riskLevels: readonly string[];
  readonly businessDomains: readonly string[];
  readonly dataClassifications: readonly string[];
  readonly customFields: Readonly<Record<string, string | readonly string[]>>;
}

export interface JiraModelRouteConfig {
  readonly id: string;
  readonly match: JiraRouteMatchConfig;
  readonly route: RouteConfig;
  readonly reason: string;
}

export interface ProfileRouteConfig {
  readonly id: string;
  readonly profiles: readonly string[];
  readonly businessDomains: readonly string[];
  readonly route: RouteConfig;
  readonly reason: string;
}

export interface TaskRouteConfig {
  readonly id: string;
  readonly taskTypes: readonly string[];
  readonly route: RouteConfig;
  readonly reason: string;
}

export type RoutePrecedenceItem =
  | 'provider_constraints'
  | 'data_classification'
  | 'jira_model_routes'
  | 'profile_routes'
  | 'task_routes'
  | 'default_route';

export interface RoutingConfigV4 {
  readonly version: typeof CONFIG_CENTER_SCHEMA_VERSION;
  readonly defaults: DefaultsRoutingConfig;
  readonly providerConstraints: readonly ProviderConstraintConfig[];
  readonly jiraModelRoutes: readonly JiraModelRouteConfig[];
  readonly profileRoutes: readonly ProfileRouteConfig[];
  readonly taskRoutes: readonly TaskRouteConfig[];
  readonly routePrecedence: readonly RoutePrecedenceItem[];
  readonly totalBudgetMs?: number;
}

export interface ConfigSnapshot {
  readonly version: string;
  readonly loadedAt: string;
  readonly providers: ProvidersConfigV4;
  readonly accounts: AccountsConfigV4;
  readonly routing: RoutingConfigV4;
  readonly modelCatalog: ModelCatalog;
}

export interface ConfigBundleRaw {
  readonly providersYaml: string;
  readonly accountsYaml: string;
  readonly routingYaml: string;
  readonly version?: string;
  readonly loadedAt?: string;
}

export interface ConfigValidationIssue {
  readonly file: 'providers.yaml' | 'accounts.yaml' | 'routing.yaml' | 'bundle';
  readonly path: string;
  readonly message: string;
}

export interface ConfigUpdateResult {
  readonly status: 'applied' | 'rejected';
  readonly snapshot: ConfigSnapshot;
  readonly previousSnapshot?: ConfigSnapshot;
  readonly issues: readonly ConfigValidationIssue[];
}

export function toModelRef(target: RouteTargetConfig, provider: ProviderConfig): ModelRef {
  return {
    providerId: target.providerId,
    model: target.model,
    runtime: target.runtime ?? provider.runtime
  };
}
