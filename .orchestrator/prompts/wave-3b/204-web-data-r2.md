# Epic 204: Web data round 2: diff events, seekable replays, insights clients, feature slices

**Wave 3b · Branch `epic/204-web-data-r2` · Issue: `gh issue list --search "Epic 204 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 90–150 min of autonomous work**

## Where you are
Starling (`.orchestrator/PRD.md`) is an open-source, open-weight-first harness. It turns one coding goal into a lane-safe task DAG, runs a flock of opencode agents in parallel git worktrees on this laptop and on other laptops ("perches"), audits each result, and merges everything through a queue, shown live in a murmuration dashboard.

**Waves 0, 1, C1 and 2 are merged** (tags `epic-NN-complete`). About 2,500 tests pass across every package, the CLI, server, web dashboard, skill, tools and evals. Epic 40 (integration captain) is landing the **real** composition (`starling run` driving real opencode agents) in parallel with you, so for now `apps/cli`, `packages/core`, `packages/llm`, `packages/runner` and `apps/web/src/data` are **off limits** (Wave 3b takes them after Epic 40 merges).

**Wave 3 is the big one: about 100 agents run at the same time on one laptop**, each in its own worktree and lane. That only works if everyone follows the rules below exactly.

**Read before you start:** `AGENTS.md`, `.orchestrator/ARCHITECTURE.md` (§6 contracts, §7 locked decisions), the `docs/epic-*.md` for every package you touch (their "Interfaces for future epics" sections), the handbacks in `.orchestrator/handbacks/` that mention your area, and **`.orchestrator/fix-requests-w2.md`**.

## Tech decisions already locked (build on these, don't relitigate)
ARCHITECTURE §7 **L1–L31** still hold (Bun 1.4.4, TS 5.9.3, zod 4, Biome 2.6.3; web tests run in their own process; Markdown formatter off; no local models; real LLM calls only via the `opencode` profile). Wave 3 adds:
- **L32 Lanes are absolute.** Write only inside your lane, plus your own `docs/epic-204-web-data-r2.md` and `.orchestrator/handbacks/204-web-data-r2.md`. Shared registration files you don't own (`apps/web/src/App.tsx` and `app/Layout.tsx`, `apps/cli/src/program.ts`, `apps/server/src/app.ts`, any package `index.ts` outside your lane) are **wired later by checkpoint C3**. Ship your work as a self-contained module with the manifest described in your prompt, and say in the handback exactly what C3 must add (file, line, code).
- **L33 Public APIs are additive only.** Never rename or remove an export, field, route, CLI flag or event other code uses. Deprecate instead. About 100 branches merge after yours.
- **L34 No new dependencies.** Don't touch any `package.json` dependency list, `bun.lock`, the root `package.json`, `tsconfig.base.json` or `biome.json`. Everything you need is already installed (React 19, lucide-react, zustand, @xyflow/react, Tailwind v4, Hono, commander, zod, bun:test, happy-dom, Playwright). If something is truly missing, write a CONTRACT REQUEST instead.
- **L35 Heavy commands go through the slot gate.** With 100 agents, everyone running the full suite at once would melt the laptop. While iterating, run **only your own tests** (`bun test <your dir>`; for web code `cd apps/web && bun test src/features/<x>`) and **only your own typecheck** (`bunx tsc --noEmit -p <your package or app>`). Run the full suite **once, at the end**, through the gate: `bash .orchestrator/bin/heavy.sh bun run test` and `bash .orchestrator/bin/heavy.sh bun run check` (also wrap `bun run build` and any Playwright run). The gate may print "waiting" for a few minutes. If your shell tool times out while it waits, just run it again.
- **L36 Bugs outside your lane are FIX REQUESTS, never edits.** QA epics record a confirmed bug as **`test.todo('BUG <area>: <one line>', () => { ... })`** with the real assertions inside, plus a FIX REQUEST. Never use `test.failing` and never commit a red test: about 100 fixes land in parallel, and a `test.failing` turns red the moment someone fixes the bug. **The one allowed cross-lane edit:** if your fix makes an existing `test.failing` probe in `tools/security/**` pass, change that probe's `test.failing(` to `test(` in the same PR (nothing else in that file) and say so in the handback.
- **L37 No real model calls and no real Starling runs in Wave 3a** unless your prompt says otherwise. Use the recorded runs in `fixtures/runs/*.jsonl`, `@starling/core/testing` fakes and the mock compose paths. No Ollama, no local models (L23).
- **L38 Tests live next to the code, and everything is deterministic.** No sleeps over 50 ms, no wall-clock assertions, no network beyond `127.0.0.1` on port `0`, and temp dirs under `os.tmpdir()` that clean up after themselves. Another 99 agents are hammering the CPU, so timing-sensitive tests will flake.
- **Wave 3b ownership.** You are the **single owner of `apps/web/src/data`** in Wave 3b. The header's line saying `apps/cli`, `packages/core`, `packages/llm`, `packages/runner` and `apps/web/src/data` are off limits was written for Wave 3a and **does not apply to your lane**. The other areas in that list stay off limits to you: Epics 200 (`packages/llm`), 201 (`packages/runner`), 202 (`packages/core`) and 203 (`apps/cli`) own them and run **in parallel** with you, so never wait for them and never edit their lanes.
- **Where main is now.** Your `main` includes Epic 40 (the real `starling run`: `apps/cli/src/real/compose-real.ts`, real recordings in `fixtures/real/*.jsonl`, its core additions) and the Wave 3a epics merged so far. Start with `git log --oneline origin/main | head -40`, `docs/epic-40-integration-captain.md` and `.orchestrator/handbacks/40-integration-captain.md`. The Wave 3a handbacks are `.orchestrator/handbacks/1[0-9][0-9]-*.md` (careful: `1*.md` also matches the Wave 1 handbacks 10–19). Read the ones that mention your area: their **FIX REQUESTS**, **CONTRACT REQUESTS** and **C3 wiring** sections are carryover for you too, exactly like `fix-requests-w2.md`.
- **Web tests run in their own process (L26).** Use `cd apps/web && bun test src/data` and `cd apps/web && bunx tsc --noEmit -p .` while you iterate. Clients always take an explicit `fetch` in tests.
- **Additive only.** Many features import `SkyState`, the selectors and `skyActions`, so add fields and actions but never rename or reshape existing ones (L33).

## FIRST TASK: carryover
Open `.orchestrator/fix-requests-w2.md`. Implement every request that targets a file in your lane, or decline it with a one-line reason. List each one in your handback under **Carryover done**.

Also, specifically for this epic:
- **Epic 70, F8:** `appendCapped` copies on every event (89 ms GC pauses at saturation). Make it amortised.
- **Epic 41, deferred:** refresh a cached drawer diff after a later fix attempt; pin the selected run against "newest run wins".
- **Epic 41, FIX REQUEST 2 (consumer side):** handle a `task.diff` event, so live diffs arrive without a fetch.
- **Epic 53, FIX REQUESTS 1–2 (data side):** the `startRun` and `previewRun(input)` web clients. Persisting recent repos and the `?repo=` handling are shell work, so FIX REQUEST them to the shell's owner.
- **SEC-01 (Epic 69), client half:** teach the web data layer to send the server token.
- **Wave 3a:** every data need in the **C3 wiring** sections of the web handbacks (deliverable 1).

## Your lane (you may write ONLY here)
`apps/web/src/data/**`
plus `docs/epic-204-web-data-r2.md` and `.orchestrator/handbacks/204-web-data-r2.md`. Read anything.

## Goal
Wave 3a shipped around 25 dashboard features that read state only through `FeatureProps` and the selectors. Each one ended its handback with a **C3 wiring** note listing what the data layer must provide. You are the single data owner who makes those wires possible:
- `task.diff` and `run.status` in the reducer;
- seekable replays for the scrubber;
- clients for the insights, compare, launch and preview routes;
- token- and server-URL-aware fetch and SSE;
- the store slices the new panels asked for;
- the reducer's copy-per-event cost removed.

Great looks like this: C3 can wire every merged feature without touching `apps/web/src/data` again, and a replay can scrub to any event of a 1,000-event real run and land on exactly the state a straight replay produces.

## Deliverables
1. **Inventory at start.** Read the **C3 wiring** and **FIX REQUESTS** sections of every merged Wave 3 web handback: `.orchestrator/handbacks/1[1-4][0-9]-*.md` (112–141), plus 191 (qa-web-core) and 141 (web-perf) if present. Your doc gets a table: feature | data need | decision (implemented / exists / declined → owner) | export name. Implement every need that lives in `apps/web/src/data`. Needs in the shell or the server become FIX REQUESTS.
2. **Events.**
   - `task.diff` sets `state.diffs[diffKey(runId, taskKey)]`. Put a new `task-diff.ts` next to `run-status.ts`, with `isTaskDiffEvent` and a local `TaskDiffEvent` type `{ type: 'task.diff'; runId: string; ts: number; payload: { taskKey: string; diff: DiffSummary } }`. Exclude that type from the exhaustive union the same way `KnownStarlingEvent` excludes `RunStatusEvent`, so the reducer and `demo.ts` compile both before and after Epic 202 adds the core arm.
   - A cached diff is dropped when that task starts a later fix attempt (deferred by Epic 41).
   - `run.status` is now a real core arm (Epic 40). Keep the `isRunStatusEvent` and `RunStatusEvent` exports (L33), and test it against `fixtures/real/*.jsonl`.
3. **Seek** (`data/seek.ts`).
   - `seekState(events: readonly StarlingEvent[], index: number, cache?: SeekCache): SkyState` gives the same result as `applyEvents(createInitialState(), events.slice(0, index + 1))`, using checkpoints every 500 events so a seek costs at most 500 applies after warm-up.
   - `DemoHandle` gains (additively) `seek(index)`, `pause()`, `resume()`, `setSpeed(speed)`, `readonly length` and `readonly paused`.
   - The store gets a `playback` slice: `{ index: number; length: number; playing: boolean; speed: number; markers: { index: number; kind: 'merge' | 'fail' | 'finish' }[] }`, plus actions `seekTo(index)` and `setPlayback({ playing?, speed? })`. These are what the scrubber (124) emits.
   - Tests are deterministic, with injected `DemoTimers`.
4. **API clients** (`api.ts`). Every client returns `undefined` on 404/501 (route not mounted yet) and validates the response shape:
   - `startRun(input: StartRunInput & { budgetUsd?: number })` → `POST /api/runs`;
   - `previewRun(input)` → `POST /api/runs/preview` (Epic 53);
   - `fetchRunReport(runId)`, `fetchRunTimeline(runId)` and `fetchRunCosts(runId)` → `/api/runs/:id/report|timeline|costs`;
   - `fetchCompare(a, b)` → `/api/compare?a=&b=` (Epic 111's routes).

   Response types: import them from Epic 111's module only if it's browser-safe; otherwise use documented local mirror types.
5. **Server settings and auth.**
   - `ApiOptions` gains `baseUrl?` and `token?`. SSE `connectEvents` / `connectRunEvents` take the same options.
   - `EventSource` can't send headers, so use whatever Epic 110's handback documents (e.g. `?token=`). If 110 isn't merged, implement the option with a no-token default and say so.
   - A `serverSettings` slice plus `setServerSettings({ baseUrl?, token? })`. Settings (118) supplies these.
6. **Perf** (Epic 70's F8). `appendCapped` copies the whole capped array on every event: 5,000 elements at saturation. Make it amortised: allow up to 10% overflow, then trim once. The public array semantics stay the same (oldest first, length ≤ cap after trimming).
   - Add an op-count test: ingesting 50,000 events copies fewer than 12 elements per event on average. Count copies with a wrapper, never wall clock.
7. **Feature slices from the inventory.** Expected examples; build what the handbacks actually ask for:
   - a monotonic `eventSeq` for toasts (121);
   - `connectionStats { retries: number; lastError?: string; lastEventTs?: number }` for health (129);
   - an unfiltered all-runs event ring for the console (117);
   - `pinnedRunId` plus `pinRun(runId?)`, so auto-follow stops replacing a pinned selection (deferred by Epic 41).

   New pure selectors go in a new `selectors-w3.ts`. Existing selectors keep their outputs byte-identical: about 25 features import them.
8. **Exports.** `data/index.ts` exports everything new (additive).
9. **Tests: at least 40 new**, run with `cd apps/web && bun test src/data`. Cover:
   - reducer arms;
   - seek equivalence (forward, backward, random order) on `fixtures/real/launch-day.jsonl`, read with `node:fs` in the test;
   - playback markers;
   - the API clients with a fake `fetch` (404/501 → `undefined`, malformed → `undefined`);
   - token propagation;
   - the ring op counts;
   - pinning.

## Explicitly out of scope
- The shell: `apps/web/src/app/**`, `App.tsx`, the feature registry (Epic 112) and C3's wiring lines.
- Feature folders (`apps/web/src/features/**`).
- `apps/server/**`: the insights routes (111) and the preview endpoint are server work. File FIX REQUESTS if a route you need is missing.
- `packages/core/**`: Epic 202 is adding `task.diff`, `log.payload.code?`, `StartRunInput.budgetUsd?` and `EngineApi.preview?` in parallel. Code against local types.

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree (it must not change `bun.lock`).
2. `cd apps/web && bun test src/data` → 0 fail, at least 40 new tests.
3. `cd apps/web && bunx tsc --noEmit -p .` clean.
4. Paste the names of the seek-equivalence tests over `fixtures/real/launch-day.jsonl` (1,141 events): `seekState(events, i)` deep-equals the straight replay for the first, middle and last index, and for a backwards-then-forwards sequence.
5. `cd apps/web && bash ../../.orchestrator/bin/heavy.sh bun run build` OK. Paste the bundle size line, plus the inventory table's row count and how many rows are implemented.
6. `bash .orchestrator/bin/heavy.sh bun run test` at the repo root → 0 fail (paste both halves' summary lines).
7. `bash .orchestrator/bin/heavy.sh bun run check` → clean.
8. `docs/epic-204-web-data-r2.md` (AGENTS.md §6 sections) and `.orchestrator/handbacks/204-web-data-r2.md` written. The handback has **Carryover done**, **C3 wiring** (exact code C3 must add, or "none") and **FIX REQUESTS** (or "none") sections. PR opened per AGENTS.md §6 with `Closes #<issue>`. Print the PR URL last.

## Git
Branch `epic/204-web-data-r2`. Conventional Commits scoped to your lane, committed small and often (at least 5 commits). `git fetch origin && git rebase origin/main` before pushing. No merging, no tags. Never `git add -A` at the repo root without checking `git status` first: only your lane's files belong in the PR.
