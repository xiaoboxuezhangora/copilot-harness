import { describe, expect, it } from 'vitest';

import { CredentialResolver, CredentialResolverError } from './index.js';

describe('CredentialResolver', () => {
  it('resolves fake vault and kms secrets while public output stays redacted', async () => {
    const resolver = new CredentialResolver({
      fakeSecrets: {
        'vault://copilot-harness/deepseek/main': 'fake-deepseek-secret',
        'kms://copilot-harness/neusoft/main': 'fake-neusoft-secret'
      },
      now: () => new Date('2026-05-26T00:00:00.000Z')
    });

    const vaultCredential = await resolver.resolve('vault://copilot-harness/deepseek/main');
    const kmsCredential = await resolver.resolve('kms://copilot-harness/neusoft/main');
    const serialized = JSON.stringify([vaultCredential, kmsCredential]);

    expect(vaultCredential.revealSecretForRuntime()).toBe('fake-deepseek-secret');
    expect(kmsCredential.revealSecretForRuntime()).toBe('fake-neusoft-secret');
    expect(serialized).not.toContain('fake-deepseek-secret');
    expect(serialized).not.toContain('vault://copilot-harness/deepseek/main');
    expect(serialized).toContain('redacted:');
  });

  it('rejects unsupported refs and redacts error messages', async () => {
    const resolver = new CredentialResolver({
      fakeSecrets: {
        'https://example.invalid/token': 'plain-secret'
      }
    });

    await expect(resolver.resolve('https://example.invalid/token')).rejects.toBeInstanceOf(
      CredentialResolverError
    );
    await expect(resolver.resolve('https://example.invalid/token')).rejects.not.toThrow(
      'https://example.invalid/token'
    );
  });
});
