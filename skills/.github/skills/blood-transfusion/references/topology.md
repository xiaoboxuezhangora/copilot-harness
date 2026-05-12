# Topology

## Workspace model

- `APMIS/main` is a non-Git cognition layer for a multi-repo workspace.
- The root is for architecture docs, trace packs, and shared orientation. Real code ownership, commits, and rollbacks happen inside subrepos.
- Default read order for this domain: `AGENTS.md` -> `docs/architecture/workspace-topology.yaml` -> transfusion-specific references -> only then repo entrypoints.

## Repo roles for this domain

- `frontend/odcbs-frontend`
  - Angular PC channel.
  - Owns page entry, route dispatch, scene-specific page selection, API invocation, and site overlays via `local-dev`.
  - Default frontend repo for this skill.

- `backend/odcbs-backend`
  - Core business source for transfusion workflows in ODCBS.
  - Owns `/atBloodApply` endpoints, blood scene dispatch, scene-specific `IBloodCycleService` implementations, persistence, and core business rules.
  - When a symptom is "data wrong", "logic wrong", or "scene selection wrong", this is usually the first backend repo to verify.

- `backend/odbip-custom-backend`
  - Integration orchestration and platform interface layer.
  - Owns hospital customization, outer receive endpoints, async message queueing, batch consumption, platform push, and status write-back.
  - Not the whole business truth source; do not treat it as replacing ODCBS domain logic.

- `frontend/aims-mobile-vue`
  - Secondary frontend channel.
  - Only bring it into scope if the prompt explicitly mentions H5, Android, mobile, socket, or a mobile-only symptom.

## Ownership rules

- UI symptom does not automatically mean frontend ownership.
- Platform push symptom does not automatically bypass ODCBS business-rule verification.
- `bloodTransfusionCode` and scene selection are cross-repo concerns:
  - frontend asks ODCBS
  - ODCBS asks ODBIP
  - ODBIP returns the scene code
- qdfe hospital customization lives in `backend/odbip-custom-backend/odbip-custom-qdfe`; this is where platform-side transfusion specialization is checked first for qdfe issues.

## Business truth versus orchestration

- Frontend is a page and request initiator.
- ODCBS is the primary truth source for transfusion business behavior inside the clinical system.
- ODBIP is the orchestration and integration layer for external contracts, async bridging, and platform push.
- For `备改输 -> BIZ857`, the field source and trigger source may still come from ODCBS or upstream events even if the actual push happens in ODBIP.
