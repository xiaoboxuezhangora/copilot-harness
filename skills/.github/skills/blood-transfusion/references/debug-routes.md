# Debug Routes

## Route 0: 先确认院方、场景码和定制模块

- Start from the workspace cognition layer, not from the first repo that looks familiar.
- Confirm:
  - current hospital or site
  - whether behavior is controlled by `local-dev` or env overlay
  - current `bloodTransfusionCode`
  - whether the active platform customization is really qdfe or another `odbip-custom-${hospCode}` module
- Use `references/search-seeds.md` to find:
  - `getBloodSceneCode`
  - `bloodTransfusionCode`
  - `BrowseSceneInfo`
  - `odbip-custom-`
- Only apply qdfe `备改输 -> BIZ857` assumptions after this route is cleared.

## Route 1: Wrong transfusion page or wrong scene-specific component

- Start in frontend:
  - `layout/path/path-routing.module.ts`
  - `business/anesthesia/anesthesia-routing.module.ts`
  - `blood-closed-loop/*directive.component.ts`
- Verify whether the page is chosen by `/atBloodApply/getBloodSceneCode`.
- Then cross to ODCBS:
  - `OpBloodApplyController.getBloodSceneCode`
  - `SceneCodeUtil.getBloodSceneCode`
- Then cross to ODBIP:
  - `BrowseSceneInfoServiceImplForCustom.getSceneInfo`
- Typical conclusion:
  - wrong scene code or wrong dispatch is often not a pure frontend issue.

## Route 2: 输血申请数据为空、错乱、重复、缺失

- Frontend API entry:
  - `blood-apply.component.ts`
  - `common-blood-application/services/blood-application.service.ts`
- ODCBS entry:
  - `OpBloodApplyController.getBloodTransList`
  - `OpBloodApplyController.getBloodApplications`
- ODCBS dispatch:
  - `OpBLoodApplyServiceFacade`
  - matching `*BloodCycleService`
- Typical conclusion:
  - if API call is correct but data is wrong, ownership usually moves to ODCBS scene service or its downstream stub and persistence path.

## Route 3: 血袋扫码、取血核对、输血前双人核对异常

- Frontend page entry:
  - `lnsrm-blood-taken-check.component.ts`
  - `lnsrm-blood-transfusion-check.component.ts`
  - `sjyy-blood-taken-check.component.ts`
  - `sjyy-blood-transfusion-check.component.ts`
- ODCBS entry:
  - `OpBloodApplyController.getBloodBagByBarCode`
  - `OpBloodApplyController.confirmBloodMatch`
- ODCBS implementation:
  - matching `*BloodCycleService`
- Typical conclusion:
  - scan or confirm failures usually sit in scene-specific backend implementation, not in the generic page shell.

## Route 4: `备改输` or `BIZ857`

- First run Route 0.
- Read trace first:
  - only if the issue is qdfe-specific or explicitly points to the qdfe trace: `docs/architecture/traces/06-qdfe-biz857-backup-to-transfusion.md`
- Verify actual qdfe repo state:
  - `ServiceCodeEnum`
  - `RegisterDataServiceImplForCustom`
  - `MsgSyncJob`
  - `HttpClient`
- Decide which case applies:
  - implementation missing in current branch
  - implementation present but routing broken
  - field-source gap between ODCBS and ODBIP
- Typical conclusion:
  - do not report a runtime defect until you verify the code actually contains a BIZ857 route.

## Route 5: 平台消息未消费、未推送、失败无回写

- Start in ODBIP:
  - inbound controller or WS entry
  - `MqMsgHandlerService.addYjcMsg(...)` caller
  - `MsgSyncJob`
  - `RegisterDataServiceImplForCustom`
  - `HttpClient`
- Check in this order:
  - message type
  - enqueue
  - schedule switch and delay
  - consumer branch
  - outbound auth and DTO
  - platform response
  - error persistence and retry
- Do not print secret config values. Only note whether required config exists and is routed.

## Route 6: Cross-repo misclassification guard

- If frontend calls the correct endpoint and payload, stop blaming frontend and move to ODCBS.
- If ODCBS dispatch depends on scene code, verify `SceneCodeUtil` and ODBIP `BrowseSceneInfo` before blaming a scene bean.
- If ODBIP outbound DTO is missing business fields, verify whether those fields are absent in ODCBS data, absent in the event source, or dropped during async routing.
- When in doubt, explicitly state the handoff point:
  - frontend -> ODCBS
  - ODCBS -> ODBIP
  - ODBIP -> platform

## Preferred answer format

Use this answer shape for investigation prompts:

1. Repo ownership conclusion
2. Problem-type conclusion
3. First concrete entrypoint
4. Handoff path to the next repo if needed
5. Next verification files or APIs

Keep refactor or redesign ideas out unless the user explicitly asks for them.
