# Implementer Agent Contract

## Purpose

W10 `/fleet` deterministic mock implementer. It produces anonymous candidate diffs for a planner step without touching a real worktree or invoking real fanout.

## Allowed Inputs

- One planner step.
- The step-local `files_touched` allowlist.
- Step acceptance criteria.
- Mock implementation strategy selected by `FleetCoordinator`.

## Output Contract

```json
{
  "agent_role": "implementer",
  "candidate_id": "string",
  "worktree_mode": "mock",
  "step_id": "string",
  "files_touched": ["string"],
  "anonymous_diff": "string",
  "self_test": {
    "command": "string",
    "passed": true,
    "summary": "string"
  },
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

- Do not include `producer_agent` in candidate output.
- Do not touch files outside the planner step's `files_touched`.
- If any candidate file is outside the step allowlist, return `blocked` and `policy_decision: deny`.
- Diffs are mock artifacts only; no file system mutation is allowed.
- All output must pass Validator and be written to `audit.log`.
