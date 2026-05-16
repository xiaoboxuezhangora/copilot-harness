#!/usr/bin/env tsx
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { resolveRepoRoot } from '../runtime/skillAgentLoader.js';
import {
  READINESS_PACK_JSON_SCHEMA,
  W18_READINESS_SCHEMA_VERSION,
  buildReadinessPack,
  validateReadinessPack,
  type BlockingRunbook,
  type CutoverChecklist,
  type GoNoGoTemplate,
  type ReadinessPack,
  type TabletopExercise
} from './index.js';

export const W18_TASK_STATE_SCHEMA_VERSION = 'w18-go-live-readiness-state@1';

interface W18ReadinessOptions {
  readonly repoRoot: string;
  readonly generatedAt?: string | undefined;
  readonly reportsDir?: string | undefined;
  readonly stateDir?: string | undefined;
}

interface W18ArtifactPaths {
  readonly readiness_schema: string;
  readonly readiness_pack_json: string;
  readonly readiness_report_md: string;
  readonly rb1_runbook_md: string;
  readonly rb2_runbook_md: string;
  readonly cutover_checklist_md: string;
  readonly go_no_go_template_md: string;
  readonly tabletop_record_md: string;
  readonly audit_jsonl: string;
  readonly task_state: string;
}

interface W18ReadinessRunResult {
  readonly pack: ReadinessPack;
  readonly artifactPaths: W18ArtifactPaths;
  readonly validationIssues: readonly string[];
}

interface W18TaskState {
  readonly schema_version: typeof W18_TASK_STATE_SCHEMA_VERSION;
  readonly task_id: 'w18-go-live-readiness';
  readonly turn_state: 'done';
  readonly execution_mode: 'readiness_rehearsal';
  readonly generated_at: string;
  readonly engineering_closure_status: ReadinessPack['engineering_closure_status'];
  readonly release_status: ReadinessPack['release_status'];
  readonly rb_1_status: ReadinessPack['rb_1_status'];
  readonly rb_2_status: ReadinessPack['rb_2_status'];
  readonly decision: ReadinessPack['decision'];
  readonly blockers: ReadinessPack['blockers'];
  readonly validation_issue_count: number;
  readonly management_review_status: ReadinessPack['go_no_go_template']['management_review_status'];
  readonly freeze_policy: ReadinessPack['freeze_policy'];
  readonly artifact_paths: W18ArtifactPaths;
}

interface CliOptions {
  readonly reportsDir?: string | undefined;
  readonly stateDir?: string | undefined;
}

export async function runW18ReadinessPack(
  options: W18ReadinessOptions
): Promise<W18ReadinessRunResult> {
  const repoRoot = resolve(options.repoRoot);
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const reportsDir = options.reportsDir ?? join(repoRoot, 'reports', 'w18');
  const stateDir = options.stateDir ?? join(repoRoot, 'state', 'tasks', 'w18');
  const artifactPaths: W18ArtifactPaths = {
    readiness_schema: join(reportsDir, 'readiness-pack.schema.json'),
    readiness_pack_json: join(reportsDir, 'readiness-pack.json'),
    readiness_report_md: join(reportsDir, 'readiness-report.md'),
    rb1_runbook_md: join(reportsDir, 'rb1-runner-live-ci-runbook.md'),
    rb2_runbook_md: join(reportsDir, 'rb2-dual-write-drift-runbook.md'),
    cutover_checklist_md: join(reportsDir, 'cutover-checklist.md'),
    go_no_go_template_md: join(reportsDir, 'go-no-go-template.md'),
    tabletop_record_md: join(reportsDir, 'tabletop-exercise.md'),
    audit_jsonl: join(reportsDir, 'audit.jsonl'),
    task_state: join(stateDir, 'go-live-readiness-state.json')
  };

  const pack = buildReadinessPack(generatedAt);
  const validationIssues = validateReadinessPack(pack).map(
    (issue) => `${issue.field}: ${issue.message}`
  );

  await writeArtifacts({
    pack,
    artifactPaths,
    validationIssues
  });

  return {
    pack,
    artifactPaths,
    validationIssues
  };
}

