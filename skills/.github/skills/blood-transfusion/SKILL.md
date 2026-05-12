---
name: blood-transfusion
description: "正触发：当编程任务涉及 APMIS 输血业务链路、输血闭环代码生成/审查、备改输、BIZ857、输血申请、取血、血袋核对、输血前双人核对、bloodTransfusionCode、neuBTMIS、scene code、异步消息或平台推送排查时触发。反触发：当任务要求执行真实输血业务动作、绕过临床核对流程、明确属于非输血模块、SSO/CA/登录启动、纯移动端且未复用输血链路，或用户只要求局部非输血代码修改时不触发。"
owner: copilot-harness
source_ref:
  - opencode:/Users/wangbo/APMIS/main/.opencode/skills/blood/SKILL.md
  - opencode:/Users/wangbo/APMIS/main/.opencode/skills/blood/references
  - references/rules.md
  - references/anti-patterns.md
---

# Blood Transfusion

## What This Skill Does

- Help the assistant understand transfusion-domain requirements and generate safer code, tests, review notes, and investigation plans.
- Enter the right APMIS context for transfusion-domain analysis without scanning unrelated repos.
- Distinguish whether a problem belongs to PC frontend, ODCBS core backend, ODBIP platform integration, or a cross-repo joint-debugging path.
- Trace page entry, API entry, scene-code dispatch, business-rule landing points, async messages, platform push, and status write-back.
- Reuse prior implementation experience as coding constraints rather than as instructions to operate the clinical system.
- Treat `APMIS/main` as a multi-repo cognition layer. Do not treat the root as a single runtime repo.
- Prefer ownership conclusions and investigation routes. Do not default to redesign or refactor proposals.

## Scope Boundary

- This skill is for software engineering work only: requirement analysis, code location, code generation constraints, tests, reviews, and experience reuse.
- It must not execute, simulate approval for, or instruct a user to bypass any real transfusion operation.
- When a task could affect clinical safety, return code-level safeguards and validation needs; do not produce operational shortcuts.

## When To Use

- The user asks to analyze a transfusion business chain.
- The user asks to implement, review, or test code in a transfusion-related workflow.
- The user mentions `备改输`, `BIZ857`, `输血申请`, `取血`, `血袋核对`, `输血前双人核对`, `bloodTransfusionCode`, or `neuBTMIS`.
- The user needs to decide whether an issue lives in frontend, ODCBS core backend, ODBIP platform, or across layers.
- The task is joint debugging across `frontend/odcbs-frontend`, `backend/odcbs-backend`, and `backend/odbip-custom-backend`.

## When Not To Use

- The issue is unrelated to transfusion or perioperative blood workflows.
- The user asks the assistant to perform a real clinical transfusion action, approve a transfusion, or bypass manual verification.
- The task is primarily SSO, CA signing, login bootstrap, or a non-transfusion ODBIP integration.
- The user already narrowed the problem to a non-transfusion module and only wants local code changes there.
- The symptom is mobile-only and does not reuse the same transfusion chain; start from the mobile repo first and return to this skill only if the chain crosses into ODCBS or ODBIP.

## Core Coding Rules

Use these as implementation and review constraints whenever transfusion code is touched. Load
`references/rules.md` when the task requires rule-level detail or source refs.

1. `scan-before-execute`: code must not record transfusion execution, blood-bag confirmation, or take-blood completion unless the required scan state is explicitly successful.
2. `double-check-required`: pre-transfusion double-check logic must remain explicit and auditable; do not auto-click, default-confirm, or silently skip double-check gates.
3. `reaction-sop-required`: transfusion reaction handling must call or preserve the SOP/incident branch; do not reduce reaction handling to a UI toast or best-effort log.
4. `scene-code-source-of-truth`: scene-specific behavior must resolve through the existing `bloodTransfusionCode` / `getBloodSceneCode` chain; do not hard-code hospital scene codes without a documented customization boundary.
5. `platform-push-observable`: platform push, status write-back, async enqueue, and consumer failure must be observable through status, retry, or error detail; do not swallow integration failures as success.
6. `idempotent-replay`: offline or async replay must use stable business identifiers such as blood bag, application, message, or operation ids; do not rely only on timestamps.
7. `redact-sensitive-context`: logs, audit events, traces, and Memory candidates must avoid raw patient identifiers, blood bag numbers, reaction detail text, access tokens, or platform credentials unless an existing project redaction policy explicitly allows it.
8. `minimal-layer-change`: modify the owning layer only. If the symptom is frontend-visible but the rule lives in ODCBS or ODBIP, produce a cross-layer plan before patching UI behavior.
9. `source-ref-required`: any generated rule, claim, or review finding must include a path, API, trace doc, Jira key, or other `source_ref`.
10. `human-review-on-clinical-gate`: changes touching scan gates, double-check, reaction handling, status write-back, or platform push must be flagged for human review even if tests pass.

## Code Anti-Patterns

Flag these patterns during implementation or review. Load `references/anti-patterns.md` when the
task requires precise review wording or source refs.

