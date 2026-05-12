---
name: angular17-upgrade-regression-handler
description: "正触发：当任务涉及 Angular 17 升级后 UI/交互回归、页面空白、modal/footer/title 异常、dynamic-form、ng-zorro table/overlay、SVG/nz-icon/twotone 颜色漂移、滚动/固定表头/拖拽/初始化状态异常时触发。反触发：当问题是编译启动失败、后端数据/权限/环境配置、新功能开发、主动视觉巡检，或通用 Angular 组件实现而非升级后行为变化时不触发。"
owner: copilot-harness
source_ref:
  - opencode:/Users/wangbo/.config/opencode/skills/angular17-upgrade-regression-handler/SKILL.md
  - opencode:/Users/wangbo/.config/opencode/skills/angular17-upgrade-regression-handler/reference/case-index.md
---

# Angular17 Upgrade Regression Handler

## What This Skill Does

- Handle test-reported Angular 17 upgrade regressions in frontend presentation or interaction behavior.
- Use `6487b9527ff67c8056a9cc40b01c87af2e8618c0` as the upgrade analysis baseline when working in the original APMIS Angular repo.
- Prioritize version, DOM, and runtime evidence before CSS or component fixes.
- Convert test issues into implementation-ready task cards with goal, owned paths, avoid-touch scope, fix layer, and validation.
- Prefer shared-layer fixes over page-local patches when the symptom pattern is shared.

## Use This Skill When

- The user mentions `Angular17`, `升级后`, `升级17`, or Angular 17 upgrade regression.
- Symptoms include blank content, right side empty, modal/drawer/overlay issues, dynamic-form layout drift, tab height, sticky table, scrollbar, drag failure, timeline/monitor interaction regression, or default selection chain failure.
- Icon/SVG color changed after upgrade, especially `nz-icon`, `twotone`, or `nzTwotoneColor`.
- The project starts successfully and the problem is primarily UI rendering, layout, timing, or interaction behavior.

## Do Not Use This Skill When

- The main issue is build failure, boot failure, or dependency installation failure.
- The root cause is backend data, API contract, permission, or environment configuration.
- The user asks for proactive screenshot巡检 or automatic visual-diff discovery.
- The task is new feature work, UI redesign, or business logic addition.
- The task is general Angular 17 component implementation; use `angular-delivery` instead.

## Intake Contract

### L0: Consult-Only Analysis

At least one of these should exist:

- `issue_id`
- page/module
- simple symptom description
- screenshot or recording

### L1: Implementation Ready

Before code changes, collect as many as possible:

- reproduction steps
- actual result
- expected result
- browser and resolution
- user role, department, and data condition
- stable or intermittent reproduction
- priority
- whether the issue appears only after Angular 17 upgrade

### Blocking Rules

- Missing both screenshot and basic description blocks intake.
- Missing reproduction steps or environment conditions does not block consult-only analysis, but blocks implementation.
- If conclusion depends on code, screenshot, or DOM inspection that is not available, explicitly block and list missing evidence.

## Problem Taxonomy

Classify first:

- `style-ui-drift`
- `render-empty`
- `partial-render-missing`
- `init-state-regression`
- `selection-chain-broken`
- `modal-adapter-regression`
- `dynamic-form-layout-regression`
- `scroll-sticky-table-regression`
- `overlay-timing-regression`
- `header-body-width-desync`
- `default-height-missing`
- `timeline-monitor-interaction-regression`
- `icon-svg-color-regression`
- `nz-icon-twotone-regression`
- `global-svg-css-overreach`
- `version-behavior-drift`
- `drag-order-regression`

If unclear, output consult-only triage and do not modify code.

## Diagnosis Order

When a regression looks like CSS, still diagnose in this order:

1. Confirm version matrix: Angular, ng-zorro, CDK, `@ant-design/icons-angular`, `@ant-design/colors`, fabric, and other affected libraries.
2. For third-party behavior, use Context7 docs plus local `node_modules` or generated DOM evidence.
3. If old/cloud baseline is authorized, capture screenshot, DOM, computed styles, and key attributes with browser tooling.
4. Check container height chain.
5. Check conditional rendering and default state chain.
6. Check overlay/template delayed mount.
7. Check whether third-party component reads dimensions only on first mount.
8. Check whether header, body, and control widths share the same source.
9. Only then consider local CSS tuning.

## Baseline And Git-History Rules