export async function runW18ReadinessPackCli(): Promise<void> {
  const cliOptions = parseCliOptions(process.argv.slice(2));
  const result = await runW18ReadinessPack({
    repoRoot: resolveRepoRoot(),
    ...(cliOptions.reportsDir === undefined ? {} : { reportsDir: cliOptions.reportsDir }),
    ...(cliOptions.stateDir === undefined ? {} : { stateDir: cliOptions.stateDir })
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        decision: result.pack.decision,
        engineering_closure_status: result.pack.engineering_closure_status,
        release_status: result.pack.release_status,
        blockers: result.pack.blockers,
        rb1_estimated_minutes: result.pack.runbooks.find((runbook) => runbook.blocker_id === 'RB-1')
          ?.estimated_total_minutes,
        rb2_estimated_minutes: result.pack.runbooks.find((runbook) => runbook.blocker_id === 'RB-2')
          ?.estimated_total_minutes,
        tabletop_issue_count: result.pack.tabletop.issues.length,
        validation_issue_count: result.validationIssues.length,
        report_path: result.artifactPaths.readiness_report_md
      },
      null,
      2
    )}\n`
  );
}

async function writeArtifacts(input: {
  readonly pack: ReadinessPack;
  readonly artifactPaths: W18ArtifactPaths;
  readonly validationIssues: readonly string[];
}): Promise<void> {
  await Promise.all([
    mkdir(dirname(input.artifactPaths.readiness_pack_json), { recursive: true }),
    mkdir(dirname(input.artifactPaths.task_state), { recursive: true })
  ]);

  const rb1 = input.pack.runbooks.find((runbook) => runbook.blocker_id === 'RB-1');
  const rb2 = input.pack.runbooks.find((runbook) => runbook.blocker_id === 'RB-2');
  if (rb1 === undefined || rb2 === undefined) {
    throw new Error('RB-1 and RB-2 runbooks are required');
  }

  const taskState: W18TaskState = {
    schema_version: W18_TASK_STATE_SCHEMA_VERSION,
    task_id: 'w18-go-live-readiness',
    turn_state: 'done',
    execution_mode: 'readiness_rehearsal',
    generated_at: input.pack.generated_at,
    engineering_closure_status: input.pack.engineering_closure_status,
    release_status: input.pack.release_status,
    rb_1_status: input.pack.rb_1_status,
    rb_2_status: input.pack.rb_2_status,
    decision: input.pack.decision,
    blockers: input.pack.blockers,
    validation_issue_count: input.validationIssues.length,
    management_review_status: input.pack.go_no_go_template.management_review_status,
    freeze_policy: input.pack.freeze_policy,
    artifact_paths: input.artifactPaths
  };

  await Promise.all([
    writeFile(
      input.artifactPaths.readiness_schema,
      `${JSON.stringify(READINESS_PACK_JSON_SCHEMA, null, 2)}\n`,
      'utf8'
    ),
    writeFile(
      input.artifactPaths.readiness_pack_json,
      `${JSON.stringify(input.pack, null, 2)}\n`,
      'utf8'
    ),
    writeFile(
      input.artifactPaths.readiness_report_md,
      renderReadinessReport(input.pack, input.artifactPaths, input.validationIssues),
      'utf8'
    ),
    writeFile(input.artifactPaths.rb1_runbook_md, renderRunbook(rb1), 'utf8'),
    writeFile(input.artifactPaths.rb2_runbook_md, renderRunbook(rb2), 'utf8'),
    writeFile(
      input.artifactPaths.cutover_checklist_md,
      renderCutoverChecklist(input.pack.cutover_checklist),
      'utf8'
    ),
    writeFile(
      input.artifactPaths.go_no_go_template_md,
      renderGoNoGoTemplate(input.pack.go_no_go_template),
      'utf8'
    ),
    writeFile(input.artifactPaths.tabletop_record_md, renderTabletop(input.pack.tabletop), 'utf8'),
    writeFile(input.artifactPaths.audit_jsonl, renderAuditJsonl(input.pack), 'utf8'),
    writeFile(input.artifactPaths.task_state, `${JSON.stringify(taskState, null, 2)}\n`, 'utf8')
  ]);
}

function renderReadinessReport(
  pack: ReadinessPack,
  artifactPaths: W18ArtifactPaths,
  validationIssues: readonly string[]
): string {
  return [
    '# W18 Go-Live Readiness Pack',
    '',
    `- schema_version: ${pack.schema_version}`,
    `- generated_at: ${pack.generated_at}`,
    `- engineering_closure_status: ${pack.engineering_closure_status}`,
    `- release_status: ${pack.release_status}`,
    `- rb_1_status: ${pack.rb_1_status}`,
    `- rb_2_status: ${pack.rb_2_status}`,
    `- decision: ${pack.decision}`,
    `- decision_reason: ${pack.decision_reason}`,
    `- blockers: ${pack.blockers.join(', ')}`,
    `- management_review_status: ${pack.go_no_go_template.management_review_status}`,
    `- real_cutover_executed: ${String(pack.freeze_policy.real_cutover_executed)}`,
    `- single_write_enabled: ${String(pack.freeze_policy.single_write_enabled)}`,
    `- git_push: ${String(pack.freeze_policy.git_push)}`,
    `- merge_request_api: ${String(pack.freeze_policy.merge_request_api)}`,
    `- jira_write: ${String(pack.freeze_policy.jira_write)}`,
    `- auto_merge: ${String(pack.freeze_policy.auto_merge)}`,
    `- note: W18 readiness engineering package is complete; release/cutover remains prohibited until RB-1/RB-2 close.`,
    '',
    '## RB Closure Estimates',
    '',
    ...pack.runbooks.map(
      (runbook) =>
        `- ${runbook.blocker_id}: ${runbook.title}; estimated_total_minutes=${runbook.estimated_total_minutes}`
    ),
    '',
    '## Quantified Gates',
    '',
    ...pack.runbooks.flatMap((runbook) =>
      runbook.closure_gates.map(
        (gate) =>
          `- ${runbook.blocker_id}/${gate.id}: ${gate.metric} ${gate.operator} ${gate.target} ${gate.unit}`
      )
    ),
    '',
    '## Tabletop Issues',
    '',
    ...pack.tabletop.issues.map(
      (issue) =>
        `- ${issue.severity} ${issue.id}: ${issue.finding}; revision=${issue.revision_item}`
    ),
    '',
    '## Validation',
    '',
    ...(validationIssues.length === 0
      ? ['- readiness pack structure: PASS']
      : validationIssues.map((issue) => `- ${issue}`)),
    '',
    '## Artifacts',
    '',
    `- rb1_runbook: ${artifactPaths.rb1_runbook_md}`,
    `- rb2_runbook: ${artifactPaths.rb2_runbook_md}`,
    `- cutover_checklist: ${artifactPaths.cutover_checklist_md}`,
    `- go_no_go_template: ${artifactPaths.go_no_go_template_md}`,
    `- tabletop_record: ${artifactPaths.tabletop_record_md}`,
    `- audit: ${artifactPaths.audit_jsonl}`,
    ''
  ].join('\n');
}

function renderRunbook(runbook: BlockingRunbook): string {
  return [
    `# ${runbook.title}`,
    '',
    `- blocker_id: ${runbook.blocker_id}`,
    `- current_status: ${runbook.current_status}`,
    `- objective: ${runbook.objective}`,
    `- estimated_total_minutes: ${runbook.estimated_total_minutes}`,
    '',
    '## Prerequisites',
    ...runbook.prerequisites.map((item) => `- ${item}`),
    '',
    '## Steps',
    '',
    ...runbook.steps.flatMap((step) => [
      `### ${step.id}: ${step.title}`,
      '',
      `- owner: ${step.owner}`,
      `- estimated_minutes: ${step.estimated_minutes}`,
      `- action: ${step.command_or_action}`,
      `- evidence_output: ${step.evidence_output}`,
      '',
      'Acceptance gates:',
      ...step.acceptance_gates.map(
        (gate) => `- ${gate.id}: ${gate.metric} ${gate.operator} ${gate.target} ${gate.unit}`
      ),
      ''
    ]),
    '## Closure Gates',
    ...runbook.closure_gates.map(
      (gate) => `- ${gate.id}: ${gate.metric} ${gate.operator} ${gate.target} ${gate.unit}`
    ),
    '',
    '## Archive Outputs',
    ...runbook.archive_outputs.map((item) => `- ${item}`),
    ''
  ].join('\n');
}

