# W9 BudgetGate Pressure Report

- status: pass
- generated_at: 2026-05-11T13:06:22.674Z
- harness: deterministic_mock
- model: gpt-5-mini
- p95_method: nearest_rank
- forced_overrun: 5/5

## P95 Usage

- fanout: 5
- tool_calls: 12
- input_tokens: 11900
- output_tokens: 2720
- premium_requests: 1

## Suggested Thresholds

- maxFanout: 6
- maxToolCalls: 15
- maxInputTokens: 14280
- maxOutputTokens: 3264
- maxPremiumRequests: 2

## Forced Overrun Evidence

- w9-forced-maxFanout: decision=deny, exceeded_budget=maxFanout, turn_state=blocked, policy_decision=deny
- w9-forced-maxToolCalls: decision=deny, exceeded_budget=maxToolCalls, turn_state=blocked, policy_decision=deny
- w9-forced-maxInputTokens: decision=deny, exceeded_budget=maxInputTokens, turn_state=blocked, policy_decision=deny
- w9-forced-maxOutputTokens: decision=deny, exceeded_budget=maxOutputTokens, turn_state=blocked, policy_decision=deny
- w9-forced-maxPremiumRequests: decision=deny, exceeded_budget=maxPremiumRequests, turn_state=blocked, policy_decision=deny

## Conclusion

BudgetGate forced overrun conversion passed 5/5 in deterministic harness.
