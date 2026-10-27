# Epic 130: Web: Sky round 3 (100 tasks, richer roosts, murmuration burst)

**Wave 3 · Branch `epic/130-web-sky-r3` · Issue: `gh issue list --search "Epic 130 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 90–150 min of autonomous work**

## Where you are
Starling (`.orchestrator/PRD.md`) is an open-source, open-weight-first harness. It turns one coding goal into a lane-safe task DAG, runs a flock of opencode agents in parallel git worktrees on this laptop and on other laptops ("perches"), audits each result, and merges everything through a queue, shown live in a murmuration dashboard.

**Waves 0, 1, C1 and 2 are merged** (tags `epic-NN-complete`). About 2,500 tests pass across every package, the CLI, server, web dashboard, skill, tools and evals. Epic 40 (integration captain) is landing the **real** composition (`starling run` driving real opencode agents) in parallel with you, so for now `apps/cli`, `packages/core`, `packages/llm`, `packages/runner` and `apps/web/src/data` are **off limits** (Wave 3b takes them after Epic 40 merges).

**Wave 3 is the big one: about 100 agents run at the same time on one laptop**, each in its own worktree and lane. That only works if everyone follows the rules below exactly.

**Read before you start:** `AGENTS.md`, `.orchestrator/ARCHITECTURE.md` (§6 contracts, §7 locked decisions), the `docs/epic-*.md` for every package you touch (their "Interfaces for future epics" sections), the handbacks in `.orchestrator/handbacks/` that mention your area, and **`.orchestrator/fix-requests-w2.md`**.

## Tech decisions already locked (build on these, don't relitigate)
ARCHITECTURE §7 **L1–L31** still hold (Bun 1.4.4, TS 5.9.3, zod 4, Biome 2.6.3; web tests run in their own process; Markdown formatter off; no local models; real LLM calls only via the `opencode` profile). Wave 3 adds:
- **L32 Lanes are absolute.** Write only inside your lane, plus your own `docs/epic-130-web-sky-r3.md` and `.orchestrator/handbacks/130-web-sky-r3.md`. Shared registration files you don't own (`apps/web/src/App.tsx` and `app/Layout.tsx`, `apps/cli/src/program.ts`, `apps/server/src/app.ts`, any package `index.ts` outside your lane) are **wired later by checkpoint C3**. Ship your work as a self-contained module with the manifest described in your prompt, and say in the handback exactly what C3 must add (file, line, code).
- **L33 Public APIs are additive only.** Never rename or remove an export, field, route, CLI flag or event other code uses. Deprecate instead. About 100 branches merge after yours.
- **L34 No new dependencies.** Don't touch any `package.json` dependency list, `bun.lock`, the root `package.json`, `tsconfig.base.json` or `biome.json`. Everything you need is already installed (React 19, lucide-react, zustand, @xyflow/react, Tailwind v4, Hono, commander, zod, bun:test, happy-dom, Playwright). If something is truly missing, write a CONTRACT REQUEST instead.
- **L35 Heavy commands go through the slot gate.** With 100 agents, everyone running the full suite at once would melt the laptop. While iterating, run **only your own tests** (`bun test <your dir>`; for web code `cd apps/web && bun test src/features/<x>`) and **only your own typecheck** (`bunx tsc --noEmit -p <your package or app>`). Run the full suite **once, at the end**, through the gate: `bash .orchestrator/bin/heavy.sh bun run test` and `bash .orchestrator/bin/heavy.sh bun run check` (also wrap `bun run build` and any Playwright run). The gate may print "waiting" for a few minutes. If your shell tool times out while it waits, just run it again.
- **L36 Bugs outside your lane are FIX REQUESTS, never edits.** QA epics record a confirmed bug as **`test.todo('BUG <area>: <one line>', () => { ... })`** with the real assertions inside, plus a FIX REQUEST. Never use `test.failing` and never commit a red test: about 100 fixes land in parallel, and a `test.failing` turns red the moment someone fixes the bug. **The one allowed cross-lane edit:** if your fix makes an existing `test.failing` probe in `tools/security/**` pass, change that probe's `test.failing(` to `test(` in the same PR (nothing else in that file) and say so in the handback.
- **L37 No real model calls and no real Starling runs in Wave 3a** unless your prompt says otherwise. Use the recorded runs in `fixtures/runs/*.jsonl`, `@starling/core/testing` fakes and the mock compose paths. No Ollama, no local models (L23).
- **L38 Tests live next to the code, and everything is deterministic.** No sleeps over 50 ms, no wall-clock assertions, no network beyond `127.0.0.1` on port `0`, and temp dirs under `os.tmpdir()` that clean up after themselves. Another 99 agents are hammering the CPU, so timing-sensitive tests will flake.
- **e2e depends on the Sky geometry.** `apps/web/e2e/support.ts` (now Epic 140's lane) imports `makeWire`/`wireSlotX` from `features/sky/layout` and hovers merged birds on their wire slots, and the suite reads `data-testid="sky-view"`. Keep those signatures and the wire/perch geometry for ≤ 30 tasks unchanged. The new `sky-tooltip` testid and freeze hook are additive (Epic 140 feature-detects them).
- The shell already passes `paused={view !== 'sky'}` (`Layout.tsx`, Epic 112's lane); don't touch it.
- The e2e visual baselines mask the canvas, so they should survive. If anything else visible changes, don't re-record them (Epic 140's lane); note it for C3.

## FIRST TASK: carryover
Open `.orchestrator/fix-requests-w2.md`. Implement every request that targets a file in your lane, or decline it with a one-line reason. List each one in your handback under **Carryover done**.

Also, specifically for this epic:
- **Epic 41 #3 / Epic 47 #2 (`paused`)**: already done. `SkyView` honours `paused` (`SkyView.test.tsx` "the paused prop stops the rAF loop…") and `Layout.tsx` passes it via `skyExtras`. Verify and list as done.
- **Epic 47 #1** (`SkyViewProps.paused` in core's handshake): decline. That's Wave 3b (Epic 202).
- **Epic 71 #1**: `data-testid="sky-tooltip"` on the hover card and a freeze hook that stops the sim without reduced motion (deliverable 1).
- **Epic 61 note** (pre-existing flake): `sim.test.ts`'s 250 ms boids budget fails under machine load. Make it deterministic (deliverable 4).

## Your lane (you may write ONLY here)
`apps/web/src/features/sky/**`
plus `docs/epic-130-web-sky-r3.md` and `.orchestrator/handbacks/130-web-sky-r3.md`. Read anything.

## Goal
The Sky is the thing judges remember, and Wave 3's demos are bigger: the "big day" goals have 12–60 tasks and the story is "100 agents built this". The Sky currently caps at `MAX_TASKS = 30` (`sim.ts:43`) and silently drops every task past the 30th (`order.slice(0, MAX_TASKS)`). This round makes the Sky honest at 100 tasks while keeping 60 fps on an M2 Air, gives the roosts more to say (latency, model, away state), and turns the end of a run into a proper murmuration burst. It also lands the test hooks Epic 71 asked for, so the e2e suite can finally snapshot the canvas.

## Deliverables
1. **Carryover** (below): verify and record that `paused` is done, add `data-testid="sky-tooltip"` on the hover card, and add a freeze hook. Freeze when `window.__STARLING_SKY_FREEZE__ === true` (checked each frame) or when the root carries `data-freeze="true"`: stop advancing the sim but keep drawing the current frame, without enabling reduced motion. Expose `data-paused="true|false"` on the `sky-view` root.
2. **Adaptive density**:
   - Add `birdsPerFlock(taskCount: number): number` (12 at ≤ 30 tasks, shrinking smoothly to a minimum of 3) and `BIRD_BUDGET = 400`.
   - Raise `MAX_TASKS` to 100. Keep every export; `MAX_BIRDS` stays "buffer capacity" and must be ≥ the budget.
   - Merged flocks on the wire compress to 3 birds when there are more than 30 tasks.
   - Extend `withStressTasks(run, nodes, count?)` to 100.
   - Tests: 100 tasks all have a flock, total birds ≤ budget, deterministic for a seed, and ≤ 30 tasks behaves exactly as before (same `BIRDS_PER_FLOCK`, same wire geometry).
3. **Render cost**:
   - In `render.ts`: batch bird drawing into one path per status colour (no per-bird `fillStyle` switch), cache roost label text metrics per (name, font size), and drop trails above 200 birds.
   - Add a deterministic counter: `renderer.stats(): { drawCalls: number; fillStyleChanges: number; birds: number }` per frame (additive export).
   - Assert at 100 tasks that `fillStyleChanges ≤ statuses + roosts + 8`. This is an op count, not a timer.
4. **Fix the flaky perf test** (`sim.test.ts` "360 birds × 600 steps in under 250 ms"): replace it with a step-work assertion (e.g. neighbour comparisons per step counted via an optional counter in `boids.ts` ≤ flocks × birds²) and keep a wall-clock version only under `test.if(process.env.STARLING_PERF === '1')` with a generous budget.
5. **fps evidence**: extend `preview.html` to accept `?stress=100` (today `stress=1` → 30 tasks; keep that meaning) and read fps via the existing `onFps`. Paste fps at 30 and 100 tasks, normal and reduced motion, in the handback.
6. **Richer roosts**:
   - Below the name and `3/5` gauge (Epic 47): latency ("18 ms", from `NodeInfo.latencyMs`) and a short model chip (first `localModels` entry, e.g. `qwen3.6`).
   - An "away" state when `status === 'offline'`: dimmed, gauge hidden, with "away" under the name.
   - Labels stay ≥ 18 px at 1080p (`roostLabelFont`) and never overlap at 6 roosts. Test the layout metrics.
7. **Murmuration burst**: build on Epic 47's `sweepProgress()`/`SWEEP_DURATION`.
   - When `run.status` becomes `finished` (once per run id), every landed bird lifts off the wire. They join one shared leader path (a seeded Lissajous or figure-eight) for about 4 s, then re-perch in merge order, with a soft chirp via the existing sound engine when enabled.
   - A `failed`/`cancelled` run gets a short muted scatter instead.
   - Reduced motion: no movement, only the existing caption ("All 7 landed").
   - Expose `sim.burstProgress(): number` (-1 idle, 0..1). Test the state machine with fixed steps (trigger once, not retriggered by re-renders, re-armed by a new run id).
8. **Stable public surface**: `index.ts` exports are additive only, and `SkyView` props stay the §8 props + existing extras (`paused`, `onFps`, `createAudio`).
9. **Tests**: ≥ 25 new across sim/render/SkyView/polish; all existing sky tests still pass unchanged (except the perf test you replace).

## Explicitly out of scope
- `app/Layout.tsx`, the shell and registry (Epic 112), stage page (127), topology view (128): don't edit them.
- `SkyViewProps.paused` in `packages/core/src/handshake.ts` is Wave 3b (Epic 202).
- No data-layer changes (`apps/web/src/data` is read-only).

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree (it must not change `bun.lock`).
2. `cd apps/web && bun test src/features/sky` → 0 fail, ≥ 25 new tests (paste before/after counts).
3. `bunx tsc --noEmit -p apps/web` clean and `bunx biome check apps/web/src/features/sky` clean.
4. Paste measured fps from `/src/features/sky/preview.html?stress=1` and `?stress=100` (Chromium; a throwaway Playwright script outside the repo through `heavy.sh` is fine) and commit 2 PNGs ≤ 300 KB to `features/sky/__screens__/`: 100-task mid-run and the burst.
5. `bash .orchestrator/bin/heavy.sh bun run test` at the repo root → 0 fail (paste both halves' summary lines).
6. `bash .orchestrator/bin/heavy.sh bun run check` → clean.
7. `docs/epic-130-web-sky-r3.md` (AGENTS.md §6 sections) and `.orchestrator/handbacks/130-web-sky-r3.md` written. The handback has **Carryover done**, **C3 wiring** (exact code C3 must add, or "none") and **FIX REQUESTS** (or "none") sections. PR opened per AGENTS.md §6 with `Closes #<issue>`. Print the PR URL last.

## Git
Branch `epic/130-web-sky-r3`. Conventional Commits scoped to your lane, committed small and often (at least 5 commits). `git fetch origin && git rebase origin/main` before pushing. No merging, no tags. Never `git add -A` at the repo root without checking `git status` first: only your lane's files belong in the PR.