function renderCutoverChecklist(checklist: CutoverChecklist): string {
  return [
    `# ${checklist.title}`,
    '',
    `- mode: ${checklist.mode}`,
    '',
    ...checklist.sections.flatMap((section) => [
      `## ${section.title}`,
      '',
      ...section.items.map((item) => `- [ ] ${item}`),
      ''
    ]),
    '## Rollback Conditions',
    '',
    ...checklist.rollback_conditions.map((condition) => `- ${condition}`),
    '',
    '## Communication Templates',
    '',
    ...checklist.communication_templates.map((template) => `- ${template}`),
    ''
  ].join('\n');
}

function renderGoNoGoTemplate(template: GoNoGoTemplate): string {
  return [
    '# W18 Go/No-Go Template',
    '',
    `- recommended_decision: ${template.decision}`,
    `- reason: ${template.reason}`,
    `- management_review_status: ${template.management_review_status}`,
    `- earliest_real_write_unlock: ${template.earliest_real_write_unlock}`,
    '- engineering_closure_status: complete',
    '- release_status: blocked_by_rb_1_rb_2',
    '- rb_1_status: open',
    '- rb_2_status: open',
    '',
    '## Required Signers',
    '',
    ...template.required_signers.map(
      (signer) =>
        `- [ ] ${signer.role}; required=${String(signer.required)}; signs_for=${signer.signs_for}`
    ),
    '',
    '## Approval Rules',
    '',
    ...template.approval_rules.map((rule) => `- ${rule}`),
    ''
  ].join('\n');
}

