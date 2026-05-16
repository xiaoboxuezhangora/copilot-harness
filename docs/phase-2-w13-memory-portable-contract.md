# Phase 2 W13: Cross-Agent Shared Memory Portable Contract

## Scope

- Define a stable cross-client Memory payload for OpenCode / Copilot SDK / Copilot CLI.
- Keep existing `namespace`-based MCP API compatible.
- Add concurrency safety for shared local SQLite writes.

## MemoryPortableRecordV1

```ts
interface MemoryPortableRecordV1 {
  kind: "decision" | "knowledge" | "alias";
  key: string;
  value: string;
  source_ref: string;
  producer_agent: string;
  ts: string;
  confidence: number;
}
```

## kind -> namespace Mapping

| kind        | namespace         |
| ----------- | ----------------- |
| `decision`  | `decisions`       |
| `knowledge` | `knowledge_index` |
| `alias`     | `aliases`         |

Compatibility rule:

- Existing `namespace` + legacy fields remain valid input/output.
- `put` may also accept `portable_record`.
- `put/get/search/list` return portable view fields so clients can use a stable portable boundary.

## Conflict & Immutability Rules

- `producer_agent` is immutable after first successful write for keys in namespaces requiring producer identity (`decisions`, `aliases`).
- If a later write uses a different `producer_agent`, the original `producer_agent` must be preserved.
- This conflict must not be silent: return structured warning (`producer_agent_immutable`) or structured error.

## Optimistic Lock Rules

- Each namespace table has `version INTEGER NOT NULL DEFAULT 1`.
- `put.expected_version` supports optimistic lock checks.
  - Insert: `expected_version` must be omitted or `0`.
  - Update: if provided, must match current row `version`.
- Mismatch returns structured MCP error with code `OPTIMISTIC_LOCK_CONFLICT` (HTTP semantic status `409`).

## SQLite Shared-Client Runtime Settings

- `PRAGMA journal_mode=WAL`
- `PRAGMA busy_timeout=5000`
- `PRAGMA synchronous=NORMAL`

## Audit/Redline Constraints

Audit and error payloads must not include:

- Memory `value`
- embedding input text or vectors
- tokens/credentials
- PHI/patient identifiers
- charge details
- CA private keys
- full sensitive request/response payloads

## OpenCode / Copilot SDK / Copilot CLI Shared Access

All clients must point to one shared SQLite path through the same Memory MCP runtime:

- `MEMORY_SQLITE_PATH=/absolute/path/to/reports/memory.sqlite`
- MCP start (stdio): `pnpm --filter @copilot-harness/memory-mcp build && node mcp-servers/memory/dist/index.js`

Recommended `producer_agent` values:

- `opencode`
- `copilot-sdk`
- `copilot-cli`
- `reviewer`
- `harvester`

## Migration Window (Dual Write: 2 Days)

1. Keep legacy/local write path and MCP write path enabled in parallel.
2. Write the same candidate set to both paths.
3. Run drift detector (`detectPortableMemoryDrift`) on portable snapshots:
   - compare `kind/key/value/source_ref/producer_agent/confidence/ts`
4. Archive drift reports daily for 2 days.

Drift report artifact:

- Mock fixture path: `orchestrator/eval/w13-memory-drift-report.mock.json`
- Required fields:
  - `generated_at`
  - `migration_window` (`mock` or real window id)
  - `legacy_total`
  - `mcp_total`
  - `drift_count`
  - `findings`
  - `cutover_ready`

Evidence boundary:

- Mock drift report only proves detector behavior and report schema in CI.
- Real cutover evidence requires a true 2-day dual-write window with archived daily reports.

## Gate3 Policy Requirement

- `pnpm ci:gate3` must pass before W13 can be closed.
- Do not relax redline detection rules to pass Gate3.
- Redline rule definition files may use controlled scanner exemptions, but business logic and test fixtures remain in scope.
- Policy Gate only allows pattern self-match exemptions inside redline rule definitions (`MEMORY_REDLINE_RULES` / `REDLINE_RULES`) in `orchestrator/src/memory/index.ts` and `mcp-servers/memory/src/security.ts`.

## Phase 2 Closure Gates

All conditions below must be true:

- `pnpm ci:gate1` pass
- `pnpm ci:gate2` pass
- `pnpm ci:gate3` pass
- drift report is continuously `0` during the real migration window
- W13 cross-client smoke passes (`client A write -> client B read version -> expected_version update`)

## Closure Evidence Status

- `pnpm ci:gate1`, `pnpm ci:gate2`, `pnpm ci:gate3` passing means engineering code gates are green.
- `orchestrator/eval/w13-memory-drift-report.mock.{json,md}` is a mock fixture only, and only proves detector behavior plus report schema.
- Production cutover to MCP single-write still requires real 2-day dual-write drift evidence.

Recommended real evidence paths:

- `orchestrator/eval/w13-memory-drift-report-live-latest.json`
- `orchestrator/eval/w13-memory-drift-report-live-latest.md`
- timestamp snapshots in `orchestrator/eval/w13-memory-drift/`

Real cutover conditions:

- continuous `drift_count=0` for 2 days in live dual-write reports
- OpenCode writes are visible to Copilot SDK/CLI reads (cross-client hit path)
- `producer_agent` fidelity is preserved across clients
- `expected_version` update path passes in cross-client flow
- `pnpm ci:gate1`, `pnpm ci:gate2`, `pnpm ci:gate3` all pass

## Cutover To MCP Single Write

Switch to single write when all are true:

- Phase 2 closure gates are all satisfied
- real 2-day drift evidence is archived and review-approved
- `memory-mcp` `test/typecheck/lint` all pass