1. `scanResult || true`, `if (!scanResult) return success`, or any fallback that records execution after failed/unknown scan state.
2. Frontend buttons or service methods that call confirmation APIs directly while bypassing double-check state, reviewer identity, or required scan records.
3. `catch (e) { return success(); }`, empty catch blocks, or warning-only handling around platform push, message enqueue, status write-back, or transfusion reaction reporting.
4. Hard-coded scene or hospital behavior such as `sceneCode = "neuBTMIS"` in generic code paths, without a clearly isolated customization module.
5. Offline replay keys based only on `patientNo + timestamp`, causing blood-bag records or application records to overwrite each other.
6. Logs or Memory values that include raw `patientNo`, `inpatientNo`, `bloodBagNo`, reaction detail, access token, platform secret, or complete request/response payloads.
7. UI-only fixes that hide an unsafe backend state, such as disabling a warning without correcting ODCBS/ODBIP status semantics.
8. Mock endpoints that call real HIS, blood-bank, SOAP, MQ, or platform services while being labeled as demo/mock behavior.

## Skill-Hit Behavior Constraints

- Default mode is analysis/code assistance, not clinical operation.
- If a proposed change touches scan gates, double-check, reaction SOP, platform push, or status write-back, set `confirm_required=true` in the response and call out the human-review point.
- If user input lacks hospital/site/env/custom module and the task depends on customization, ask for or infer the missing axis before editing.
- If the task is qdfe-specific, load `references/transfusion-biz857.md`; otherwise avoid importing qdfe assumptions into other hospitals.
- If source evidence is missing, output `await_human` or `need_more_context` rather than inventing a business rule.

## Interaction With Other Skills

- Use `jira-requirement-analysis` first when the user provides a Jira issue and needs an Evidence Pack.
- Use `angular-delivery` when the transfusion task touches Angular PC pages, ng-zorro tables, overlays, forms, or shared UI behavior.
- Use `angular17-upgrade-regression-handler` only when the transfusion symptom is specifically an Angular 17 upgrade regression.
- Use Java/Spring guidance when patching `backend/odcbs-backend` or `backend/odbip-custom-backend`.
- Keep this skill as the transfusion-domain boundary checker even when another framework skill owns the code style.

## Programming Task Output Contract

For coding tasks, include these fields in the answer or change note:

- `owning_layer`: `frontend` / `odcbs-backend` / `odbip-custom-backend` / `cross-layer`.
- `problem_type`: one of the types in this skill's classification list.
- `rule_hits`: applicable core coding rule ids.
- `anti_pattern_hits`: concrete anti-pattern ids, if any.
- `owned_paths`: files or modules to change.
- `avoid_touch`: files, repos, or clinical gates that should not be changed.
- `source_refs`: paths, trace docs, Jira keys, commits, or payload anchors used as evidence.
- `validation`: minimum build, test, API, fixture, or manual-review checks.
- `memory_candidates`: stable lessons worth saving, with sensitive details redacted.

## Memory-Friendly Experience Keys

Prefer these stable keys when proposing Memory candidates:

- `blood-transfusion.scan-before-execute.required`
- `blood-transfusion.double-check.required`
- `blood-transfusion.reaction-sop.required`
- `blood-transfusion.scene-code.cross-repo`
- `blood-transfusion.platform-push.must-not-swallow-failure`
- `blood-transfusion.async-replay.idempotent`
- `blood-transfusion.log-redaction.required`
- `blood-transfusion.mock.no-real-third-party`

## Core Workflow

1. Start from workspace cognition, not code guessing.
   - Read `AGENTS.md`.
   - Read `docs/architecture/workspace-topology.yaml`.
   - Read `references/topology.md`, `references/repo-entrypoints.md`, and `references/search-seeds.md` before broad repo search.
   - Confirm current hospital/site/env/custom module first.
   - Identify whether the issue is in a generic scene path or `odbip-custom-${hospCode}` customization path.
   - If the issue mentions `备改输`, `BIZ857`, qdfe, or `scheduleStatus=18`, do not jump straight to qdfe assumptions. First verify whether the current issue actually belongs to qdfe or explicitly references the qdfe trace.
   - Only after confirming qdfe-specific scope, read `docs/architecture/traces/06-qdfe-biz857-backup-to-transfusion.md` and `references/transfusion-biz857.md`.

2. Classify the owning layer first.
   - `frontend/odcbs-frontend`: page entry, UI behavior, route dispatch, API invocation, site overlay.
   - `backend/odcbs-backend`: transfusion business rule, scene dispatch, persistence, blood-cycle implementation.
   - `backend/odbip-custom-backend`: external interface reception, hospital customization, async message bridge, platform push, status write-back.
   - `cross-layer`: scene-code mismatch, contract mismatch, async lag, data-source gap, or platform push issues spanning more than one repo.

