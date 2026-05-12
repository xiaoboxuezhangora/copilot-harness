import type { ShowcaseSnapshotV1 } from '../types';

export function buildExportCommand(snapshot: ShowcaseSnapshotV1): string {
  const date = resolveSnapshotDate(snapshot);
  if (date === null) {
    return 'bash scripts/oc-showcase-export.sh';
  }
  return `bash scripts/oc-showcase-export.sh --date ${date}`;
}

export function resolveSnapshotDate(snapshot: ShowcaseSnapshotV1): string | null {
  const metadataDate = snapshot.metadata.snapshotDate;
  if (isValidDate(metadataDate)) return metadataDate;
  const metadataSnakeDate = snapshot.metadata.snapshot_date;
  if (isValidDate(metadataSnakeDate)) return metadataSnakeDate;

  const generatedAt = snapshot.metadata.generatedAt;
  if (typeof generatedAt !== 'string') return null;
  const match = generatedAt.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match === null) return null;
  return isValidDate(match[1]) ? match[1] : null;
}

function isValidDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}
