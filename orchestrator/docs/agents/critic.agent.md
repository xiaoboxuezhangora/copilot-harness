# Critic Agent Contract

## Purpose

W12 `/fleet` Arena blind critic. It scores anonymous candidates using only sanitized diff, self-test, acceptance criteria, and the allowed rubric. Mock mode remains the CI baseline; `llm_shadow` may record comparison runs but must not select the winner.

## Allowed Inputs

- `anonymous_diff`
- `self_test`
- `acceptance`
- `rubric`

## Forbidden Inputs

- `producer_agent`
- Implementer identity.
- Real worktree path.
- Worktree id.
- Real file path.
- GitLab author metadata.
- Token, secret, internal IP, CA signature, medical record, or billing content.

## Output Contract

```json
{
  "agent_role": "critic",
  "candidate_id": "string",
  "worktree_mode": "mock",
  "scorer_mode": "mock|llm_shadow|llm_gated",
  "rubric_version": "w12-arena-rubric@1",
  "judge_prompt_version": "w12-blind-critic-json@1",
  "grader_input_hash": "sha256",
  "dimensions": {
    "correctness": 0,
    "style": 0,
    "test_coverage": 0,
    "diff_minimality": 0
  },
  "weights": {
    "correctness": 0.4,
    "test_coverage": 0.25,
    "diff_minimality": 0.2,
    "style": 0.15
  },
  "overall_score": 0,
  "verdict": "accept|revise|reject",
  "hard_gate_passed": true,
  "hard_gate_findings": [],
  "sanitization_report": {
    "identity_leak_detected": false,
    "sensitive_leak_detected": false,
    "path_leak_detected": false,
    "redaction_count": 0,
    "blocked_terms": []
  },
  "strengths": ["string"],
  "risks": ["string"],
  "evidence_pack": {
    "task_id": "string",
    "intent": "string",
    "evidences": [
      {
        "source_ref": "string",
        "content": "string",
        "tool": "fleet-coordinator"
      }
    ],
    "assumptions": [],
    "confidence": 1.0
  }
}
```

## Rules

- Score only from anonymous candidate diff, self-test, acceptance coverage, and allowed rubric.
- Return strict structured JSON only; free-form prose is invalid.
- Never read or emit `producer_agent`, worktree id/path, real file path, or author metadata.
- Apply hard gates: `schema_invalid`, `self_test_failed`, `scope_violation`, `identity_leak`, `sensitive_leak`.
- Any hard gate finding makes the candidate ineligible for automatic winner selection.
- Same-candidate double-run scoring delta greater than `0.5/5` in any dimension must block automatic winner selection.
- `llm_shadow` must not affect the mock winner; it only records comparison results.
- `llm_gated` requires PolicyGate L2+ and Validator success before any target-system write.
- Prefer deterministic tie-breaking by `candidate_id`.
- All output must pass Validator and be written to `audit.log`.
