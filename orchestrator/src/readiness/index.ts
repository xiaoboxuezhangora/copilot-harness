export const W18_READINESS_SCHEMA_VERSION = 'w18-go-live-readiness@1';

export type ReadinessDecision = 'GO' | 'NO-GO';
export type ReadinessBlockerId = 'RB-1' | 'RB-2';
export type RunbookId = 'rb1_runner_live_ci' | 'rb2_dual_write_drift';
export type ChecklistSectionId = 'pre_checks' | 'cutover_steps' | 'rollback' | 'oncall_comms';

export interface QuantitativeGate {
  readonly id: string;
  readonly metric: string;
  readonly operator: '>=' | '<=' | '=';
  readonly target: number;
  readonly unit: string;
  readonly evidence_required: string;
}

export interface RunbookStep {
  readonly id: string;
  readonly title: string;
  readonly owner: string;
  readonly estimated_minutes: number;
  readonly command_or_action: string;
  readonly acceptance_gates: readonly QuantitativeGate[];
  readonly evidence_output: string;
}

export interface BlockingRunbook {
  readonly id: RunbookId;
  readonly blocker_id: ReadinessBlockerId;
  readonly title: string;
  readonly objective: string;
  readonly current_status: 'open';
  readonly estimated_total_minutes: number;
  readonly prerequisites: readonly string[];
  readonly steps: readonly RunbookStep[];
  readonly closure_gates: readonly QuantitativeGate[];
  readonly archive_outputs: readonly string[];
}

export interface CutoverChecklistSection {
  readonly id: ChecklistSectionId;
  readonly title: string;
  readonly items: readonly string[];
}

export interface CutoverChecklist {
  readonly title: string;
  readonly mode: 'rehearsal_only';
  readonly sections: readonly CutoverChecklistSection[];
  readonly rollback_conditions: readonly string[];
  readonly communication_templates: readonly string[];
}

export interface GoNoGoSigner {
  readonly role: string;
  readonly required: boolean;
  readonly signs_for: string;
}

export interface GoNoGoTemplate {
  readonly decision: ReadinessDecision;
  readonly reason: string;
  readonly required_signers: readonly GoNoGoSigner[];
  readonly earliest_real_write_unlock: string;
  readonly approval_rules: readonly string[];
  readonly management_review_status: 'pending_rb_closure';
}

export interface TabletopIssue {
  readonly id: string;
  readonly severity: 'P0' | 'P1' | 'P2';
  readonly scenario: string;
  readonly finding: string;
  readonly revision_item: string;
  readonly owner: string;
}

export interface TabletopExercise {
  readonly title: string;
  readonly mode: 'tabletop';
  readonly scenarios: readonly string[];
  readonly issues: readonly TabletopIssue[];
  readonly conclusion: ReadinessDecision;
  readonly revision_summary: readonly string[];
}

export interface ReadinessPack {
  readonly schema_version: typeof W18_READINESS_SCHEMA_VERSION;
  readonly generated_at: string;
  readonly engineering_closure_status: 'complete';
  readonly release_status: 'blocked_by_rb_1_rb_2';
  readonly rb_1_status: 'open';
  readonly rb_2_status: 'open';
  readonly decision: ReadinessDecision;
  readonly decision_reason: string;
  readonly blockers: readonly ReadinessBlockerId[];
  readonly runbooks: readonly BlockingRunbook[];
  readonly cutover_checklist: CutoverChecklist;
  readonly go_no_go_template: GoNoGoTemplate;
  readonly tabletop: TabletopExercise;
  readonly freeze_policy: {
    readonly real_cutover_executed: false;
    readonly single_write_enabled: false;
    readonly git_push: false;
    readonly merge_request_api: false;
    readonly jira_write: false;
    readonly auto_merge: false;
  };
}

export interface ReadinessValidationIssue {
  readonly field: string;
  readonly message: string;
}

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | readonly JsonValue[] | JsonObject;
interface JsonObject {
  readonly [key: string]: JsonValue;
}

