# Transfusion BIZ857

## Why this file exists

- `备改输 -> BIZ857` is a special route, not a generic transfusion page issue.
- The first task is to decide whether the user is asking about:
  - an already-implemented runtime chain,
  - a missing implementation,
  - or a cross-repo field-source gap.

## Baseline from the trace pack

- Trace source: `docs/architecture/traces/06-qdfe-biz857-backup-to-transfusion.md`
- The trace states:
  - qdfe already has `BIZ820` close-loop push patterns.
  - qdfe did not yet have native `BIZ857` service code, DTO, and call encapsulation in the baseline described by the trace.
  - `scheduleStatus=18` means `备改输`.
  - qdfe should gate the route with `bloodTransfusionCode=neuBTMIS`.
  - Recommended route is to reuse the async pattern: `入库 -> 定时消费 -> 注册 -> 状态回写`.

## Current workspace reality to verify first

- Current qdfe code scan shows:
  - `BrowseSceneInfoServiceImplForCustom` returns `bloodTransfusionCode=neuBTMIS`.
  - `ServiceCodeEnum` contains `pushCloseLoop("BIZ820")`.
  - `AdviseSaveDocEventServiceImplForCustom` shows existing close-loop push style.
  - `MsgSyncJob` and `RegisterDataServiceImplForCustom` show the async processing skeleton.
- Current qdfe scan did not directly show:
  - `BIZ857`
  - `BloodTransfusionStatusController`
  - `PushBloodTransfusionStatusReq`
  - a dedicated `register_blood_transfusion_status` message branch

If the user asks about qdfe `BIZ857`, do not assume the runtime chain already exists in the current branch. First compare the trace baseline with the actual repo state.

## Expected route when BIZ857 exists

1. Receive `备改输` trigger from ODCBS or an outer interface.
2. Validate scene gate: qdfe and `bloodTransfusionCode=neuBTMIS`.
3. Enqueue with `MqMsgHandlerService.addYjcMsg(...)`.
4. `MsgSyncJob` polls and consumes the message.
5. `RegisterDataServiceImplForCustom.registerData(...)` branches by message type.
6. `HttpClient` sends the outbound platform request using a new service code and auth mapping.
7. Persist consume result and error details for retry or compensation.

## Key field questions

- Where does `elecApplyFormNumber` come from?
- Where do `orderNumber`, `bloodBagNumber`, and `crossmatchNumber` come from?
- Is the trigger emitted by ODCBS domain behavior, by an outer interface, or by another upstream system?
- Is the issue a missing field source, a wrong DTO mapping, a missing async branch, or a platform call failure?

## Ownership guidance

- If the issue is "field does not exist" or "业务动作没有触发", verify ODCBS or the upstream event source before changing ODBIP.
- If the issue is "message not consumed", "branch not routed", or "platform not called", start in qdfe ODBIP.
- If the issue is "page displayed action succeeded but platform saw nothing", do not stop at frontend. Move to ODCBS event generation and ODBIP async routing.

## Files to open first

- `docs/architecture/traces/06-qdfe-biz857-backup-to-transfusion.md`
- `backend/odbip-custom-backend/odbip-custom-qdfe/src/main/java/com/neusoft/hit/odts/odbip/custom/service/impl/BrowseSceneInfoServiceImplForCustom.java`
- `backend/odbip-custom-backend/odbip-custom-qdfe/src/main/java/com/neusoft/hit/odts/odbip/custom/job/MsgSyncJob.java`
- `backend/odbip-custom-backend/odbip-custom-qdfe/src/main/java/com/neusoft/hit/odts/odbip/custom/service/impl/RegisterDataServiceImplForCustom.java`
- `backend/odbip-custom-backend/odbip-custom-qdfe/src/main/java/com/neusoft/hit/odts/odbip/custom/service/impl/AdviseSaveDocEventServiceImplForCustom.java`
- `backend/odbip-custom-backend/odbip-custom-qdfe/src/main/java/com/neusoft/hit/odts/odbip/custom/model/enums/ServiceCodeEnum.java`
- `backend/odbip-custom-backend/odbip-custom-qdfe/src/main/java/com/neusoft/hit/odts/odbip/custom/client/HttpClient.java`

## Reporting pattern

When answering a `备改输` or `BIZ857` question, prefer this output order:

1. Is this implemented, partially implemented, or trace-only in the current repo?
2. Which repo currently owns the failing segment?
3. Which exact handoff point is broken or missing?
4. Which fields or scene-code gates must be verified next?