- `BASELINE_COMMIT=6487b9527ff67c8056a9cc40b01c87af2e8618c0`
- History is reference evidence only; it cannot replace reproduction or current evidence.
- Prefer historical fixes after the baseline, non-merge commits, concrete symptom titles, and paths that overlap the current issue.
- Do not generalize merge commits, mixed-issue commits, temporary patches, or hospital-specific special cases into common rules.
- Look up representative cases in `reference/case-index.md`, and cite them as references rather than proven current root cause.

## External Docs And Version Semantics

When ng-zorro, `@ant-design/icons-angular`, CDK, fabric, wangeditor, CodeMirror, or similar libraries are involved:

- Query Context7 for the relevant or nearest version documentation.
- Verify docs against local `node_modules` or runtime DOM.
- Output three evidence layers: document fact, local source fact, current DOM fact.
- Do not make final root-cause claims from docs alone.

## Cloud Baseline Evidence

If the user authorizes old/cloud environment comparison:

- Open the old environment with browser tooling.
- Use only user-authorized test credentials for the specified environment and task.
- Reproduce the same page, data condition, and viewport.
- Capture screenshot, DOM, computed styles, and for SVG/icon issues also `svg`, `path`, `fill`, `stroke`, computed fill/color.
- If the baseline is accessible but not captured, do not claim high-confidence visual parity.

## Fix-Layer Decision

Default rule: shared fix first, page-local patch last.

- Multi-page symptom: shared layer.
- modal/title/footer/content mismatch: shared modal or adapter layer.
- Blank or not rendered: wrapper, mount point, conditional rendering, initialization chain first.
- Table header mismatch, default height missing, internal scroll failure: table wrapper, width source, and scroll container first.
- Single page with no reusable abstraction: page-local layer.

## DOM Evidence Checkpoints

For UI/table/overlay regression, collect when feasible:

- host container height
- `.ant-table-header`
- `.ant-table-body`
- header table width versus body table width
- whether `th` and `td` share column width config
- embedded control final `width`, `min-width`, and padding

For icon/SVG color regression, also collect:

- `.anticon` computed `color`
- `svg` computed `fill/stroke`
- `path` fill/stroke attributes
- `path` computed fill/stroke/color
- inline style or global `!important` overrides
- old baseline versus local DOM structure

## Project-Specific Priority Paths

Prefer these path families in the original Angular workspace:

- `odcbs-all/src/app/share/component/common-modal/**`
- `odcbs-all/src/app/share/dynamic-form/**`
- `odcbs-all/src/app/share/dynamic-form/business-previewer/**`
- `odcbs-all/src/app/business/anesthesia/ops-common/**`
- `odcbs-all/src/app/business/anesthesia/pacu-workstation/**`
- `odcbs-all/src/app/layout/path/wrapper/**`
- `odcbs-all/src/app/layout/path/toolbar/**`
- `odcbs-all/src/app/business/component/room-overview/**`
- `odcbs-all/src/app/share/component/patient-timeline-modal/**`
- `odcbs-all/src/styles.less`
- `odcbs-all/src/app/app.module.ts`

## Required Outputs Per Issue

1. `Issue summary`
2. `L0/L1 status`
3. `Baseline verdict`
4. `Historical cases referenced`
5. `Fix-layer recommendation`
6. `Implementation task card` when implementation is ready
7. `Validation checklist`
8. `.ai-docs` files that need updates

## Templates And References

- `reference/case-index.md`: historical pattern index.
- `templates/issue-intake.md`: intake shape for test-reported issues.
- `templates/task-card.md`: implementation-ready task card.

## AI Docs Requirements

- Always update `.ai-docs/handoff.md` and `.ai-docs/changes/<task-id>.md` in the target project when making fixes.
- Update `.ai-docs/registry.json` and `.ai-docs/architecture.md` when the local project conventions require it.
- If the fix uses DOM fallback, shared style override, or timing retry, record why it is needed, its scope, and future removal conditions.

## Guardrails

- Do not proactively hunt for issues; handle test-reported issues.
- Do not treat historical cases as the only evidence.
- Do not skip reuse audit.
- Do not patch page-local first and only later inspect shared layers.
- Do not modify code while owned paths are unclear.
- Do not mix business requirements, hospital customization, and upgrade regression into one root cause.
- Do not assume "looks like CSS" means "only CSS can fix it."

## Completion Criteria

- The issue is classified and standardized as task input.
- Baseline attribution is complete.
- Historical cases are cited, or explicitly unavailable.
- Fix layer is explicit.
- Original test steps pass.
- Shared-layer changes have minimal spot checks.
- `.ai-docs` is synchronized.
- For table/overlay/layout issues, DOM evidence and final visual result are consistent.
