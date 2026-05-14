# W10 Fleet Smoke Report

- Schema: `phase-2-w10-fleet-smoke@1`
- Generated: 2026-05-14T09:30:22.541Z
- Status: PASS
- Mode: mock
- Real /fleet: real_disabled
- Real GitLab MR: real_disabled
- Fleet session: fleet-w10-fleet-smoke
- Candidates: 3
- Critic scores: 3
- Selected candidate: candidate-1

## Evidence Files

- Audit log: `/Users/wangbo/own/copilot-harness/reports/audit.log`
- Task state: `/Users/wangbo/own/copilot-harness/state/tasks/w10/w10-fleet-smoke.json`
- Snapshot: `/Users/wangbo/own/copilot-harness/reports/showcase/2026-05-14/snapshot.json`
- Showcase mirror: `/Users/wangbo/own/copilot-harness/apps/showcase/src/generated/snapshot.json`

## Checks

| Check | Result | Detail |
| --- | --- | --- |
| fleet session completed | pass | turn_state=done |
| real fanout disabled | pass | real_fanout=real_disabled |
| real merge request disabled | pass | real_merge_request=real_disabled |
| candidate count is three | pass | candidate_count=3 |
| critic score count is three | pass | critic_score_count=3 |
| reviewer selected a candidate | pass | selected_candidate_id=candidate-1 |
| reviewer draft has no real write | pass | pushed=false; merge_request_created=false; worktree_mode=real_disabled |
| audit contains all fleet roles | pass | audited_roles=critic,implementer,planner,reviewer |
