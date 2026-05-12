# W8 Eval Report

- status: NOT_READY
- generated_at: 2026-05-09T09:06:36.594Z
- dataset_source: eval/w8-jira-gitlab-eval-current.json
- acceptance_profile: w8-current-jira-limited-closure
- temporary_profile: true
- profile_reason: 当前 Jira 条件仅返回 15 条，先以 12 条已确认 Jira+GitLab 联合样本作为 W8 阶段性收尾标准；后续阶段恢复 50/20 最终标准。
- sample_count: 12/12
- real_joint_sample_count: 12/12
- repo_hit_at_1: 100.00% (12/12)
- plan_executability_average: 2
- correction_rate: 0.00% (0/12)
- source_ref_coverage: 100.00% (12/12)
- accept_rate: 100.00% (12/12)
- review_time_minutes: not_available (target <= 10)
- final_target: 50 samples / 20 real joint samples

## Environment

- gitlab_config_present: false
- jira_config_present: false

## Not Ready Reasons

- Read-only GitLab environment is not configured in env.
- Read-only Jira environment is not configured in env.

## Failure Samples

- none

## Joint Sample Source Ref Proof

- w8-current-01-APMIS-1988: jira:APMIS-1988; gitlab:apmis/odcbs/odcbs-frontend#file:README.md@66f9b209c391201aa6b6740e6af06d4493c1b8fb#L1-L3
- w8-current-02-APMIS-2061: jira:APMIS-2061; gitlab:apmis/odcbs/odcbs-frontend#file:README.md@66f9b209c391201aa6b6740e6af06d4493c1b8fb#L1-L3
- w8-current-03-APMIS-2062: jira:APMIS-2062; gitlab:apmis/odcbs/odcbs-frontend#file:README.md@66f9b209c391201aa6b6740e6af06d4493c1b8fb#L1-L3
- w8-current-04-APMIS-2028: jira:APMIS-2028; gitlab:apmis/odcbs/odcbs-frontend#file:README.md@66f9b209c391201aa6b6740e6af06d4493c1b8fb#L1-L3
- w8-current-05-APMIS-2027: jira:APMIS-2027; gitlab:apmis/odcbs/odcbs-frontend#file:README.md@66f9b209c391201aa6b6740e6af06d4493c1b8fb#L1-L3
- w8-current-06-APMIS-2026: jira:APMIS-2026; gitlab:apmis/odcbs/odcbs-frontend#file:README.md@66f9b209c391201aa6b6740e6af06d4493c1b8fb#L1-L3
- w8-current-07-APMIS-2213: jira:APMIS-2213; gitlab:apmis/odcbs/odcbs-frontend#file:README.md@66f9b209c391201aa6b6740e6af06d4493c1b8fb#L1-L3
- w8-current-08-APMIS-2090: jira:APMIS-2090; gitlab:apmis/odcbs/odcbs-frontend#file:README.md@ada64a338c141cfa9d082b35e66bc66230908576#L1-L3
- w8-current-09-APMIS-2045: jira:APMIS-2045; gitlab:apmis/odcbs/odcbs-frontend#file:README.md@ada64a338c141cfa9d082b35e66bc66230908576#L1-L3
- w8-current-10-APMIS-1955: jira:APMIS-1955; gitlab:apmis/odcbs/odcbs-frontend#file:README.md@ada64a338c141cfa9d082b35e66bc66230908576#L1-L3
- w8-current-11-APMIS-73: jira:APMIS-73; gitlab:apmis/odcbs/odcbs-frontend#mr:1737; gitlab:apmis/odcbs/odcbs-frontend#mr:1717; gitlab:apmis/odcbs/odcbs-frontend#file:README.md@ada64a338c141cfa9d082b35e66bc66230908576#L1-L3
- w8-current-12-APMIS-1004: jira:APMIS-1004; gitlab:apmis/odcbs/odcbs-frontend#file:README.md@ada64a338c141cfa9d082b35e66bc66230908576#L1-L3

## W9 Regression Checklist

- Raise W8 acceptance profile back to 50 samples and 20 real joint samples.
- Run Code Retrieval MCP against the read-only GitLab environment and attach evidence refs to each joint sample.
- Run one Review CLI approval pass for the final 50-sample target and record accept_rate plus review_time_minutes.
- Re-run eval:w8 and inspect coverage_gap_samples before W9 regression.
