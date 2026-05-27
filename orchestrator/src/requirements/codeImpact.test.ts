import { describe, expect, it } from 'vitest';

import type { JiraEvidencePackV2 } from '../jira/evidence.js';
import type { RequirementGateResultV0 } from './gate.js';
import {
  buildCodeImpactReportV0,
  type BuildCodeImpactReportInputV0,
  type GitLabContextPackV1Like,
  type TargetCodeMapV0,
  type TargetCodeMapTargetV0
} from './codeImpact.js';

describe('code impact gate beta v0', () => {
  it('returns need_more_context with all-gray dimensions when targetCodeMap is missing', () => {
    const evidencePack = buildEvidencePack('OPS-7001');

    const report = buildCodeImpactReportV0({
      evidencePack
    });

    expect(report.status).toBe('need_more_context');
    expect(report.overall.light).toBe('gray');
    expect(report.dimensions.every((dimension) => dimension.light === 'gray')).toBe(true);
    expect(report.dimensions.every((dimension) => dimension.score === null)).toBe(true);
    expect(report.nonBlocking).toBe(true);
  });

  it('returns need_more_context when targets have no traceable sourceRef', () => {
    const evidencePack = buildEvidencePack('OPS-7002');
    const targetCodeMap: TargetCodeMapV0 = {
      schemaVersion: 'TargetCodeMapV0',
      issueKey: evidencePack.issue.key,
      targets: [
        {
          repo: 'ops/app',
          branch: 'main',
          file: 'src/features/export/statusLabel.ts',
          symbol: 'statusLabelMap',
          symbolKind: 'function',
          changeKind: 'modify'
        }
      ],
      sourceRefs: []
    };

    const report = buildCodeImpactReportV0({
      evidencePack,
      targetCodeMap
    });

    expect(report.status).toBe('need_more_context');
    expect(report.targetCodeMapStatus).toBe('no_traceable_target');
    expect(report.overall.light).toBe('gray');
    expect(report.sourceRefs).toEqual([]);
  });

  it('returns need_more_context with gray dimensions when targetCodeMap.issueKey mismatches jira issueKey', () => {
    const evidencePack = buildEvidencePack('OPS-7010');
    const targetRef = 'gitlab:ops/app#file:src/features/localBadge/statusLabel.ts@abc7010#L10-L28';

    const report = buildCodeImpactReportV0({
      evidencePack,
      targetCodeMap: buildTargetCodeMap('OPS-OTHER', [
        {
          repo: 'ops/app',
          branch: 'main',
          file: 'src/features/localBadge/statusLabel.ts',
          symbol: 'statusLabelMap',
          symbolKind: 'function',
          changeKind: 'modify',
          sourceRef: targetRef
        }
      ], [targetRef])
    });

    expect(report.status).toBe('need_more_context');
    expect(report.targetCodeMapStatus).toBe('issue_key_mismatch');
    expect(report.overall.light).toBe('gray');
    expect(report.dimensions.every((dimension) => dimension.light === 'gray')).toBe(true);
    expect(report.overall.reason).toContain('不一致');
    expect(report.auditPayload.targetCodeMapStatus).toBe('issue_key_mismatch');
  });

  it('returns need_more_context with gray dimensions when targetCodeMap.issueKey is empty', () => {
    const evidencePack = buildEvidencePack('OPS-7012');
    const targetRef = 'gitlab:ops/app#file:src/features/localBadge/statusLabel.ts@abc7012#L10-L28';

    const report = buildCodeImpactReportV0({
      evidencePack,
      targetCodeMap: buildTargetCodeMap('', [
        {
          repo: 'ops/app',
          branch: 'main',
          file: 'src/features/localBadge/statusLabel.ts',
          symbol: 'statusLabelMap',
          symbolKind: 'function',
          changeKind: 'modify',
          sourceRef: targetRef
        }
      ], [targetRef])
    });

    expect(report.status).toBe('need_more_context');
    expect(report.targetCodeMapStatus).toBe('missing_issue_key');
    expect(report.overall.light).toBe('gray');
    expect(report.dimensions.every((dimension) => dimension.light === 'gray')).toBe(true);
  });

  it('returns need_more_context when targets are only partially traceable', () => {
    const evidencePack = buildEvidencePack('OPS-7013');
    const leafRef = 'gitlab:ops/app#file:src/features/localBadge/statusLabel.ts@abc7013#L10-L28';

    const report = buildCodeImpactReportV0({
      evidencePack,
      targetCodeMap: buildTargetCodeMap(evidencePack.issue.key, [
        {
          repo: 'ops/app',
          branch: 'main',
          file: 'src/features/localBadge/statusLabel.ts',
          symbol: 'statusLabelMap',
          symbolKind: 'function',
          changeKind: 'add',
          sourceRef: leafRef
        },
        {
          repo: 'ops/app',
          branch: 'main',
          file: 'src/framework/core/publicApi.ts',
          symbol: 'removeLegacyContract',
          symbolKind: 'method',
          changeKind: 'delete'
        }
      ], [leafRef])
    });

    expect(report.status).toBe('need_more_context');
    expect(report.targetCodeMapStatus).toBe('partial_traceable_target');
    expect(report.overall.light).toBe('gray');
    expect(report.dimensions.every((dimension) => dimension.light === 'gray')).toBe(true);
    expect(report.overall.reason).toContain('部分具备可追溯');
    expect(report.auditPayload.traceableTargetCount).toBe(1);
    expect(report.auditPayload.targetCount).toBe(2);
  });

  it('keeps single-file leaf change as green on surface area and abstraction', () => {
    const evidencePack = buildEvidencePack('OPS-7003', {
      summary: 'Adjust local badge text'
    });
    const targetRef = 'gitlab:ops/app#file:src/features/localBadge/statusLabel.ts@abc7003#L10-L28';
    const testRef = 'gitlab:ops/app#file:src/features/localBadge/statusLabel.spec.ts@abc7003#L1-L42';

    const report = buildCodeImpactReportV0({
      evidencePack,
      targetCodeMap: buildTargetCodeMap(evidencePack.issue.key, [
        {
          repo: 'ops/app',
          branch: 'main',
          file: 'src/features/localBadge/statusLabel.ts',
          symbol: 'statusLabelMap',
          symbolKind: 'function',
          changeKind: 'add',
          sourceRef: targetRef
        }
      ], [targetRef]),
      gitlabContextPack: buildGitlabContext([testRef], [
        {
          source_ref: testRef,
          path: 'src/features/localBadge/statusLabel.spec.ts'
        }
      ])
    });

    expect(report.status).toBe('ready');
    expect(findDimensionLight(report, 'SurfaceArea')).toBe('green');
    expect(findDimensionLight(report, 'AbstractionInvasion')).toBe('green');
    expect(findDimensionLight(report, 'Verifiability')).toBe('green');
    expect(findDimension(report, 'Verifiability').sourceRefs).toContain(testRef);
    expect(report.overall.light).toBe('green');
  });

  it('does not allow test path without source_ref to turn Verifiability green', () => {
    const evidencePack = buildEvidencePack('OPS-7011', {
      summary: 'Adjust local badge text only'
    });
    const targetRef = 'gitlab:ops/app#file:src/features/localBadge/statusLabel.ts@abc7011#L10-L28';

    const report = buildCodeImpactReportV0({
      evidencePack,
      targetCodeMap: buildTargetCodeMap(evidencePack.issue.key, [
        {
          repo: 'ops/app',
          branch: 'main',
          file: 'src/features/localBadge/statusLabel.ts',
          symbol: 'statusLabelMap',
          symbolKind: 'function',
          changeKind: 'modify',
          sourceRef: targetRef
        }
      ], [targetRef]),
      gitlabContextPack: buildGitlabContext([], [
        {
          source_ref: '',
          path: 'src/features/localBadge/statusLabel.test.ts'
        }
      ])
    });

    expect(findDimensionLight(report, 'Verifiability')).not.toBe('green');
  });

  it('raises SurfaceArea to yellow/red for multi-file multi-module changes', () => {
    const evidencePack = buildEvidencePack('OPS-7004');
    const refs = [
      'gitlab:ops/app#file:src/modules/approval/service.ts@abc7004#L1-L40',
      'gitlab:ops/app#file:src/modules/approval/repo.ts@abc7004#L1-L33',
      'gitlab:ops/app#file:src/modules/billing/invoice.ts@abc7004#L1-L55',
      'gitlab:ops/app#file:src/modules/billing/invoiceMapper.ts@abc7004#L1-L29',
      'gitlab:ops/app#file:src/modules/report/export.ts@abc7004#L1-L44',
      'gitlab:ops/shared#file:src/common/flags.ts@abc7004#L1-L18'
    ];

    const targets = refs.map((ref, index) => ({
      repo: index === refs.length - 1 ? 'ops/shared' : 'ops/app',
      branch: 'main',
      file:
        index === 0
          ? 'src/modules/approval/service.ts'
          : index === 1
            ? 'src/modules/approval/repo.ts'
            : index === 2
              ? 'src/modules/billing/invoice.ts'
              : index === 3
                ? 'src/modules/billing/invoiceMapper.ts'
                : index === 4
                  ? 'src/modules/report/export.ts'
                  : 'src/common/flags.ts',
      symbol: `symbol-${index + 1}`,
      symbolKind: 'function',
      changeKind: 'modify',
      sourceRef: ref
    })) as TargetCodeMapTargetV0[];

    const report = buildCodeImpactReportV0({
      evidencePack,
      targetCodeMap: buildTargetCodeMap(evidencePack.issue.key, targets, refs)
    });

    expect(report.status).toBe('ready');
    expect(['yellow', 'red']).toContain(findDimensionLight(report, 'SurfaceArea'));
  });

  it('marks abstraction/compatibility non-green when shared API contract is modified', () => {
    const evidencePack = buildEvidencePack('OPS-7005', {
      summary: 'Update public API contract for export service mapping'
    });

    const sourceRef = 'gitlab:ops/app#file:src/shared/api/publicContract.ts@abc7005#L3-L88';

    const report = buildCodeImpactReportV0({
      evidencePack,
      targetCodeMap: buildTargetCodeMap(evidencePack.issue.key, [
        {
          repo: 'ops/app',
          branch: 'main',
          file: 'src/shared/api/publicContract.ts',
          symbol: 'PublicExportContract',
          symbolKind: 'class',
          changeKind: 'modify',
          sourceRef
        }
      ], [sourceRef])
    });

    expect(['yellow', 'red']).toContain(findDimensionLight(report, 'AbstractionInvasion'));
    expect(['yellow', 'red']).toContain(findDimensionLight(report, 'Compatibility'));
  });

  it('marks Compliance as non-green for auth/billing/medical/token/signature signals', () => {
    const evidencePack = buildEvidencePack('OPS-7006', {
      summary: '医嘱 billing token signature auth update'
    });

    const sourceRef = 'gitlab:ops/app#file:src/modules/billing/tokenPolicy.ts@abc7006#L8-L72';

    const report = buildCodeImpactReportV0({
      evidencePack,
      targetCodeMap: buildTargetCodeMap(evidencePack.issue.key, [
        {
          repo: 'ops/app',
          branch: 'main',
          file: 'src/modules/billing/tokenPolicy.ts',
          symbol: 'verifySignature',
          symbolKind: 'function',
          changeKind: 'modify',
          sourceRef
        }
      ], [sourceRef])
    });

    expect(['yellow', 'red']).toContain(findDimensionLight(report, 'Compliance'));
  });

  it('marks Verifiability red when no test clue exists and provides turnGreenCondition', () => {
    const evidencePack = buildEvidencePack('OPS-7007', {
      summary: 'Adjust export label behavior'
    });

    const sourceRef = 'gitlab:ops/app#file:src/features/export/statusLabel.ts@abc7007#L11-L26';

    const report = buildCodeImpactReportV0({
      evidencePack,
      targetCodeMap: buildTargetCodeMap(evidencePack.issue.key, [
        {
          repo: 'ops/app',
          branch: 'main',
          file: 'src/features/export/statusLabel.ts',
          symbol: 'statusLabelMap',
          symbolKind: 'function',
          changeKind: 'modify',
          sourceRef
        }
      ], [sourceRef])
    });

    const dimension = findDimension(report, 'Verifiability');
    expect(dimension.light).toBe('red');
    expect(dimension.turnGreenCondition.toLowerCase()).toMatch(/test|spec|fixture/);
  });

  it('provides downgrade/split suggestions for red-light reports and keeps beta non-blocking', () => {
    const evidencePack = buildEvidencePack('OPS-7008', {
      summary: 'Breaking delete public API with migration and auth bypass risk'
    });

    const sourceRef = 'gitlab:ops/app#file:src/framework/core/publicApi.ts@abc7008#L1-L130';

    const report = buildCodeImpactReportV0({
      evidencePack,
      requirementGateResult: buildGateResultStub('green'),
      targetCodeMap: buildTargetCodeMap(evidencePack.issue.key, [
        {
          repo: 'ops/app',
          branch: 'main',
          file: 'src/framework/core/publicApi.ts',
          symbol: 'removeLegacyContract',
          symbolKind: 'method',
          changeKind: 'delete',
          sourceRef
        }
      ], [sourceRef])
    });

    expect(report.overall.light).toBe('red');
    expect(report.nonBlocking).toBe(true);
    expect(report.overall.combinedBetaLight).toBe('red');
    expect(report.downgradeSuggestions.length).toBeGreaterThan(0);
    expect(report.splitSuggestions.length).toBeGreaterThan(0);
  });

  it('keeps report/sourceRefs/auditPayload sourceRefs within allowed set and deduplicated', () => {
    const evidencePack = buildEvidencePack('OPS-7009', {
      summary: 'Shared API update with manual verify hint'
    });

    const targetRef = 'gitlab:ops/app#file:src/shared/api/client.ts@abc7009#L4-L88';
    const extraRef = 'gitlab:ops/app#file:src/shared/api/client.test.ts@abc7009#L1-L34';

    const report = buildCodeImpactReportV0({
      evidencePack,
      targetCodeMap: buildTargetCodeMap(evidencePack.issue.key, [
        {
          repo: 'ops/app',
          branch: 'main',
          file: 'src/shared/api/client.ts',
          symbol: 'ApiClient',
          symbolKind: 'class',
          changeKind: 'modify',
          sourceRef: targetRef
        }
      ], [targetRef, targetRef]),
      gitlabContextPack: buildGitlabContext([extraRef], [
        {
          source_ref: extraRef,
          path: 'src/shared/api/client.test.ts'
        }
      ]),
      resolverPacket: {
        schema_version: 'resolver_packet.v1',
        intent: {
          issue_key: evidencePack.issue.key,
          summary: evidencePack.issue.summary,
          kind: 'feature',
          source_refs: [evidencePack.issue.sourceRef]
        },
        constraints: ['manual verify'],
        repo_hints: [],
        risk_level: 'L1',
        missing_info: [],
        next_action: 'shadow_ready',
        source_refs: [targetRef, extraRef, targetRef]
      }
    });

    const allowed = collectAllowedRefsFromInput({
      evidencePack,
      targetCodeMap: buildTargetCodeMap(evidencePack.issue.key, [
        {
          repo: 'ops/app',
          branch: 'main',
          file: 'src/shared/api/client.ts',
          symbol: 'ApiClient',
          symbolKind: 'class',
          changeKind: 'modify',
          sourceRef: targetRef
        }
      ], [targetRef, targetRef]),
      gitlabContextPack: buildGitlabContext([extraRef], [
        {
          source_ref: extraRef,
          path: 'src/shared/api/client.test.ts'
        }
      ]),
      resolverPacket: {
        schema_version: 'resolver_packet.v1',
        intent: {
          issue_key: evidencePack.issue.key,
          summary: evidencePack.issue.summary,
          kind: 'feature',
          source_refs: [evidencePack.issue.sourceRef]
        },
        constraints: ['manual verify'],
        repo_hints: [],
        risk_level: 'L1',
        missing_info: [],
        next_action: 'shadow_ready',
        source_refs: [targetRef, extraRef, targetRef]
      }
    });

    expect(report.sourceRefs).toEqual([...new Set(report.sourceRefs)]);
    expect(report.auditPayload.sourceRefs).toEqual([...new Set(report.auditPayload.sourceRefs)]);

    const reportRefs = new Set<string>([
      ...report.sourceRefs,
      ...report.auditPayload.sourceRefs,
      ...report.dimensions.flatMap((dimension) => dimension.sourceRefs),
      ...report.overall.sourceRefs
    ]);

    for (const sourceRef of reportRefs) {
      expect(allowed.has(sourceRef)).toBe(true);
    }
  });
});

