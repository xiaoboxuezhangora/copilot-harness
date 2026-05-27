import { createHash } from 'node:crypto';

export type CredentialRefScheme = 'vault' | 'kms';

export interface CredentialResolverOptions {
  readonly fakeSecrets?: Readonly<Record<string, string>>;
  readonly now?: () => Date;
}

export interface CredentialPublicView {
  readonly credentialRef: string;
  readonly credentialRefScheme: CredentialRefScheme;
  readonly redactedSecret: string;
  readonly resolvedAt: string;
}

export class CredentialResolverError extends Error {
  readonly redactedRef: string;

  constructor(message: string, credentialRef: string) {
    super(`${message}: ${redactCredentialValue(credentialRef)}`);
    this.name = 'CredentialResolverError';
    this.redactedRef = redactCredentialValue(credentialRef);
  }
}

export class ResolvedCredential {
  readonly credentialRef: string;
  readonly credentialRefScheme: CredentialRefScheme;
  readonly redactedSecret: string;
  readonly resolvedAt: string;
  #secret: string;

  constructor(input: {
    readonly credentialRef: string;
    readonly credentialRefScheme: CredentialRefScheme;
    readonly secret: string;
    readonly resolvedAt: string;
  }) {
    this.credentialRef = redactCredentialValue(input.credentialRef);
    this.credentialRefScheme = input.credentialRefScheme;
    this.redactedSecret = redactCredentialValue(input.secret);
    this.resolvedAt = input.resolvedAt;
    this.#secret = input.secret;
  }

  revealSecretForRuntime(): string {
    return this.#secret;
  }

  toJSON(): CredentialPublicView {
    return {
      credentialRef: this.credentialRef,
      credentialRefScheme: this.credentialRefScheme,
      redactedSecret: this.redactedSecret,
      resolvedAt: this.resolvedAt
    };
  }
}

export class CredentialResolver {
  private readonly fakeSecrets: Readonly<Record<string, string>>;
  private readonly now: () => Date;

  constructor(options: CredentialResolverOptions = {}) {
    this.fakeSecrets = options.fakeSecrets ?? {};
    this.now = options.now ?? (() => new Date());
  }

  async resolve(credentialRef: string): Promise<ResolvedCredential> {
    const scheme = parseCredentialRefScheme(credentialRef);
    const secret = this.fakeSecrets[credentialRef];
    if (secret === undefined) {
      throw new CredentialResolverError('CredentialResolver stub has no fake secret', credentialRef);
    }
    return new ResolvedCredential({
      credentialRef,
      credentialRefScheme: scheme,
      secret,
      resolvedAt: this.now().toISOString()
    });
  }
}

export function parseCredentialRefScheme(credentialRef: string): CredentialRefScheme {
  if (credentialRef.startsWith('vault://')) return 'vault';
  if (credentialRef.startsWith('kms://')) return 'kms';
  throw new CredentialResolverError('Unsupported credential ref scheme', credentialRef);
}

export function redactCredentialValue(value: string): string {
  return `redacted:${createHash('sha256').update(value).digest('hex').slice(0, 8)}`;
}
