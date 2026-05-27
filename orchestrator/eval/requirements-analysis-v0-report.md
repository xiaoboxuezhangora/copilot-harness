# Requirements Analysis Eval v0 Report

- schemaVersion: `requirements-analysis-eval-v0-report@1`
- generatedAt: `2026-05-20T06:42:24.410Z`
- status: `NOT_READY`

## Dataset

- sampleCount: 17
- requiredSampleCount: 50
- realReviewedSampleCount: 0
- missingReviewMetadataCount: 0

## Not Ready Reasons

- sampleCount=17 < requiredSampleCount=50
- realReviewedSampleCount=0 < requiredSampleCount=50

## Metrics

| Metric | Value |
| --- | ---: |
| routerTop1Accuracy | 1 |
| investigationGateAccuracy | 1 |
| implementationGateAccuracy | 1 |
| sourceRefCoverage | 1 |
| profileFieldCompletenessAverage | 0.221 |
| redRecall | 1 |
| yellowFalsePositiveRate | 0 |
| unsupportedProfileSampleCount | 1 |

## Failures

- [keyGaps] jira-filter-86004-apmis-2234 (APMIS-2234): 关键缺口字段未覆盖。
  - missingGaps: acceptanceAssertions
- [keyGaps] jira-filter-86004-apmis-2213 (APMIS-2213): 关键缺口字段未覆盖。
  - missingGaps: exceptionPaths
- [keyGaps] jira-filter-86004-apmis-2096 (APMIS-2096): 关键缺口字段未覆盖。
  - missingGaps: auditTrail
- [keyGaps] jira-filter-86004-apmis-2088 (APMIS-2088): 关键缺口字段未覆盖。
  - missingGaps: acceptanceAssertions
- [keyGaps] jira-filter-86004-apmis-2026 (APMIS-2026): 关键缺口字段未覆盖。
  - missingGaps: acceptanceAssertions
- [keyGaps] jira-filter-86004-apmis-1988 (APMIS-1988): 关键缺口字段未覆盖。
  - missingGaps: acceptanceAssertions
- [keyGaps] jira-filter-86004-apmis-1004 (APMIS-1004): 关键缺口字段未覆盖。
  - missingGaps: businessRules, exceptionPaths, auditTrail

## Samples

| sampleId | issueKey | routerTop1Pass | investigationGatePass | implementationGatePass | keyGapsPass | sourceRefCoveragePass | profileFieldCompleteness |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| jira-filter-86004-apmis-2271 | APMIS-2271 | true | true | true | true | true | 0 |
| jira-filter-86004-apmis-2270 | APMIS-2270 | true | true | true | true | true | 0.2857 |
| jira-filter-86004-apmis-2250 | APMIS-2250 | true | true | true | true | true | 0.25 |
| jira-filter-86004-apmis-2234 | APMIS-2234 | true | true | true | false | true | 0.7143 |
| jira-filter-86004-apmis-2213 | APMIS-2213 | true | true | true | false | true | 0 |
| jira-filter-86004-apmis-2096 | APMIS-2096 | true | true | true | false | true | 0 |
| jira-filter-86004-apmis-2090 | APMIS-2090 | true | true | true | true | true | n/a |
| jira-filter-86004-apmis-2088 | APMIS-2088 | true | true | true | false | true | 0.4286 |
| jira-filter-86004-apmis-2062 | APMIS-2062 | true | true | true | true | true | 0.1429 |
| jira-filter-86004-apmis-2061 | APMIS-2061 | true | true | true | true | true | 0.1429 |
| jira-filter-86004-apmis-2045 | APMIS-2045 | true | true | true | true | true | 0.2857 |
| jira-filter-86004-apmis-2028 | APMIS-2028 | true | true | true | true | true | 0.2857 |
| jira-filter-86004-apmis-2027 | APMIS-2027 | true | true | true | true | true | 0 |
| jira-filter-86004-apmis-2026 | APMIS-2026 | true | true | true | false | true | 0.4286 |
| jira-filter-86004-apmis-1988 | APMIS-1988 | true | true | true | false | true | 0.5714 |
| jira-filter-86004-apmis-1955 | APMIS-1955 | true | true | true | true | true | 0 |
| jira-filter-86004-apmis-1004 | APMIS-1004 | true | true | true | false | true | 0 |