export const READINESS_PACK_JSON_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'w18-go-live-readiness.schema.json',
  title: 'W18 Go-Live Readiness Pack',
  type: 'object',
  additionalProperties: false,
  required: [
    'schema_version',
    'generated_at',
    'engineering_closure_status',
    'release_status',
    'rb_1_status',
    'rb_2_status',
    'decision',
    'decision_reason',
    'blockers',
    'runbooks',
    'cutover_checklist',
    'go_no_go_template',
    'tabletop',
    'freeze_policy'
  ],
  properties: {
    schema_version: { const: W18_READINESS_SCHEMA_VERSION },
    generated_at: { type: 'string', minLength: 1 },
    engineering_closure_status: { const: 'complete' },
    release_status: { const: 'blocked_by_rb_1_rb_2' },
    rb_1_status: { const: 'open' },
    rb_2_status: { const: 'open' },
    decision: { enum: ['GO', 'NO-GO'] },
    decision_reason: { type: 'string', minLength: 1 },
    blockers: { type: 'array', items: { enum: ['RB-1', 'RB-2'] } },
    runbooks: { type: 'array', minItems: 2 },
    cutover_checklist: { type: 'object' },
    go_no_go_template: { type: 'object' },
    tabletop: { type: 'object' },
    freeze_policy: { type: 'object' }
  }
} as const satisfies JsonObject;

export function buildReadinessPack(generatedAt: string): ReadinessPack {
  const runbooks = buildBlockingRunbooks();
  const blockers = runbooks.map((runbook) => runbook.blocker_id);
  const decision: ReadinessDecision = blockers.length === 0 ? 'GO' : 'NO-GO';
  return {
    schema_version: W18_READINESS_SCHEMA_VERSION,
    generated_at: generatedAt,
    engineering_closure_status: 'complete',
    release_status: 'blocked_by_rb_1_rb_2',
    rb_1_status: 'open',
    rb_2_status: 'open',
    decision,
    decision_reason:
      decision === 'GO'
        ? 'All release blockers are closed and archived.'
        : 'RB-1 and RB-2 remain open; real write unlock and single-write cutover are not allowed.',
    blockers,
    runbooks,
    cutover_checklist: buildCutoverChecklist(),
    go_no_go_template: buildGoNoGoTemplate(decision),
    tabletop: buildTabletopExercise(),
    freeze_policy: {
      real_cutover_executed: false,
      single_write_enabled: false,
      git_push: false,
      merge_request_api: false,
      jira_write: false,
      auto_merge: false
    }
  };
}

export function validateReadinessPack(pack: ReadinessPack): readonly ReadinessValidationIssue[] {
  const issues: ReadinessValidationIssue[] = [];
  if (pack.schema_version !== W18_READINESS_SCHEMA_VERSION) {
    issues.push({
      field: 'schema_version',
      message: `schema_version must be ${W18_READINESS_SCHEMA_VERSION}`
    });
  }
  if (pack.decision !== 'NO-GO') {
    issues.push({
      field: 'decision',
      message: 'W18 must remain NO-GO while RB-1/RB-2 are open'
    });
  }
  if (
    pack.engineering_closure_status !== 'complete' ||
    pack.release_status !== 'blocked_by_rb_1_rb_2' ||
    pack.rb_1_status !== 'open' ||
    pack.rb_2_status !== 'open'
  ) {
    issues.push({
      field: 'engineering_release_status',
      message: 'W18 engineering must be complete while release remains blocked by open RB-1/RB-2'
    });
  }
  if (!pack.blockers.includes('RB-1') || !pack.blockers.includes('RB-2')) {
    issues.push({ field: 'blockers', message: 'RB-1 and RB-2 must both remain explicit blockers' });
  }
  if (pack.runbooks.length !== 2) {
    issues.push({ field: 'runbooks', message: 'exactly two RB runbooks are required' });
  }
  pack.runbooks.forEach((runbook) => {
    if (runbook.steps.length < 3) {
      issues.push({
        field: `runbooks.${runbook.id}.steps`,
        message: 'each RB runbook requires at least three executable steps'
      });
    }
    if (runbook.closure_gates.length === 0) {
      issues.push({
        field: `runbooks.${runbook.id}.closure_gates`,
        message: 'closure gates must be quantified'
      });
    }
    runbook.closure_gates.forEach((gate) => {
      if (!Number.isFinite(gate.target)) {
        issues.push({
          field: `runbooks.${runbook.id}.closure_gates.${gate.id}`,
          message: 'closure gate target must be numeric'
        });
      }
    });
  });
  if (pack.cutover_checklist.sections.length < 4) {
    issues.push({
      field: 'cutover_checklist.sections',
      message: 'cutover checklist must include pre-checks, steps, rollback, and comms'
    });
  }
  if (pack.go_no_go_template.required_signers.filter((signer) => signer.required).length < 4) {
    issues.push({
      field: 'go_no_go_template.required_signers',
      message: 'go/no-go template needs required signers for engineering, SRE, product, and safety'
    });
  }
  if (pack.tabletop.issues.length === 0) {
    issues.push({ field: 'tabletop.issues', message: 'tabletop must record issues' });
  }
  if (
    pack.freeze_policy.real_cutover_executed ||
    pack.freeze_policy.single_write_enabled ||
    pack.freeze_policy.git_push ||
    pack.freeze_policy.merge_request_api ||
    pack.freeze_policy.jira_write ||
    pack.freeze_policy.auto_merge
  ) {
    issues.push({ field: 'freeze_policy', message: 'all real write/cutover flags must be false' });
  }
  return issues;
}

