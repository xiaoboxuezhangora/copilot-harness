# Repo Entrypoints

All paths below are relative to the APMIS workspace root.

## Workspace and customization axis

- `AGENTS.md`
  - Workspace-level rules, repo roles, and the default analysis order for this workspace.

- `docs/architecture/workspace-topology.yaml`
  - Repo topology and responsibility boundaries.

- `backend/odbip-custom-backend/settings.gradle`
  - First stop when you need to confirm active customization modules and the `odbip-custom-${hospCode}` axis.

- `backend/odbip-custom-backend/gradle.properties`
- `backend/odbip-custom-backend/build.gradle`
  - Useful when the issue may actually depend on build flags or packaging behavior rather than business code.

## Frontend PC

- `frontend/odcbs-frontend/odcbs-all/src/app/layout/layout-routing.module.ts`
  - Global root route. `ws` and `path` are the main shells that eventually lead into anesthesia pages.

- `frontend/odcbs-frontend/odcbs-all/src/app/layout/path/path-routing.module.ts`
  - `path: 'anes'` loads the anesthesia module.

- `frontend/odcbs-frontend/odcbs-all/src/app/business/anesthesia/anesthesia-routing.module.ts`
  - Real anesthesia-page routes, including:
    - `blood-apply`
    - `blood-application`
    - `blood-taken-check`
    - `blood-transfution-check`
    - `lnsrm-blood-application`
    - `lnsrm-blood-transfusion-check`
    - `blood-delivery-check`

- `frontend/odcbs-frontend/odcbs-all/src/app/business/anesthesia/blood-closed-loop/blood-application-directive.component.ts`
- `frontend/odcbs-frontend/odcbs-all/src/app/business/anesthesia/blood-closed-loop/blood-taken-check-directive.component.ts`
- `frontend/odcbs-frontend/odcbs-all/src/app/business/anesthesia/blood-closed-loop/blood-transfution-check-directive.component.ts`
  - Dynamic scene dispatch. These components call `/atBloodApply/getBloodSceneCode` and choose the scene-specific component.

- `frontend/odcbs-frontend/odcbs-all/src/app/business/anesthesia/blood-apply/blood-apply.component.ts`
  - Legacy or direct blood-apply API entry.
  - Calls `/atBloodApply/getBloodTransList`, `/getSyncBloodTransList`, `/getBloodTransListByHis`, `/insertBloodApply`.

- `frontend/odcbs-frontend/odcbs-all/src/app/business/anesthesia/blood-delivery-check/blood-delivery-check.component.ts`
  - Uses `/atBloodApply/getBloodDeliveryCheck` and `/confirmBloodBag`.

- `frontend/odcbs-frontend/odcbs-all/src/app/business/anesthesia/blood-closed-loop/common/common-blood-application/services/blood-application.service.ts`
  - Common closed-loop API wrapper for `/getBloodApplications`, `/getOpBloodTakeApplyList`, `/saveGetBloodApplications`.

- Scene-specific page files worth opening when the symptom is clearly site-specific:
  - `.../blood-closed-loop/lnsrm/...`
  - `.../blood-closed-loop/lnszl/...`
  - `.../blood-closed-loop/sjyy/...`
  - `.../blood-closed-loop/ynszl/...`

- Site overlay check when behavior differs by site:
  - `frontend/odcbs-frontend/odcbs-all/handle-local-dev.js`
  - `frontend/odcbs-frontend/odcbs-all/local-dev/<site>/local-dev.json`

## ODCBS core backend

- `backend/odcbs-backend/odcbs-operation/src/main/java/com/neusoft/hit/odts/odcbs/operation/web/OpBloodApplyController.java`
  - Main `/atBloodApply` entry for transfusion application, blood bag, scene code, and match confirmation.

- `backend/odcbs-backend/odcbs-operation/src/main/java/com/neusoft/hit/odts/odcbs/operation/service/impl/facade/OpBLoodApplyServiceFacade.java`
  - Scene-based service dispatch. Builds bean name `<sceneCode>BloodCycleService`.

