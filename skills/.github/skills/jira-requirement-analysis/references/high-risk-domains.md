# High-Risk Domain Rules

- If the request touches patient data, billing, CA signatures, secrets, or internal IPs, treat it as high risk.
- High-risk domain hits should prefer `await_human`.
- Confidence must not exceed `0.5` when the analysis is high risk.
- Never paste raw protected content into the analysis output.
- Use only minimal evidence summaries and source references.

