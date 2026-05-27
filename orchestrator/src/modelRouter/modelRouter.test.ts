import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { LocalConfigCenterClient, parseConfigSnapshot } from '../configCenter/index.js';
import { ModelRouteRejectedError, ModelRouter } from './index.js';

const jiraRoutesFixtureDir = fileURLToPath(
  new URL('../../fixtures/configCenter/jira-routes', import.meta.url)
);

describe('ModelRouter', () => {
  it('prioritizes Jira model routes over task routes', async () => {
    const router = await fixtureRouter();
    const decision = router.route({
      taskType: 'requirements_analysis',
      jira: {
        projectKey: 'APMIS',
        issueType: 'Bug',
        labels: ['sql'],
        components: ['Oracle'],
        priority: 'High',
        riskLevel: 'high'
      },
      estimatedInputTokens: 2000,
      estimatedOutputTokens: 1000
    });

    expect(decision.providerId).toBe('deepseek_contract');
    expect(decision.model).toBe('deepseek-coder-v3');
    expect(decision.matchedRuleId).toBe('jira_apmis_oracle_high_risk');
    expect(decision.routeSource).toBe('jira_model_routes');
    expect(decision.estimatedCostCny).toBe(0.004);
  });

  it('uses route_precedence to change matching order', () => {
    const jiraFirst = new ModelRouter({
      snapshot: parseConfigSnapshot({
        providersYaml: providersYaml(),
        accountsYaml: accountsYaml(),
        routingYaml: overlappingRoutesYaml(
          '[provider_constraints, jira_model_routes, profile_routes, task_routes, default_route]'
        )
      })
    });
    const profileFirst = new ModelRouter({
      snapshot: parseConfigSnapshot({
        providersYaml: providersYaml(),
        accountsYaml: accountsYaml(),
        routingYaml: overlappingRoutesYaml(
          '[provider_constraints, profile_routes, jira_model_routes, task_routes, default_route]'
        )
      })
    });
    const input = {
      profile: 'Billing',
      businessDomain: 'billing',
      jira: {
        projectKey: 'APMIS',
        labels: ['sql']
      }
    };

    expect(jiraFirst.route(input).matchedRuleId).toBe('jira_overlap');
    expect(jiraFirst.route(input).providerId).toBe('deepseek_contract');
    expect(profileFirst.route(input).matchedRuleId).toBe('profile_overlap');
    expect(profileFirst.route(input).providerId).toBe('neusoft_contract');
  });

  it('falls back to the default model when no rule matches', async () => {
    const router = await fixtureRouter();
    const decision = router.route({
      jira: {
        projectKey: 'DOC',
        issueType: 'Task',
        labels: ['docs'],
        priority: 'Low'
      }
    });

    expect(decision.providerId).toBe('copilot');
    expect(decision.model).toBe('gpt-5-mini');
    expect(decision.matchedRuleId).toBe('defaults.default_route');
    expect(decision.auditAttrs['harness.model.is_default']).toBe(true);
  });

  it('selects non-default registered models with route reason and rule id', async () => {
    const router = await fixtureRouter();
    const decision = router.route({
      jira: {
        projectKey: 'OPS',
        issueType: 'Bug',
        labels: ['frontend'],
        priority: 'High'
      }
    });

    expect(decision.providerId).toBe('copilot');
    expect(decision.model).toBe('gpt-4.1');
    expect(decision.matchedRuleId).toBe('jira_ops_frontend_review');
    expect(decision.routeReason).toContain('Copilot');
    expect(decision.fallbackChain).toEqual([
      {
        providerId: 'copilot',
        model: 'gpt-5-mini',
        runtime: 'copilot_sdk'
      }
    ]);
  });

  it('applies provider_constraints before Jira rules', async () => {
    const router = await fixtureRouter();
    const decision = router.route({
      dataClassification: 'medical_sensitive',
      jira: {
        projectKey: 'APMIS',
        issueType: 'Bug',
        labels: ['sql'],
        components: ['Oracle'],
        priority: 'High',
        riskLevel: 'high'
      }
    });

    expect(decision.providerId).toBe('neusoft_contract');
    expect(decision.model).toBe('neu-coder-32b');
    expect(decision.matchedRuleId).toBe('medical_sensitive_neusoft_only');
    expect(decision.routeSource).toBe('provider_constraints');
    expect(decision.auditAttrs['harness.constraint.matched']).toBe(
      'medical_sensitive_neusoft_only'
    );
  });

  it('rejects routes that violate provider_constraints', () => {
    const snapshot = parseConfigSnapshot({
      providersYaml: providersYaml(),
      accountsYaml: accountsYaml(),
      routingYaml: `
version: 4
defaults:
  default_route:
    provider_id: copilot
    model: gpt-5-mini
    runtime: copilot-sdk
    fallback_chain: []
provider_constraints:
  - id: medical_sensitive_neusoft_only
    data_classification: medical_sensitive
    must_use_providers: [neusoft_contract]
    denied_providers: [deepseek_contract]
    on_unavailable: deny
jira_model_routes:
  - id: jira_apmis_oracle_high_risk
    match:
      project_keys: [APMIS]
      labels_any: [sql]
    route:
      provider_id: deepseek_contract
      model: deepseek-coder-v3
      runtime: openai-compatible
      fallback_chain: []
    reason: invalid under medical constraint
profile_routes: []
task_routes: []
route_precedence: [provider_constraints, data_classification, jira_model_routes, profile_routes, task_routes, defaults.default_route]
`
    });
    const router = new ModelRouter({ snapshot });

    expect(() =>
      router.route({
        dataClassification: 'medical_sensitive',
        jira: {
          projectKey: 'APMIS',
          labels: ['sql']
        }
      })
    ).toThrow(ModelRouteRejectedError);
  });

  it('surfaces audit attrs for Jira and model routing', async () => {
    const router = await fixtureRouter();
    const decision = router.route({
      jira: {
        projectKey: 'OPS',
        issueType: 'Bug',
        labels: ['ui'],
        priority: 'High'
      }
    });

    expect(decision.auditAttrs).toMatchObject({
      'harness.routing.rule_id': 'jira_ops_frontend_review',
      'harness.routing.source': 'jira_model_routes',
      'harness.jira.project_key': 'OPS',
      'harness.model.id': 'copilot/gpt-4.1',
      'harness.model.is_default': false,
      'harness.provider.id': 'copilot'
    });
  });
});

