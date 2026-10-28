"""Wave 3 group B2: web stage/topology/health, round 2 of the existing web features, gallery, a11y, e2e, perf."""

# Shared snippets -------------------------------------------------------------------------------

LEGIBILITY = """- **Legibility floor is enforced across lanes.** `apps/web/src/features/metrics/legibility.test.ts` (Epic 55, metrics lane) scans every non-test `.ts/.tsx` in `dag`, `agents`, `queue`, `metrics` and `flock`: no `text-[<12px]`, no `text-[13px]`, no `text-slate-500`…`900` (or gray/zinc/neutral/stone), no shell `text-micro`/`text-caption` tokens. New code in those folders must pass it; run it with your own tests (`cd apps/web && bun test src/features/metrics/legibility.test.ts`)."""

EXTRAS = """- **Additive props only, the existing way.** New inputs are optional props declared in your feature's `types.ts` extras intersection (pattern: `DagViewExtras`, `QueueExtras`, `MetricsExtras`, `FlockPanelExtras`), so the component still satisfies the frozen §8 props from `@starling/core`. `app/Layout.tsx` is Epic 112's: in the handback's **C3 wiring** give the exact prop expression C3 should add at the call site (e.g. `tasks={activeRunOf(state)?.tasks}`), and make the component behave well when it's absent.
- Test DOM pattern: copy `features/flock/test-dom.ts` (register happy-dom defensively, `react-dom/client` + `act`, no Testing Library `screen`). Web tests run in their own process: `cd apps/web && bun test src/features/<x>`.
- Visible changes will break the two e2e visual baselines (`apps/web/e2e/__screenshots__/end-*.png`, Epic 140's lane). Don't re-record them; write "C3: re-record e2e baselines (`bun run --cwd apps/web e2e:update`)" in the handback."""

FEATURE_PROPS_TEXT = "`{ state: SkyState; onSelectTask?(key: string): void; onSelectRun?(runId: string): void; onClose?(): void }`"

