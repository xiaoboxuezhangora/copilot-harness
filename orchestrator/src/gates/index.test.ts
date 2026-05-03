import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  BudgetExceededError,
  DefaultBudgetGate,
  DefaultPolicyGate,
  DefaultValidator,
  loadGatesConfig,
  toBudgetExceededAuditRecord
} from './index.js';
import type { BudgetGateInput, PolicyGateInput, ValidatorInput } from './index.js';

describe('gates', () => {
  it('loads gates config from yaml', async () => {
    const config = await loadGatesConfig(
      fileURLToPath(new URL('../../gates.yaml', import.meta.url))
    );

    expect(config).toEqual({
      maxFanout: 4,
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
        toolCalls: 1,
        inputTokens: 1,
        outputTokens: 1,
        premiumRequests: 0
      }
    };

    try {
      new DefaultBudgetGate().evaluate(input);
      expect.fail('Expected BudgetExceededError');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(BudgetExceededError);
      const budgetError = error as BudgetExceededError;
      expect(budgetError.taskId).toBe('task-1');
      expect(budgetError.policyDecision).toBe('deny');
      expect(toBudgetExceededAuditRecord(budgetError, 'trace-1')).toEqual({
        taskId: 'task-1',
        policyDecision: 'deny',
        budgetUsage: input.usage,
        traceId: 'trace-1'
      });
    }
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
      reason: 'Tool updateIssue is outside the Jira Reader read-only whitelist'
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
