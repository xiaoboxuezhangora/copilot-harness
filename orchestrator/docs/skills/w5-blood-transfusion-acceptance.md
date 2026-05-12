# W5 Blood Transfusion Skill Acceptance

## Scope

This record covers only the `blood-transfusion` W5 skill branch. It does not claim that the full W5
four-skill milestone is complete.

## Skill Location

- `skills/.github/skills/blood-transfusion/SKILL.md`
- `skills/.github/skills/blood-transfusion/references/rules.md`
- `skills/.github/skills/blood-transfusion/references/anti-patterns.md`
- Existing migrated references under `skills/.github/skills/blood-transfusion/references/`

## Acceptance Checks

- `name` matches directory: `blood-transfusion`
- `description` includes positive and negative triggers
- `owner` is present
- `source_ref` is present and points to migrated OpenCode sources plus local rules and anti-patterns
- `SKILL.md` body is under 500 lines
- Core coding rules: 10
- Code anti-patterns: 8
- Scope boundary states this skill is for programming assistance, not clinical operation
- Runtime loading is conditional on transfusion task-description triggers
- Minimal validator: `pnpm skills:validate blood-transfusion`

## Runtime Loading Rule

Default investigator skills:

- `jira-requirement-analysis`

When task description contains transfusion-domain terms such as `输血`, `血袋`, `备改输`,
`BIZ857`, `bloodTransfusionCode`, `neuBTMIS`, `blood transfusion`, or `atBloodApply`, the runtime
adds:

- `blood-transfusion`

## Remaining Non-Blocking Notes

- Full W5 milestone still requires the other business-domain skills if judged against the original
  four-skill Notion scope.
- Showcase skill-hit visualization is not included in this acceptance record.