- `backend/odcbs-backend/odcbs-operation/src/main/java/com/neusoft/hit/odts/odcbs/operation/service/impl/facade/SceneCodeUtil.java`
  - Cross-repo bridge to ODBIP `BrowseSceneInfo`. Caches `bloodTransfusionCode`.

- `backend/odcbs-backend/odcbs-operation/src/main/java/com/neusoft/hit/odts/odcbs/operation/service/IBloodCycleService.java`
  - Common transfusion-cycle contract.

- Scene implementations to open based on returned scene code:
  - `.../service/impl/facade/blood/neubtmis/NEUBTMISAbstractIBloodCycleServiceImpl.java`
  - `.../service/impl/facade/blood/lnsrmyy/LNSRMYYIBloodCycleServiceImpl.java`
  - `.../service/impl/facade/blood/lnszlyy/LNSZLYYIBloodCycleServiceImpl.java`
  - `.../service/impl/facade/blood/sjyy/SJYYIBloodCycleServiceImpl.java`

- Contract model showing the ODBIP-to-ODCBS scene-code handoff:
  - `backend/odcbs-backend/odcbs-outer/src/main/java/com/neusoft/hit/odts/odcbs/outer/responsity/stub/odbip/model/BrowseSceneInfoDto.java`

## ODBIP platform and integration layer

- `backend/odbip-custom-backend/odbip-custom-qdfe/src/main/java/com/neusoft/hit/odts/odbip/custom/service/impl/BrowseSceneInfoServiceImplForCustom.java`
  - qdfe scene info. Currently returns `bloodTransfusionCode=neuBTMIS`.

- `backend/odbip-custom-backend/odbip-custom-qdfe/src/main/java/com/neusoft/hit/odts/odbip/custom/controller/OpApplyAppointmentController.java`
  - Example outer receive controller that validates input and enqueues async messages.

- `backend/odbip-custom-backend/odbip-custom-qdfe/src/main/java/com/neusoft/hit/odts/odbip/custom/ws/impl/OrisServerWSImpl.java`
  - Another inbound entry that writes to the message queue.

- `backend/odbip-custom-backend/odbip-custom-qdfe/src/main/java/com/neusoft/hit/odts/odbip/custom/job/MsgSyncJob.java`
  - Async consumer loop. Polls unconsumed messages, calls register service, writes success or failure status and error details.

- `backend/odbip-custom-backend/odbip-custom-qdfe/src/main/java/com/neusoft/hit/odts/odbip/custom/service/impl/RegisterDataServiceImplForCustom.java`
  - Message-type router. Current baseline handles operation apply, medical info, appointment, and staff dictionary.

- `backend/odbip-custom-backend/odbip-custom-qdfe/src/main/java/com/neusoft/hit/odts/odbip/custom/service/impl/AdviseSaveDocEventServiceImplForCustom.java`
  - Existing outbound push pattern. Useful for comparing `BIZ820` close-loop push style with planned `BIZ857`.

- `backend/odbip-custom-backend/odbip-custom-qdfe/src/main/java/com/neusoft/hit/odts/odbip/custom/model/enums/ServiceCodeEnum.java`
  - Existing platform service-code registry. Current baseline contains `BIZ820` but not a visible `BIZ857` item.

- `backend/odbip-custom-backend/odbip-custom-qdfe/src/main/java/com/neusoft/hit/odts/odbip/custom/client/HttpClient.java`
  - Unified outbound client and auth injection pattern.

- `backend/odbip-custom-backend/odbip-custom-qdfe/src/main/java/com/neusoft/hit/odts/odbip/custom/model/enums/MsgTypeEnum.java`
  - Async message type registry.

## Trace-first files

- `docs/architecture/traces/04-odbip-hospcode-customization.md`
  - Useful when the real issue is customization selection, not transfusion logic itself.

- `docs/architecture/traces/06-qdfe-biz857-backup-to-transfusion.md`
  - Primary baseline only when the issue is qdfe-specific or explicitly asks for the qdfe `备改输 -> BIZ857` chain.

- `docs/architecture/traces/10-odcbs-sceneinfo-via-odbip.md`
  - Useful when the question is actually about scene-code sourcing rather than transfusion logic itself.
