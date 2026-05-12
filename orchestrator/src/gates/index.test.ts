import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  BudgetExceededError,
  DefaultBudgetGate,
  DefaultPolicyGate,
  DefaultValidator,
  loadGatesConfig,
  toBudgetExceededAuditRecord,
  toBudgetOverrunPartialResultV1
} from './index.js';
import type { BudgetGateInput, BudgetLimitKey, PolicyGateInput, ValidatorInput } from './index.js';

describe('gates', () => {
  it('loads gates config from yaml', async () => {
    const config = await loadGatesConfig(
      fileURLToPath(new URL('../../gates.yaml', import.meta.url))
    );

    expect(config).toEqual({
      maxFanout: 4,
      maxFleetFanout: 5,
      maxToolCalls: 8,
      maxInputTokens: 10_000,
      maxOutputTokens: 4_000,
      maxPremiumRequests: 1
    });
  });

  it('throws BudgetExceededError when fanout exceeds configured limit', () => {
    const input: BudgetGateInput = {
      taskId: 'task-1',
      traceId: 'trace-1',
      budgetLimit: {
        maxFanout: 1,
        maxToolCalls: 2,
        maxInputTokens: 10,
        maxOutputTokens: 10,
        maxPremiumRequests: 1
      },
      usage: {
        fanout: 2,
        fleetFanout: 3,
        toolCalls: 1,
        inputTokens: 1,
        outputTokens: 1,
        premiumRequests: 0
      },
      fleetFanout: 3
    };

    try {
      new DefaultBudgetGate().evaluate(input);
      expect.fail('Expected BudgetExceededError');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(BudgetExceededError);
      const budgetError = error as BudgetExceededError;
      expect(budgetError.taskId).toBe('task-1');
      expect(budgetError.policyDecision).toBe('deny');
      expect(budgetError.exceededBudget).toBe('maxFanout');
      expect(toBudgetExceededAuditRecord(budgetError, 'trace-1')).toEqual({
        taskId: 'task-1',
        policyDecision: 'deny',
        budgetUsage: input.usage,
        exceededBudget: 'maxFanout',
        fleetFanout: 3,
        recoveryHint:
          'Reduce fanout to one gpt-5-mini turn or wait for ADR-approved fanout enablement.',
        traceId: 'trace-1'
      });
    }
  });

  it('denies W10 fleet fanout above the validation hard cap', () => {
    const input: BudgetGateInput = {
      taskId: 'fleet-overrun',
      traceId: 'trace-fleet-overrun',
      budgetLimit: {
        maxFanout: 4,
        maxFleetFanout: 7,
        maxToolCalls: 8,
        maxInputTokens: 10_000,
        maxOutputTokens: 4_000,
        maxPremiumRequests: 1
      },
      usage: {
        fanout: 1,
        fleetFanout: 6,
        toolCalls: 1,
        inputTokens: 10,
        outputTokens: 10,
        premiumRequests: 0
      },
      fleetFanout: 6
    };

    try {
      new DefaultBudgetGate().evaluate(input);
      expect.fail('Expected BudgetExceededError');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(BudgetExceededError);
      const partial = toBudgetOverrunPartialResultV1(error as BudgetExceededError);

      expect(partial).toMatchObject({
        task_id: 'fleet-overrun',
        turn_state: 'blocked',
        policy_decision: 'deny',
        exceeded_budget: 'maxFleetFanout',
        exceeded_budget_limit: 5,
        exceeded_budget_actual: 6,
        fleet_fanout: 6
      });
      expect(partial.recovery_hint).toContain('/fleet mock fanout');
    }
  });

  it('converts a budget overrun into a blocked partial result', () => {
    const input: BudgetGateInput = {
      taskId: 'task-partial',
      traceId: 'trace-partial',
      budgetLimit: {
        maxFanout: 4,
        maxToolCalls: 8,
        maxInputTokens: 10_000,
        maxOutputTokens: 4_000,
        maxPremiumRequests: 1
      },
      usage: {
        fanout: 4,
        toolCalls: 9,
        inputTokens: 2_000,
        outputTokens: 300,
        premiumRequests: 0
      }
    };

    try {
      new DefaultBudgetGate().evaluate(input);
      expect.fail('Expected BudgetExceededError');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(BudgetExceededError);
      const partial = toBudgetOverrunPartialResultV1(error as BudgetExceededError);

      expect(partial).toMatchObject({
        schema_version: 'phase-1c-w9-budget-overrun-partial-result@1',
        task_id: 'task-partial',
        turn_state: 'blocked',
        policy_decision: 'deny',
        exceeded_budget: 'maxToolCalls',
        exceeded_budget_limit: 8,
        exceeded_budget_actual: 9,
        audit_trace_id: 'trace-partial'
      });
      expect(partial.partial_result.summary).toContain('BudgetGate denied');
      expect(partial.recovery_hint).toContain('partial result');
    }
  });

  it('blocks all forced overrun dimensions with partial result evidence', () => {
    const fleetLimit = 5;
    const baseLimit = {
      maxFanout: 4,
      maxFleetFanout: fleetLimit,
      maxToolCalls: 8,
      maxInputTokens: 10_000,
      maxOutputTokens: 4_000,
      maxPremiumRequests: 1
    };
    const baseUsage = {
      fanout: 1,
      fleetFanout: 1,
      toolCalls: 3,
      inputTokens: 2_000,
      outputTokens: 500,
      premiumRequests: 0
    };
    const forcedOverruns: readonly BudgetLimitKey[] = [
      'maxFleetFanout',
      'maxFanout',
      'maxToolCalls',
      'maxInputTokens',
      'maxOutputTokens',
      'maxPremiumRequests'
    ];

    const passed = forcedOverruns.filter((exceededBudget) => {
      const usage = {
        ...baseUsage,
        ...(exceededBudget === 'maxFleetFanout' ? { fleetFanout: fleetLimit + 1 } : {}),
        ...(exceededBudget === 'maxFanout' ? { fanout: baseLimit.maxFanout + 1 } : {}),
        ...(exceededBudget === 'maxToolCalls' ? { toolCalls: baseLimit.maxToolCalls + 1 } : {}),
        ...(exceededBudget === 'maxInputTokens'
          ? { inputTokens: baseLimit.maxInputTokens + 1 }
          : {}),
        ...(exceededBudget === 'maxOutputTokens'
          ? { outputTokens: baseLimit.maxOutputTokens + 1 }
          : {}),
        ...(exceededBudget === 'maxPremiumRequests'
          ? { premiumRequests: baseLimit.maxPremiumRequests + 1 }
          : {})
      };

      try {
        new DefaultBudgetGate().evaluate({
          taskId: `forced-${exceededBudget}`,
          traceId: `trace-${exceededBudget}`,
          budgetLimit: baseLimit,
          usage,
          ...(exceededBudget === 'maxFleetFanout' ? { fleetFanout: fleetLimit + 1 } : {})
        });
        return false;
      } catch (error: unknown) {
        if (!(error instanceof BudgetExceededError)) return false;
        const partial = toBudgetOverrunPartialResultV1(error);
        return (
          partial.turn_state === 'blocked' &&
          partial.policy_decision === 'deny' &&
          partial.exceeded_budget === exceededBudget &&
          partial.audit_trace_id === `trace-${exceededBudget}` &&
          partial.recovery_hint.length > 0
        );
      }
    });

    expect(passed).toHaveLength(6);
  });

  it('denies undeclared tools and write tools', () => {
    const gate = new DefaultPolicyGate();

    const undeclared: PolicyGateInput = {
      toolName: 'getIssue',
      declaredTools: ['searchIssues']
    };
    const writeTool: PolicyGateInput = {
      toolName: 'updateIssue',
      declaredTools: ['updateIssue'],
      toolDescriptor: {
        name: 'updateIssue',
        level: 'L2',
        risk: 'write'
      },
      policyLevel: 'L2'
    };

    expect(gate.evaluate(undeclared)).toEqual({
      allowed: false,
      decision: 'deny',
      reason: 'Tool getIssue is not declared'
    });
    expect(gate.evaluate(writeTool)).toEqual({
      allowed: false,
      decision: 'escalate',
      reason: 'Tool updateIssue is outside the read-only tool allowlist'
    });
  });

  it('allows code retrieval read-only tools and escalates GitLab write tools', () => {
    const gate = new DefaultPolicyGate();
    const readTool: PolicyGateInput = {
      toolName: 'searchCode',
      declaredTools: ['searchCode'],
      toolDescriptor: {
        name: 'searchCode',
        level: 'L0',
        risk: 'read'
      }
    };
    const writeToolName = ['create', 'Merge', 'Request'].join('');
    const writeTool: PolicyGateInput = {
      toolName: writeToolName,
      declaredTools: [writeToolName],
      toolDescriptor: {
        name: writeToolName,
        level: 'L2',
        risk: 'write'
      },
      policyLevel: 'L2'
    };

    expect(gate.evaluate(readTool)).toEqual({
      allowed: true,
      decision: 'allow',
      reason: 'Tool searchCode allowed'
    });
    expect(gate.evaluate(writeTool)).toEqual({
      allowed: false,
      decision: 'escalate',
      reason: `Tool ${writeToolName} is outside the read-only tool allowlist`
    });
  });

  it('rejects evidence packs without source_ref', () => {
    const validator = new DefaultValidator();
    const input: ValidatorInput = {
      turnState: 'done',
      output: 'final answer',
      evidencePack: {
        taskId: 'task-1',
        intent: 'validate evidence',
        evidences: [
          {
            source_ref: '',
            content: 'derived from memory'
          }
        ],
        assumptions: [
          {
            statement: 'derived from memory',
            confidence: 0.5
          }
        ],
        confidence: 0.5
      }
    };

    const result = validator.validate(input);
    expect(result.allowed).toBe(false);
    expect(result.issues.map((issue) => issue.field)).toContain(
      'evidencePack.evidences.source_ref'
    );
  });

  it('accepts object assumptions with statement and confidence', () => {
    const validator = new DefaultValidator();
    const input: ValidatorInput = {
      turnState: 'done',
      output: 'final answer',
      evidencePack: {
        taskId: 'task-2',
        intent: 'validate assumption contract',
        evidences: [
          {
            source_ref: 'jira://TASK-2',
            content: 'Source-backed fact'
          }
        ],
        assumptions: [
          {
            statement: 'The affected module name is inferred from the label',
            confidence: 0.4
          }
        ],
        confidence: 0.7
      }
    };

    const result = validator.validate(input);
    expect(result.allowed).toBe(true);
  });

  it('rejects malformed assumption objects without dereferencing them', () => {
    const validator = new DefaultValidator();
    const input = {
      turnState: 'done',
      output: 'final answer',
      evidencePack: {
        taskId: 'task-3',
        intent: 'validate malformed assumption contract',
        evidences: [
          {
            source_ref: 'jira://TASK-3',
            content: 'Source-backed fact'
          }
        ],
        assumptions: ['legacy string assumption'],
        confidence: 0.7
      }
    } as unknown as ValidatorInput;

    const result = validator.validate(input);
    expect(result.allowed).toBe(false);
    expect(result.issues.map((issue) => issue.field)).toContain('evidencePack.assumptions');
  });
});
