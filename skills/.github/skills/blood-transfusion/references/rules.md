# Blood Transfusion Coding Rules

These rules turn transfusion-domain experience into coding constraints. They are for software
engineering work only; they must not be used to execute real clinical actions.

## R1 scan-before-execute

Code must not record transfusion execution, blood-bag confirmation, or take-blood completion unless
the required scan state is explicitly successful.

source_ref:

- `references/repo-entrypoints.md`: frontend blood application/check components and ODCBS
  `/atBloodApply` entrypoints.
- `apmis:frontend/odcbs-frontend/odcbs-all/src/app/business/anesthesia/blood-closed-loop/**`
- `apmis:backend/odcbs-backend/odcbs-operation/src/main/java/com/neusoft/hit/odts/odcbs/operation/web/OpBloodApplyController.java`

## R2 double-check-required

Pre-transfusion double-check logic must remain explicit and auditable. Do not auto-click,
default-confirm, or silently skip double-check gates.

source_ref:

- `references/repo-entrypoints.md`: blood-taken-check and blood-transfution-check directive
  entrypoints.
- `apmis:frontend/odcbs-frontend/odcbs-all/src/app/business/anesthesia/blood-closed-loop/blood-transfution-check-directive.component.ts`
- `apmis:backend/odcbs-backend/odcbs-operation/src/main/java/com/neusoft/hit/odts/odcbs/operation/service/IBloodCycleService.java`

## R3 reaction-sop-required

Transfusion reaction handling must call or preserve the SOP/incident branch. Do not reduce reaction
handling to a UI toast or best-effort log.

source_ref:

- `references/topology.md`: ODCBS is the primary truth source for transfusion business behavior.
- `references/debug-routes.md`: symptom-to-route map for business-rule and cross-layer issues.

## R4 scene-code-source-of-truth

Scene-specific behavior must resolve through the existing `bloodTransfusionCode` /
`getBloodSceneCode` chain. Do not hard-code hospital scene codes in generic paths without a
documented customization boundary.

source_ref:

- `references/topology.md`: `bloodTransfusionCode` and scene selection are cross-repo concerns.
- `references/repo-entrypoints.md`: ODCBS `SceneCodeUtil` and ODBIP `BrowseSceneInfo`.
- `apmis:backend/odcbs-backend/odcbs-operation/src/main/java/com/neusoft/hit/odts/odcbs/operation/service/impl/facade/SceneCodeUtil.java`
- `apmis:backend/odbip-custom-backend/odbip-custom-qdfe/src/main/java/com/neusoft/hit/odts/odbip/custom/service/impl/BrowseSceneInfoServiceImplForCustom.java`

## R5 platform-push-observable

Platform push, status write-back, async enqueue, and consumer failure must be observable through
status, retry, or error detail. Do not swallow integration failures as success.

source_ref:

- `references/repo-entrypoints.md`: ODBIP `MsgSyncJob`, `RegisterDataServiceImplForCustom`, and
  `HttpClient` push path.
- `references/transfusion-biz857.md`: qdfe `备改输 -> BIZ857` baseline.

## R6 idempotent-replay

Offline or async replay must use stable business identifiers such as blood bag, application,
message, or operation ids. Do not rely only on timestamps.

source_ref:

- `references/debug-routes.md`: message enqueue, polling, consume, retry, and idempotency problem
  class.
- `references/repo-entrypoints.md`: ODBIP async consumer and message registry paths.

## R7 redact-sensitive-context

Logs, audit events, traces, and Memory candidates must avoid raw patient identifiers, blood bag
numbers, reaction detail text, access tokens, platform credentials, or complete request/response
payloads unless an existing project redaction policy explicitly allows it.

source_ref:

- `references/topology.md`: business truth versus orchestration boundaries.
- `references/search-seeds.md`: targeted search should avoid sweeping unrelated sensitive payloads.

## R8 minimal-layer-change

Modify the owning layer only. If the symptom is frontend-visible but the rule lives in ODCBS or
ODBIP, produce a cross-layer plan before patching UI behavior.

source_ref:

- `references/topology.md`: repo roles and ownership rules.
- `references/debug-routes.md`: symptom-to-route investigation map.

## R9 source-ref-required

Any generated rule, claim, or review finding must include a path, API, trace doc, Jira key, commit,
or payload anchor as `source_ref`.

source_ref:

- `references/repo-entrypoints.md`
- `references/debug-routes.md`
- `references/transfusion-biz857.md`

## R10 human-review-on-clinical-gate

Changes touching scan gates, double-check, reaction handling, status write-back, or platform push
must be flagged for human review even if tests pass.

source_ref:

- `references/topology.md`: transfusion is cross-layer clinical workflow logic.
- `references/transfusion-biz857.md`: platform push and status write-back are high-impact
  integration points.
