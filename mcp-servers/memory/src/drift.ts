import type { MemoryPortableRecordV1 } from "./types.js";

export type DriftType =
  | "missing_in_legacy"
  | "missing_in_mcp"
  | "field_mismatch";
export type DriftComparableField =
  | "kind"
  | "key"
  | "value"
  | "source_ref"
  | "producer_agent"
  | "confidence"
  | "ts";

export interface DriftFinding {
  readonly type: DriftType;
  readonly key: string;
  readonly kind: MemoryPortableRecordV1["kind"];
  readonly mismatch_fields?: readonly DriftComparableField[] | undefined;
}

export interface DriftReport {
  readonly total_legacy: number;
  readonly total_mcp: number;
  readonly drift_count: number;
  readonly findings: readonly DriftFinding[];
}

export interface DriftDetectionInput {
  readonly legacy_records: readonly MemoryPortableRecordV1[];
  readonly mcp_records: readonly MemoryPortableRecordV1[];
}

export function detectPortableMemoryDrift(
  input: DriftDetectionInput,
): DriftReport {
  const legacyByIdentity = new Map<string, MemoryPortableRecordV1>();
  const mcpByIdentity = new Map<string, MemoryPortableRecordV1>();

  for (const record of input.legacy_records) {
    legacyByIdentity.set(identity(record), record);
  }
  for (const record of input.mcp_records) {
    mcpByIdentity.set(identity(record), record);
  }

  const identities = new Set([
    ...legacyByIdentity.keys(),
    ...mcpByIdentity.keys(),
  ]);
  const findings: DriftFinding[] = [];

  for (const id of identities) {
    const legacy = legacyByIdentity.get(id);
    const mcp = mcpByIdentity.get(id);
    if (legacy === undefined && mcp !== undefined) {
      findings.push({
        type: "missing_in_legacy",
        key: mcp.key,
        kind: mcp.kind,
      });
      continue;
    }
    if (legacy !== undefined && mcp === undefined) {
      findings.push({
        type: "missing_in_mcp",
        key: legacy.key,
        kind: legacy.kind,
      });
      continue;
    }
    if (legacy !== undefined && mcp !== undefined) {
      const mismatchFields = diffFields(legacy, mcp);
      if (mismatchFields.length > 0) {
        findings.push({
          type: "field_mismatch",
          key: legacy.key,
          kind: legacy.kind,
          mismatch_fields: mismatchFields,
        });
      }
    }
  }

  return {
    total_legacy: input.legacy_records.length,
    total_mcp: input.mcp_records.length,
    drift_count: findings.length,
    findings,
  };
}

function identity(record: MemoryPortableRecordV1): string {
  return `${record.kind}::${record.key}`;
}

function diffFields(
  legacy: MemoryPortableRecordV1,
  mcp: MemoryPortableRecordV1,
): readonly DriftComparableField[] {
  const mismatches: DriftComparableField[] = [];
  if (legacy.kind !== mcp.kind) {
    mismatches.push("kind");
  }
  if (legacy.key !== mcp.key) {
    mismatches.push("key");
  }
  if (legacy.value !== mcp.value) {
    mismatches.push("value");
  }
  if (legacy.source_ref !== mcp.source_ref) {
    mismatches.push("source_ref");
  }
  if (legacy.producer_agent !== mcp.producer_agent) {
    mismatches.push("producer_agent");
  }
  if (legacy.confidence !== mcp.confidence) {
    mismatches.push("confidence");
  }
  if (legacy.ts !== mcp.ts) {
    mismatches.push("ts");
  }
  return mismatches;
}