function findDimensionLight(
  report: ReturnType<typeof buildCodeImpactReportV0>,
  id: ReturnType<typeof buildCodeImpactReportV0>['dimensions'][number]['id']
): ReturnType<typeof buildCodeImpactReportV0>['dimensions'][number]['light'] {
  return findDimension(report, id).light;
}

function findDimension(
  report: ReturnType<typeof buildCodeImpactReportV0>,
  id: ReturnType<typeof buildCodeImpactReportV0>['dimensions'][number]['id']
): ReturnType<typeof buildCodeImpactReportV0>['dimensions'][number] {
  const dimension = report.dimensions.find((item) => item.id === id);
  if (dimension === undefined) {
    throw new Error(`missing dimension: ${id}`);
  }

  return dimension;
}

function buildEvidencePack(
  issueKey: string,
  overrides?: {
    readonly summary?: string | undefined;
    readonly description?: string | undefined;
    readonly labels?: readonly string[] | undefined;
  }
): JiraEvidencePackV2 {
  const sourceRef = `jira.issue:${issueKey}`;

  return {
    schemaVersion: 'JiraEvidencePackV2',
    issue: {
      key: issueKey,
      summary: overrides?.summary ?? 'Update export label mapping',
      description: overrides?.description ?? 'Need a deterministic code impact assessment in shadow mode.',
      issueType: 'Task',
      status: 'Open',
      priority: 'Medium',
      assignee: 'dev',
      labels: overrides?.labels ?? ['requirements', 'beta'],
      projectKey: 'OPS',
      projectName: 'Operations',
      created: '2026-05-20T00:00:00.000Z',
      updated: '2026-05-20T00:00:00.000Z',
      dueDate: '',
      sourceRef
    },
    fields: [],
    fieldValues: [],
    comments: [],
    attachments: [],
    mediaEvidence: [],
    projectMetadata: null,
    relations: [],
    transitions: [],
    sourceRefs: [sourceRef],
    generatedAt: '2026-05-20T00:00:00.000Z'
  };
}

