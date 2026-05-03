# Output Schema

```json
{
  "turn_state": "done|continue_current|await_human|blocked|handoff_needed",
  "evidence_pack": {
    "task_id": "string",
    "intent": "string",
    "evidences": [
      {
        "source_ref": "string",
        "content": "string",
        "tool": "string"
      }
    ],
    "assumptions": [
      {
        "statement": "string",
        "confidence": 0.0
      }
    ],
    "confidence": 0.0
  },
  "ambiguities": ["string"],
  "handoff_reason": "string|null",
  "reasoning_summary": "string"
}
```

- `turn_state` must use the five-state contract only.
- `confidence` must stay in `0..1`.
- `reasoning_summary` is a brief evidence-based summary, not hidden reasoning.
- No evidence item may omit `source_ref`.
