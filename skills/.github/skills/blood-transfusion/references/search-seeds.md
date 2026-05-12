# Search Seeds

Use these seeds before broad repo scanning. They are designed to get OpenCode to the first trustworthy entrypoint quickly.

## Usage rules

- Start with the smallest repo scope that matches the symptom.
- For `备改输` or `BIZ857`, confirm hospital or customization module first, then replace `odbip-custom-qdfe` with the actual target module if needed.
- Prefer these focused seeds over global `blood` or `transfusion` searches across the entire workspace.

## Workspace and customization

```bash
rg -n 'odbip-custom-|hospCode|withDFT|withLM' \
  backend/odbip-custom-backend/settings.gradle \
  backend/odbip-custom-backend/build.gradle \
  backend/odbip-custom-backend/gradle.properties
```

```bash
rg -n 'bloodTransfusionCode|getBloodSceneCode|BrowseSceneInfo|SceneCodeUtil|neuBTMIS' \
  backend/odcbs-backend \
  backend/odbip-custom-backend \
  frontend/odcbs-frontend/odcbs-all/src/app
```

## Frontend page and API entry

```bash
rg -n '/atBloodApply|getBloodSceneCode|getBloodApplications|getBloodTransList|getBloodBagByBarCode|confirmBloodMatch' \
  frontend/odcbs-frontend/odcbs-all/src/app
```

```bash
rg -n 'blood-apply|blood-application|blood-taken-check|blood-transfution-check|blood-delivery-check|输血|取血|血袋|双人核对' \
  frontend/odcbs-frontend/odcbs-all/src/app/business/anesthesia
```

## ODCBS core backend

```bash
rg -n 'class OpBloodApplyController|/atBloodApply|getBloodSceneCode|getBloodApplications|confirmBloodMatch' \
  backend/odcbs-backend/odcbs-operation/src/main/java
```

```bash
rg -n 'OpBLoodApplyServiceFacade|IBloodCycleService|BloodCycleService|SceneCodeUtil|neubtmisBloodCycleService|lnsrmyyBloodCycleService|lnszlyyBloodCycleService|sjyyBloodCycleService' \
  backend/odcbs-backend/odcbs-operation/src/main/java
```

## ODBIP platform and async path

```bash
rg -n 'addYjcMsg|MsgSyncJob|RegisterDataServiceImplForCustom|MsgTypeEnum|TEventPollInfo|TEventMsgYjcDetail' \
  backend/odbip-custom-backend/odbip-custom-* \
  backend/odbip-custom-backend/odbip-batch \
  backend/odbip-custom-backend/odbip-portal
```

```bash
rg -n 'BrowseSceneInfoServiceImplForCustom|ServiceCodeEnum|HttpClient|AdviseSaveDocEventServiceImplForCustom|pushCloseLoop|BIZ820' \
  backend/odbip-custom-backend/odbip-custom-*
```

## qdfe `备改输 -> BIZ857` specialized check

Run this only after you have evidence the issue is qdfe-specific.

```bash
rg -n 'BIZ857|备改输|scheduleStatus|bloodTransfusionCode|neuBTMIS|BloodTransfusionStatusController|pushBloodTransfusionStatus|register_blood_transfusion_status' \
  docs/architecture/traces \
  backend/odbip-custom-backend/odbip-custom-qdfe
```

## Suggested first-pass sequence

1. Customization and scene seed
2. Frontend or ODCBS seed based on symptom visibility
3. ODBIP async seed only when the chain clearly crosses into platform integration
4. qdfe `BIZ857` seed only after site or module confirmation
