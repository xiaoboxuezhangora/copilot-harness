# Skill and Agent Loading

## Current state

- `skills/.github/skills/*/SKILL.md` stores reusable Skill definitions.
- `orchestrator/docs/agents/*.md` stores agent contracts and local operating rules.
- `orchestrator/AGENTS.md` stores the always-on harness contract.

## SDK / CLI loading

- The SDK live path now explicitly assembles session config with `workingDirectory`, `skillDirectories`, `customAgents`, and `agent`.
- The investigator agent is registered from `orchestrator/docs/agents/investigator.agent.md` and preloads `jira-requirement-analysis` from `skills/.github/skills`.
- `orchestrator/AGENTS.md` is appended to the SDK session `systemMessage`, so W3 does not depend on monorepo directory discovery for this file.
- The investigator custom agent is limited to Jira Reader `getIssue`, `searchIssues`, and `getComments`; other tool calls are denied by the SDK pre-tool hook.
- Mock smoke still does not execute a real Copilot session, but the session config construction is covered by unit tests.
- CLI runtime loading remains a capability difference and should be treated as a separate risk until it is verified end to end.

## W3 limitation

- This document no longer claims that W3 has no loading behavior.
- It only states that the CLI path may not expose the same loading semantics as the SDK path.