function buildBlockingRunbooks(): readonly BlockingRunbook[] {
  return [buildRb1Runbook(), buildRb2Runbook()];
}

function buildRb1Runbook(): BlockingRunbook {
  const steps: readonly RunbookStep[] = [
    {
      id: 'rb1-01',
      title: 'Bind GitLab Runner to project or group',
      owner: 'SRE',
      estimated_minutes: 30,
      command_or_action:
        'Register or assign a non-shared Runner to the target project/group and verify protected-branch access.',
      acceptance_gates: [
        gate('runner_online_count', 'online runners matching project scope', '>=', 1, 'runner'),
        gate('runner_last_contact_age_minutes', 'runner last contact age', '<=', 5, 'minutes')
      ],
      evidence_output: 'reports/w18/evidence/rb1-runner-binding.json'
    },
    {
      id: 'rb1-02',
      title: 'Apply tag strategy',
      owner: 'SRE + Maintainer',
      estimated_minutes: 20,
      command_or_action:
        'Configure tags for gate1/gate2/gate3 jobs and reject untagged protected jobs.',
      acceptance_gates: [
        gate('required_tag_count', 'required tags present', '>=', 3, 'tag'),
        gate('untagged_protected_jobs', 'untagged protected jobs', '=', 0, 'job')
      ],
      evidence_output: 'reports/w18/evidence/rb1-tag-strategy.json'
    },
    {
      id: 'rb1-03',
      title: 'Run pipeline acceptance',
      owner: 'Release Captain',
      estimated_minutes: 60,
      command_or_action:
        'Run a live MR pipeline that executes gate1, gate2, gate3, and correction capture without retry-only success.',
      acceptance_gates: [
        gate('live_pipeline_success_count', 'successful live MR pipelines', '>=', 1, 'pipeline'),
        gate('required_gate_success_count', 'successful required gates', '>=', 4, 'gate'),
        gate('manual_retry_count', 'manual retries required for green pipeline', '=', 0, 'retry')
      ],
      evidence_output: 'reports/w18/evidence/rb1-pipeline-acceptance.json'
    }
  ];

  return {
    id: 'rb1_runner_live_ci',
    blocker_id: 'RB-1',
    title: 'RB-1 Closure Runbook: GitLab Runner Live CI',
    objective:
      'Close Runner availability by proving live MR pipeline execution for required gates.',
    current_status: 'open',
    estimated_total_minutes: sumMinutes(steps),
    prerequisites: [
      'Project maintainer access is available.',
      'Runner registration token or group-level runner assignment path is available.',
      'Protected branch and tag policy owners are on call.'
    ],
    steps,
    closure_gates: [
      gate('live_pipeline_success_count', 'successful live MR pipelines', '>=', 1, 'pipeline'),
      gate('required_gate_success_count', 'successful required gates in pipeline', '>=', 4, 'gate'),
      gate('manual_retry_count', 'manual retries required', '=', 0, 'retry'),
      gate('runner_last_contact_age_minutes', 'runner last contact age', '<=', 5, 'minutes')
    ],
    archive_outputs: [
      'reports/w18/evidence/rb1-runner-binding.json',
      'reports/w18/evidence/rb1-tag-strategy.json',
      'reports/w18/evidence/rb1-pipeline-acceptance.json'
    ]
  };
}

