---
name: angular-delivery
description: "正触发：当任务是在 Angular 17 项目中实现或评审组件、路由、状态、表单、ng-zorro 表格、overlay 时序、共享 UI 行为或前端交付质量时触发。反触发：当任务是 Angular 17 升级后已知回归排查时优先使用 angular17-upgrade-regression-handler；当项目不是 Angular 或任务不涉及前端实现时不触发。"
owner: copilot-harness
source_ref:
  - opencode:/Users/wangbo/.config/opencode/skills/angular-delivery/SKILL.md
---

# Angular Delivery

## Focus Areas

- Keep shared UI in reusable components rather than page-local duplication.
- Respect existing standalone versus NgModule project style.
- Check routing, guards, interceptors, and shared services before adding new patterns.
- Keep form validation and error states explicit.
- Treat Angular 17 dynamic rendering timing as a first-class concern when DOM size or third-party widget layout is involved.
- Prefer column-config-driven table layout over component-driven width expansion in editable tables.

## Angular 17 Runtime Conventions

- When layout depends on rendered DOM size, prefer this order:
  1. `ViewChild` or component host refs.
  2. change detection flush.
  3. microtask or short timeout after view render.
  4. safe DOM fallback query.
  5. one retry for overlay or delayed widget mount.
- Do not assume `ng-template`, `nz-popover`, `nz-modal`, `nz-drawer`, or CDK overlay content is fully mounted at first synchronous access.
- When a third-party component reads dimensions only on first mount, document that behavior in code comments and add a DOM-level fallback when needed.

## ng-zorro Table Delivery Rules

### Column Width Source Of Truth

- For editable or mixed-content `nz-table`, header width, body width, and `scroll.x` must come from the same column definition source.
- Do not estimate `scroll.x` with `columnCount * constant`.
- Compute `scroll.x` from actual configured widths or min-widths.
- If `th` binds width, `td` must bind the same `width/min-width/max-width` unless the table intentionally uses auto layout.

### Header/Body Alignment

- Do not let inputs, selects, or custom controls determine column width implicitly.
- Internal controls should usually use `width: 100%` and fit inside the cell instead of expanding the cell.
- Long read-only text in cells should use ellipsis or nowrap unless the design explicitly requires wrapping.
- Use `table-layout: fixed` only when header and body widths are synchronized from the same config.

### Vertical Scroll In Dynamic Containers

- If `nz-table` is rendered inside `nz-popover`, `nz-modal`, `nz-drawer`, or delayed template content and `scroll.y` is computed after render:
  - do not rely on `[nzScroll]` update alone;
  - apply height, max-height, or overflow styles to `.ant-table-body` as a DOM fallback;
  - retry once after a short delay if the body node is not ready yet.
- Container min-height alone is not enough; the effective scroll area must be applied to `.ant-table-body`.

## Custom Form Controls Inside Tables

- Before placing a custom Angular form control inside a table cell, check for:
  - `min-width`
  - fixed internal padding
  - absolute positioning
  - inline-block sizing
  - icon or addon width that can overflow a narrow cell
- Prefer exposing style inputs (`style`, `nzStyle`, `size`, class hooks) over relying only on deep CSS overrides.
- If a custom control must be reused inside dense tables, support compact mode or allow `min-width: 0`.

## Overlay And Timing Checklist

When diagnosing layout issues in overlay content, inspect all of:

- host container height
- `.ant-table-header`
- `.ant-table-body`
- header table width versus body table width
- computed width/min-width of embedded controls

Separate these problem classes early:

1. column alignment issue
2. control overflow issue
3. missing default height or scroll area issue
4. render timing issue

## Validation Checklist For Angular UI Fixes

- Always validate at least:
  - empty state
  - single-row state
  - multi-row state
  - resize behavior
  - build success
- For table layout fixes, additionally inspect DOM for:
  - `.ant-table-body` computed height or max-height
  - header and body table widths
  - synchronized cell widths for `th` and `td`
- When the issue is visual alignment, prefer at least one before/after screenshot or a precise DOM note in the task change record.

## Review Reminders

- Do not add a second state pattern unless the existing one is clearly inadequate.
- Update docs when shared component or route behavior changes.
- If a fix uses DOM fallback to compensate for third-party timing behavior, record why the fallback is needed and what condition would allow its removal.
- When patching styles for a shared custom control, scope the override to the target container first; avoid broad global overrides unless the problem is confirmed global.
