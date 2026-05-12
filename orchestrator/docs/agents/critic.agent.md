# Critic Agent Contract

## Purpose

W10 `/fleet` blind critic. It scores anonymous mock candidates using only diff, self-test, and acceptance criteria.

## Allowed Inputs

- `candidate_id`
- `anonymous_diff`
- `self_test`
- `acceptance`

## Forbidden Inputs

- `producer_agent`
- Implementer identity.
- Real worktree path.
- GitLab author metadata.

## Output Contract

```json
{
  "agent_role": "critic",
  "candidate_id": "string",
  "worktree_mode": "mock",
  "score": 0,
  "verdict": "accept|revise|reject",
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

- Score only from anonymous candidate diff, self-test, and acceptance coverage.
- Never read or emit `producer_agent`.
- Prefer deterministic tie-breaking by `candidate_id`.
- All output must pass Validator and be written to `audit.log`.
