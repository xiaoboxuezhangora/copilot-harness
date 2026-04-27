export type PolicyLevel = 'L1' | 'L2' | 'L3';

export interface GateDecision {
  readonly allowed: boolean;
  readonly reason: string;
}

export interface BudgetGateInput {
  readonly plannedFanout: number;
  readonly maxFanout: number;
}

export interface BudgetGate {
  evaluate(_input: BudgetGateInput): GateDecision;
}

export interface PolicyGateInput {
  readonly operation: string;
  readonly requiredLevel: PolicyLevel;
}

export interface PolicyGate {
  evaluate(_input: PolicyGateInput): GateDecision;
}

export interface ValidatorInput {
  readonly output: string;
  readonly evidencePackId: string;
}

export interface Validator {
  validate(_input: ValidatorInput): GateDecision;
}
