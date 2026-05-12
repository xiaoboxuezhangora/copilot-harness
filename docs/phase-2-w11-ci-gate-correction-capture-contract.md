# Phase 2 W11: CI Gate and Correction Capture Contract

Generated at: 2026-05-12

## Source Contracts Read

- `.gitlab-ci.yml` currently has separate `format-check`, `lint`, `typecheck`, `test`, and `eval-harvester-mock` jobs, with CI still opt-in through `ENABLE_GITLAB_CI=1`.
- `orchestrator/src/gates/index.ts` already defines `DefaultBudgetGate`, `DefaultPolicyGate`, and `DefaultValidator`; W11 adds CI policy scanning rather than changing those runtime gates.
- `orchestrator/src/automemory/*` already writes `.memory/pending/**/*.md`, parses `## Accepted Candidates`, applies redline checks before memory writes, and audits review decisions.
- `docs/phase-2-w10-closure.md` states real `/fleet`, real worktree fanout, and real GitLab MR creation are `NO-GO` / `real_disabled`.
- `docs/phase-1b-w8-review-cli-contract.md` states Review CLI is local, does not write GitLab/Jira/Notion, and requires pending candidates to carry source refs.

## Scope

W11 wires draft MR artifacts into three deterministic CI gates and captures actionable GitLab MR review comments into Auto-Memory pending correction files.

W11 does not enable production execution:

- Real `/fleet` fanout remains `real_disabled`.
- Real git worktree creation remains `real_disabled`.
- Real GitLab MR creation remains `real_disabled`.
- No CI job may push, merge, create an MR, or change Jira status.

## CI Three-Gate Model

### Gate 1: Quality

Command:

```sh
pnpm ci:gate1
```

Required checks:

- `pnpm --filter @copilot-harness/orchestrator ci:format-check`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`

The W11 format check is changed-file scoped by default and can be forced to all tracked
formattable files with `--scope all`. This keeps historical generated eval artifacts from blocking
the first W11 gate while still blocking new unformatted changes. Generated reports under
`orchestrator/eval/harvester*`, `.memory/`, and `reports/` are exempt because Gate 2 and
Correction Capture rewrite them as artifacts.

Failure condition: any command exits non-zero.

### Gate 2: Eval Regression

Command:

```sh
pnpm ci:gate2
```

Required checks:

- Runs `@copilot-harness/orchestrator eval:harvester` against the fixed 20-sample mock dataset.
- Uses `--enforce-thresholds`.
- CI job timeout target is five minutes.

Failure condition: any threshold regression or timeout blocks the pipeline.

### Gate 3: Policy

Command:

```sh
pnpm ci:gate3
```

Required checks:

- Loads root `policies.yaml`.
- Fails changed redline paths.
- Fails forbidden secret, token, private key, PHI, and sensitive request/response patterns.
- Emits a JSON report without printing matched content.
- If MR diff environment variables are absent, falls back deterministically to local git changed files.

Failure condition: at least one policy violation blocks the pipeline.

## Correction Capture

Command:

```sh
pnpm --filter @copilot-harness/orchestrator automemory-capture-corrections
```

Data flow:

1. Read GitLab MR discussions through a read-only API call when `GITLAB_BASE_URL`, project id, MR iid, and a token are present.
2. If MR environment is absent, run deterministic fallback and write a report with zero pending files.
3. Extract actionable review notes and suggestions.
4. Redact sensitive content before writing markdown.
5. Write `.memory/pending/correction-*.md` with `kind: correction` candidates that remain compatible with the W8 Review CLI.
6. Write a structured audit summary without reviewer PII or raw sensitive snippets.

## Correction Schema

Each captured correction record must contain:

```ts
interface W11CorrectionRecord {
  readonly before_diff: string;
  readonly after_diff: string;
  readonly reviewer_reason: string;
  readonly skill_hint: readonly string[];
  readonly source_ref: string;
  readonly redaction_status: "clean" | "redacted";
}
```

Reviewer identity is not stored. Implementations may store a non-reversible reviewer hash in future, but W11 omits it.

## Redaction Rules

- Tokens, bearer headers, platform credentials, CA private keys, patient identifiers, PHI markers, and full sensitive request/response bodies must not be written to pending markdown, reports, or audit logs.
- Redacted fields use `[REDACTED:<rule_id>]` placeholders.
- If content cannot be made safe after redaction, the correction is skipped and only aggregate counts are reported.

## Artifacts

- `reports/w11-policy-report.json`
- `reports/w11-correction-capture.json`
- `.memory/pending/correction-*.md`
- Existing Gate 2 reports under `orchestrator/eval/harvester*`
