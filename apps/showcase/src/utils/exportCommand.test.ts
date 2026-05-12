import { describe, expect, it } from 'vitest';

import { buildExportCommand, resolveSnapshotDate } from './exportCommand';
import type { ShowcaseSnapshotV1 } from '../types';

function createSnapshot(metadataOverride: Partial<ShowcaseSnapshotV1['metadata']> = {}): ShowcaseSnapshotV1 {
  return {
    schemaVersion: 'ShowcaseSnapshotV1',
    metadata: {
      generatedAt: '2026-05-04T00:00:00.000Z',
      sourceFiles: [],
      sampleCount: 1,
      phase0Readiness: 'NOT_READY',
      warnings: [],
      ...metadataOverride
    },
    fieldPresence: {},
    tasks: [],
    mcpCalls: [],
    evidencePacks: [],
    routeChains: []
  };
}

describe('export command from snapshot', () => {
  it('uses metadata snapshot_date when provided', () => {
    const snapshot = createSnapshot({ snapshot_date: '2026-05-03' });
    expect(resolveSnapshotDate(snapshot)).toBe('2026-05-03');
    expect(buildExportCommand(snapshot)).toBe('bash scripts/oc-showcase-export.sh --date 2026-05-03');
  });

  it('uses metadata snapshotDate when provided', () => {
    const snapshot = createSnapshot({ snapshotDate: '2026-05-04' });
    expect(resolveSnapshotDate(snapshot)).toBe('2026-05-04');
    expect(buildExportCommand(snapshot)).toBe('bash scripts/oc-showcase-export.sh --date 2026-05-04');
  });

  it('falls back to generatedAt date', () => {
    const snapshot = createSnapshot({ generatedAt: '2026-05-02T14:20:00.000Z' });
    expect(resolveSnapshotDate(snapshot)).toBe('2026-05-02');
    expect(buildExportCommand(snapshot)).toBe('bash scripts/oc-showcase-export.sh --date 2026-05-02');
  });

  it('falls back to default command when no valid date', () => {
    const snapshot = createSnapshot({ generatedAt: 'invalid-date', snapshot_date: 'bad' });
    expect(resolveSnapshotDate(snapshot)).toBeNull();
    expect(buildExportCommand(snapshot)).toBe('bash scripts/oc-showcase-export.sh');
  });
});
