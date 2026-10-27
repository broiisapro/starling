# Epic 33 (Checkpoint C1-a): Core consolidation, contract requests, root health

**Checkpoint C1 · Branch `epic/33-c1-core-consolidation` · No GitHub issue (it's a checkpoint epic, so skip `Closes #`) · Model: DeepSeek V4.1 Flash · Budget: 45–90 min**

## Where you are
Starling (`.orchestrator/PRD.md`, `.orchestrator/ARCHITECTURE.md`) just finished **Wave 1**. 23 epics were built in parallel against mocks and all **merged into `main`** (tags `epic-10-complete` … `epic-32-complete`). The Orchestrator ran an integration dry run of all 23 branches before they were merged:
- Every branch merged cleanly with no conflicts, and every lane was respected.
- **Typecheck passes in all 18 workspaces.**
- **Tests: 1,726 pass, 0 fail, but only when `apps/web` runs in its own `bun test` process.** In one process, happy-dom's `GlobalRegistrator` (registered by web tests) replaces the global `fetch`, which breaks `packages/llm`'s opencode V2 client tests that call a `Bun.serve` fake (7 failures: "Duplicate Content-Length" from happy-dom's fetch).
- **`bun run check` fails only on Biome *markdown formatting*** in `docs/epic-01`, `-02`, `-15`, `-20`, `-23`, `-24` (plus some `tools/local-models` files on main).
- 14 epics filed **CONTRACT REQUESTS** against the frozen core. The Orchestrator has ruled on each one below. You implement the rulings.

A sibling checkpoint epic (**34, web wiring**) runs **in parallel** with you and owns `apps/web/src/{app,data,components,lib}/**` and `apps/web/src/features/*/index.ts`/components. Stay out of those paths, except for the `handshake.ts` files listed in task 3.

## Tech decisions already locked
ARCHITECTURE §7 **L1–L25** and §8. You are the one epic allowed to change **root config and `@starling/core`**. Keep every change **additive and backward compatible**: existing callers must keep compiling and passing without edits, unless this prompt tells you to update them. L23 still applies: no real LLM, opencode prompts, GitHub calls or `ollama`.

## FIRST TASK: carryover (root health, before anything else)
1. **Test isolation.** Change the root `test` script so `apps/web` runs in its own `bun test` process: e.g. `bun test packages apps/server apps/cli skills integrations tools evals && (cd apps/web && bun test)`. The root summary must stay readable, so print a one-line label before each half. Also make `packages/llm`'s opencode client tests robust on their own: pass an explicit `fetch` (`globalThis.fetch` captured at module load, or Bun's native fetch) into the client in tests, so they'd survive a polluted global anyway. Verify: `bun run test` → **0 fail**.
2. **Biome.**
   - Disable the **Markdown** formatter at the root (`"markdown": { "formatter": { "enabled": false } }`, or the equivalent for Biome 2.6.3). Docs are prose written by many agents and must never fail CI on whitespace. Remove the now-redundant nested `skills/biome.json` and `integrations/biome.json` *only if* they exist solely for that purpose; check first.
   - Enable Tailwind directives in the CSS parser (`"css": { "parser": { "tailwindDirectives": true } }`), so `@theme`/`@utility` parse.
   - Run `bunx biome check --write` on `tools/local-models` for the pre-existing formatting failures.
   - Verify: `bun run check` → clean.

## Contract rulings to implement in `packages/core`
All additive. Add tests in core for each.
1. **`StarlingErrorCode`**: add `'LLM_BAD_JSON' | 'GIT_TOO_OLD' | 'GH_AUTH' | 'GH_REPO' | 'GH_COMMAND' | 'GH_MISSING' | 'NOT_WIRED' | 'NODE_AUTH'`. Then remove the workarounds that exist only because these were missing:
   - `packages/llm`: throw `LLM_BAD_JSON` directly; keep `isBadJsonError` as a thin helper so existing callers work.
   - `packages/workspace`: drop the `GIT_TOO_OLD_CODE` cast.
   - `packages/github`: `GitHubError` should be a `StarlingError` with the right `GH_*` code; keep the `githubCode` field as an alias.
   - `apps/cli`: use `NOT_WIRED`.
   - `packages/flock`: use `NODE_AUTH` for 401/403 instead of `INVALID_ARGUMENT`.
2. **`AuditCheck.durationMs?: number`** (int, ≥ 0, optional). Update `packages/auditor` to set it and stop appending ` (N ms)` to `detail`. Update the auditor's tests.
3. **`AuditVerdict.dod?: { item: string; met: boolean; evidence?: string }[]`** (optional). Update `packages/auditor` to copy the LLM's per-item DoD judgments into it.
4. **`NodeRegistry.onChange` event gets `reason?: string`.** Update `packages/flock` to use the core type instead of its local `FlockRegistryEvent` (keep a type alias export for compatibility).
5. **`LLM` cancellation**: add an optional second parameter `opts?: { signal?: AbortSignal; timeoutMs?: number }` to `complete` and `completeJson` in the port. `packages/llm`'s `LLMClient` already supports it; make it satisfy the port directly. `MockLLM` accepts and ignores the opts.
6. **`Merger.preflight?`** (optional method) plus the `MergePreflight` type, exactly as Epic 17's handback proposes (`{ clean; conflictedFiles; alreadyMerged; detail }`). `packages/merger` already implements it, so just type it against core.
7. **`BundleOps`** (`createBundle`, `cloneFromBundle`, `fetchBundle`, using Epic 14's exact signatures) and **`MdnsAdvertiser` / `MdnsBrowser` / `MdnsAdvertiseOptions`** (Epic 30/31 shapes; read both and unify) become core port types. `packages/workspace`, `packages/flock` and `packages/perch` import them from core; their local declarations become `export type X = core.X` aliases.

## Move the §8 handshake into core
8. Create `packages/core/src/handshake.ts` with **every** interface from ARCHITECTURE §8 (`StartRunInput`, `EngineApi`, `JoinInfo`, `FlockHub`, `BundleUrlFor`, all six web `*Props`, `WorkerHandback`), exported from the core index. Include these amendments:
   - `FlockPanelProps` gains `onSelectTask?(key: string): void` (Epic 32).
   - `MetricsPanelProps` gains `live?: boolean` (Epic 26).
9. Turn **every** local mirror (`src/handshake.ts` in engine, server, cli, flock, perch, prompts, and the `handshake.ts` files under `apps/web/src/data/` and `apps/web/src/features/*/`) into a one-line **re-export from `@starling/core`** (`export type { … } from '@starling/core';`). Re-export, don't delete, so nothing else needs to change. Verify every workspace still typechecks. These handshake files are the **only** `apps/web` files you may touch.
10. Add a **browser-safe entry** `@starling/core/browser` (`"./browser": "./src/browser.ts"` in core's `exports`). It exports the contracts (schemas and types), the handshake types, and the pure helpers (glob, metrics/pricing, ids). Nothing that imports `node:*`, `Bun`, `exec` or `config`. Add a test that bundles it with `Bun.build({ target: 'browser' })` and fails if any `node:` import sneaks in. (Epic 34 and Wave 2 will switch web imports to it.)

## Small housekeeping
11. **Pricing**: find DeepSeek V4.1 Flash's current *uncached input* price (webfetch DeepSeek's pricing page or docs; the page may be client-rendered, so try their API docs or a reputable mirror). Update `PRICING` (Epic 00 used a $0.28/M placeholder) with a source comment. If you truly can't find it, leave the placeholder and say so.
12. Update **ARCHITECTURE.md**? **No**: it's orchestrator-owned. Instead, list in your handback every rule you implemented, so the Orchestrator can append L26+.

## Explicitly out of scope
Wiring web components into the layout (Epic 34). Consolidating the two opencode V2 clients (`packages/llm` and `packages/runner` each wrote one; Wave 2 Epic 40 unifies them). CLI `--budget` and plan-stdout purity (Wave 2). Flock heartbeat/deregister/Last-Event-ID changes (Wave 2 Epic 42). Making `evals/` a workspace. Any behavioural change beyond the rulings above.

## Definition of done (run literally, paste results in the handback)
1. Fresh `bun install` clean.
2. `bun run test` → **0 fail** (paste both halves' summary lines; expect ≈ 1,700+ pass).
3. `bun run check` → clean.
4. `grep -rn "interface EngineApi\|interface FlockHub\|interface SkyViewProps" packages apps --include=*.ts --include=*.tsx | grep -v node_modules` shows each defined **only** in `packages/core/src/handshake.ts`.
5. The browser-entry bundle test passes.
6. `docs/epic-33-c1-core-consolidation.md` + `.orchestrator/handbacks/33-c1-core-consolidation.md` written. PR opened (`gh pr create --base main --title "epic(33): C1 core consolidation" --body-file …`). Print the PR URL last.

## Git
Branch `epic/33-c1-core-consolidation`. Conventional Commits, one commit per numbered item where sensible (`chore(root): isolate web tests`, `feat(core): GH_* error codes`, `refactor(flock): registry events from core`, …), at least 10 commits. Rebase on `origin/main` before pushing. No merging, no tags.
