## Epic 33 Handback — Checkpoint C1-a: Core consolidation, contract requests, root health

**Status:** Complete. Branch `epic/33-c1-core-consolidation` @ 35383c9 (18 commits, rebased on `origin/main` a3c3dac — 0 behind).

**Delivered:**

*Root health (FIRST TASK)*
- **Test isolation.** Root `test` = `test:packages && test:web`. Each half prints a one-line banner:
  `── bun test: packages apps/server apps/cli skills integrations tools evals ──` and
  `── bun test: apps/web (separate process — happy-dom owns the global fetch) ──`.
  `packages/llm/src/providers/opencode.test.ts` also passes an explicit `NATIVE_FETCH = Bun.fetch`
  to every `createOpencodeCompletionClient(...)`, so its 7 `Bun.serve`-backed tests survive a polluted
  global even in one process.
- **Biome.** Root `markdown.formatter.enabled: false`; root `css.parser.tailwindDirectives: true`.
  Deleted `skills/biome.json` and `integrations/biome.json` after confirming they contained **only**
  `markdown.formatter.enabled: false` + `extends: "//"`. `tools/local-models` was already clean
  (`bunx biome check tools/local-models` → 38 files, no fixes); the command was still run.
- **Flaky web test fixed deterministically** (`apps/web/src/features/metrics/MetricsPanel.test.tsx`):
  the "elapsed clock ticks" sample was stamped with `Date.now()` at render time, so it only passed when
  the mount crossed a millisecond. It now stamps the newest sample 50 ms in the past. Failed 4/5 runs in
  isolation before, 0/6 after.

*Contract rulings (all additive; each has core tests)*
1. `StarlingErrorCode` += `LLM_BAD_JSON | GIT_TOO_OLD | GH_AUTH | GH_REPO | GH_COMMAND | GH_MISSING |
   NOT_WIRED | NODE_AUTH` (`errors.ts`). Workarounds removed:
   - `packages/llm/src/errors.ts`: `badJsonError` throws `LLM_BAD_JSON`; `isBadJsonError` stays and still
     recognises pre-C1 `LLM_ERROR` + `details.reason`. `CallOptions` is now an alias of core's type.
   - `packages/workspace/src/version.ts`: `GIT_TOO_OLD_CODE = 'GIT_TOO_OLD' as const satisfies StarlingErrorCode`.
   - `packages/github/src/errors.ts`: `GitHubError` passes the `GH_*` code to `StarlingError`; `githubCode`
     is kept as an alias (and in `details`).
   - `apps/cli/src/compose.ts`: throws `NOT_WIRED`; the local cast and its comment are gone. `HINTS` is
     now `Partial<Record<StarlingErrorCode, string>>` (+ hints for `GIT_TOO_OLD`, `GH_AUTH`, `GH_MISSING`,
     `NODE_AUTH`).
   - `packages/flock/src/http.ts`: 401/403 → `NODE_AUTH` (and the SSE loop stops on `NODE_AUTH`).
2. `AuditCheck.durationMs?: number` (int ≥ 0). `packages/auditor` sets it; `detail` no longer gets
   ` (N ms)`. Auditor tests updated (`makeCheck` returns `{...detail, durationMs}`, no trailer).
3. `AuditVerdict.dod?: { item; met; evidence? }[]`. The auditor copies the reviewer's DoD judgments,
   dropping empty evidence; no reviewer means no `dod`.
4. `NodeRegistryEvent { type; node; reason? }` drives `NodeRegistry.onChange`.
   `packages/flock`'s `FlockRegistryEvent` is now `export type FlockRegistryEvent = NodeRegistryEvent`;
   `MockRegistry` (core/testing) emits reasons too.
5. `LLMCallOptions { signal?; timeoutMs? }` on `LLM.complete`/`completeJson`. `LLMClient extends LLM`
   with no duplicate shape; `MockLLM` accepts and ignores the opts (tested).
6. `MergePreflight { clean; conflictedFiles; alreadyMerged; detail }` + `Merger.preflight?()`.
   `packages/merger`'s `PreflightResult extends MergePreflight` (+ repo/branches), so `MergerService`
   satisfies the port method with no adapter.
