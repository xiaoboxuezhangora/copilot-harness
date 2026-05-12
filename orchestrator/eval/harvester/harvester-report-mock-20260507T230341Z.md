# Harvester Eval (20 Samples)

- Mode: mock
- Evidence policy: regression_only
- Acceptance note: mock 模式仅用于离线回归，不可作为最终验收证据。
- Dataset: /Users/wangbo/own/copilot-harness/orchestrator/eval/jira-eval-20.json
- Samples: 20
- Threshold enforced: true
- Threshold passed: true
- Threshold failures: none

## A/B
- A pending_written_total: 0
- B pending_written_total: 7
- Delta pending_written: 7
- B gate_blocked_total: 28
- B redline_blocked_total: 5
- B missing_source_ref_total: 0
- B candidate_total: 40
- B pending_files: 7

## Evidence
- Baseline audit: /Users/wangbo/own/copilot-harness/reports/automemory-a-baseline.audit.log
- Candidate audit: /Users/wangbo/own/copilot-harness/reports/automemory-b-harvester.audit.log
- Baseline pending dir: /Users/wangbo/own/copilot-harness/.memory/pending/a-baseline
- Candidate pending dir: /Users/wangbo/own/copilot-harness/.memory/pending/b-harvester

## Live Mode Execution
- Command: `pnpm --filter @copilot-harness/orchestrator eval:harvester -- --mode=live`
- Storage: `orchestrator/eval/harvester/harvester-report-live-latest.{json,md}` + timestamped snapshots
- Rule: mock reports are regression-only and cannot be used as final acceptance evidence.