function buildRb2Runbook(): BlockingRunbook {
  const steps: readonly RunbookStep[] = [
    {
      id: 'rb2-01',
      title: 'Start two-day dual-write window',
      owner: 'Platform Owner',
      estimated_minutes: 30,
      command_or_action:
        'Enable monitored dual-write in live environment while single-write cutover remains disabled.',
      acceptance_gates: [
        gate('dual_write_window_hours', 'continuous dual-write window', '>=', 48, 'hour'),
        gate(
          'single_write_enabled',
          'single-write mode enabled during evidence collection',
          '=',
          0,
          'boolean'
        )
      ],
      evidence_output: 'reports/w18/evidence/rb2-dual-write-window.json'
    },
    {
      id: 'rb2-02',
      title: 'Archive daily drift reports',
      owner: 'Memory Owner',
      estimated_minutes: 60,
      command_or_action:
        'Archive two daily live drift reports with read-after-write samples from both writers.',
      acceptance_gates: [
        gate('daily_live_report_count', 'archived daily live drift reports', '>=', 2, 'report'),
        gate('drift_count', 'drift count per daily report', '=', 0, 'drift'),
        gate(
          'read_after_write_sample_count',
          'read-after-write samples per day',
          '>=',
          20,
          'sample'
        )
      ],
      evidence_output: 'reports/w18/evidence/rb2-drift-reports.json'
    },
    {
      id: 'rb2-03',
      title: 'Single-write decision gate',
      owner: 'Release Captain + SRE',
      estimated_minutes: 30,
      command_or_action:
        'Evaluate dual-write evidence and prepare signed single-write change request without applying it.',
      acceptance_gates: [
        gate(
          'consecutive_zero_drift_days',
          'consecutive live days with drift_count=0',
          '>=',
          2,
          'day'
        ),
        gate('p0_incident_count', 'P0 incidents during window', '=', 0, 'incident'),
        gate('required_signer_count', 'required go/no-go signers present', '>=', 4, 'signature')
      ],
      evidence_output: 'reports/w18/evidence/rb2-single-write-decision.json'
    }
  ];

  return {
    id: 'rb2_dual_write_drift',
    blocker_id: 'RB-2',
    title: 'RB-2 Closure Runbook: Two-Day Dual-Write Drift',
    objective:
      'Close dual-write readiness by proving drift_count=0 for two consecutive live days and archiving evidence.',
    current_status: 'open',
    estimated_total_minutes: sumMinutes(steps),
    prerequisites: [
      'Live dual-write instrumentation is deployed.',
      'Both old and new write paths emit comparable trace IDs.',
      'Daily drift report storage path is agreed and immutable.'
    ],
    steps,
    closure_gates: [
      gate('dual_write_window_hours', 'continuous dual-write window', '>=', 48, 'hour'),
      gate(
        'consecutive_zero_drift_days',
        'consecutive live days with drift_count=0',
        '>=',
        2,
        'day'
      ),
      gate('daily_live_report_count', 'archived daily live drift reports', '>=', 2, 'report'),
      gate('p0_incident_count', 'P0 incidents during window', '=', 0, 'incident')
    ],
    archive_outputs: [
      'reports/w18/evidence/rb2-dual-write-window.json',
      'reports/w18/evidence/rb2-drift-reports.json',
      'reports/w18/evidence/rb2-single-write-decision.json'
    ]
  };
}

function buildCutoverChecklist(): CutoverChecklist {
  return {
    title: 'W18 Cutover Checklist',
    mode: 'rehearsal_only',
    sections: [
      {
        id: 'pre_checks',
        title: 'Pre-checks',
        items: [
          'RB-1 status is closed with live_pipeline_success_count >= 1.',
          'RB-2 status is closed with consecutive_zero_drift_days >= 2.',
          'gate1/gate2/gate3 latest run status is PASS.',
          'W16 write intent approvals exist for every real write path.',
          'On-call roster has primary and secondary responders for 24 hours.'
        ]
      },
      {
        id: 'cutover_steps',
        title: 'Cutover Steps',
        items: [
          'Announce T-30 minutes freeze confirmation in release channel.',
          'Verify write freeze is still active before any unlock request.',
          'Apply approved write intent only after required signers approve.',
          'Monitor first 20 write operations and compare audit trace completeness.',
          'Keep old write path available for rollback for at least 24 hours.'
        ]
      },
      {
        id: 'rollback',
        title: 'Rollback Conditions',
        items: [
          'Rollback if drift_count > 0 in any live comparison window.',
          'Rollback if P0/P1 incident count >= 1 during cutover window.',
          'Rollback if audit trace coverage drops below 100%.',
          'Rollback if required gate status becomes FAIL or UNKNOWN.',
          'Rollback if on-call acknowledgement latency exceeds 10 minutes.'
        ]
      },
      {
        id: 'oncall_comms',
        title: 'On-call and Communication',
        items: [
          'Release captain owns go/no-go bridge and timeline.',
          'SRE owns Runner and pipeline health.',
          'Memory owner owns dual-write drift evidence.',
          'Product owner owns customer-impact messaging.',
          'Security owner owns write approval and audit trace review.'
        ]
      }
    ],
    rollback_conditions: [
      'drift_count > 0',
      'P0/P1 incident count >= 1',
      'audit trace coverage < 100%',
      'gate1/gate2/gate3 not PASS',
      'manual approval missing for any real write'
    ],
    communication_templates: [
      'T-30: Readiness check started; no real write unlock requested.',
      'T-0: Approved cutover would start only after RB-1/RB-2 closure and signer confirmation.',
      'Rollback: Reverting to frozen write posture because {condition}; next update in 15 minutes.',
      'No-Go: Cutover remains blocked by {blocker}; next review at {time}.'
    ]
  };
}

