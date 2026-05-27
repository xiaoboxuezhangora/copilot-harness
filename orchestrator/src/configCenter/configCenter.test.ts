import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  ConfigCenterValidationError,
  LocalConfigCenterClient,
  parseConfigSnapshot
} from './index.js';

const validFixtureDir = fileURLToPath(
  new URL('../../fixtures/configCenter/valid', import.meta.url)
);
const invalidFixtureDir = fileURLToPath(
  new URL('../../fixtures/configCenter/invalid', import.meta.url)
);

describe('configCenter', () => {
  it('loads an immutable v4 local snapshot and model catalog', async () => {
    const client = new LocalConfigCenterClient({
      now: () => new Date('2026-05-26T00:00:00.000Z')
    });
    const snapshot = await client.loadInitialFromDirectory(validFixtureDir);

    expect(snapshot.providers.version).toBe(4);
    expect(snapshot.routing.defaults.defaultRoute.model).toBe('gpt-5-mini');
    expect(snapshot.modelCatalog.models.some((model) => model.model === 'stub-coder-v1')).toBe(
      true
    );
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.providers.providers)).toBe(true);
  });

  it('rejects invalid config without leaking credential refs', async () => {
    const client = new LocalConfigCenterClient();

    await expect(client.loadInitialFromDirectory(invalidFixtureDir)).rejects.toBeInstanceOf(
      ConfigCenterValidationError
    );
    await expect(client.loadInitialFromDirectory(invalidFixtureDir)).rejects.not.toThrow(
      'vault://copilot-harness/copilot/forbidden'
    );
  });

  it('rolls back invalid local updates to the previous snapshot', async () => {
    const client = new LocalConfigCenterClient();
    const initial = await client.loadInitialFromDirectory(validFixtureDir);
    const result = await client.updateFromDirectory(invalidFixtureDir);

    expect(result.status).toBe('rejected');
    expect(result.snapshot).toBe(initial);
    expect(client.currentSnapshot()).toBe(initial);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it('rejects accounts.yaml entries for copilot user passthrough', () => {
    expect(() =>
      parseConfigSnapshot({
        providersYaml: `
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
`,
        accountsYaml: `
version: 4
accounts:
  - id: copilot_pool
    provider_id: copilot
    enabled: true
    credential_ref: "vault://forbidden/copilot"
`,
        routingYaml: `
version: 4
defaults:
  default_route:
    provider_id: copilot
    model: gpt-5-mini
    runtime: copilot-sdk
    fallback_chain: []
provider_constraints: []
jira_model_routes: []
profile_routes: []
task_routes: []
route_precedence: [provider_constraints, data_classification, jira_model_routes, profile_routes, task_routes, defaults.default_route]
`
      })
    ).toThrow('copilot user_passthrough must not appear in accounts.yaml');
  });

  it('normalizes missing or empty route_precedence to the compatible default order', () => {
    const withoutPrecedence = parseConfigSnapshot({
      providersYaml: minimalProvidersYaml(),
      accountsYaml: 'version: 4\naccounts: []\n',
      routingYaml: minimalRoutingYaml('')
    });
    const emptyPrecedence = parseConfigSnapshot({
      providersYaml: minimalProvidersYaml(),
      accountsYaml: 'version: 4\naccounts: []\n',
      routingYaml: minimalRoutingYaml('route_precedence: []')
    });

    expect(withoutPrecedence.routing.routePrecedence).toEqual([
      'provider_constraints',
      'jira_model_routes',
      'profile_routes',
      'task_routes',
      'default_route'
    ]);
    expect(emptyPrecedence.routing.routePrecedence).toEqual(
      withoutPrecedence.routing.routePrecedence
    );
  });

  it('rejects invalid route_precedence entries before routing applies', () => {
    expect(() =>
      parseConfigSnapshot({
        providersYaml: minimalProvidersYaml(),
        accountsYaml: 'version: 4\naccounts: []\n',
        routingYaml: minimalRoutingYaml(
          'route_precedence: [profile_routes, profile_routes, default_route]'
        )
      })
    ).toThrow('duplicate route precedence item profile_routes');

    expect(() =>
      parseConfigSnapshot({
        providersYaml: minimalProvidersYaml(),
        accountsYaml: 'version: 4\naccounts: []\n',
        routingYaml: minimalRoutingYaml('route_precedence: [jira_model_routes]')
      })
    ).toThrow('route_precedence must include default_route');

    expect(() =>
      parseConfigSnapshot({
        providersYaml: minimalProvidersYaml(),
        accountsYaml: 'version: 4\naccounts: []\n',
        routingYaml: minimalRoutingYaml('route_precedence: [unknown_route, default_route]')
      })
    ).toThrow('unsupported route precedence item');
  });

  it('rejects route and fallback runtime mismatches with provider runtime', () => {
    expect(() =>
      parseConfigSnapshot({
        providersYaml: minimalProvidersYaml(),
        accountsYaml: 'version: 4\naccounts: []\n',
        routingYaml: `
version: 4
defaults:
  default_route:
    provider_id: copilot
    model: gpt-5-mini
    runtime: copilot-cli
    fallback_chain: []
provider_constraints: []
jira_model_routes: []
profile_routes: []
task_routes: []
route_precedence: [default_route]
`
      })
    ).toThrow('route runtime copilot_cli must match provider runtime copilot_sdk');

    expect(() =>
      parseConfigSnapshot({
        providersYaml: minimalProvidersYaml(),
        accountsYaml: 'version: 4\naccounts: []\n',
        routingYaml: `
version: 4
defaults:
  default_route:
    provider_id: copilot
    model: gpt-5-mini
    runtime: copilot-sdk
    fallback_chain:
      - { provider_id: copilot, model: gpt-5-mini, runtime: copilot-cli }
provider_constraints: []
jira_model_routes: []
profile_routes: []
task_routes: []
route_precedence: [default_route]
`
      })
    ).toThrow('route runtime copilot_cli must match provider runtime copilot_sdk');
  });
});

function minimalProvidersYaml(): string {
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
`;
}

function minimalRoutingYaml(routePrecedence: string): string {
  return `
version: 4
defaults:
  default_route:
    provider_id: copilot
    model: gpt-5-mini
    runtime: copilot-sdk
    fallback_chain: []
provider_constraints: []
jira_model_routes: []
profile_routes: []
task_routes: []
${routePrecedence}
`;
}