function buildTargetCodeMap(
  issueKey: string,
  targets: readonly TargetCodeMapTargetV0[],
  sourceRefs: readonly string[]
): TargetCodeMapV0 {
  return {
    schemaVersion: 'TargetCodeMapV0',
    issueKey,
    targets,
    sourceRefs
  };
}

function buildGitlabContext(
  refs: readonly string[],
  searchResults: readonly { readonly source_ref: string; readonly path: string }[]
): GitLabContextPackV1Like {
  return {
    version: 'GitLabContextPackV1',
    evidence_refs: refs.map((source_ref) => ({ source_ref })),
    search_results: searchResults,
    file_slices: []
  };
}

function buildGateResultStub(light: 'green' | 'yellow' | 'red'): RequirementGateResultV0 {
  return {
    schemaVersion: 'RequirementGateResultV0',
    profile: 'Integration',
    investigationReady: {
      light,
      reason: 'stub',
      axisResults: [],
      sourceRefs: []
    },
    implementationReady: {
      light,
      reason: 'stub',
      axisResults: [],
      sourceRefs: []
    },
    gaps: [],
    clarificationQuestions: [],
    hardBlocks: [],
    sourceRefs: [],
    auditPayload: {
      schemaVersion: 'RequirementGateAuditPayloadV0',
      profileSpecStatus: 'spec_ready',
      usedFallbackProfileSpec: true,
      runtimeFlags: {},
      ruleEvaluations: [],
      sourceRefs: []
    }
  };
}

