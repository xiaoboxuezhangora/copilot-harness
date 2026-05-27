import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { ConfigSnapshot, ConfigUpdateResult } from './types.js';
import {
  ConfigCenterValidationError,
  parseConfigSnapshot
} from './validation.js';

export interface LocalConfigCenterClientOptions {
  readonly now?: () => Date;
}

export class LocalConfigCenterClient {
  private snapshot: ConfigSnapshot | undefined;

  constructor(private readonly options: LocalConfigCenterClientOptions = {}) {}

  currentSnapshot(): ConfigSnapshot {
    if (this.snapshot === undefined) {
      throw new Error('ConfigCenter snapshot has not been loaded');
    }
    return this.snapshot;
  }

  async loadInitialFromDirectory(directory: string): Promise<ConfigSnapshot> {
    const snapshot = await this.readSnapshot(directory);
    this.snapshot = snapshot;
    return snapshot;
  }

  async updateFromDirectory(directory: string): Promise<ConfigUpdateResult> {
    const previousSnapshot = this.snapshot;
    try {
      const snapshot = await this.readSnapshot(directory);
      this.snapshot = snapshot;
      return {
        status: 'applied',
        snapshot,
        ...(previousSnapshot !== undefined ? { previousSnapshot } : {}),
        issues: []
      };
    } catch (error: unknown) {
      if (previousSnapshot === undefined) {
        throw error;
      }
      return {
        status: 'rejected',
        snapshot: previousSnapshot,
        previousSnapshot,
        issues: error instanceof ConfigCenterValidationError ? error.issues : []
      };
    }
  }

  async validateDirectory(directory: string): Promise<ConfigSnapshot> {
    return this.readSnapshot(directory);
  }

  private async readSnapshot(directory: string): Promise<ConfigSnapshot> {
    const [providersYaml, accountsYaml, routingYaml] = await Promise.all([
      readFile(join(directory, 'providers.yaml'), 'utf8'),
      readFile(join(directory, 'accounts.yaml'), 'utf8'),
      readFile(join(directory, 'routing.yaml'), 'utf8')
    ]);
    return parseConfigSnapshot({
      providersYaml,
      accountsYaml,
      routingYaml,
      loadedAt: (this.options.now ?? (() => new Date()))().toISOString()
    });
  }
}