SPECS = [
    # ── 127 ─────────────────────────────────────────────────────────────────────────────────────
    {
        "nn": "127",
        "slug": "web-stage",
        "title": "Web: presenter stage mode",
        "lane": "`apps/web/src/features/stage/**`",
        "wave": "3",
        "convention": "web",
        "budget": "90–150 min",
        "goal": """The live demo happens on a projector, often a 720p one, watched from the back of a room. The normal dashboard is built for a developer at arm's length: five dense regions, 12 px meta text. Stage mode is the judges' view: a huge Sky, a few giant counters (landed, flying, API dollars vs local calls, elapsed), a ticker of merges along the bottom, and chrome that hides itself after a few seconds so nothing but the murmuration is on screen. Great looks like this: the presenter presses `s`, steps back, and the room can read every number at 1280×720. When the run finishes, a finale banner lands at the same moment as the Sky's all-landed sweep. It's a new page (`kind: 'page'`, `?page=stage`) built only from existing feature components and pure selectors.""",
        "deliverables": """1. **Files**: `index.ts` (L39 manifest: `id: 'stage'`, `title: 'Stage mode'`, `kind: 'page'`, `icon: 'Presentation'`, `hotkey: 's'`; check the icon exists in `lucide-react`), `StagePage.tsx` (root, `FeatureProps`), `stage-model.ts` (pure), `use-idle.ts`, `BigCounters.tsx`, `MergeTicker.tsx`, `Finale.tsx`, `Playground.tsx` + `playground.html` + `playground-main.tsx`, plus tests next to each.
2. **`stage-model.ts`** (pure, no React):
   - `export interface StageCounters { landed: number; total: number; flying: number; auditing: number; grounded: number; apiCostUsd: number; localCalls: number; estSavedUsd: number; elapsedMs: number; nodesOnline: number; nodesTotal: number }`
   - `stageCounters(state: SkyState): StageCounters` (via `activeRunOf`, `sortedNodes` from `data/selectors`, latest `state.metricsHistory.at(-1)?.metrics ?? run.metrics`; "flying" = running|fixing, "auditing" = auditing|merging).
   - `tickerItems(state: SkyState, max = 8): TickerItem[]` with `TickerItem = { key: string; title: string; status: MergeResult['status']; ordinal: number; commit?: string; ts: number }`, built from `state.merges` (newest first, latest result per task key, titles from `run.plan.tasks`, key as fallback).
   - `stageHeadline(state): { phase: 'idle' | 'planning' | 'flying' | 'landed' | 'failed'; title: string; sub: string }` ("Waiting for a goal", "5 birds in the air", "All 7 landed in 5m 55s").
3. **`StagePage`** fills the viewport (`h-dvh w-full overflow-hidden`, no page scroll at 1280×720 or 1920×1080). The Sky gets about 75% of the area: `<SkyView {...skyProps(state, actions)} reducedMotion={reduced} />` (import from `../sky`; `usePrefersReducedMotion` from `../metrics`). A right rail of `BigCounters` and a bottom `MergeTicker`. Use `clamp()` sizes: values at least 40 px and labels at least 18 px at 720p, scaling up at 1080p. Only design tokens and `components` (`Stat`, `Badge`, `EmptyState`).
4. **Auto-hiding chrome**: `useIdle(timeoutMs = 2500, timers?: { setTimeout; clearTimeout }): boolean` goes idle after no `pointermove`/`keydown`/`touchstart`. While idle, the header (goal text, `state.connection` badge, "Exit stage (Esc)" button, "Full screen" button) fades out and the cursor is hidden; any input brings it back. There's no fade under reduced motion, just show/hide. Esc calls `onClose` (document keydown; ignore inputs and `defaultPrevented`). Full screen calls `document.documentElement.requestFullscreen?.()` inside try/catch. Don't bind `f`: it's taken.
5. **Merge ticker**: the newest merge slides in from the left (CSS transform, 0 ms under reduced motion). It shows `#3 dark-mode · Dark mode toggle · a1b2c3d`, plus a red chip for `conflict`/`tests-failed`. A separate sr-only `aria-live="polite"` node announces only the newest merge. Empty state: "Nothing on the wire yet".
6. **Finale**: when `activeRunOf(state)?.status === 'finished'`, show a large banner: "All 7 landed · 5m 55s · $0.04 API · 9 local calls". A failed or cancelled run gets an amber banner with the grounded count. It appears once per run id, can be dismissed with a click or Esc (the first Esc dismisses the banner, the second exits stage), and is static under reduced motion.
7. **Bird clicks** pass through to `onSelectTask` when it's provided. Stage has no drawer of its own, so don't import `AgentDrawer`.
8. **Playground** (`/src/features/stage/playground.html`): plays the recorded run at 16× into local React state with `playDemo({ onEvent: (e) => setState((s) => applyEvent(s, e)), speed: 16, rebaseTo: () => Date.now(), onLoop: () => setState(createInitialState()) })` (`data/demo`, `data/reducer`; import only). A small corner control switches speed (1/4/16) and restarts.
9. **Tests (≥ 30)**:
   - `stage-model` against `applyEvents(createInitialState(), demoEvents())`: 7 of 7 landed, $0.04 API, 9 local calls, 2 nodes. Also against a mid-run slice (pick the index by condition, not a magic number), the empty state, a failed merge and duplicate merge results.
   - `useIdle` with fake timers.
   - `StagePage` in happy-dom: Esc → `onClose`, chrome hidden after idle and shown on keydown, aria-live text, finale once per run.
   - A source scan of this folder: no `text-[<18px]`, no `text-micro`/`text-caption`.""",
        "oos": """- `?page=stage` routing, hotkey dispatch and the registry are Epic 112's (`app/**`); C3 adds the line.
- Don't edit `features/sky|queue|metrics|flock`: import their public `index.ts` only. If the Sky needs a prop for stage use (e.g. a larger label scale), write a FIX REQUEST to Epic 130.
- Don't import sibling Wave 3 features (report 113, toasts 121, scrubber 124, leaderboard 126): they aren't merged.
- `apps/web/src/data/**` is read-only (Wave 3b).""",
        "dod": [
            "`cd apps/web && bun test src/features/stage` → 0 fail, ≥ 30 tests.",
            "`bunx tsc --noEmit -p apps/web` clean and `bunx biome check apps/web/src/features/stage` clean.",
            "`bun run --cwd apps/web dev`, open `/src/features/stage/playground.html` at 1280×720 and 1920×1080 (a throwaway Playwright script outside the repo is fine, run through `heavy.sh`): commit 2 PNGs ≤ 300 KB (mid-run, finale) to `apps/web/src/features/stage/__screens__/` and paste `document.documentElement.scrollWidth/scrollHeight` vs the viewport (no page scroll).",
        ],
        "carryover": "",
    },
    # ── 128 ─────────────────────────────────────────────────────────────────────────────────────
    {
        "nn": "128",
        "slug": "web-topology",
        "title": "Web: flock topology",
        "lane": "`apps/web/src/features/topology/**`",
        "wave": "3",
        "convention": "web",
        "budget": "90–150 min",
        "goal": """The flock is the most surprising part of Starling: several laptops lending their agents to one run. Today it's a list of roost cards. The topology view makes it physical. The hub sits in the middle and the perches sit around it as roosts. Each link shows its latency. Birds orbit the roost they're working on, and when the engine migrates a task (`task.migrated`) a bird visibly flies hub-ward and out to its new laptop. Great looks like this: a judge watching the two-laptop demo sees the MacBook Air join, takes the point at once, and sees a task hop machines when the Air leaves. It's a centre view (`kind: 'view'`) like Sky and DAG.""",
        "deliverables": """1. **Files**: `index.ts` (L39 manifest: `id: 'topology'`, `title: 'Flock topology'`, `kind: 'view'`, `icon: 'Network'`, `hotkey: 'o'`), `TopologyView.tsx`, `topology.ts` (pure layout + model), `migrations.ts` (pure), `playground-fixtures.ts`, `Playground.tsx` + `playground.html` + `playground-main.tsx`, tests.
2. **Model**: `buildTopology(state: SkyState, size: { width: number; height: number }): Topology`.
   - `TopoNode = { id; name; role: 'hub' | 'local' | 'remote'; status: NodeStatus; activeSessions; maxSessions; latencyMs?: number; localModel?: string; tasks: { key: string; status: TaskStatus }[]; x: number; y: number; r: number }`.
   - `TopoLink = { from: string; to: string; latencyMs?: number; band: 'fast' | 'ok' | 'slow' | 'unknown' | 'down' }`.
   - The hub is the node with id `'hub'`, else the first `local` (same rule as `sortedNodes`). Perches go on an ellipse around it. Links are hub↔perch only (perches talk through the hub).
   - Positions are deterministic and **stable when a node joins**: order perches by first appearance in `state.events` (`node.joined`), falling back to `sortedNodes` order.
   - `r ∝ sqrt(maxSessions)`, clamped.
   - `latencyBand(ms?: number, status?: NodeStatus)`: < 25 fast, < 120 ok, else slow; `offline` → down; missing → unknown.
3. **Migrations**: `recentMigrations(events: readonly StarlingEvent[], now: number, windowMs = 4000): Migration[]` from `task.migrated` payloads (`{ taskKey, fromNode, toNode, reason }`), with `progress = (now - ts) / windowMs`. Unknown nodes are skipped. The view animates a bird glyph along from→hub→to, running `requestAnimationFrame` **only while a migration is in flight** (then the loop stops). Reduced motion: a static dashed arrow plus a label ("theme moved Air → Pro: perch left") for the window.
4. **Render** (SVG with `viewBox`, sized by a ResizeObserver with a fallback):
   - Roost circles with a sessions ring (arc = active/max), a crown on the hub, names ≥ 14 px at 1280×720.
   - A latency label on each link ("18 ms"). Link colour comes from the band; down links are dashed grey with "offline".
   - Up to 12 birds orbit each roost, coloured by task status via `statusColor` from `../sky`. Use a CSS rotate animation, paused under reduced motion.
   - Clicking a bird or task calls `onSelectTask(key)`. Each roost is a focusable `<g role="button" tabIndex={0} aria-label="MacBook Air · 3 of 5 sessions · 18 ms">`, and Enter selects its first live task.
5. **Accessible summary**: `<svg role="img">` with `<title>` and a `<desc>` from pure `describeTopology(t)` ("2 machines, 1 offline, slowest link 18 ms, 1 task moved in the last 4 s"), plus a visually hidden `<table>` of nodes and links.
6. **Edge states**:
   - 0 nodes → `EmptyState` "No flock yet".
   - 1 node → the hub alone with an "Invite a perch" hint that shows `state.join?.command` when present.
   - 12 perches → no overlapping circles and labels alternate above/below. Test this for 1..12 nodes.
7. **Playground**: the recorded run (hub + Air, one `task.migrated`, Air leaves and rejoins) replayed at 16× into local state with `playDemo` (as in the stage/flock playgrounds), plus toggles for "Add 6 synthetic perches" and "Replay a migration now" (injects a synthetic `task.migrated` at `Date.now()`).
8. **Tests (≥ 30)**: layout determinism and stability on join, bands, migrations window/progress, `describeTopology`, empty/1/12 nodes, offline perch, click/keyboard selection, and that the rAF loop stops when no migration is in flight (fake rAF).""",
        "oos": """- Sky roosts (Epic 130), flock panel (Epic 135), leaderboard (Epic 126): don't edit or import their unmerged work.
- No new events or fields. Per-pair link latency or migration progress from the hub would be a CONTRACT REQUEST to Wave 3b (core 202).
- View switching, registration and hotkey dispatch belong to Epic 112 + C3.""",
        "dod": [
            "`cd apps/web && bun test src/features/topology` → 0 fail, ≥ 30 tests.",
            "`bunx tsc --noEmit -p apps/web` clean and `bunx biome check apps/web/src/features/topology` clean.",
            "Playground at `/src/features/topology/playground.html`: commit 2 screenshots ≤ 300 KB (recorded run mid-migration; 8 perches with one offline) to `apps/web/src/features/topology/__screens__/`.",
        ],
        "carryover": "",
    },
    # ── 129 ─────────────────────────────────────────────────────────────────────────────────────
    {
        "nn": "129",
        "slug": "web-health",
        "title": "Web: system health panel",
        "lane": "`apps/web/src/features/health/**`",
        "wave": "3",
        "convention": "web",
        "budget": "90–150 min",
        "goal": """With 100 agents on a laptop and a second laptop on hotel wifi, things go wrong mid-demo: 429s, a perch that stops heartbeating, an agent that stalls, a budget warning, a dropped SSE stream. The engine already reports most of this as `log` events with stable policy codes (Epic 49), but nothing in the dashboard reads them. The health panel is the operator's glance: one red/amber/green light per subsystem, with a plain sentence explaining each non-green light. Great looks like this: during the demo the presenter sees "Air: last heartbeat 14 s ago" turn amber before the engine reschedules, and can say so out loud. It's a panel (`kind: 'panel'`), pure derivation over `SkyState`.""",
        "deliverables": """1. **Files**: `index.ts` (L39 manifest: `id: 'health'`, `title: 'System health'`, `kind: 'panel'`, `icon: 'HeartPulse'`, `hotkey: '!'`), `HealthPanel.tsx`, `health.ts` (pure), `codes.ts`, `use-tick.ts`, `fixtures.ts` (synthetic scenarios), `Playground.tsx` + `playground.html` + `playground-main.tsx`, tests.
2. **Extras** (`types.ts`): `HealthExtras = { now?: number; sse?: { status: 'connecting' | 'live' | 'offline'; attempt: number; delayMs?: number }; budgetUsd?: number; stallAfterMs?: number; compact?: boolean }`. The root component takes `FeatureProps & HealthExtras`. `sse` mirrors `data/sse.ts`'s `SseStatus` + `onStatus` detail, and C3 or Wave 3b can feed it later.
3. **`codes.ts`**: `policyCode(event: StarlingEvent): string | undefined`.
   - Read the additive `payload.code` the engine sets (`packages/engine/src/policies/log.ts` `PolicyCode`; copy the union as a local `const` with a pointer comment, and don't import the engine).
   - Else parse the `[code] detail` prefix (`policyMessage`).
   - Else apply heuristics to runner/llm/perch `warn` logs: `/\\b429\\b|rate.?limit/i` → `rate-limit.backoff`, and `/event stream (dropped|ended)/` → `stream.retry`.
4. **`deriveHealth(state: SkyState, now: number, extras?: HealthExtras): HealthReport`**, with `type Light = 'green' | 'amber' | 'red' | 'idle'`, `HealthRow = { id: 'stream' | 'heartbeats' | 'agents' | 'retries' | 'rate-limits' | 'budget' | 'errors'; light: Light; label: string; detail: string; items?: { id: string; light: Light; text: string }[] }`, and `overall` = the worst light. Rules:
   - **stream**: `connection` live → green (amber "reconnecting, attempt 3, next in 4 s" when `sse.status === 'connecting'`); demo → idle "Replaying the recorded run"; offline → red.
   - **heartbeats** (per node): age = clock − `lastSeen`. Under 10 s green, under 15 s amber, 15 s or more (ARCHITECTURE's offline threshold) or `status: 'offline'` red. **Clock** = `now` when live, but the newest event's `ts` in demo/replay, otherwise a finished replay turns everything red.
   - **agents**: running/fixing tasks whose newest `state.agentLog[key]` entry is older than `stallAfterMs` (default 90 s) are amber, past 2× red; any `stall.*` code is at least amber.
   - **retries**: `stall.retry`/`stall.redispatch`/`perch.loss` codes plus tasks with `attempts > 1`. 0 green, 1–3 amber, more (or `stall.failed`) red.
   - **rate-limits**: `rate-limit.backoff`/`parallelism.reduced` in the last 5 min. Any → amber, 5 or more → red.
   - **budget**: `budget.stop` red, `budget.warn` amber. Else with `budgetUsd`, spend/cap under 70% green, under 90% amber, else red. Else idle "no cap set".
   - **errors**: any `log` at level `error` in the last 5 min → red, showing the newest message truncated to 120 chars.
5. Derive from `state.events` only (capped at `EVENT_CAP` = 5,000, global `runId: '*'` logs included), memoised on `state.events` identity plus clock bucket. Never scan more than once per render.
6. **`HealthPanel` UI**:
   - A header with the overall light and "All systems go" / "2 warnings · 1 problem".
   - One row per subsystem: dot + lucide icon (`CheckCircle2`/`AlertTriangle`/`XCircle`) + text, so colour is never the only signal. Heartbeat items are expandable.
   - `aria-live="polite"` announces only transitions **into** red.
   - `compact` renders a single row of labelled lights for 720p.
7. **Clock**: `useTick(1000)` runs only while `connection === 'live'`; the `now` prop overrides it in tests.
8. **Playground scenarios** in `fixtures.ts`, built on the recorded run plus synthetic events: healthy, 429 storm, perch lost, budget warning, stalled agent, stream offline.
9. **Tests (≥ 40)**: every rule's thresholds and boundaries, code parsing (field / prefix / heuristic / none), the demo clock, caps, memo, the aria-live transition, and the compact mode.""",
        "oos": """- Cost breakdown and budget gauge (Epic 116), toasts (Epic 121), event console (Epic 117): don't import them.
- Adding SSE attempt counts to the store is `apps/web/src/data` (Wave 3b, Epic 204): FIX REQUEST, and keep the `sse` prop optional.
- No new policy codes or fields in core or engine (Epics 100/202). If a code you need doesn't exist, write it up as a CONTRACT REQUEST.""",
        "dod": [
            "`cd apps/web && bun test src/features/health` → 0 fail, ≥ 40 tests.",
            "`bunx tsc --noEmit -p apps/web` clean and `bunx biome check apps/web/src/features/health` clean.",
            "Playground `/src/features/health/playground.html`: paste the overall light + row lights for each of the 6 scenarios in the handback, and commit one screenshot ≤ 300 KB of the '429 storm' scenario.",
        ],
        "carryover": "",
    },
    # ── 130 ─────────────────────────────────────────────────────────────────────────────────────
    {
        "nn": "130",
        "slug": "web-sky-r3",
        "title": "Web: Sky round 3 (100 tasks, richer roosts, murmuration burst)",
        "lane": "`apps/web/src/features/sky/**`",
        "wave": "3",
        "convention": None,
        "budget": "90–150 min",
        "goal": """The Sky is the thing judges remember, and Wave 3's demos are bigger: the "big day" goals have 12–60 tasks and the story is "100 agents built this". The Sky currently caps at `MAX_TASKS = 30` (`sim.ts:43`) and silently drops every task past the 30th (`order.slice(0, MAX_TASKS)`). This round makes the Sky honest at 100 tasks while keeping 60 fps on an M2 Air, gives the roosts more to say (latency, model, away state), and turns the end of a run into a proper murmuration burst. It also lands the test hooks Epic 71 asked for, so the e2e suite can finally snapshot the canvas.""",
        "deliverables": """1. **Carryover** (below): verify and record that `paused` is done, add `data-testid="sky-tooltip"` on the hover card, and add a freeze hook. Freeze when `window.__STARLING_SKY_FREEZE__ === true` (checked each frame) or when the root carries `data-freeze="true"`: stop advancing the sim but keep drawing the current frame, without enabling reduced motion. Expose `data-paused="true|false"` on the `sky-view` root.
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
9. **Tests**: ≥ 25 new across sim/render/SkyView/polish; all existing sky tests still pass unchanged (except the perf test you replace).""",
        "extra_locked": """- **e2e depends on the Sky geometry.** `apps/web/e2e/support.ts` (now Epic 140's lane) imports `makeWire`/`wireSlotX` from `features/sky/layout` and hovers merged birds on their wire slots, and the suite reads `data-testid="sky-view"`. Keep those signatures and the wire/perch geometry for ≤ 30 tasks unchanged. The new `sky-tooltip` testid and freeze hook are additive (Epic 140 feature-detects them).
- The shell already passes `paused={view !== 'sky'}` (`Layout.tsx`, Epic 112's lane); don't touch it.
- The e2e visual baselines mask the canvas, so they should survive. If anything else visible changes, don't re-record them (Epic 140's lane); note it for C3.""",
        "oos": """- `app/Layout.tsx`, the shell and registry (Epic 112), stage page (127), topology view (128): don't edit them.
- `SkyViewProps.paused` in `packages/core/src/handshake.ts` is Wave 3b (Epic 202).
- No data-layer changes (`apps/web/src/data` is read-only).""",
        "dod": [
            "`cd apps/web && bun test src/features/sky` → 0 fail, ≥ 25 new tests (paste before/after counts).",
            "`bunx tsc --noEmit -p apps/web` clean and `bunx biome check apps/web/src/features/sky` clean.",
            "Paste measured fps from `/src/features/sky/preview.html?stress=1` and `?stress=100` (Chromium; a throwaway Playwright script outside the repo through `heavy.sh` is fine) and commit 2 PNGs ≤ 300 KB to `features/sky/__screens__/`: 100-task mid-run and the burst.",
        ],
        "carryover": """- **Epic 41 #3 / Epic 47 #2 (`paused`)**: already done. `SkyView` honours `paused` (`SkyView.test.tsx` "the paused prop stops the rAF loop…") and `Layout.tsx` passes it via `skyExtras`. Verify and list as done.
- **Epic 47 #1** (`SkyViewProps.paused` in core's handshake): decline. That's Wave 3b (Epic 202).
- **Epic 71 #1**: `data-testid="sky-tooltip"` on the hover card and a freeze hook that stops the sim without reduced motion (deliverable 1).
- **Epic 61 note** (pre-existing flake): `sim.test.ts`'s 250 ms boids budget fails under machine load. Make it deterministic (deliverable 4).""",
    },
    # ── 131 ─────────────────────────────────────────────────────────────────────────────────────
    {
        "nn": "131",
        "slug": "web-dag-r2",
        "title": "Web: DAG round 2 (60-task plans, lane collapse, re-plan diff)",
        "lane": "`apps/web/src/features/dag/**`",
        "wave": "3",
        "convention": None,
        "budget": "90–150 min",
        "goal": """The flight plan reads beautifully at 7 tasks; Wave 3's goals produce 30–60. At that size the Dagre graph becomes a wall of tiny cards. Round 2 keeps big plans readable. Collapse tasks into one node per lane, auto-enable the minimap, and switch to compact cards when zoomed out. It also makes the plan tell a story: the critical path visibly flows, and when the planner re-plans mid-run (Epic 107 adds plan diffing in parallel) the changed tasks light up. Great looks like this: a 60-task plan fits a 1280×720 centre region with every lane name readable, and expanding one lane takes a single click.""",
        "deliverables": """1. **Big fixture**: `dag/fixtures-big.ts`: `bigPlan(n = 60, seed = 1): { plan: Plan; tasks: Record<string, TaskRun> }`. It's deterministic, uses about 8 lanes with layered dependencies and realistic `owns` globs, and mixes statuses. It's used by tests and the Playground, never by production code paths.
2. **Lane grouping (pure)**: `laneKeyOf(task: TaskSpec): string` is the first `owns` glob's directory prefix without the trailing `/**` or `*` (`src/features/export/**` → `src/features/export`), or `(no lane)`. `groupByLane(plan: Plan, tasks: Record<string, TaskRun>): LaneGroup[]` with `LaneGroup = { id: string; label: string; keys: string[]; counts: Record<TaskStatus, number>; critical: boolean }`, plus `aggregateEdges(plan, groups, expanded: ReadonlySet<string>)` that collapses edges between groups with a count label.
3. **Collapsed rendering**:
   - Plans with more than `COLLAPSE_AFTER = 24` tasks start collapsed: one group node per lane, showing the label, "12 tasks", and a mini status bar.
   - Click or Enter expands a group in place (re-layout with the expanded set; memoise the layout by `plan.id` + sorted expanded ids).
   - A toolbar toggle "Collapse by lane" uses `aria-pressed`.
   - The group containing `selectedTask` auto-expands.
   - Arrow-key navigation (Epic 25) works across group nodes.
4. **Minimap and zoom**:
   - The minimap toggle exists (`DagView.tsx:59`); turn it on automatically above 24 tasks, with nodes coloured by status and a labelled control.
   - Below zoom 0.6 cards render a compact variant (key + status dot). Read zoom with a narrow React Flow store selector so pan/zoom doesn't re-render every card.
   - `fitView` minimum zoom is 0.35.
5. **Critical path animation**: use the existing `criticalPath(plan)` / `criticalEdges`. Critical edges get a moving dash (`stroke-dashoffset` keyframes) and critical nodes a soft glow, only while the run has live tasks. Under `reducedMotion` (the existing `DagViewExtras`) the highlight is static.
6. **Re-plan diff**:
   - Pure `diffPlanTasks(prev: Plan, next: Plan): { added: string[]; removed: string[]; changed: string[] }`, where changed means a different title, `dependsOn`, `owns` or `estimateMin`. Write it locally: Epic 107 is adding `diffPlans` to the planner package in parallel, so don't import it.
   - When `plan.id` changes for the same `plan.goalId`, added tasks glow green and changed ones amber for 6 s. Removed tasks render as fading ghost nodes for 6 s.
   - A legend chip reads "re-planned: +2 −1 ~3". Under reduced motion it's badges only, no fades.
   - Keep the previous plan in a ref keyed by `goalId`.
7. **Performance**: node/edge arrays are memoised, and the layout runs once per (plan, expanded set). Test this with an injected or spied layout function and a call count.
8. **Playground**: a plan-size switch (7 recorded / 60 synthetic), a "re-plan" button (mutates the plan into a new id with +2/−1/~3), and the collapse toggle.
9. **Tests (≥ 30 new)**: `laneKeyOf` edge cases, grouping, aggregated edges, collapse threshold, expand/selection behaviour, `diffPlanTasks`, ghost timing with fake timers, the layout-call count, and the reduced-motion paths.""",
        "extra_locked": LEGIBILITY + "\n" + EXTRAS + """
- e2e reads `data-testid="dag-canvas"` and `getByRole('region', { name: 'Flight plan region' })` (shell). Keep `dag-canvas`, and keep the recorded 7-task plan expanded by default (it's under the threshold).""",
        "oos": """- Planner `diffPlans` (Epic 107), lanes treemap (Epic 115), timeline (Epic 114): no imports from them.
- Shell layout, view switching and `Layout.tsx` (Epic 112).
- No core contract changes (Wave 3b).""",
        "dod": [
            "`cd apps/web && bun test src/features/dag src/features/metrics/legibility.test.ts` → 0 fail, ≥ 30 new tests.",
            "`bunx tsc --noEmit -p apps/web` clean and `bunx biome check apps/web/src/features/dag` clean.",
            "Playground `/src/features/dag/playground.html`: commit 2 PNGs ≤ 300 KB (60 tasks collapsed at 1280×720; re-plan highlight) to `features/dag/__screens__/` and paste the number of rendered nodes collapsed vs expanded.",
        ],
        "carryover": """- No Wave 2 FIX REQUEST targets `features/dag`. Epic 55 already shipped the critical path, follow mode and status flash (`critical-path.ts`, `follow.ts`, `use-status-flash.ts`): build on them, don't redo them. Write "none" under **Carryover done**.""",
    },
    # ── 132 ─────────────────────────────────────────────────────────────────────────────────────
    {
        "nn": "132",
        "slug": "web-agents-r2",
        "title": "Web: agent drawer round 2 (split diff, verdict explanations, fix prompt, search)",
        "lane": "`apps/web/src/features/agents/**`",
        "wave": "3",
        "convention": None,
        "budget": "90–150 min",
        "goal": """The agent drawer is where a judge asks "but what did the agent actually do?". Round 2 answers in seconds:
- a side-by-side diff for real reading;
- a plain-English "why" for every audit verdict;
- the full fix-attempt history (attempt 1 ✗ → 2 ✗ → 3 ✓, with what changed between them);
- a search over a 500-event log;
- a "copy fix prompt" button that turns a failed verdict into a ready-to-paste prompt for any coding agent, which demonstrates the open-weight loop in one click.

Everything stays props-only and read-only.""",
        "deliverables": """1. **Split diff**:
   - Pure `toSideBySide(lines: PatchLineView[]): SideBySideRow[]` with `SideBySideRow = { kind: 'context' | 'change' | 'add' | 'del' | 'hunk'; left?: PatchLineView; right?: PatchLineView }`. It pairs del/add runs inside a hunk and keeps the existing word highlights (`annotateWordDiffs`).
   - The drawer is only 22 rem wide in the shell, so split mode lives in an **"Open full diff"** dialog: portalled to `document.body`, about 92vw, focus trapped, Esc closes it and returns focus to the button.
   - A Unified/Split toggle (`aria-pressed`) is remembered in localStorage `starling.diffMode` (try/catch, typed guard).
2. **Verdict explanations**: pure `explainVerdict(v: AuditVerdict): { headline: string; reasons: string[] }`.
   - Map the auditor's real check names (read `packages/auditor/src/`: at least `tests`, `lane`, `lint`, `definition-of-done`, `diff`) to plain sentences that include the check `detail` (truncated), list lane violations, and summarise `dod` items when present.
   - Feature-detect an additive `explanation?: string` on the verdict (Epic 103 is adding a dashboard-ready explanation in parallel) and prefer it. The Audit tab shows the headline plus a "Why?" disclosure.
3. **Copy fix prompt**: pure `buildFixPrompt(input: { task?: TaskSpec; verdict: AuditVerdict; diff?: DiffSummary }): string`.
   - Markdown containing the task key/title, deliverables, failing checks with details (each truncated to 400 chars), lane violations, `fixInstructions`, `owns`/`reads` and an explicit "Only touch files matching: …" line.
   - Deterministic output; snapshot-test it.
   - The button shows only on failing verdicts and uses `navigator.clipboard.writeText` with a textarea + `execCommand('copy')` fallback, a "Copied ✓" state and `aria-live`.
   - Write it locally: don't import `packages/prompts` (Epic 109 is changing it).
4. **Log search** (Activity tab):
   - Pure `searchTimeline(entries: TimelineEntry[], query: string): number[]`, case-insensitive over prose, tool names, args and file paths.
   - An input with a "3 of 12" counter; Enter/Shift+Enter jump next/prev and scroll to the match through the existing windowing (`windowing.ts`, active above 80 rows); `<mark>` highlights. Esc in the input clears it (the shell's Esc handler already skips inputs).
5. **Fix-attempt history** (Audit tab):
   - A stepper "Attempt 1 ✗ → Attempt 2 ✗ → Attempt 3 ✓" from `sortVerdicts(verdicts)`, where each step selects that verdict.
   - Pure `attemptDeltas(verdicts): { attempt: number; fixed: string[]; broke: string[] }[]` (checks that flipped). The Activity tab shows attempt separators where a `session.started` follows a failing verdict.
6. **Accessibility and legibility**: every new control is keyboard reachable with a name, the tab ARIA from Epic 25 is unchanged, and the dialog is `role="dialog" aria-modal="true"` with a labelled title.
7. **Playground**: add a 3-attempt fixture (fail lane → fail tests → pass), a 300-line patch, and a 500-event log to `test-fixtures.ts`/`Playground.tsx`.
8. **Tests (≥ 35 new)**: the pure helpers (pairing edge cases: pure adds, pure deletes, uneven runs, hunks), the explanation mapping incl. `explanation` precedence, prompt snapshot + truncation, search + windowed scroll, deltas, clipboard fallback, dialog focus trap/return, and localStorage that throws.""",
        "extra_locked": LEGIBILITY + "\n" + EXTRAS + """
- e2e and the shell rely on `data-testid="agent-drawer"`, `data-testid="drawer-status"`, the button named "Close agent drawer", and the drawer root being an `<aside>` (Layout pins it with `[&>aside]` selectors). Keep all four.""",
        "oos": """- Refreshing a cached diff after a later fix attempt (Epic 41 deferred): that's shell/data (Epics 112/204).
- Auditor verdict content (Epic 103) and prompt templates (Epic 109).
- Drawer width and placement in the layout (Epic 112).
- No mutations: the drawer never retries, aborts or edits.""",
        "dod": [
            "`cd apps/web && bun test src/features/agents src/features/metrics/legibility.test.ts` → 0 fail, ≥ 35 new tests.",
            "`bunx tsc --noEmit -p apps/web` clean and `bunx biome check apps/web/src/features/agents` clean.",
            "Paste `buildFixPrompt` output for the Playground's failing attempt in the handback, and commit 1 PNG ≤ 300 KB of the split-diff dialog to `features/agents/__screens__/`.",
        ],
        "carryover": "",
    },
    # ── 133 ─────────────────────────────────────────────────────────────────────────────────────
    {
        "nn": "133",
        "slug": "web-queue-r2",
        "title": "Web: merge queue round 2 (720p board, column widths, batch/bisect)",
        "lane": "`apps/web/src/features/queue/**`",
        "wave": "3",
        "convention": None,
        "budget": "90–150 min",
        "goal": """"7 of 7 on the wire" is the run's headline, but on a 1280×720 projector the queue board scrolls sideways and shows exactly one wire card (Epic 71), while five mostly empty columns take five sixths of the width (Epic 55). Round 2 makes the board show what matters at any size. Occupied columns grow, and below a width threshold a compact, wire-first board shows every landed task at once. It also gets ready for Epic 104's batched merges: a batch is bracketed on the wire, and when a batch breaks the suite the bisect visibly halves its way to the culprit.""",
        "deliverables": """1. **Carryover** (below): verify and record that `selectedTask` is done, then do column widths and the compact board.
2. **Column weights (pure)**: `columnWeights(board: QueueBoard): Record<QueueColumnId, { grow: number; collapsed: boolean }>`.
   - Empty columns collapse to a slim header (about 3.5 rem: icon + count, with a vertical or abbreviated label).
   - Occupied columns grow ∝ `sqrt(cards)` (min 7 rem), and `wire` gets at least 1.5× the largest other weight once it has cards.
   - Apply it via inline `flexGrow`/`flexBasis` on the column `<section>` (today `flex-1 min-w-[7rem]`, `MergeQueue.tsx:187`). Width transitions are 0 ms under reduced motion.
3. **Compact board**:
   - Pure `boardMode(widthPx: number, compact: 'auto' | 'always' | 'never'): 'full' | 'compact'` with `COMPACT_BELOW_PX = 840`, plus `useBoardWidth(ref)` (ResizeObserver; fall back to `window.innerWidth` when RO is missing, e.g. happy-dom).
   - Compact layout: "On the wire" is a wrapping chip grid (`#3 dark-mode`), with all 7 chips visible in the shell's 12 rem strip at 1280×720. The other stages collapse into one summary row ("2 flying · 1 auditing · 1 landing · 1 grounded"), where each segment is a button that expands that stage's list in place.
   - Additive prop `compact?: 'auto' | 'always' | 'never'` in `queue/types.ts` (default `'auto'`).
4. **Batch/bisect visualisation** (Epic 104 adds batched merges + regression bisect in parallel; don't wait for it):
   - Code against a local, feature-detected shape: `type MergeResultExtras = { batchId?: string; batchSize?: number; bisect?: { step: number; steps: number; suspects: string[]; culprit?: string } }` read structurally from each `MergeResult`.
   - Pure `batchGroups(wire: WireEntry[], merges: MergeResult[]): BatchGroup[]` and `bisectView(merges: MergeResult[]): BisectView | undefined`.
   - Render: consecutive wire cards of one batch get a bracket with "batch ×4". While a bisect is in progress, a strip above the wire shows the suspects as chips and "step 2 of 3 · 2 suspects", and highlights the culprit, which lands in Grounded with a "regression culprit" reason.
   - Put the exact shape in the handback as a CONTRACT note to Epics 104/202 so the producer matches it, or C3 maps it.
5. **Grounded reasons**: a reason chip (conflict / tests failed / regression), keeping the `title` + sr-only detail (Epic 26).
6. **Keep working**: virtualisation (`window.ts`, more than 30 cards) in both modes, `selectedTask` highlight + `aria-current` in chips, and the slide-in animation (off under reduced motion).
7. **Playground**: a width slider (720p strip / 1080p strip / phone), and a synthetic 12-task scenario with a 4-task batch and a 3-step bisect.
8. **Tests (≥ 30 new)**: weights (all empty, one column, wire-heavy), `boardMode` thresholds, compact rendering in happy-dom with `compact="always"` (every wire task visible as a chip, summary counts), batch grouping and bisect view (missing fields → no UI), `selectedTask` in compact mode.""",
        "extra_locked": LEGIBILITY + "\n" + EXTRAS + """
- **e2e selector contract** (Epic 71 suite): `data-testid="queue-landed"` with text `7 of 7`, `[data-starling-queue] [data-column="wire"]` matching exactly one element per landed task, and `data-reduced-motion` on the section. All three must hold in **both** modes (compact wire chips keep `data-column="wire"`; don't render a task twice with that attribute).""",
        "oos": """- The strip's height and the shell grid (`Layout.tsx` `h-48` footer) belong to Epic 112. Mention the 720p strip-height part of Epic 71 #3 there as a FIX REQUEST if you need more room.
- The merger itself (Epic 104); core `MergeResult`/`TaskRun`/`MergeQueueProps` fields (Wave 3b, Epic 202).""",
        "dod": [
            "`cd apps/web && bun test src/features/queue src/features/metrics/legibility.test.ts` → 0 fail, ≥ 30 new tests.",
            "`bunx tsc --noEmit -p apps/web` clean and `bunx biome check apps/web/src/features/queue` clean.",
            "Run the existing e2e queue checks through the gate: `bash .orchestrator/bin/heavy.sh bun run --cwd apps/web e2e -- replay.pw.ts shell.pw.ts` → pass, and commit 2 PNGs ≤ 300 KB (1280×720 compact board with 7 wire chips; batch/bisect scenario) to `features/queue/__screens__/`.",
        ],
        "carryover": """- **Epic 41 #4** (honour `selectedTask`): already done by Epic 55 (`aria-current`, column scroll in `MergeQueue.tsx`). Verify and list as done.
- **Epic 55 #1 / #2** (`TaskRun.nodeName`, `MergeQueueProps.selectedTask` in core): decline. Core is Wave 3b (Epic 202), and both are already read structurally here.
- **Epic 55 #3** (column widths: six equal `flex-1` columns, five empty ones take five sixths): deliverable 2.
- **Epic 71 #3** (at 1280×720 the board scrolls horizontally and shows only one "On the wire" card): deliverable 3. The component side is yours; the strip height is Epic 112's.""",
    },
    # ── 134 ─────────────────────────────────────────────────────────────────────────────────────
    {
        "nn": "134",
        "slug": "web-metrics-r2",
        "title": "Web: metrics round 2 (throughput, parallelism, time saved, tokens/s)",
        "lane": "`apps/web/src/features/metrics/**`",
        "wave": "3",
        "convention": None,
        "budget": "60–120 min",
        "goal": """The meter answers "is it cheap?". Round 2 makes it also answer "is it fast?":
- a throughput sparkline (merges over time);
- parallelism over time with a peak marker;
- a "4.1× faster than one agent, saved 18 min" counter computed honestly from task timings;
- live tokens per second for API vs local.

Every chart also gets a real text description for screen readers. All of it has to fit the shell's 12 rem strip at 1280×720 without reflowing digits, so a judge can read it from the back of the room.""",
        "deliverables": """1. **Throughput**: pure `throughputSeries(history: MetricsSample[], bucketMs = 30_000): SparklinePoint[]` (merges per bucket from `tasksMerged` deltas; a negative delta means a new run, so reset). Render it with the existing `sparklineGeometry` + `SparklineChart`.
2. **Parallelism**: pure `parallelismStats(history): { peak: number; peakAt: number; mean: number }` (time-weighted mean of `agentsActive`). The existing agents sparkline gets a peak dot + "peak 5" label and a step-line option (`SparklineOptions` additive).
3. **Time saved vs serial**:
   - Additive extra `tasks?: Record<string, TaskRun>` on `MetricsExtras` (`types.ts`).
   - Pure `serialEstimate(tasks, wallMs, now): { serialMs: number; wallMs: number; savedMs: number; speedup: number } | undefined`, where serial = Σ((finishedAt ?? now) − startedAt) over tasks that started. It returns `undefined` with fewer than 2 started tasks or `wallMs <= 0`.
   - The counter reads "4.1× · saved 18m", with a tooltip spelling out the method and its limits (parallel time vs summed agent time; it isn't a benchmark).
   - C3 passes `tasks={activeRunOf(state)?.tasks}`.
4. **Tokens/s**: pure `tokenRate(history, windowMs = 60_000): { apiPerSec: number; localPerSec: number }` from `apiUsage`/`localUsage` (input + output) deltas over the window. It's robust to resets and returns 0 with fewer than 2 samples or a zero time span. Display it with `formatRate`/`formatTokens` and tabular digits.
5. **Accessible charts**: every SVG gets `role="img"` + `<title>` + `<desc>` from pure `describeSeries(label: string, points: SparklinePoint[], format: (v: number) => string): string` ("Agents active: rose from 0 to a peak of 5 at 2m 10s, now 0"). A "Show data" toggle reveals a small `<table>` with a caption (keyboard accessible). Count-ups stay snapped on replay and under reduced motion (Epic 55 behaviour).
6. **Fit the strip**: `useElementSize(ref)` (ResizeObserver with a graceful fallback). Below 200 px tall, `dense` mode hides the throughput sparkline first, then the data toggle; nothing reflows as values change (fixed `min-w` on figures).
7. **Exports**: add the new pure helpers to `metrics/index.ts` (additive). Keep `MetricsPanel`'s existing testids.
8. **Tests (≥ 30 new)**: the recorded fixture through `replayMetrics` (`replay.ts`) for peak/mean/throughput/tokens per second, plus synthetic histories (empty, one sample, reset mid-run, 2,000 samples = `METRICS_CAP`), `serialEstimate` edge cases, `describeSeries` strings, dense mode, and the data table.""",
        "extra_locked": """- **You own `metrics/legibility.test.ts`** (Epic 55), which guards dag/agents/queue/metrics/flock. Keep it green and don't loosen it; other Wave 3 epics rely on it.
- e2e reads `metrics-panel`, `metrics-merged`, `metrics-failed`, `metrics-elapsed`, `cost-meter`, `cost-api`, `cost-local`, `cost-saved` testids. Keep them and their text formats.
- `usePrefersReducedMotion` and `MOTION_CSS` are imported by the shell and other features: signatures unchanged.
""" + EXTRAS,
        "oos": """- Cost-by-role breakdown and frontier-price comparison (Epic 116), run report (113), timeline parallelism curve (114): don't import them, and don't build their features here.
- Pricing tables in core and the data layer (Wave 3b).""",
        "dod": [
            "`cd apps/web && bun test src/features/metrics` → 0 fail, ≥ 30 new tests.",
            "`bunx tsc --noEmit -p apps/web` clean and `bunx biome check apps/web/src/features/metrics` clean.",
            "Paste the values the recorded run produces (peak agents, mean, speedup, saved, tokens/s at the end) and commit 1 PNG ≤ 300 KB of the panel at a 1280×720 strip size to `features/metrics/__screens__/`.",
        ],
        "carryover": "",
    },
    # ── 135 ─────────────────────────────────────────────────────────────────────────────────────
    {
        "nn": "135",
        "slug": "web-flock-r3",
        "title": "Web: flock panel round 3 (join polish, perch drill-down, drain/remove, offline)",
        "lane": "`apps/web/src/features/flock/**`",
        "wave": "3",
        "convention": None,
        "budget": "90–150 min",
        "goal": """Inviting a second laptop on stage is the demo's riskiest 20 seconds. Round 3 makes the join card impossible to fumble:
- copy buttons for every piece;
- a big scannable QR;
- an expiry countdown (when the hub provides one);
- a visible "MacBook Air joined" moment.

It also gives the operator real control: drill into one perch (hardware, models, latency, its tasks and recent events), drain it or remove it before closing the lid, and see clearly when a perch has gone away and where its tasks went. The panel only emits callbacks; the server and perch sides are built in parallel (Epics 102/110) and wired at C3.""",
        "deliverables": """1. **Join polish** (`JoinCard.tsx`, `QrCode.tsx`, `CopyButton.tsx`, `use-copy.ts`):
   - Separate copy buttons for the command, the code and the hub URL, each with "Copied ✓" and an `aria-live` confirmation.
   - Clicking the QR enlarges it in a dialog (portal, Esc closes, focus returns).
   - Countdown: feature-detect an additive `join.expiresAt?: number` (epoch ms; not in core yet) → "expires in 4:32"; expired → greyed with "ask the hub for a new code"; absent → no countdown.
2. **Join moment**: while only the hub is online, a calm "Waiting for a perch…" pulse (static under reduced motion). When a new node id appears (reuse `use-presence.ts`/`use-entered.ts`), that roost shows "MacBook Air joined the flock" for 5 s.
3. **Per-perch drill-down**: Enter or click on a `RoostCard` opens `PerchDetail` (inline expansion in card mode, the existing portalled "All roosts" sheet in compact mode). It shows:
   - hardware (`formatHardwareParts`), models, sessions meter, latency, last seen;
   - tasks on that node grouped by status (chips → `onSelectTask`);
   - recent node events (`node.joined/left/stats` and `task.migrated` from/to it), which needs the additive extra `events?: readonly StarlingEvent[]` (C3 passes `state.events`). Without it the section hides.
4. **Drain/remove callbacks**: additive `onDrainNode?(nodeId: string): void | Promise<void>` and `onRemoveNode?(nodeId: string): void | Promise<void>` in `FlockPanelExtras`.
   - Buttons render only when the callback exists, and never for the hub.
   - Remove needs an inline confirm ("Remove MacBook Air? Its running tasks move to other roosts.").
   - While pending: a spinner and disabled state. On rejection: an inline error.
   - "Draining" badge: from local pending state, or a feature-detected `draining?: boolean` on the node, until a `node.left` arrives.
5. **Offline state**:
   - Offline roosts are dimmed and sorted last (`sortRoosts`), with "away 12s" and the `node.left` reason when events are given.
   - Tasks that migrated away show "moved → MacBook Pro".
   - In the compact rail an offline node gets a red ring + sr-only "offline".
   - The compact rail's bare task-count badge (Epic 55 deferred) gets the accessible name "5 tasks".
6. **Playground** scenarios: join → busy → drain → remove → rejoin, plus an expired code. Buttons drive local state.
7. **Tests (≥ 30 new)**: countdown with fake timers (absent, ticking, expired), copy fallbacks, QR dialog focus, drill-down content with/without `events`, callbacks absent/present/rejecting, hub never removable, offline sorting + migration hints, compact accessible names.""",
        "extra_locked": LEGIBILITY + "\n" + EXTRAS + """
- **The shell styles your DOM.** `Layout.tsx` restyles the panel through `[data-testid='compact-flock']`, `[data-testid='roost-card'] h3` and `section>div.grid`, and e2e reads `flock-panel`, `flock-summary`, `roost-card` and `data-reduced-motion` on roost cards. Keep those hooks and that structure.""",
        "oos": """- Perch drain and the server endpoints (Epics 102/110). The topology view (Epic 128) and Sky roosts (Epic 130).
- `JoinInfo.expiresAt` or a `draining` node status in core: Wave 3b CONTRACT REQUESTS, not edits.
- Shell wiring of the callbacks (C3).""",
        "dod": [
            "`cd apps/web && bun test src/features/flock src/features/metrics/legibility.test.ts` → 0 fail, ≥ 30 new tests.",
            "`bunx tsc --noEmit -p apps/web` clean and `bunx biome check apps/web/src/features/flock` clean.",
            "Commit 2 PNGs ≤ 300 KB (join card with countdown; perch drill-down with drain/remove) from the Playground (`?playground=flock` or the feature's own page) to `features/flock/__screens__/`.",
        ],
        "carryover": "",
    },
    # ── 136 ─────────────────────────────────────────────────────────────────────────────────────
    {
        "nn": "136",
        "slug": "web-launch-r2",
        "title": "Web: launch form round 2 (templates, preview step, validation, recent goals)",
        "lane": "`apps/web/src/features/launch/**`",
        "wave": "3",
        "convention": None,
        "budget": "90–150 min",
        "goal": """The launch panel (Epic 53) is finished but **not mounted anywhere**: the shell never wired it. Round 2 makes it ship-ready. It gets goal templates for every demo target (sky-todo and py-ledger today, the birdwatch API when it lands), an explicit Goal → Preview → Launch flow that degrades gracefully when the hub can't preview, strict validation of anything that goes into a request, and a recent-goals list. It also ships a self-contained container + manifest so C3 can mount it with a single line. Great looks like this: a judge picks "py-ledger · bug-hunt", sees the plan and its lanes, and launches.""",
        "deliverables": """1. **Carryover**: fix the budget copy (below).
2. **Templates per target** (`goals.ts`):
   - `GOAL_TEMPLATES: Readonly<Record<string, readonly LaunchGoal[]>>` keyed by repo path: `examples/sky-todo` (the existing `DEMO_GOALS` + `will-fail-audit`) and `examples/py-ledger` (`quick-wins`, `bug-hunt`, `feature-day`). Copy the texts verbatim from `examples/*/demo-goals/<name>.md`.
   - `goalsForRepo(repoPath: string): readonly LaunchGoal[]` matches by trailing path/basename and falls back to sky-todo. The chips follow the repo field.
   - Keep `DEMO_GOALS`/`DEMO_REPO_PATH` exports unchanged (L33).
   - A drift test reads the `.md` files with `node:fs` and asserts the texts match exactly.
   - Epic 168 (`examples/birdwatch-api`) is being written in parallel: don't add it, and list the one-line addition in the handback for C3.
3. **Three-step flow** (Goal → Preview → Launch) with a labelled stepper (`aria-current="step"`), built on the existing `PlanPreview.tsx`/`ConfirmLaunch.tsx`.
   - Back keeps the form state.
   - When `onPreview` is absent, or rejects with an error whose message or code contains `PREVIEW_UNAVAILABLE`/501, show "This hub can't preview yet: Starling will plan when you launch" and allow skipping.
   - Overlap report + estimates use the existing `overlapReport`/`estimatePlanCostUsd`/`estimateMinutes`.
4. **Validation** (`form.ts`, additive):
   - `repoPathError`: non-empty, ≤ 300 chars, no `..` segments, no shell metacharacters ``; | & $ ` < >``, no newline.
   - Goal ≤ 4,000 chars.
   - Optional `capacity?: number` prop: warn (don't block) when `maxParallel` exceeds the flock's total sessions.
   - Budget `0` forces dry-run on, with an explanation.
   - On submit, focus moves to the first invalid field. Errors use the existing `aria-invalid`/`aria-describedby` pattern.
5. **Recent goals** (`recent-goals.ts`): the last 8 launched goals per repo in localStorage `starling.recentGoals` (schema guard, try/catch, dedupe by trimmed text, newest first, clear button), shown as a "Recent" chip row above the templates.
6. **Container + manifest** so C3 needs one line:
   - `launch/api.ts` (local tiny client; `apps/web/src/data` is off-limits): `postRun(input, opts)` → `POST /api/runs` (body: `goal`, `repoPath`, `dryRun`, `maxParallel`, `budgetUsd`) and `postPreview(input, opts)` → `POST /api/runs/preview` (501 → `PREVIEW_UNAVAILABLE`). Both accept `fetchImpl`, `headers` (for Epic 110's optional token) and `signal`.
   - `LaunchContainer(props: FeatureProps & { fetchImpl?: typeof fetch; headers?: Record<string, string> })` derives `runs = sortedRuns(state)`, `recentRepos` (unique `goal.repoPath`, newest first, plus `DEMO_REPO_PATH`), and `onOpenRun = onSelectRun`.
   - Export `feature = { id: 'launch', title: 'Launch a run', description: 'Pick a goal, preview the plan, launch the flock', kind: 'overlay', icon: 'Rocket', hotkey: undefined, Component: LaunchContainer } as const` from `index.ts`, with `FeatureProps` = """ + FEATURE_PROPS_TEXT + """ (the Wave 3 manifest shape Epic 112's registry accepts; declare it locally).
7. **Tests (≥ 30 new)**: template lookup + drift, every validation rule, the 3-step flow incl. a preview that's unavailable or rejected, recent goals with throwing storage, `api.ts` with a mocked `fetchImpl` (status codes, 501, network error), the container's derived props, and manifest shape.""",
        "extra_locked": EXTRAS,
        "oos": """- The server routes `POST /api/runs/preview` and budget plumbing (Epic 110), the data client (Wave 3b, Epic 204), shell mounting/routing and `?playground=launch` (Epic 112 + C3), storing the token in settings (Epic 118).
- Don't add `examples/birdwatch-api` goals (Epic 168 isn't merged).""",
        "dod": [
            "`cd apps/web && bun test src/features/launch` → 0 fail, ≥ 30 new tests.",
            "`bunx tsc --noEmit -p apps/web` clean and `bunx biome check apps/web/src/features/launch` clean.",
            "Playground `/src/features/launch/playground.html`: walk py-ledger · bug-hunt through Goal → Preview → Launch and commit 1 PNG ≤ 300 KB of the preview step to `features/launch/__screens__/`.",
        ],
        "carryover": """- **Epic 53 open question (budget copy)**: the hint says "USD cap · 0 = plan only" (`LaunchForm.tsx:237`). A per-run budget is advisory until the engine honours `budgetUsd` (Epic 100, in parallel). Reword it, e.g. "Spend cap (USD) · enforced once the hub supports per-run budgets · 0 = plan only (dry run)", and tie `0` to dry-run (deliverable 4).
- **Epic 53 #1–#5** (shell render, preview endpoint, budget plumbing, `?playground=launch`, initial repo): decline. They belong to Epic 112 (shell/routes), Epic 110 (server) and Wave 3b (data). Deliverable 6 makes the C3 wiring a single line.""",
    },
    # ── 137 ─────────────────────────────────────────────────────────────────────────────────────
    {
        "nn": "137",
        "slug": "web-about-r2",
        "title": "Web: about / built-by-the-flock round 2",
        "lane": "`apps/web/src/features/about/**`",
        "wave": "3",
        "convention": None,
        "budget": "60–120 min",
        "goal": """"One person, 100 agents" is the hackathon's best line, and the About page is where it's proven with numbers read from the repo itself. Today the page renders the v1 stats JSON (`tools/stats/types.ts`), has no Playground, and isn't routed (Epic 68 asked for `?page=about`). Round 2:
- reads the Wave 3 stats format Epic 154 is producing in parallel, with a graceful fallback;
- adds a visual of the 100-agent wave lifting off at once;
- ships a loader container + manifest so C3 mounts it with one line.

Great looks like this: the page loads `/stats.json`, falls back to labelled sample data when it can't, and the wave visual makes a judge say "wait, all at once?".""",
        "deliverables": """1. **Tolerant parser** (`about/parse.ts`): `parseSwarmStats(json: unknown): { ok: true; version: number; stats: SwarmStats; extras: WaveThreeExtras; warnings: string[] } | { ok: false; reason: string }`.
   - It accepts v1 exactly as today, and v2+ when the v1 core fields are present.
   - Unknown fields are ignored. A missing or invalid required field fails with a reason. A major version above `SUPPORTED_STATS_VERSION + 1` gives a warning.
2. **Wave 3 extras** (declared locally; Epic 154 writes them):
   - Shape: `WaveThreeExtras = { prsPerHour?: number; linesByLane?: { lane: string; added: number; removed: number }[]; concurrency?: { t: string; agents: number }[]; perWave?: Record<string, { epics: number; agents: number; prs: number; wallTimeMs?: number }> }`.
   - Every field is read with type guards; partial data renders partially.
   - Keep all field-name knowledge in `parse.ts`, so if 154's names differ, C3 changes one file. Put the expected shape in the handback as a coordination note for Epic 154.
3. **`AboutContainer`** (`FeatureProps & { url?: string; fetchImpl?: typeof fetch }`) loads `url ?? '/stats.json'` once (Epic 68: `bun tools/stats/collect.ts --out apps/web/public/stats.json`). It shows a loading skeleton (`EmptyState`), then the page. On fetch/parse failure or an unsupported version it falls back to `FIXTURE_STATS` with a visible "sample data · <reason>" ribbon. It needs no store access beyond props.
4. **Manifest**: `feature = { id: 'about', title: 'Built by the flock', description: 'How 100 agents built Starling', kind: 'page', icon: 'Bird', hotkey: undefined, Component: AboutContainer } as const`, with `FeatureProps` = """ + FEATURE_PROPS_TEXT + """ declared locally (Epic 112's registry shape). C3's line gives `?page=about`.
5. **100-agent wave visual** (`WaveSwarm.tsx`):
   - An SVG "concurrency river" of agents in parallel over time, from `extras.concurrency` or derived by pure `concurrencySeries(epics: EpicStats[]): { t: number; agents: number }[]` from `agentSession` start/end intervals.
   - One tiny bird per epic of the biggest wave rises along its session interval, and a "peak: 100 agents at 14:32" label marks the peak.
   - `role="img"` + `<desc>`; static under reduced motion.
6. **Wave cards**: the per-wave summary (epics, agents, PRs/hour, wall time) from `WaveStats` + `extras.perWave`; a top-10 "lines by lane" bar list when `linesByLane` exists. `swarmStory` mentions the biggest wave when it has 50 or more agents.
7. **Playground** (about has none yet): `Playground.tsx` + `playground.html` + `playground-main.tsx` with fixture switches for v1 (`FIXTURE_STATS`), synthetic v2 with 100 wave-3 epics (`fixtures-w3.ts` deterministic generator), broken JSON and a fetch failure.
8. **Tests (≥ 30 new)**: the parser (v1, v2, partial extras, wrong types, future version, garbage), `concurrencySeries` (overlaps, open sessions, empty), container states with a mocked fetch, the story, WaveSwarm's description and reduced motion, and manifest shape.""",
        "extra_locked": """- `about/types.ts` re-exports types from `tools/stats/types.ts`, which is Epic 154's lane and changes in parallel (additive by L33). Don't edit `tools/stats`, and don't rely on new fields existing in that type: declare them locally in `parse.ts`.
""" + EXTRAS,
        "oos": """- `tools/stats/**` (Epic 154), the landing site (Epic 179), the blog (Epic 180).
- `?page=about` routing and `apps/web/public/` (Epic 112 + C3). Generating `stats.json` is the collector's job.""",
        "dod": [
            "`cd apps/web && bun test src/features/about` → 0 fail, ≥ 30 new tests.",
            "`bunx tsc --noEmit -p apps/web` clean and `bunx biome check apps/web/src/features/about` clean.",
            "Playground `/src/features/about/playground.html` with the synthetic 100-agent fixture: commit 1 PNG ≤ 300 KB of the wave visual to `features/about/__screens__/`, and paste the fallback ribbon text for the broken-JSON case.",
        ],
        "carryover": """- **Epic 68 #1** (`?page=about` route + stats loader): the route belongs to Epic 112 + C3. Ship the loader container and manifest (deliverables 3–4) so it's one line, and list the exact line under **C3 wiring**.
- **Epic 68 #2–#4** (`site/data/stats.json`, `tools/*` workspace/typecheck): not this lane (Epics 179/154/C3). Decline with that reason.""",
    },
    # ── 138 ─────────────────────────────────────────────────────────────────────────────────────
    {
        "nn": "138",
        "slug": "web-gallery",
        "title": "Web: component gallery",
        "lane": "`apps/web/src/gallery/**`, `apps/web/gallery.html`",
        "wave": "3",
        "convention": None,
        "budget": "90–150 min",
        "goal": """About 25 web features and components will be changing at once in Wave 3, and nobody can open a dashboard in every state to check them. The gallery is one dev page that renders every shared component and every feature in each meaningful state, from the recorded fixture: empty, loading, error, live mid-run, demo and finished. Light and dark sit side by side. It doubles as a crash matrix: a test mounts every (entry × state × theme) in happy-dom, so a feature that throws on an empty run is caught before the stage. Great looks like this: open `/gallery.html`, see 9 components × states and 8 features × 6 states, in both themes, with zero red cells.""",
        "deliverables": """1. **Entry**: `apps/web/gallery.html` (copy `index.html`'s head; `<script type="module" src="/src/gallery/main.tsx">`). Vite's dev server serves it at `/gallery.html` with no config change. It's dev-only: adding it to the production build would mean editing `vite.config.ts` (Epic 112), so just mention it as an optional C3 line.
2. **States** (`gallery/states.ts`, pure): `type GalleryState = 'empty' | 'loading' | 'error' | 'live' | 'demo' | 'finished'` and `galleryState(kind): SkyState`.
   - empty = `createInitialState()`.
   - live = the recorded run (`demoEvents()`) applied up to the first index where ≥ 3 tasks are running. Compute it; don't hardcode an index.
   - finished = all events.
   - demo = live with `connection: 'demo'`.
   - loading and error are rendering modes (below), not states.
3. **Registry** (`gallery/entries.tsx`): `interface GalleryEntry { id: string; group: 'component' | 'feature'; title: string; states: readonly GalleryState[]; render(state: SkyState, ctx: { theme: Theme; reducedMotion: boolean }): ReactNode }` and `GALLERY_ENTRIES`, plus `registerGalleryEntry(entry)` so Wave 3 features can be added later (one line each; document it).
   - **Components** (`apps/web/src/components`): `Badge` (every tone), `StatusDot` (every `TaskStatus` × size), `Stat` (tones), `Panel`, `Tabs`, `Tooltip`, `Kbd`, `EmptyState`, `ErrorBoundary`, plus `RegionPlaceholder` from `app/`.
   - **Features**: `SkyView`, `DagView`, `AgentDrawer` (first plan task selected), `MergeQueue`, `MetricsPanel`, `FlockPanel` (card + compact), `LaunchPanel` (its exported fixtures: `PLAYGROUND_RUNS`, `PLAYGROUND_RECENT_REPOS`, `DEMO_GOALS`, a fake `onLaunch`), `AboutPage` (`FIXTURE_STATS`).
   - Feature props come from `data/selectors` (`skyProps`, `dagProps`, `drawerProps`, `queueProps`, `metricsProps`, `flockProps`) with no-op actions. Import only; edit nothing.
4. **Loading and error modes**: loading renders the `EmptyState` fallback the shell uses (`PlaygroundHost` pattern). Error wraps the entry in `ErrorBoundary` with a child that throws, showing the `RegionPlaceholder` fallback.
5. **Gallery UI** (`Gallery.tsx`, `main.tsx`):
   - A left nav (groups, a text filter) and a grid of entry × state cells.
   - **Light and dark side by side**: each cell renders twice inside `<div data-theme="light">` / `<div data-theme="dark">`. The tokens key off `[data-theme]` on any element (`index.css:37`).
   - Cells show the region at a 1280×720-scaled size (`transform: scale(0.5)`) with a 1:1 toggle, plus a reduced-motion toggle.
   - URL state: `?entry=dag&state=live&theme=both&scale=1` for deep links and screenshots.
   - Every cell sits in its own `ErrorBoundary`.
6. **Theme audit**: features that hard-code `slate-*`/`white/` colours don't flip in light mode. Record which ones, with a screenshot, as FIX REQUESTS per owning lane (sky 130, dag 131, agents 132, queue 133, metrics 134, flock 135, launch 136, about 137; components/app → 112).
7. **Crash-matrix test** (`gallery.test.tsx`): for every entry × declared state × theme, mount in happy-dom (pattern: `features/flock/test-dom.ts`) and assert it renders non-empty with no thrown error and no `console.error`. A crash is recorded as `test.todo('BUG <feature>: crashes in <state>', …)` with the real assertions, plus a FIX REQUEST (L36).
8. **More tests (≥ 25 total)**: `galleryState` invariants (live has ≥ 3 running tasks, finished is `finished`), registry/filter, URL parsing, and the theme wrapper.""",
        "extra_locked": """- Pure consumer: import components, features, `app/RegionPlaceholder`, `data/selectors`, `data/reducer` and `data/demo`, but edit none of them. Features change in parallel (Epics 130–137): use only exports and props that exist on `main` now. Their new optional props can be registered after C3.
- Don't import unmerged Wave 3 features (stage, topology, health, report, …). `registerGalleryEntry` is how they join later.""",
        "oos": """- Editing components, the shell or `vite.config.ts` (Epic 112), or any feature (its own lane).
- Playwright and visual baselines (Epic 140). The a11y audit (Epic 139).""",
        "dod": [
            "`cd apps/web && bun test src/gallery` → 0 fail (todos allowed), ≥ 25 tests, with the crash matrix covering every entry × state × theme (paste the matrix size).",
            "`bunx tsc --noEmit -p apps/web` clean and `bunx biome check apps/web/src/gallery apps/web/gallery.html` clean.",
            "`bun run --cwd apps/web dev` → `/gallery.html` loads with no console errors. Commit 2 PNGs ≤ 300 KB to `apps/web/src/gallery/__screens__/` (components page; DAG across states, light vs dark).",
        ],
        "carryover": "",
    },
    # ── 139 ─────────────────────────────────────────────────────────────────────────────────────
    {
        "nn": "139",
        "slug": "web-a11y-audit",
        "title": "Web: accessibility audit",
        "lane": "`apps/web/src/__a11y__/**`",
        "wave": "3",
        "convention": "qa",
        "budget": "90–150 min",
        "goal": """Judges notice when a dashboard can't be driven from the keyboard or reads as soup to a screen reader, and open-source contributors notice even more. Every web epic so far promised roles, labels, focus behaviour and reduced motion, but nobody checked them across the whole app. This epic builds a small, dependency-free checker that runs in happy-dom, audits the shell and every existing feature, and turns each promise into a regression test. Each violation becomes a `test.todo` + FIX REQUEST routed to the Wave 3 epic that owns that code. Great looks like this: 60+ passing checks guarding the app as 15 web epics merge, and a precise bug list per lane.""",
        "deliverables": """1. **`__a11y__/checker.ts`** (no axe, L34): `auditDom(root: Element, opts?): A11yIssue[]` with `A11yIssue = { rule: string; severity: 'error' | 'warn'; selector: string; message: string }`, plus `accessibleName(el: Element): string` (simplified accname: aria-labelledby → aria-label → native label/alt/text → title). Rules:
   - `button-name`, `link-name`, `form-label`;
   - `img-alt` (`<img>` alt; `<svg>` either `aria-hidden` or `role="img"` + name);
   - `aria-refs` (controls/labelledby/describedby ids resolve), `dup-id`;
   - `role-valid` (known ARIA roles; `tab` inside `tablist`; `tabpanel` labelled);
   - `tabindex-positive`, `aria-hidden-focusable` (no focusable inside `aria-hidden`/`inert`), `heading-order` (warn).
   - Self-tests: ≥ 15 good/bad snippets.
2. **Harness**: per-file happy-dom setup (copy `features/flock/test-dom.ts`), and `fixtureState(kind: 'empty' | 'mid' | 'end')` from `applyEvents(createInitialState(), demoEvents())` (`data/reducer`, `data/demo`; import only).
3. **Shell audit**: render `Layout` (`app/Layout.tsx`) with the end and empty states and run every rule. Verify the documented keyboard map with dispatched `KeyboardEvent`s on `document`: `1`/`2` switch view, `b`, `f`, `?` opens `KeyboardHelp`, Esc closes the help then the drawer. Also check the skip link targets `#region-sky` and inactive centre views are `inert` + `aria-hidden`.
4. **Feature audits**: sky, dag, agents (selected task, every tab), queue, metrics, flock (card + compact + "All roosts" sheet), launch (`LaunchPanel` with its exported fixtures) and about (`FIXTURE_STATS`), fed through `data/selectors`. One test per (feature × rule group) so failures are precise.
5. **Focus order**: `tabbables(root): HTMLElement[]` (DOM order, tabIndex rules, skipping hidden/inert). Assert the shell order: skip link → top bar → flock → centre view → strip. Check the documented focus moves: the flock sheet focuses its close button and returns focus on Esc (Epic 55); the drawer is a labelled non-modal dialog (Epic 25).
6. **Contrast tokens**:
   - Parse `apps/web/src/index.css` (and `src/lib/tokens.pcss` if tokens live there) for the custom properties under `:root` and `[data-theme="light"]`, and compute WCAG ratios for ink tokens on surface/panel tokens in both themes: ≥ 4.5:1 for body ink, ≥ 3:1 for meta/large.
   - Generalise the source scan in `features/metrics/legibility.test.ts` to **every** folder under `features/`, plus `app/` and `components/` (no `<12px`, no `13px`, low-contrast slate on dark). Hard-coded dark-only colours that won't flip in light mode go under **Open questions**.
7. **Reduced motion**:
   - With `matchMedia('(prefers-reduced-motion: reduce)')` mocked to match, the Sky gets `reducedMotion`, and queue/metrics/flock expose `data-reduced-motion="true"`.
   - A source scan finds every `@keyframes`/`animation`/`transition` in `index.css` and in feature `<style>` strings (`QUEUE_STYLES`, `MOTION_CSS`, …) and checks each is neutralised under `@media (prefers-reduced-motion: reduce)`.
8. **Live regions**: the places the docs promise announcements (`aria-live` on queue/metrics updates, copy confirmations) actually carry them.
9. **Routing** in `REPORT.md` and the handback:
   - shell/`components`/`lib` → Epic 112;
   - sky 130 · dag 131 · agents 132 · queue 133 · metrics 134 · flock 135 · launch 136 · about 137;
   - data → Wave 3b (204).""",
        "extra_locked": """- **Your tests must survive 15 web merges.** Shell (112) and features (130–137) change in parallel. Assert semantics (roles, accessible names that docs promise, relationships, focus moves), never exact copy, class names or DOM depth. Anything that only holds after an unmerged sibling change is out of scope: note it for a follow-up audit.
- Web tests run in their own process: `cd apps/web && bun test src/__a11y__`. Keep the whole folder under ~3 s.""",
        "oos": """- Fixing anything outside `__a11y__` (FIX REQUESTS only).
- Playwright and real-browser checks (Epic 140). The web QA lanes `__qa__/core` and `__qa__/features` (Epics 191/192).
- Unmerged Wave 3 features (stage, topology, health, report, …): list them in REPORT.md as "audit after C3".""",
        "dod": [
            "`cd apps/web && bun test src/__a11y__` → 0 fail, ≥ 60 passing tests plus one `test.todo` per confirmed violation.",
            "`bunx tsc --noEmit -p apps/web` clean and `bunx biome check apps/web/src/__a11y__` clean.",
            "`apps/web/src/__a11y__/REPORT.md` has the coverage table (feature × rule) and the bug table routed to owning epics, with the contrast ratios computed for every ink/surface token pair in both themes.",
        ],
        "carryover": "",
    },
    # ── 140 ─────────────────────────────────────────────────────────────────────────────────────
    {
        "nn": "140",
        "slug": "web-e2e-r2",
        "title": "Web: Playwright round 2",
        "lane": "`apps/web/e2e/**`",
        "wave": "3",
        "convention": None,
        "budget": "90–150 min",
        "goal": """Epic 71's 12 Playwright tests prove the demo boots, replays and clicks. Round 2 covers what a judge (or a nervous presenter) actually does:
- drive the dashboard with only a keyboard;
- flip to light theme;
- open the drawer from every entry point;
- fold and unfold the flock;
- fill the launch form;
- view it at 720p and 1080p with reduced motion.

The suite runs against demo mode with no server, so it's a pre-demo checklist anyone can run in two minutes. Bugs are recorded precisely, not "fixed" from this lane, and the README becomes the selector contract that the 15 web epics merging in parallel must keep.""",
        "deliverables": """1. **Read first**: `playwright.config.ts` (Vite dev server on a per-worktree port, `*.pw.ts`, 1 worker, artifacts in `$TMPDIR`) and `e2e/support.ts` (`openReplay`, `openEndState` via the dev-only `__STARLING_SKY__` handle, `watchConsole`, `horizontalOverflow`, `wirePerchPoints`/`hoverBird`). Keep this model. Extend `support.ts` additively; existing helpers keep their signatures.
2. **`keyboard.pw.ts`**, from `openEndState`:
   - The first Tab reaches the "Skip to the sky" link, and Enter moves focus into `#region-sky`.
   - Tabbing through the top bar (run picker combobox "Active run", view toggle, speed tabs, help, theme) shows a visible focus indicator on each control (computed `outline-style`/`box-shadow` not none).
   - Opening a task's drawer with keyboard only works (Tab to a queue card, Enter). Arrow keys move between drawer tabs. Esc closes it, and focus isn't left on `<body>`.
3. **`theme.pw.ts`**: the theme toggle flips `html[data-theme]` and persists across reload (`starling.theme`). In the light-theme end state there's no `RegionPlaceholder`, and 10 key labels (top bar, queue header, metrics figures, roost names) have a computed contrast ≥ 4.5:1 against their effective background, computed in-page.
4. **`drawer.pw.ts`**: the drawer opens from a DAG node (`2`, click a node), from a queue card and from a Sky bird (`hoverBird`). All four tabs render content, the Audit tab shows verdict cards, ✕ closes, and the drawer region doesn't overlap the sky region's box at 1280×720.
5. **`flock.pw.ts`**: `f` folds and unfolds the rail. At 1280×720 the compact rail's "All roosts" sheet opens; Escape closes it and focus returns to its trigger (Epic 55 promise). At 1920×1080 both roost cards are visible, and clicking a task chip opens that task's drawer.
6. **`launch.pw.ts`**: the launch panel isn't in the shell yet, so test it at `/src/features/launch/playground.html`. A demo-goal chip fills the goal; an empty goal or a bad budget shows errors tied to their fields; the preview step renders the fixture plan; a confirmed launch adds the fake run to history. Use roles and labels only.
7. **`playgrounds.pw.ts`**: each `/?playground=sky|dag|agents|queue|metrics|flock` and each feature `playground.html`/`preview.html` that exists on main boots with zero console/page errors and a visible root.
8. **`viewports.pw.ts`**: the end state at 1280×720 and 1920×1080, dark and light. Check no page-level horizontal overflow, every region visible, and the smallest rendered font of visible text ≥ 12 px. **Screenshots are captures, not assertions**: write them to `e2e/__captures__/<name>.png` only when `STARLING_E2E_CAPTURE=1` (commit 4, each ≤ 300 KB). Don't add new `toHaveScreenshot` baselines; 15 web epics are changing pixels in parallel.
9. **Reduced motion** (extend `motion.pw.ts`): with `reducedMotion: 'reduce'`, there's no DAG status flash (`data-flash` or equivalent absent after a scrubbed status change), queue cards have no transform transition, and the flock pulse is static.
10. **Sky hooks**: Epic 130 is adding `data-testid="sky-tooltip"` and a freeze hook (`window.__STARLING_SKY_FREEZE__`) in parallel. Feature-detect them in `support.ts` (use them when present, else the current selectors). Don't wait.
11. **Bugs**: `test.fixme('BUG <area>: …', async () => { …real steps… })` (the Playwright equivalent of `test.todo`; never `test.fail`), plus a FIX REQUEST naming the owning Wave 3 epic.
12. **README**: the scenario list, capture mode, the typecheck command, and a **selector contract table** (every testid/role/label the suite depends on → owning lane).""",
        "extra_locked": """- **Playwright is heavy**: always run it through the gate, e.g. `bash .orchestrator/bin/heavy.sh bun run --cwd apps/web e2e -- keyboard.pw.ts` while iterating. Chromium is already installed on this laptop (`bunx playwright install chromium` is a no-op); never `--with-deps`.
- It's not part of `bun run test` (files are `*.pw.ts`) and that stays true. `playwright.config.ts` and `apps/web/tsconfig.json` are outside your lane.
- Write selectors against `main`'s current DOM using roles, labels and the testids in the contract table. Siblings 112 and 130–137 are changing markup, so prefer roles over structure.""",
        "oos": """- The CI job, caching and per-platform snapshot directories: Epic 150 (`.github/workflows`), plus `playwright.config.ts` changes via FIX REQUEST.
- Fixing UI bugs. Testing unmerged Wave 3 features (stage, topology, health, …): list them in the README as "next round".
- Live-server or real-flock journeys.""",
        "dod": [
            "`bunx tsc --noEmit -p apps/web/e2e` clean (your new `e2e/tsconfig.json`), and `bunx biome check apps/web/e2e` clean.",
            "`bash .orchestrator/bin/heavy.sh bun run --cwd apps/web e2e` → all pass (fixme allowed): the 12 existing tests + ≥ 20 new ones. Paste the summary line and the run time.",
            "`STARLING_E2E_CAPTURE=1 bash .orchestrator/bin/heavy.sh bun run --cwd apps/web e2e -- viewports.pw.ts` → 4 PNGs in `apps/web/e2e/__captures__/`, each ≤ 300 KB (paste `ls -l`).",
        ],
        "carryover": """- **Epic 71 #2 (typecheck)**: `bun run check` doesn't typecheck `e2e/` because `apps/web/tsconfig.json` only includes `src/**`, and that file is in no Wave 3 lane. Add `apps/web/e2e/tsconfig.json` (extends `../tsconfig.json`, `include: ["./**/*.ts", "../playwright.config.ts"]`) and make it pass. Add a FIX REQUEST for the root `typecheck` loop / Epic 150 to run `tsc -p apps/web/e2e`.
- **Epic 71 #2 (CI job, Linux baselines)**: decline. That's Epic 150 (`.github/workflows`), plus a FIX REQUEST for any `playwright.config.ts` change (e.g. a per-platform `snapshotPathTemplate`).
- **Epic 71 #1** (Sky tooltip testid + freeze hook): Epic 130 is doing it in parallel. Feature-detect it (deliverable 10).
- **Epic 71 deferred**: light-theme and `?playground=` coverage (deliverables 3 and 7).""",
    },
    # ── 141 ─────────────────────────────────────────────────────────────────────────────────────
    {
        "nn": "141",
        "slug": "web-perf",
        "title": "Web: performance budgets",
        "lane": "`apps/web/src/__perf__/**`",
        "wave": "3",
        "convention": "qa",
        "budget": "60–120 min",
        "goal": """Wave 3's demos push the dashboard from 7 tasks to 60–100, and a long live run streams tens of thousands of events into one tab. Nobody has measured what the reducer, selectors and panels cost at that scale. This epic builds deterministic synthetic runs, measures the data path and the panels' render counts at 30/100/300 tasks and 50k events, and writes a budget file so regressions show up as failing numbers instead of a stuttering projector. Great looks like this: a bench table in the handback, render-count budgets enforced in the default test run, and precise FIX REQUESTS (e.g. "every agent.event re-renders the queue").""",
        "deliverables": """1. **`synth.ts`**: `synthRun(opts: { tasks: number; events: number; nodes?: number; seed?: number }): StarlingEvent[]`.
   - Deterministic (a local mulberry32), with a realistic mix: `run.created`, `plan.created`, `task.status` walks, about 60% `agent.event`, `metrics` every 5 s of sim time, `node.stats`, verdicts, merges and a few `log`s.
   - Validate a sample against `StarlingEventSchema` (`@starling/core/browser`) in a test.
   - Scenarios: `S30`, `S100`, `S300` (tasks) and `L50K` (50,000 events, 100 tasks).
2. **`budgets.ts`**: `PERF_BUDGETS` as a typed table per scenario (`maxRendersPerPanel`, `maxHeldEvents`, `maxMs` (opt-in only), notes). It's generous (about 10× what you measure) and every number is commented with where it came from.
3. **`bench.ts`** CLI: `bun apps/web/src/__perf__/bench.ts [--json] [--scenario S100]` prints a table:
   - reducer throughput (`applyEvents` events/s) per scenario;
   - the 50k-event replay time;
   - per-call cost of `skyProps`, `dagProps`, `queueProps`, `flockProps`, `metricsProps`, `displayTasks`, `recentEvents` on the end state (median of 5).
   It writes nothing unless `--out <path>`. Run it through `heavy.sh`.
4. **Deterministic tests** (the default `bun test`, under ~3 s total):
   - **Caps hold** after `L50K`: `events.length ≤ EVENT_CAP`, every `agentLog[k].length ≤ AGENT_LOG_CAP`, `metricsHistory ≤ METRICS_CAP`, `merges ≤ MERGE_CAP`.
   - **No-op identity**: `applyEvent` returns the same object for events it ignores.
   - **Selector stability**: two calls on the same state return identity-equal `tasks`/`nodes`/`recent` props (`displayTasks` is cached; `recentEvents` likely isn't, so record what you find).
5. **Render counts**: mount `MergeQueue`, `MetricsPanel`, `FlockPanel`, `DagView` and `AgentDrawer` inside React `<Profiler onRender>`, fed by the real selectors from a state you advance with `applyEvent`.
   - Ingest 200 `agent.event`s for one task and count commits per panel. Panels that don't show agent events ideally don't commit.
   - Also count full `Layout` commits per ingested event.
   - Assert the measured counts against `PERF_BUDGETS` (they're deterministic). A panel over its realistic budget becomes `test.todo` + FIX REQUEST:
     - memoisation in the feature → its Wave 3 epic (queue 133, metrics 134, flock 135, dag 131, agents 132);
     - selector identity → Wave 3b (204);
     - Layout recomputation → Epic 112.
6. **Complexity probes**: suspects to measure and report are `appendCapped` copying the whole capped array per event (`data/reducer.ts`), `recentEvents` filtering all `state.events` per render, and the `displayTasks` signature string per call. Measure scaling (5k vs 50k events, 30 vs 300 tasks) **only** under `STARLING_PERF=1` (`test.if(process.env.STARLING_PERF === '1')`) and put the ratios in REPORT.md.
7. **`REPORT.md`**: what's covered, the bench table measured on this laptop (note the machine load), findings with severity and FIX REQUEST routing, and what to measure next (canvas fps lives in Epic 130).""",
        "extra_locked": """- **L38 is strict here**: no wall-clock assertions in the default run. Timing tests exist only behind `STARLING_PERF=1` and never run in `bun run test`. Default assertions are counts, caps and identities only.
- Import `data/**`, `features/**` and `app/Layout` read-only. Don't edit them (FIX REQUESTS instead).""",
        "oos": """- Fixing the reducer or selectors (Wave 3b, Epic 204), features or shell.
- Package hot paths (Epic 199). Canvas fps (Epic 130). Server/SSE load (Epic 155).""",
        "dod": [
            "`cd apps/web && bun test src/__perf__` → 0 fail (todos allowed), ≥ 40 tests, under ~3 s (paste the timing line).",
            "`bunx tsc --noEmit -p apps/web` clean and `bunx biome check apps/web/src/__perf__` clean.",
            "`bash .orchestrator/bin/heavy.sh bun apps/web/src/__perf__/bench.ts` → paste the table in the handback and REPORT.md. `STARLING_PERF=1 bash .orchestrator/bin/heavy.sh bash -c 'cd apps/web && bun test src/__perf__'` → pass.",
        ],
        "carryover": "",
    },
]