function collectAllowedRefsFromInput(input: BuildCodeImpactReportInputV0): Set<string> {
  const refs = new Set<string>();

  for (const sourceRef of input.targetCodeMap?.sourceRefs ?? []) {
    if (sourceRef.trim().length > 0) {
      refs.add(sourceRef.trim());
    }
  }

  for (const target of input.targetCodeMap?.targets ?? []) {
    const sourceRef = target.sourceRef?.trim();
    if (sourceRef !== undefined && sourceRef.length > 0) {
      refs.add(sourceRef);
    }
  }

  for (const evidenceRef of input.gitlabContextPack?.evidence_refs ?? []) {
    if (evidenceRef.source_ref.trim().length > 0) {
      refs.add(evidenceRef.source_ref.trim());
    }
  }

  for (const search of input.gitlabContextPack?.search_results ?? []) {
    if (search.source_ref.trim().length > 0) {
      refs.add(search.source_ref.trim());
    }
  }

  for (const slice of input.gitlabContextPack?.file_slices ?? []) {
    if (slice.source_ref.trim().length > 0) {
      refs.add(slice.source_ref.trim());
    }
  }

  for (const sourceRef of input.resolverPacket?.source_refs ?? []) {
    if (sourceRef.trim().length > 0) {
      refs.add(sourceRef.trim());
    }
  }

  return refs;
}
