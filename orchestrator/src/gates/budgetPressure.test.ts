import { describe, expect, it } from 'vitest';

import { buildBudgetPressureReport, calculateP95, suggestThresholds } from './budgetPressure.js';

describe('budget pressure harness', () => {
  it('uses nearest-rank P95 and 20 percent suggested thresholds', () => {
    expect(calculateP95([1, 2, 3, 4, 100])).toBe(100);
    expect(
      suggestThresholds({
        fanout: 5,
        toolCalls: 12,
        inputTokens: 11_900,
        outputTokens: 2_720,
        premiumRequests: 1
      })
    ).toEqual({
      maxFanout: 6,
      maxToolCalls: 15,
      maxInputTokens: 14_280,
      maxOutputTokens: 3_264,
      maxPremiumRequests: 2
    });
  });

  it('generates deterministic 5/5 forced overrun partial results', () => {
    const report = buildBudgetPressureReport('2026-05-11T00:00:00.000Z');

    expect(report.status).toBe('pass');
    expect(report.forced_overrun.passed).toBe(5);
    expect(report.forced_overrun.total).toBe(5);
    expect(report.forced_overrun.cases.map((sample) => sample.exceeded_budget)).toEqual([
      'maxFanout',
      'maxToolCalls',
      'maxInputTokens',
      'maxOutputTokens',
      'maxPremiumRequests'
    ]);
    expect(
      report.forced_overrun.cases.every(
        (sample) =>
          sample.partial_result?.turn_state === 'blocked' &&
          sample.partial_result.policy_decision === 'deny' &&
          sample.partial_result.audit_trace_id === sample.audit_trace_id
      )
    ).toBe(true);
  });
});