3. Classify the problem type second.
   - `page`: wrong page, wrong component, wrong route, incorrect scene-specific UI.
   - `api`: wrong endpoint, wrong params, wrong response mapping.
   - `business-rule`: application, take, transfusion logic, scene-specific service selection, persistence behavior.
   - `message`: message enqueue, polling, consume, retry, idempotency.
   - `push`: platform outbound call, service code, auth mapping, DTO fields, state write-back.
   - `config/scene`: `bloodTransfusionCode`, `local-dev`, `hospCode`, site or env overlays.
   - `coding`: scene or service code constants such as `neuBTMIS`, `BIZ820`, `BIZ857`.

4. Follow only the narrow route that matches the classification.
   - Start from the visible symptom.
   - Walk to the first concrete entrypoint.
   - Cross into the next repo only when the previous repo delegates or stubs the responsibility.
   - Record the handoff point explicitly.

5. Return analysis in this order.
   - Owning repo or cross-repo conclusion.
   - Problem type.
   - Evidence paths.
   - Investigation route.
   - Missing data or next checks.
   - Change suggestions only if the user asks.

## Key Boundaries

- `APMIS/main` is a multi-repo cognition layer, not a single runtime repo.
- `frontend/odcbs-frontend` is usually the first visible symptom source, not the business truth source.
- `backend/odcbs-backend` is the default truth source for transfusion business behavior inside ODCBS.
- `backend/odbip-custom-backend` owns hospital customization, inbound/outbound integration, async bridging, platform push, and status write-back. Do not misclassify it as the whole business source.
- `ODCBS -> ODBIP` scene discovery is a real cross-repo boundary. `getBloodSceneCode` in ODCBS ultimately depends on ODBIP `BrowseSceneInfo`.
- `备改输 -> BIZ857` is a special investigation path. Verify actual implementation versus trace baseline before concluding.
- qdfe `备改输 -> BIZ857` is a special baseline, not a universal default for every hospital customization.
- Do not conclude "frontend issue" just because the symptom appears on a page.
- Do not skip ODCBS core-business verification just because a platform interface is involved.

## Initial Files To Read

- `AGENTS.md`
- `docs/architecture/workspace-topology.yaml`
- `references/topology.md`
- `references/repo-entrypoints.md`
- `references/debug-routes.md`
- `references/search-seeds.md`

Conditionally read these qdfe-specific files only after confirming the issue is actually qdfe-related:

- `docs/architecture/traces/06-qdfe-biz857-backup-to-transfusion.md`
- `references/transfusion-biz857.md`

## Typical Investigation Routes

- Analyze transfusion business chain:
  - `frontend/odcbs-frontend` route or component
  - `/atBloodApply/*` API
  - `backend/odcbs-backend` `OpBloodApplyController`
  - `OpBLoodApplyServiceFacade`
  - scene-specific `*BloodCycleService`
  - outer stub or persistence
  - if scene resolution depends on ODBIP, continue to `BrowseSceneInfo`

- Determine which repo owns the issue:
  - Wrong page or wrong component selection: frontend first.
  - Wrong scene code or wrong page dispatch: frontend -> ODCBS `getBloodSceneCode` -> ODBIP `BrowseSceneInfo`.
  - Wrong application, take, transfusion data or persistence: ODCBS first.
  - Missing platform callback, async lag, or outbound push: ODBIP first.
  - Cross-repo data mismatch: trace the handoff point and compare request and response payloads before blaming either side.

- Investigate `备改输` or `BIZ857`:
  - Confirm current hospital/site/custom module first.
  - If the issue is not qdfe-specific, do not import qdfe-specific assumptions.
  - If qdfe-specific, read the qdfe trace baseline and compare it with the current branch.
  - Verify whether current qdfe code contains `BIZ857` artifacts or only older `BIZ820` patterns.
  - If current code lacks `BIZ857`, treat it as a baseline-versus-implementation gap rather than an already-wired runtime defect.
  - If the chain exists, follow `receive` or event entry -> `addYjcMsg` -> `MsgSyncJob` -> `RegisterDataServiceImplForCustom` -> `HttpClient` -> platform response -> error or status write-back.

- Investigate scene-specific transfusion behavior:
  - Frontend dynamic directive asks `/atBloodApply/getBloodSceneCode`.
  - ODCBS `SceneCodeUtil` calls ODBIP `BrowseSceneInfo`.
  - ODCBS facade resolves bean name `<sceneCode>BloodCycleService`.
  - ODCBS implementation falls into `neubtmis`, `lnsrmyy`, `lnszlyy`, `sjyy`, or another scene bean.
  - ODBIP qdfe currently returns `bloodTransfusionCode=neuBTMIS`.

- Investigate platform push or status write-back:
  - Do not start from frontend.
  - Start from `backend/odbip-custom-backend` controller or event source, then async queue, batch consume, register branch, and `HttpClient`.
  - Check service code, auth mapping, DTO fields, consumer scheduling and retry, then upstream and downstream data completeness.

## References

- `references/topology.md`: workspace model, repo roles, and ownership boundaries.
- `references/repo-entrypoints.md`: high-value files to open first.
- `references/debug-routes.md`: symptom-to-route investigation map.
- `references/search-seeds.md`: ready-to-run grep seeds for fast first-pass location.
- `references/transfusion-biz857.md`: qdfe `备改输 -> BIZ857` baseline and implementation checks.
