import { describe, expect, it } from "vitest";

import { detectPortableMemoryDrift } from "../src/index.js";

describe("portable memory drift detector", () => {
  it("reports no drift when legacy and mcp records are identical", () => {
    const report = detectPortableMemoryDrift({
      legacy_records: [
        {
          kind: "decision",
          key: "w13.same",
          value: "v1",
          source_ref: "manual://same",
          producer_agent: "opencode",
          ts: "2026-05-14T00:00:00.000Z",
          confidence: 0.9,
        },
      ],
      mcp_records: [
        {
          kind: "decision",
          key: "w13.same",
          value: "v1",
          source_ref: "manual://same",
          producer_agent: "opencode",
          ts: "2026-05-14T00:00:00.000Z",
          confidence: 0.9,
        },
      ],
    });

    expect(report.drift_count).toBe(0);
    expect(report.findings).toEqual([]);
  });

  it("reports producer_agent drift", () => {
    const report = detectPortableMemoryDrift({
      legacy_records: [
        {
          kind: "knowledge",
          key: "w13.producer",
          value: "v",
          source_ref: "manual://p",
          producer_agent: "opencode",
          ts: "2026-05-14T00:00:00.000Z",
          confidence: 0.7,
        },
      ],
      mcp_records: [
        {
          kind: "knowledge",
          key: "w13.producer",
          value: "v",
          source_ref: "manual://p",
          producer_agent: "copilot-sdk",
          ts: "2026-05-14T00:00:00.000Z",
          confidence: 0.7,
        },
      ],
    });

    expect(report.drift_count).toBe(1);
    expect(report.findings[0]?.type).toBe("field_mismatch");
    expect(report.findings[0]?.mismatch_fields).toContain("producer_agent");
  });

  it("reports missing record drift", () => {
    const report = detectPortableMemoryDrift({
      legacy_records: [
        {
          kind: "alias",
          key: "w13.alias",
          value: "v",
          source_ref: "manual://a",
          producer_agent: "reviewer",
          ts: "2026-05-14T00:00:00.000Z",
          confidence: 0.7,
        },
      ],
      mcp_records: [],
    });

    expect(report.drift_count).toBe(1);
    expect(report.findings[0]?.type).toBe("missing_in_mcp");
    expect(report.findings[0]?.key).toBe("w13.alias");
  });
});
