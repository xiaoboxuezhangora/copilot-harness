# Blood Transfusion Code Anti-Patterns

Use these examples during implementation and review. They are code-risk patterns, not clinical
operation instructions.

## A1 scan fallback records execution

Examples:

- `scanResult || true`
- `if (!scanResult) return success()`
- writing `executed=true` when scan state is missing or unknown

Why it matters: it violates `R1 scan-before-execute`.

source_ref:

- `references/repo-entrypoints.md`: blood application/check components and `/atBloodApply`
  backend entrypoints.

## A2 confirmation bypasses double-check

Examples:

- frontend button directly calls confirmation API before reviewer identity is captured
- service method writes confirmation state without checking double-check record
- UI defaults a double-check modal to confirmed

Why it matters: it violates `R2 double-check-required`.

source_ref:

- `references/repo-entrypoints.md`: blood-taken-check and blood-transfution-check directive
  entrypoints.

## A3 integration failure is converted to success

Examples:

- `catch (e) { return success(); }`
- empty catch around platform push, status write-back, message enqueue, or reaction reporting
- warning-only handling for outbound push failures with no retry/status detail

Why it matters: it violates `R5 platform-push-observable`.

source_ref:

- `references/repo-entrypoints.md`: ODBIP async and outbound push paths.
- `references/transfusion-biz857.md`

## A4 scene code hard-coded in a generic path

Examples:

- `sceneCode = "neuBTMIS"` in generic ODCBS code
- frontend maps a hospital directly instead of using `getBloodSceneCode`
- fallback scene code silently changes behavior for all hospitals

Why it matters: it violates `R4 scene-code-source-of-truth`.

source_ref:

- `references/topology.md`: scene selection is a cross-repo concern.
- `references/repo-entrypoints.md`: `SceneCodeUtil` and `BrowseSceneInfo` paths.

## A5 replay key is timestamp-only or patient-only

Examples:

- `patientNo + timestamp` as the only replay key
- overwriting blood-bag records when multiple bags share a patient/time window
- retry consuming the same message without stable message id or idempotency check

Why it matters: it violates `R6 idempotent-replay`.

source_ref:

- `references/debug-routes.md`: message and idempotency route.

## A6 sensitive payload enters logs or Memory

Examples:

- logging raw `patientNo`, `inpatientNo`, `bloodBagNo`, reaction detail, access token, platform
  secret, or full request/response payload
- storing raw transfusion payloads in Memory candidates

Why it matters: it violates `R7 redact-sensitive-context`.

source_ref:

- `references/topology.md`
- `references/search-seeds.md`

## A7 UI hides unsafe backend state

Examples:

- disabling a warning in the Angular page while ODCBS/ODBIP status remains inconsistent
- changing display labels to make an error appear successful
- local-only fix that masks a cross-layer contract mismatch

Why it matters: it violates `R8 minimal-layer-change`.

source_ref:

- `references/debug-routes.md`: cross-layer data mismatch route.

## A8 mock endpoint calls real third-party services

Examples:

- demo/mock endpoint calls real HIS, blood-bank, SOAP, MQ, or platform service
- method logs `DEMO_MOCK_BLOOD` while still using a real outbound client

Why it matters: mock code must be isolated from clinical or platform side effects.

source_ref:

- `references/repo-entrypoints.md`: ODBIP `HttpClient` and custom controller/service paths.
