# ADR-0001: W1 Uses One GitLab Monorepo

Status: Accepted

Date: 2026-04-27

## Context

The original Phase 0 W1 plan asked for three GitLab repositories:

- `orchestrator`
- `skills`
- `playbooks`

The actual GitLab repository is `http://10.100.77.238/b.w_neu/copilot-harness`. During W1 the
three workstreams are still bootstrap artifacts and are tightly coupled for validation:
`orchestrator` loads contracts, `skills` holds reusable instructions, and `playbooks` will later
compose workflows.

## Decision

Use a single GitLab repository for W1:

- `orchestrator/` contains the TypeScript package and local CI commands.
- `skills/` contains Skill assets under `.github/skills/`.
- `playbooks/` contains playbook assets under `.github/playbooks/`.
- Root `.gitlab-ci.yml` dispatches quality gates into `orchestrator/`.
- Root `CODEOWNERS` defines ownership for each workstream.

The W1 acceptance artifact changes from "three repository URLs" to:

- One repository URL: `http://10.100.77.238/b.w_neu/copilot-harness`
- Three top-level directories: `orchestrator/`, `skills/`, `playbooks/`
- One MR and one CI pipeline covering the monorepo

## Consequences

Positive:

- Lower setup overhead during Phase 0.
- One MR can validate contracts across orchestrator, Skill, and playbook assets.
- Easier W2 smoke work because package and assets share one commit boundary.

Tradeoffs:

- Permission boundaries are coarser than three separate repositories.
- Skill publishing and cross-project reuse will need an explicit extraction step later.
- CI must keep path ownership and package boundaries clear.

## Split Triggers

Revisit repository splitting when one of these becomes true:

- Skills need independent versioning or cross-project release.
- Playbooks become independently owned by a different team.
- GitLab permission requirements differ materially by workstream.
- Phase 3 needs publishing automation that is simpler with separate repositories.
