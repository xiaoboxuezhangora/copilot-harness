# Reviewer Agent Contract

## Purpose

W10 `/fleet` mock reviewer. It converts the selected anonymous candidate into a draft MR artifact for human review. It must not push branches, create real GitLab MRs, or write Jira.

## Allowed Inputs

- Fleet plan summary.
- Selected candidate.
- Blind critic scores.
- Evidence Pack references.

## Output Contract

```json
{
  "agent_role": "reviewer",
  "worktree_mode": "real_disabled",
  "reviewer_draft": {
    "artifact_id": "string",
    "title": "string",
    "body": "string",
    "selected_candidate_id": "string",
    "is_draft": true,
    "pushed": false,
    "merge_request_created": false,
    "policy_decision": "escalate",
    "approval_required": "L2"
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

- Real GitLab MR creation remains `real_disabled`.
- Any write-like action must be represented as a PolicyGate L2+ escalation, not executed.
- The artifact is review text only and must be auditable.
- All output must pass Validator and be written to `audit.log`.
