# Harvester Eval (20 Samples)

- Mode: live
- Evidence policy: acceptance_candidate
- Acceptance note: live 模式结果可作为验收候选证据，需结合 MR 评审结论。
- Dataset: /Users/wangbo/own/copilot-harness/orchestrator/eval/jira-eval-20.json
- Samples: 20
- Threshold enforced: true
- Threshold passed: false
- Threshold failures: harvestErrorCount expected 0, got 4

## A/B
- A pending_written_total: 0
- B pending_written_total: 10
- Delta pending_written: 10
- B gate_blocked_total: 21
- B redline_blocked_total: 5
- B missing_source_ref_total: 0
- B candidate_total: 36
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