7. `BundleOps` (+ `BundleOpsOptions` stays local), `MdnsAdvertiseOptions`, `MdnsAdvertiser`,
   `DiscoveredPerch`, `MdnsBrowser` are core ports. `packages/workspace` and `packages/flock` alias
   `BundleOps`; `packages/flock/src/mdns.ts` re-exports the mDNS types; `packages/perch/src/handshake.ts`
   re-exports its two.

*§8 handshake + browser entry*
8. `packages/core/src/handshake.ts` holds all of §8 (types only — a test asserts zero runtime exports),
   including `FlockPanelProps.onSelectTask?` and `MetricsPanelProps.live?`. Exported from the core index.
9. Every mirror is a one-line `export type { … } from '@starling/core'`: `packages/{engine,flock,perch,
   prompts,github}`, `apps/{server,cli}`, `apps/web/src/data/handshake.ts` and all six
   `apps/web/src/features/*/handshake.ts`. `packages/prompts` keeps its zod schema/markers (schema typed
   as `z.ZodType<WorkerHandback>`); `packages/github` keeps its parser.
10. `@starling/core/browser` (`"./browser": "./src/browser.ts"`) exports contracts, handshake, errors,
    glob, metrics/pricing and ids. `packages/core/src/browser.test.ts` bundles it with
    `Bun.build({ target: 'browser', metafile: true })` and fails on any external import (this is where a
    `node:` sneaks through — Bun stubs Node built-ins instead of failing), any non-`node_modules` input
    outside the seven allowed modules, or `node:`/`Bun.`/`process.env` in the output. Verified by adding
    `import 'node:fs'`: the guard reports `src/__probe.ts -> node:fs`.

*Pricing*
11. `PRICING` now uses DeepSeek's published **peak** rates (source comment + table in
    `packages/core/src/metrics.ts`): uncached input $0.30/M (was the $0.28 placeholder), cached $0.006/M,
    output $1.20/M. Source: <https://api-docs.deepseek.com/quick_start/pricing>, read 2026-10-27
    (`deepseek-flash` = DeepSeek-V4.1-Flash-1017; off-peak is exactly half of peak).
    Consequences updated in the same PR: core/llm/engine price assertions, plus the golden fixture
    `fixtures/runs/sky-todo-launch-day.jsonl` (every metrics snapshot, every task `costUsd`, the final
    `run.metrics` and the summary prose: API $0.042 / saved $0.019 — only money numbers changed) and the
    three `apps/web/src/features/metrics/*.test.tsx` display strings that pin them.
12. ARCHITECTURE stays untouched; the eight rules to append as **L26–L34** are in
    `docs/epic-33-c1-core-consolidation.md` §"Rules implemented".

**Key design decisions:**
- **Two defences for the fetch pollution** — process split (the real fix) + explicit `Bun.fetch` in the
  LLM tests (insurance for anyone running `bun test` in one process). Rejected: skipping/serialising
  tests, which hides the ordering trap instead of removing it.
- **Markdown formatting off at the root**, nested configs deleted — docs are human prose; per-directory
  configs would need recreating for every new `docs/` folder.
- **`NODE_AUTH` as its own code** — the engine branches on codes (stop vs reschedule); reusing
  `INVALID_ARGUMENT` would force message matching.
- **Duration and DoD as fields, not prose** — `detail` is human text the model may rewrite.
- **Re-exports, not deletions, for the thirteen handshake files** — zero churn for other lanes; deletion
  is a Wave 2 cleanup once no branch is holding one.
- **mDNS unifies on the perch's shape** (`type?` optional) because it subsumes flock's; `DiscoveredPerch`
  moved to core because `MdnsBrowser.browse` needs it in its signature.
- **Golden fixture regenerated, not hand-patched** — its money fields are derived by the engine's table,
  so a price change makes it stale by definition; regenerating keeps `apiCostUsd` equal to the sum of
  task `costUsd`.