function renderTabletop(tabletop: TabletopExercise): string {
  return [
    `# ${tabletop.title}`,
    '',
    `- mode: ${tabletop.mode}`,
    `- conclusion: ${tabletop.conclusion}`,
    '',
    '## Scenarios',
    '',
    ...tabletop.scenarios.map((scenario) => `- ${scenario}`),
    '',
    '## Issues and Revisions',
    '',
    ...tabletop.issues.map(
      (issue) =>
        `- ${issue.severity} ${issue.id}: scenario=${issue.scenario}; finding=${issue.finding}; revision=${issue.revision_item}; owner=${issue.owner}`
    ),
    '',
    '## Revision Summary',
    '',
    ...tabletop.revision_summary.map((item) => `- ${item}`),
    ''
  ].join('\n');
}

function renderAuditJsonl(pack: ReadinessPack): string {
  const events = [
    {
      schema_version: W18_READINESS_SCHEMA_VERSION,
      event_name: 'readiness.decision',
      trace_ref: 'w18:readiness:decision',
      decision: pack.decision,
      engineering_closure_status: pack.engineering_closure_status,
      release_status: pack.release_status,
      rb_1_status: pack.rb_1_status,
      rb_2_status: pack.rb_2_status,
      reason: pack.decision_reason,
      blockers: pack.blockers,
      freeze_policy: pack.freeze_policy
    },
    ...pack.runbooks.map((runbook) => ({
      schema_version: W18_READINESS_SCHEMA_VERSION,
      event_name: 'readiness.runbook.prepared',
      trace_ref: `w18:readiness:${runbook.blocker_id.toLowerCase()}`,
      blocker_id: runbook.blocker_id,
      estimated_total_minutes: runbook.estimated_total_minutes,
      closure_gate_count: runbook.closure_gates.length,
      status: runbook.current_status
    })),
    {
      schema_version: W18_READINESS_SCHEMA_VERSION,
      event_name: 'readiness.tabletop.completed',
      trace_ref: 'w18:readiness:tabletop',
      decision: pack.tabletop.conclusion,
      issue_count: pack.tabletop.issues.length,
      revision_count: pack.tabletop.revision_summary.length
    },
    {
      schema_version: W18_READINESS_SCHEMA_VERSION,
      event_name: 'readiness.management_review.template_prepared',
      trace_ref: 'w18:readiness:go-no-go',
      decision: pack.go_no_go_template.decision,
      required_signer_count: pack.go_no_go_template.required_signers.filter(
        (signer) => signer.required
      ).length,
      management_review_status: pack.go_no_go_template.management_review_status
    }
  ];
  return `${events.map((event) => JSON.stringify(event)).join('\n')}\n`;
}

function parseCliOptions(args: readonly string[]): CliOptions {
  const options: { reportsDir?: string; stateDir?: string } = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === '--reports-dir' && next !== undefined) {
      options.reportsDir = resolve(next);
      index += 1;
    } else if (arg === '--state-dir' && next !== undefined) {
      options.stateDir = resolve(next);
      index += 1;
    } else {
      throw new Error(`Unknown option ${arg ?? ''}`);
    }
  }
  return options;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await runW18ReadinessPackCli();
}