async function fixtureRouter(): Promise<ModelRouter> {
  const client = new LocalConfigCenterClient();
  const snapshot = await client.loadInitialFromDirectory(jiraRoutesFixtureDir);
  return new ModelRouter({ snapshot });
}

function providersYaml(): string {
  return `
version: 4
feature_flags: {}
providers:
  - id: copilot
    type: copilot_sdk
    enabled: true
    display_name: Copilot
    runtime: copilot-sdk
    auth_mode: user_passthrough
    capabilities:
      tool_calling: openai_v2
      reasoning_effort: true
      streaming: true
      structured_output: json_schema
      vision: true
    pricing:
      currency: USD
      tiers:
        - { name: standard, input_per_1k: 0, output_per_1k: 0 }
    models: [gpt-5-mini]
  - id: deepseek_contract
    type: openai_compatible
    enabled: true
    display_name: DeepSeek Contract Stub
    runtime: openai-compatible
    base_url: "https://example.invalid/deepseek/v1"
    auth_mode: pool
    capabilities:
      tool_calling: openai_v2
      reasoning_effort: false
      streaming: true
      structured_output: json_schema
      vision: false
    pricing:
      currency: CNY
      tiers:
        - { name: standard, input_per_1k: 0.001, output_per_1k: 0.002 }
    models: [deepseek-coder-v3]
  - id: neusoft_contract
    type: openai_compatible
    enabled: true
    display_name: Neusoft Contract Stub
    runtime: openai-compatible
    base_url: "https://example.invalid/neusoft/v1"
    auth_mode: pool
    capabilities:
      tool_calling: openai_v1
      reasoning_effort: false
      streaming: true
      structured_output: json_mode
      vision: false
    pricing:
      currency: CNY
      tiers:
        - { name: standard, input_per_1k: 0.004, output_per_1k: 0.012 }
    models: [neu-coder-32b]
`;
}

function accountsYaml(): string {
  return `
version: 4
accounts:
  - id: deepseek_contract_main
    provider_id: deepseek_contract
    enabled: true
    credential_ref: "vault://copilot-harness/deepseek-contract/main"
  - id: neusoft_contract_main
    provider_id: neusoft_contract
    enabled: true
    credential_ref: "kms://copilot-harness/neusoft-contract/main"
`;
}

function overlappingRoutesYaml(routePrecedence: string): string {
  return `
version: 4
defaults:
  default_route:
    provider_id: copilot
    model: gpt-5-mini
    runtime: copilot-sdk
    fallback_chain: []
provider_constraints: []
jira_model_routes:
  - id: jira_overlap
    match:
      project_keys: [APMIS]
      labels_any: [sql]
    route:
      provider_id: deepseek_contract
      model: deepseek-coder-v3
      runtime: openai-compatible
      fallback_chain: []
    reason: jira overlap route
profile_routes:
  - id: profile_overlap
    profiles: [Billing]
    business_domains: [billing]
    route:
      provider_id: neusoft_contract
      model: neu-coder-32b
      runtime: openai-compatible
      fallback_chain: []
    reason: profile overlap route
task_routes:
  - id: task_overlap
    task_types: [requirements_analysis]
    route:
      provider_id: copilot
      model: gpt-5-mini
      runtime: copilot-sdk
      fallback_chain: []
    reason: task overlap route
route_precedence: ${routePrecedence}
`;
}