**Verification (exact commands + results):**
- `bun install` → `Checked 162 installs across 221 packages (no changes)`.
- `bun run test` (root) → **0 fail**:
  - half 1: `1359 pass`, `4 skip`, `0 fail` — `Ran 1363 tests across 162 files. [14.11s]`
  - half 2: `397 pass`, `0 fail` — `Ran 397 tests across 36 files. [1.98s]`
  - total **1756 pass / 0 fail** (≈ the 1,726 the dry run measured, plus the new core tests).
- `bun run check` → clean: `Checked 695 files in 168ms. No fixes applied.` + `tsc --noEmit` over all 18
  workspaces exits 0.
- `grep -rn "interface EngineApi\|interface FlockHub\|interface SkyViewProps" packages apps --include='*.ts' --include='*.tsx' | grep -v node_modules`:
  ```
  packages/core/src/handshake.ts:36:export interface EngineApi {
  packages/core/src/handshake.ts:56:export interface FlockHub {
  packages/core/src/handshake.ts:76:export interface SkyViewProps {
  packages/flock/src/hub.ts:14:export interface FlockHubOptions {
  packages/flock/src/hub.ts:38:export interface FlockHub extends HandshakeFlockHub {
  ```
  The three §8 interfaces are **defined** only in core. The two flock lines are not definitions of the
  contract: `FlockHubOptions` is `createFlockHub`'s options bag, and `hub.ts`'s `FlockHub` is the
  hub-side **extension** of core's (`+ code`, `+ discover()`), which necessarily reuses the name. Same
  for `WorkerHandback`/`MetricsPanelProps`/… (only core now defines them; `packages/github` and
  `packages/prompts` re-export the type and keep their runtime parser/schema).
- Browser entry: `packages/core/src/browser.test.ts` → 4 pass (bundle graph clean, subpath resolves,
  pricing/schemas/glob/ids exported). Negative control: injecting `import 'node:fs'` into the graph makes
  the guard report `src/__probe.ts -> node:fs`.
- Auditor: `packages/auditor` 82 pass — durations recorded on `checks[].durationMs`, `dod` copied
  verbatim, empty evidence dropped, deterministic audits carry no `dod`.
- `bun install`/`git status` clean; no lockfile edits.

**Dependencies added:** none.

**CONTRACT REQUESTS:** none outstanding — all fourteen Wave 1 requests are implemented above. Notes for
the integrator:
- `MergerService` (`@starling/merger`) now also satisfies `Merger.preflight?`; `PreflightResult` gained
  the four core fields via `extends` (no shape change for existing callers).
- `BundleOps.cloneFromBundle` returns `{ path, branch }` (Epic 14's signature) in **both** workspace and
  flock; flock's `void` return had no callers relying on it.
- `apps/web/src/features/metrics/MetricsPanel.test.tsx` and `cost.test.ts` were edited (see Deviations).

**Deliberately deferred / out of scope:**
- Deleting the thirteen `handshake.ts` re-export files (Wave 2 cleanup; imports would need rewriting in
  every lane).
- Switching `apps/web` imports to `@starling/core/browser` (Epic 34).
- Unifying the two opencode V2 clients (Wave 2 Epic 40).
- CLI `--budget`, plan-stdout purity, flock heartbeat/deregister/Last-Event-ID (Wave 2 Epic 42).
- Making `evals/` a workspace.
- `PRICING` bills peak; an "off-peak report" toggle belongs with the cost-meter work.

**Open questions / flagged tradeoffs:**
- The §8 DoD grep necessarily matches flock's extension (`FlockHub extends HandshakeFlockHub`) and its
  options type. I did not rename them: the extension is the correct modelling, and `FlockHubOptions`
  still matches the grep string. If the Orchestrator wants the grep byte-clean, the rename would be
  `HubService` + `CreateHubOptions`, which is a public API change for `apps/server`.
- I touched two files in Epic 26's feature folder (`apps/web/src/features/metrics/{cost,MetricsPanel}.test.tsx`)
  and the shared golden fixture, because the pricing ruling makes them stale otherwise. Pollution risk
  with Epic 34 is low (it does not edit metrics tests), but the integrator should know.
- Peak vs off-peak pricing is a product choice ($0.30 vs $0.15 per M uncached input). I chose peak so the
  `budget.maxUsd` guardrail cannot under-count; halving the input/output figures switches to a typical bill.