function buildGoNoGoTemplate(decision: ReadinessDecision): GoNoGoTemplate {
  return {
    decision,
    reason:
      decision === 'GO'
        ? 'All quantitative gates are closed and management signoff is complete.'
        : 'RB-1 Runner live CI and RB-2 two-day dual-write drift evidence are still open.',
    required_signers: [
      {
        role: 'Release Captain',
        required: true,
        signs_for: 'final sequencing and rollback authority'
      },
      {
        role: 'SRE Owner',
        required: true,
        signs_for: 'Runner, pipeline, and on-call readiness'
      },
      {
        role: 'Memory Owner',
        required: true,
        signs_for: 'dual-write drift and single-write eligibility'
      },
      {
        role: 'Security Owner',
        required: true,
        signs_for: 'write intent approvals and audit trace coverage'
      },
      {
        role: 'Product Owner',
        required: true,
        signs_for: 'customer-impact and communication readiness'
      }
    ],
    earliest_real_write_unlock:
      'Only after RB-1 closed, RB-2 closed, required_signer_count >= 5, and audit trace coverage = 100%.',
    approval_rules: [
      'No real write can be enabled while decision=NO-GO.',
      'No single-write mode can be enabled before consecutive_zero_drift_days >= 2.',
      'No Git push, MR API creation, Jira write, or auto-merge can be performed by this pack.',
      'Any missing signer keeps the decision at NO-GO.'
    ],
    management_review_status: 'pending_rb_closure'
  };
}

function buildTabletopExercise(): TabletopExercise {
  return {
    title: 'W18 Tabletop Exercise: No-Go Cutover Rehearsal',
    mode: 'tabletop',
    scenarios: [
      'Runner is still unavailable at T-30.',
      'Dual-write report day 2 is missing from archive.',
      'A write unlock request appears without security approval.',
      'Drift count becomes non-zero during simulated cutover.',
      'On-call primary does not acknowledge within 10 minutes.'
    ],
    issues: [
      {
        id: 'TT-01',
        severity: 'P1',
        scenario: 'Runner unavailable at T-30',
        finding: 'RB-1 cannot be closed without a successful live MR pipeline.',
        revision_item: 'Add explicit NO-GO announcement template for Runner unavailable state.',
        owner: 'SRE Owner'
      },
      {
        id: 'TT-02',
        severity: 'P1',
        scenario: 'Missing day-2 dual-write archive',
        finding: 'RB-2 cannot rely on mock drift evidence or one-day live evidence.',
        revision_item: 'Require daily_live_report_count >= 2 before management review.',
        owner: 'Memory Owner'
      },
      {
        id: 'TT-03',
        severity: 'P0',
        scenario: 'Unapproved write unlock request',
        finding: 'Any bypass attempt must be blocked by W16 write intent policy.',
        revision_item: 'Add signer checklist line for write intent approval ID.',
        owner: 'Security Owner'
      },
      {
        id: 'TT-04',
        severity: 'P1',
        scenario: 'Non-zero drift during rehearsal',
        finding: 'Single-write cutover must remain blocked when drift_count > 0.',
        revision_item: 'Add rollback condition drift_count > 0 to cutover checklist.',
        owner: 'Release Captain'
      }
    ],
    conclusion: 'NO-GO',
    revision_summary: [
      'Keep write freeze active until RB-1/RB-2 are both closed.',
      'Require archived live evidence rather than mock reports.',
      'Require security approval trace before any write unlock.'
    ]
  };
}

function gate(
  id: string,
  metric: string,
  operator: QuantitativeGate['operator'],
  target: number,
  unit: string
): QuantitativeGate {
  return {
    id,
    metric,
    operator,
    target,
    unit,
    evidence_required: `${metric} ${operator} ${target} ${unit}`
  };
}

function sumMinutes(steps: readonly RunbookStep[]): number {
  return steps.reduce((total, step) => total + step.estimated_minutes, 0);
}
