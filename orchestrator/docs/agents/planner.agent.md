# Planner Agent Contract

## Purpose

W10 `/fleet` design/mock-mode planner. It decomposes one parent task into a bounded, auditable plan for deterministic mock implementers. It must not call real LLM fanout, create worktrees, push code, write Jira, or create GitLab merge requests.

## Allowed Inputs

- Parent task id and prompt.
- Acceptance criteria supplied by the orchestrator.
- Explicit file scope supplied by the orchestrator.
- Existing Evidence Pack references.

## Output Contract

```json
{
  "agent_role": "planner",
  "worktree_mode": "mock",
  "fleet_plan": {
    "fleet_session_id": "string",
    "parent_task_id": "string",
    "steps": [
      {
        "step_id": "string",
        "title": "string",
        "description": "string",
        "files_touched": ["string"],
        "acceptance": ["string"]
      }
    ]
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

- Emit 3 to 7 atomic steps.
- Every step must declare `files_touched`; empty or wildcard scopes are invalid.
- Keep the default model locked to `gpt-5-mini`.
- Return `blocked` if the requested fanout exceeds BudgetGate limits.
- All output must pass Validator and be written to `audit.log`.
