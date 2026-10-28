"""Wave 3 specs, group B1: web shell round 2 (Epic 112) + new web feature folders (Epics 113-126)."""

W = "apps/web/src/features"

# Shared, grounded notes for every new B1 feature folder (inserted after L39 via extra_locked).
WEB_NOTES = """- **SkyState facts you must design around** (`apps/web/src/data/reducer.ts`, read-only):
  `state.events` holds only the **active run's** events plus global `runId: '*'` flock events, capped at `EVENT_CAP` = 5,000, so every derivation needs a fallback from the `Run`/`TaskRun` snapshots in `state.runs` (`startedAt`, `finishedAt`, `status`, `attempts`, `usage`, `costUsd`, `nodeId`, `lastVerdict`). `state.verdicts` and `state.agentLog` are keyed by **task key only** (not run), so filter them by the active run's task keys. `state.metricsHistory` is not per run. `activeRunOf`, `sortedRuns`, `sortedNodes`, `displayTasks` come from `data/selectors.ts`.
- **Event contract drift.** Epic 40 is adding `'run.status'` to core's `StarlingEvent` union and `nodeName?` to `TaskRun`. Never write an exhaustive `never` switch over `StarlingEvent['type']`: use a `default:` branch, and `isRunStatusEvent` from `../../data/run-status` for run status. Read `nodeName` structurally and fall back to `state.nodes[nodeId]?.name ?? nodeId`.
- **Imports.** Runtime values from `@starling/core/browser` only (`PRICING`, `usageCostUsd`, `globsOverlap`, `matchesGlob`, schemas); `import type` from it for types. Shared helpers: `lib/format` (`formatDuration`, `formatUsd`, `formatTokens`, `percent`; note `cached` is a **subset** of `input` in `TokenUsage`, so a token total is `input + output`, not `totalTokens()`, which adds `cached` too), `lib/status` (`STATUS_COLORS`, `statusLabel`, `taskTone`), `components` (`Panel`, `Stat`, `Badge`, `EmptyState`, `Tabs`, `Tooltip`, `Kbd`), `usePrefersReducedMotion`/`useNow` from `../metrics`. Another feature's helpers only through its `index.ts`.
- **The shell binds your hotkey** (Epic 112's registry, wired at C3). Don't add a document-level `keydown` listener for it; handle keys only while focus is inside your component. Extra props beyond `FeatureProps` must be **optional** (so the `ComponentType<FeatureProps>` cast stays honest); list them under **C3 wiring**. Also export `FEATURE = '<folder>' as const` (the existing folder smoke-test convention).
- **Playground recipe:** `applyEvents(createInitialState(), demoEvents().slice(0, i))` (from `../../data/reducer` and `../../data/demo`) with an event-index range slider, so the feature can be seen mid-run and at the end. Copy `features/dag/{playground.html,playground-main.tsx}`. Put the pure derivation in `derive.ts` (tested without a DOM), and component tests use `ensureDom()` from `../../lib/test-dom` + `@testing-library/react`. Clear `localStorage` after each test that writes it."""

INSIGHTS_NOTE = """- **Epic 111 is building `/api/runs/:id/report|timeline|costs` and `/api/compare?a=&b=` in parallel; the response shapes are not final.** Your feature must be complete from `SkyState` alone. The endpoint is an optional enhancement: fetch only when `state.connection === 'live'`, through an optional `fetchImpl?: typeof fetch` prop (C3 passes one that adds the auth header from Epic 110), with an `AbortController`, a 2 s timeout, a structural guard on the JSON, and silent fallback to the local derivation on any error/404/501/mismatch. Never block the first render on it. Write the expected shape you coded against in the handback so C3 can reconcile it with 111's."""

SPECS = [
    # ─────────────────────────────────────────────────────────────────────────────────────────────
    {
        "nn": "112",
        "slug": "web-shell-r2",
        "title": "Web shell round 2: feature registry, page router, panel dock, overlay host, compact 720p stage",
        "lane": "`apps/web/src/{app,components,lib}/**`, `apps/web/src/App.tsx`, `apps/web/src/main.tsx`, `apps/web/src/index.css`, `apps/web/index.html`, `apps/web/vite.config.ts`",
        "wave": "3",
        "convention": None,
        "budget": "90–150 min",
        "goal": """Fifteen new web features (Epics 113–129) are being built right now as self-contained folders that each export one L39 `feature` manifest. Your shell is what turns them into one product: C3 must be able to add each with **one line** in a single file you own, and the dashboard must stay calm and readable on a 1280×720 projector. Today `Layout.tsx` hard-codes two centre views (Sky/DAG), the bottom strip and one help overlay, and nothing knows about `?page=`. Great looks like: a typed registry whose `FeatureManifest` matches L39 exactly, a view switcher that accepts extra centre views, a bottom panel dock, an overlay host with a correct Esc stack, a `?page=<id>` router, hotkeys bound from manifests, every feature wrapped in an error boundary, and the 720p layout fixed, all without breaking a single existing test, `data-region` hook or e2e selector.""",
        "deliverables": """1. **`app/feature-registry.ts`**: the contract, matching L39 exactly:
   ```ts
   export type FeatureKind = 'view' | 'panel' | 'overlay' | 'page';
   export interface FeatureProps { state: SkyState; onSelectTask?(key: string): void; onSelectRun?(runId: string): void; onClose?(): void }
   export interface FeatureManifest { readonly id: string; readonly title: string; readonly description: string; readonly kind: FeatureKind; readonly icon: string; readonly hotkey?: string | undefined; readonly Component: ComponentType<FeatureProps> }
   export interface FeatureOptions { mount?: 'on-demand' | 'always'; defaultOpen?: boolean; order?: number; props?(shell: ShellApi): Record<string, unknown>; playground?(): Promise<{ default: ComponentType }> }
   export interface FeatureEntry { manifest: FeatureManifest; options?: FeatureOptions }
   export function createFeatureRegistry(entries?: readonly FeatureEntry[]): FeatureRegistry  // list(kind?), get(id), hotkeyFor(event), warnings
   ```
   Validation: id `^[a-z][a-z0-9-]*$`, duplicate id → second ignored + warning; hotkey in `RESERVED_HOTKEYS` (`1 2 b f ? Escape` and the arrows) or already taken → the feature registers **without** a hotkey + warning (never throw: one bad manifest must not blank the dashboard). Hotkeys match `event.key` case-sensitively (`l` ≠ `L`); `mod+k` = meta **or** ctrl + `k`. A unknown `icon` name resolves to a fallback icon through a curated map `FEATURE_ICONS` (at least: `FileText ChartGantt LayoutGrid Coins SquareTerminal Settings Compass Command Bell GitCompareArrows Share2 Rewind Flame Trophy Presentation Network HeartPulse Info Rocket`, all verified to exist in lucide-react 1.62; note `History` and `GanttChart` do **not** exist). Don't `import *` from lucide-react.
2. **`app/features.ts`**: `export const FEATURES: readonly FeatureEntry[] = [ /* C3: one line per feature */ ]`, plus the built-ins you add (item 8). This is the one file C3 edits: `{ manifest: reportFeature },`.
3. **`ShellApi` + `ShellContext`/`useShell()`** in `app/shell-context.tsx`: `{ state, features, open(id), close(id), toggle(id), isOpen(id), setView(id), goToPage(id?: string) }`. Every mounted feature gets `{ state, onSelectTask, onSelectRun, onClose }` plus `options.props?.(shell)` (this is how C3 hands the palette `features`/`onOpenFeature`, or the scrubber `onSeek`, in one line).
4. **Extra centre views.** Keep the `Sky`/`DAG` tabs exactly as they are (e2e uses `getByRole('tab', { name: 'DAG' })`) and add a **Views** menu button listing registered `view` features with their hotkeys; an active extra view shows as a third tab. Sky and DAG stay mounted as today; extra views mount only while active (wrapped in `ErrorBoundary` + a generic `FeaturePlaceholder`), and the Sky gets `paused` whenever it isn't the active view. Changes to `CentreView`/`TopBarProps`/`LayoutProps` are additive (new optional props, e.g. `features?: FeatureRegistry`).
5. **Panel dock.** `panel` features open in the bottom strip region as tabs next to the existing "Landing strip" (queue + meter), one active at a time, the dock grows to `min(40vh, 22rem)` while a feature panel is active; its hotkey toggles it, Esc returns to the strip. `b` still collapses the whole strip.
6. **Overlay host + Esc stack.** `overlay` features render above everything in open order; `mount: 'always'` overlays (toasts) are always mounted and never "open"; `defaultOpen` (tour on first visit) opens once at boot. Esc closes, in order: topmost overlay → keyboard help → active dock panel → agent drawer. Hotkeys are bound in the existing single document handler (the typing guard stays; `mod+k` must pass the current `metaKey/ctrlKey` early return).
7. **Page router.** `lib/route.ts`: add `page?: string` to `SkyRoute` (parsed from `?page=`, lowercase, `[a-z0-9-]{1,32}`), `pageHref(id?, search?)`. `AppShell` keeps booting data, then renders a `PageHost` (slim top bar with "← Back to the sky" that clears `?page` via `history.pushState`) for a registered `page` feature, or an `EmptyState` for an unknown id. `popstate` is handled. `?run=` keeps working together with `?page=`.
8. **Built-ins via the registry** (the carryover): `about` page (`?page=about`) loading `/stats.json` once into `AboutPage` with an `EmptyState` explaining `bun tools/stats/collect.ts --out apps/web/public/stats.json` when it's missing; a `launch` overlay (top-bar "New run" button, no hotkey) rendering `LaunchPanel` with `runs={sortedRuns(state)}`, `goals={[...DEMO_GOALS]}`, `recentRepos` (from `?repo=`, then `localStorage['starling.recentRepos']`, then run repo paths, then `DEMO_REPO_PATH`), and `onLaunch`/`onPreview` from a new `app/launch-client.ts` (`postRun`, `postPreview`: POST `/api/runs` and `/api/runs/preview`; 501/404 → `undefined`; demo mode → a clear "start the server to launch" error). Add `'launch'` to `PLAYGROUNDS` and a lazy branch in `PlaygroundHost`, and let `options.playground` add `?playground=<id>` for new features.
9. **Compact stage at 720p.** `lib/viewport.ts`: `COMPACT_STAGE_QUERY = '(max-width: 1366px), (max-height: 800px)'` + `useCompactStage()`. When compact: strip `grid-cols-[minmax(0,2fr)_minmax(0,1fr)]` and `h-40`, top bar hides secondary items (model badge, "murmuration" label) behind the Views menu, no page-level horizontal overflow at 1280×720. Queue *board internals* (column widths, wire-first) are Epic 133's; you only give the queue region more room.
10. **Settings hooks in CSS/lib** (Epic 118 writes these attributes on `<html>` in parallel): `index.css` rules for `[data-density="compact"]` (tighter `--spacing-*`) and `[data-motion="reduced"]` (same backstop as the existing `prefers-reduced-motion` block), and `lib/motion.ts` `useReducedMotion()` = media query **or** `data-motion="reduced"`; Layout uses it instead of importing from `features/metrics`.
11. **KeyboardHelp**: optional `extra?: readonly Shortcut[]`; the shell passes every registered hotkey (`mod+k` rendered as ⌘K/Ctrl K). **`lib/format`**: `totalTokens()` adds `cached`, which is a subset of `input` (see core's `usageCostUsd`), and `lib.test.ts` pins that. Keep it (L33), mark it `@deprecated`, and add `billableTokens(usage) = input + output` with tests.
12. **Tests (≥ 40 new, happy-dom):** registry validation/collisions/icon fallback (~12); a literal written exactly as the L39 snippet (`as const`, `hotkey: undefined` and `hotkey: 'r'`, a feature-local copy of `FeatureProps`) type-checks as `FeatureManifest` (`satisfies`); route parsing for `page` (~6); Layout with fake view/panel/overlay/page manifests: menu + hotkeys switch views, dock toggles, Esc stack order, `mod+k`, a throwing feature shows the placeholder while the rest renders, typing in an input doesn't trigger hotkeys (~15); compact layout via a stubbed `matchMedia` (~3); launch client 2xx/501/network error (~4). All existing `src/app` tests keep passing unchanged.""",
        "oos": """- Anything inside `apps/web/src/features/**` (each folder has its owner: 113–126 here, 127–137 in B2) and `apps/web/src/data/**` (off limits; Epic 204 in Wave 3b adds seek/slices).
- Wiring the 15 new features into `FEATURES` (C3 does it, one line each, from their handbacks). Ship `FEATURES` with only your built-ins.
- `apps/web/e2e/**` and its screenshot baselines (Epic 140), the gallery (Epic 138), `apps/web/tsconfig.json`, `package.json`.
- Queue board column widths / wire-first board (Epic 133), Sky internals (Epic 130), server routes such as `/api/runs/preview` (Epic 110).
- Attaching the SEC-01 token to `fetch`/SSE: that lives in `data/api.ts`/`data/sse.ts` (Wave 3b, Epic 204).""",
        "dod": [
            "`cd apps/web && bun test src/app src/lib src/components` → 0 fail, ≥ 40 new tests",
            "`cd apps/web && bun test` → 0 fail (every existing feature and shell test still green)",
            "`bunx tsc --noEmit -p apps/web` clean, and `bunx biome check apps/web/src/app apps/web/src/lib apps/web/src/components` clean",
            "`bash .orchestrator/bin/heavy.sh bun run --cwd apps/web build` succeeds; paste the bundle size lines and compare with `main`",
            "If Playwright browsers are installed: `bash .orchestrator/bin/heavy.sh bun run --cwd apps/web e2e` → all non-visual specs pass. A changed 1280×720 baseline is expected: don't touch `apps/web/e2e/`, list it in the handback for Epic 140/C3",
        ],
        "carryover": """- **41 #3 / 47 #2 (Sky `paused` wiring)**: `Layout.tsx` already passes `paused: view !== 'sky'` via `SkyExtras`. Verify, extend it to extra views, and mark it done.
- **41 #4 / 55 #2 (queue `selectedTask`)**: the shell already passes it; the board side is Epic 133's. Mark the shell part done.
- **53 #1, #4, #5 (launch)**: wire `LaunchPanel` (deliverable 8), add the `launch` playground route, initial repo from `?repo=`/localStorage. Decline #2/#3 (server preview route and budget plumbing: Epic 110 / data layer) with one line each.
- **55 #3 (queue column widths)** and **71 #3 (720p board clips "On the wire")**: do the shell half (deliverable 9); the board internals are Epic 133's.
- **68 #1 (`?page=about` + stats loader)**: deliverable 8.
- **SEC-01 (web must attach the token)**: decline here. The fetch/SSE clients are in `apps/web/src/data` (Wave 3b); Epic 118 stores the token.""",
        "extra_locked": """- **You own `apps/web/src/App.tsx` and `app/Layout.tsx` this wave**, so L32's "registration files you don't own" doesn't apply to them for you. Registering the *other* epics' features is still C3's job (deliverable 2).
- **Your `FeatureManifest`/`FeatureProps` must accept the L39 snippet verbatim.** The 15 feature epics can't import from `app/` (you merge in parallel), so each declares an identical `FeatureProps` locally; structural typing makes them compatible. Don't add required fields to either type. Shell-side extras go in `FeatureOptions`, never in the manifest.
- **Hotkey table (L39):** report `r`, timeline `t`, lanes `l`, costs `c`, console `` ` ``, settings `,`, palette `mod+k`, compare `x`, export `e`, scrubber `.`, heatmap `h`, leaderboard `L`, stage `s`, topology `o`, health `!`. Put it in `docs/epic-112-web-shell-r2.md` together with a worked C3 example for each kind.
- **Keep every existing hook stable** (L33): `data-region="flock|sky|drawer|strip|queue|metrics"`, `data-view`, `data-active`, `#region-sky`, the button labels "Expand/Collapse the flock region", "Collapse the bottom strip", `data-testid="keyboard-help"`, the `__STARLING_SKY__` dev handle. Epic 119's tour spotlights `data-region` elements, so add `data-shell="topbar|views-menu|dock|run-picker"` anchors too, and document them.""",
    },
    # ─────────────────────────────────────────────────────────────────────────────────────────────
    {
        "nn": "113",
        "slug": "web-report",
        "title": "Web: flight report (the post-run summary page)",
        "lane": f"`{W}/report/**`",
        "wave": "3",
        "convention": "web",
        "budget": "90–150 min",
        "goal": """When the murmuration lands, judges want one page that says what happened: did it work, how much faster than one agent, what it cost, which laptop did what, where the auditor pushed back, and the story in plain English. The flight report is that page (`?page=report`). It should look great on a projector and print cleanly. Every number must be traceable to events or run snapshots, and estimates must be labelled as estimates.""",
        "deliverables": """1. `report/derive.ts`: `buildFlightReport(state: SkyState, runId?: string, now?: number): FlightReport | undefined` (defaults to the active run). `FlightReport` = `{ runId, goal, status, outcome: 'landed' | 'partial' | 'failed' | 'in-flight' | 'cancelled', tasks: { total, merged, failed, conflict, cancelled, inFlight }, wallMs, flightWindowMs, serialMs, savedMs, speedup, costUsd, savedUsd, localCalls, tokens: { api, local }, nodes: NodeContribution[], verdicts: NotableVerdict[], story: StoryBeat[], summary?: string, estimated: string[] }`.
2. **Sources (from the real reducer):** counts from `run.tasks[*].status`. `wallMs = (run.finishedAt ?? now) − run.startedAt`. Per-task flight = `finishedAt − startedAt` from `TaskRun`. `flightWindowMs = max(finishedAt) − min(startedAt)`. `serialMs = (wallMs − flightWindowMs) + Σ flight` (overhead + the tasks one at a time), labelled "estimate". If task timings are missing, fall back to `Σ plan.tasks[*].estimateMin` labelled "planner estimate". Cost/savings/local calls from the latest `state.metricsHistory` sample when the run is active, else `run.metrics` (`apiCostUsd`, `estSavedUsd`, `localCallCount`, `apiUsage`, `localUsage`).
3. **Per-node contribution** (`NodeContribution = { nodeId, name, tasks, merged, flightMs, costUsd, migratedIn, migratedOut }`): group `TaskRun.nodeId` (name via `state.nodes`), migrations from `task.migrated` events (`fromNode → toNode`).
4. **Notable verdicts:** for the run's task keys, `state.verdicts[key]` entries with `pass: false`, non-empty `laneViolations` or `fixInstructions`, paired with the later passing attempt ("theme failed attempt 1 (tests, definition-of-done), passed on attempt 2"). Show `checks[].name/ok/detail` and the verdict `model`.
5. **Story** (`storyBeats(events, run, nodes): StoryBeat[]`, `{ at: number /* ms since run start */, kind, text, taskKey? }`): `repomap.ready` (files), `plan.created` (task count, issues), `node.joined`/`node.left` (with `reason`), the first `task.status → running`, failed audits, `task.migrated` (with `reason`), the first and last `merge.result: merged`, `merge.result` conflicts, `log` warn/error, and `run.finished` whose `payload.summary` becomes `summary` (it's only on the event, not on `Run`). Cap at 12 beats, de-duplicated, chronological.
6. **Fixture truths (assert them):** for `fixtures/runs/sky-todo-launch-day.jsonl`: 7/7 merged, `wallMs` 356,000, Σ flight 400,300 ms, flight window 245,000 ms, `serialMs` 511,300, speedup ≈ 1.44×, `costUsd` ≈ 0.0422, `savedUsd` ≈ 0.0185, theme's failed-then-passed verdict, search migrated `air → hub`, and the summary text present.
7. `ReportPage` (kind `page`): hero outcome line + `Stat` row (landed, wall time, time saved, API spend, saved by local); a "one agent vs the flock" pair of bars (serial vs wall) with the estimate label; node contribution bars; verdict cards; story as a vertical timeline with `T+m:ss`. Clicking a task → `onSelectTask`; a run `<select>` (from `sortedRuns`) → `onSelectRun`. In-flight runs say "still flying" and update live. Empty state when there's no run.
8. `print:` styles (white background, no chrome, page-break-safe sections) and a "Print" button (`window.print`, guarded).
9. Optional enhancement: `GET /api/runs/:id/report` merged over the local report (server wins per field it provides), see the note below.
10. `index.ts` manifest: id `report`, kind `page`, icon `FileText`, hotkey `r`. Playground with the slider (mid-run vs landed).
11. Tests: ≥ 20 derive tests (fixture truths, missing timings fallback, a failed/conflict run, no verdicts, foreign-run verdict keys ignored, migration counting, summary absent) and ≥ 8 component tests (renders hero, estimate labels, select task/run callbacks, empty state, live fetch merges and falls back on 501 with an injected `fetchImpl`).""",
        "oos": """- Exporting/sharing (Markdown, JSONL, PNG): Epic 123. Run comparison: Epic 122. Gantt rendering: Epic 114.
- Server-side report building (Epic 111), shell routing (Epic 112 / C3), anything in `data/`.""",
        "dod": [
            "`cd apps/web && bun test src/features/report` → 0 fail, ≥ 28 new tests",
            "`bunx tsc --noEmit -p apps/web` clean, `bunx biome check apps/web/src/features/report` clean",
            "A happy-dom test renders `Playground` at the end of the fixture and finds \"7/7\", \"5m 56s\" and the word \"estimate\"",
            "Paste `buildFlightReport` for the fixture (JSON, abbreviated) in the handback",
        ],
        "carryover": "",
        "extra_locked": WEB_NOTES + "\n" + INSIGHTS_NOTE,
    },
    # ─────────────────────────────────────────────────────────────────────────────────────────────
    {
        "nn": "114",
        "slug": "web-timeline",
        "title": "Web: timeline (a live Gantt of the flock)",
        "lane": f"`{W}/timeline/**`",
        "wave": "3",
        "convention": "web",
        "budget": "90–150 min",
        "goal": """The Sky shows the feeling of parallelism; the timeline proves it. One row per task, coloured bars for each phase, the laptop that ran it, a parallelism curve on top, a now-line that moves while the run is live, and the migration moment (the Air drops, `search` lands on the hub) visible at a glance. It's the view a judge screenshots.""",
        "deliverables": """1. `timeline/derive.ts`: `buildGanttModel(state: SkyState, now: number): GanttModel` with `GanttModel = { start, end, live, planning?: { start, end }, rows: GanttRow[], parallelism: { ts: number; count: number }[], peak: { count, ts } }`, `GanttRow = { taskKey, title, finalStatus, segments: GanttSegment[], migrations: { ts, from, to, reason }[] }`, `GanttSegment = { phase: 'queued' | 'working' | 'auditing' | 'fixing' | 'merging', start, end?: number, nodeId?: string, attempt: number }`.
2. **Sources:** segments come from `task.status` events in `state.events` (`payload.from/to`, envelope `ts`, and `payload.run.nodeId`/`attempts`, which are per transition, so the `search` row shows an Air segment then a hub segment). Mapping: `ready→queued`, `running→working`, `auditing`, `fixing`, `merging`; a terminal status (`merged/failed/conflict/cancelled`) closes the open segment. Open segments end at `now` while live. Row order = plan order (`run.plan.tasks`), then any unknown keys.
3. **Fallback** when a task has no `task.status` events (hydrated run, or truncated by `EVENT_CAP`): one `working` segment from `TaskRun.startedAt` to `finishedAt` (or `now`), node `TaskRun.nodeId`. Planning band = `run.startedAt` → the `plan.created` event `ts` (or absent).
4. `parallelismCurve(rows, start, end)`: a step series counting segments in `working|auditing|fixing|merging` at each change point. Fixture truth: peak 4 at T+14.6 s. `migrations` from `task.migrated` events (fixture: `search`, `air → hub`, T+190.6 s, "air went offline").
5. `TimelineView` (kind `view`): SVG, sticky task-label column, time axis with ticks (`formatDuration`), rows ≈ 22 px, phase fill from `--color-status-*` tokens, a thin node stripe per segment (node colour from a deterministic palette over `sortedNodes`, legend with node names), migration arrows, the parallelism area chart above (aria-described: "peak 4 agents at 0:14"), and a now-line while live (`useNow(live)` from `../metrics`).
6. Interaction: hover tooltip (task, phase, node, duration, attempt), click a bar/row → `onSelectTask`, selected row highlighted from `state.selectedTask`, ↑/↓ move between rows when the chart has focus, Enter selects. Fits 1280×720 without horizontal page scroll (the chart scales to the container width; `ResizeObserver` guarded for happy-dom).
7. Reduced motion: no bar transitions or now-line easing. Empty states: no run, a run with no plan yet ("planning…").
8. Optional enhancement: `GET /api/runs/:id/timeline` used only to backfill rows that local derivation could only build from the fallback (see the note below).
9. `index.ts` manifest: id `timeline`, kind `view`, icon `ChartGantt`, hotkey `t`. Playground with the slider.
10. Tests: ≥ 20 derive tests (fixture segments for `theme` = queued, working, auditing, fixing, auditing, merging; `search` node switch; peak 4; truncated events fallback; open segment ends at `now`; unknown task key; empty run) and ≥ 8 component tests (rows rendered, click selects, keyboard nav, tooltip text, legend names, live now-line present only when running).""",
        "oos": """- The run-wide report/narrative (Epic 113), replay seeking (Epic 124), the DAG (Epic 131), anything in `data/` or `app/`.""",
        "dod": [
            "`cd apps/web && bun test src/features/timeline` → 0 fail, ≥ 28 new tests",
            "`bunx tsc --noEmit -p apps/web` clean, `bunx biome check apps/web/src/features/timeline` clean",
            "A happy-dom test renders the fixture end state: 7 rows, a migration marker on `search`, and an accessible description containing \"peak 4\"",
        ],
        "carryover": "",
        "extra_locked": WEB_NOTES + "\n" + INSIGHTS_NOTE,
    },
    # ─────────────────────────────────────────────────────────────────────────────────────────────
    {
        "nn": "115",
        "slug": "web-lanes",
        "title": "Web: lanes map (who owns which files)",
        "lane": f"`{W}/lanes/**`",
        "wave": "3",
        "convention": "web",
        "budget": "60–120 min",
        "goal": """Lanes are why a hundred agents can work at once without stepping on each other. This view makes that visible: a treemap of the repo, coloured by the task that owns each area, with read-only areas faded, overlaps hatched and conflicts outlined in red. A judge should get "every bird has its own patch of sky" in two seconds.""",
        "deliverables": """1. `lanes/derive.ts`: `buildLaneTree(state: SkyState): LaneNode` where `LaneNode = { path, name, children, owners: string[], readers: string[], touched: number, conflict: boolean, violation: boolean, weight: number }`.
2. **Sources:** the active run's `plan.tasks[*].lane.owns`/`reads` globs (a glob's static prefix before the first `*` becomes a directory node: `src/features/theme/**` → `src/features/theme`; exact files stay files). Touched files from `state.agentLog[taskKey]` entries with `kind === 'file.edited'` (`data.path`, `data.added`, `data.removed`, read defensively), from `state.diffs[diffKey(runId, key)]?.files`, and from any `task.diff` event in `state.events` (Epic 100 may add it; detect it structurally). Conflicts: `merge.result` with `status: 'conflict'` → `conflictedFiles`. Violations: `state.verdicts[key][*].laneViolations`.
3. Overlaps: `globsOverlap(a.owns, b.owns)` from `@starling/core/browser` for every task pair → `LaneOverlap[]` (`{ a, b, globs }`); a node owned by ≥ 2 tasks is hatched. `weight` = touched lines (added + removed) when known, else 1 per file, else 1 per lane glob, so a fresh plan still draws.
4. `squarify(nodes, rect): Tile[]`: a pure squarified-treemap layout (tested: areas proportional to weight within 1%, no overlaps, inside the rect, deterministic order).
5. `LanesView` (kind `view`): SVG treemap with nested directory frames, tile colour = owning task (deterministic palette over the plan's task order using `--color-irid-*`/status tokens; legend with task titles), reads-only tiles faded, overlap hatch (`<pattern>`), red outline for conflict/violation, labels when the tile is big enough. Click → `onSelectTask(owner)`; `state.selectedTask` highlights its lane and dims the rest.
6. Accessibility: a "View as list" toggle rendering the same data as a table (path, owner, readers, touched lines, flags); tiles are focusable buttons with roving tabindex (arrows move within the view only when it has focus).
7. A summary strip: "7 lanes · 0 overlaps · 8 files touched · 0 conflicts" (fixture truth), plus warnings from `plan.created` `issues` with `code: 'lane-overlap'` when the event is present.
8. `index.ts` manifest: id `lanes`, kind `view`, icon `LayoutGrid`, hotkey `l`. Playground with the slider and a toggle that swaps in a hand-made plan with two overlapping lanes and a conflict (fixture in `lanes/test-fixtures.ts`).
9. Tests: ≥ 18 derive/layout tests (glob prefix → path, overlap detection, touched aggregation, weight fallback, conflict/violation flags, squarify invariants) and ≥ 8 component tests (legend, click selects owner, list view, selected dimming, empty state with no plan).""",
        "oos": """- File churn ranking (Epic 125 heatmap owns "how much changed"; you own "who owns what"). Planner-side lane suggestions (Epic 107). Anything outside your folder.""",
        "dod": [
            "`cd apps/web && bun test src/features/lanes` → 0 fail, ≥ 26 new tests",
            "`bunx tsc --noEmit -p apps/web` clean, `bunx biome check apps/web/src/features/lanes` clean",
            "A happy-dom test of the fixture end state finds the summary \"7 lanes · 0 overlaps · 8 files touched\"",
        ],
        "carryover": "",
        "extra_locked": WEB_NOTES,
    },
    # ─────────────────────────────────────────────────────────────────────────────────────────────
    {
        "nn": "116",
        "slug": "web-costs",
        "title": "Web: costs and tokens breakdown, with open-weight savings",
        "lane": f"`{W}/costs/**`",
        "wave": "3",
        "convention": "web",
        "budget": "60–120 min",
        "goal": """Starling's pitch is that an open-weight flock does serious work for pennies. The meter in the bottom strip shows two numbers; this panel shows where every token went (role, model, laptop, task) and what the same tokens would cost on a closed frontier model, from a **clearly labelled, editable** price table. The figures must be honest: real data where the events carry it, "not recorded" where they don't.""",
        "deliverables": """1. `costs/derive.ts`: `buildCostBreakdown(state: SkyState): CostModel` = `{ total: { apiUsd, savedUsd, apiTokens: TokenUsage, localTokens: TokenUsage }, byRole: Row[], byModel: Row[], byNode: Row[], byTask: Row[], notes: string[] }`, `Row = { id, label, usage: TokenUsage, usd: number, local: boolean, source: 'events' | 'snapshot' | 'attributed' | 'not-recorded' }`.
2. **Sources (from the real events):** worker usage = `agent.event` with `kind === 'usage'`, `data = { model: { provider, model }, input, output, cached, local }` (validate every field; skip malformed), keyed by `payload.taskKey`, priced with `usageCostUsd(model, usage)` from `@starling/core/browser`. Per task/node: `TaskRun.usage` and `TaskRun.costUsd` (snapshot; preferred when events were truncated), node via `TaskRun.nodeId`. Totals: latest `metrics` (`apiUsage`, `localUsage`, `apiCostUsd`, `estSavedUsd`, `localCallCount`). Auditor: `metrics.localUsage` attributed to the verdict models in `state.verdicts` (fixture: `ollama/qwen3.6:35b-a3b`, local, $0), marked `attributed`. Planner: `plan.model` with usage `not-recorded`. Fixture truths: Σ `TaskRun.costUsd` = `apiCostUsd` = 0.0421956, local saved 0.01854, 9 local calls.
3. **Frontier comparison:** `PriceTable = { id, label, inputPerM, cachedInputPerM, outputPerM }[]` with 2–3 default rows labelled generically ("Closed frontier model (example)", "Mid-tier closed model (example)") and a visible caption: "Example prices, not quotes. Edit them to match your provider's current list price." Editable inline (numeric inputs, validation ≥ 0, reset to defaults), persisted to `localStorage['starling.costs.prices.v1']` with a typed parser and safe fallback. `whatIf(total tokens, row)` shows "this run would have cost $X (N× more)". Never present example prices as facts.
4. **Budget gauge:** budget from an optional `budgetUsd?: number` prop, else `(run as { budgetUsd?: number }).budgetUsd` (Epic 100 may add it), else hidden with "no budget set". Amber at 80%, red at 100%, with text, not just colour.
5. `CostsPanel` (kind `panel`): `Tabs` for Role / Model / Node / Task, each a sorted bar list (tokens split into input/cached/output, USD right-aligned, local rows tagged "local · $0"), the frontier card and the gauge. Fits the panel dock (≈ 22 rem tall) at 1280 wide and scrolls inside. Click a task row → `onSelectTask`.
6. Optional enhancement: `GET /api/runs/:id/costs`, merged per row (see the note below).
7. `index.ts` manifest: id `costs`, kind `panel`, icon `Coins`, hotkey `c`. Playground with the slider.
8. Tests: ≥ 18 derive tests (fixture truths, malformed usage events skipped, truncated events fall back to snapshots, local vs API split, price-table parse/fallback/clamp, what-if math, gauge thresholds) and ≥ 8 component tests (tabs, editing a price updates the what-if, reset, gauge text, empty state).""",
        "oos": """- The bottom-strip meter (Epic 134 owns `features/metrics`; don't edit it, you may import its formatters). Changing core's `PRICING` (Wave 3b). Real provider price lookups (no network).""",
        "dod": [
            "`cd apps/web && bun test src/features/costs` → 0 fail, ≥ 26 new tests",
            "`bunx tsc --noEmit -p apps/web` clean, `bunx biome check apps/web/src/features/costs` clean",
            "A happy-dom test of the fixture shows the API total $0.042, a local auditor row at $0, and the \"Example prices\" caption",
        ],
        "carryover": "",
        "extra_locked": WEB_NOTES + "\n" + INSIGHTS_NOTE,
    },
    # ─────────────────────────────────────────────────────────────────────────────────────────────
    {
        "nn": "117",
        "slug": "web-console",
        "title": "Web: event console (the raw murmuration)",
        "lane": f"`{W}/console/**`",
        "wave": "3",
        "convention": "web",
        "budget": "60–120 min",
        "goal": """Developers (and curious judges) want to see the wire: every `StarlingEvent` as it arrives, filterable and searchable, pausable during a busy burst, copyable as JSONL for a bug report. It must stay smooth with 5,000 events and never fight the user's scroll position.""",
        "deliverables": """1. `console/derive.ts`: `consoleRows(events: readonly StarlingEvent[], runStart?: number): ConsoleRow[]` (`{ index, ts, rel, type, runId, taskKey?, nodeId?, summary, level }`) and `filterRows(rows, filter: ConsoleFilter)` with `ConsoleFilter = { types: Set<string>, taskKey?, nodeId?, query: string }`. `taskKey` from `payload.taskKey` (`task.status`, `agent.event`, `audit.verdict`, `merge.result`, `task.migrated`, `log`). `nodeId` from `payload.node.id`, `payload.nodeId`, `payload.run.nodeId`, `toNode`. One-line `summary` per type (e.g. `task.status theme running → auditing @hub`, `agent.event usage 12.4k in / 1.8k out`, `audit.verdict theme #1 FAIL`). Unknown types (`run.status`, a future `task.diff`) render generically, never throw.
2. Search matches the summary and the JSON (`JSON.stringify` cached per event in a `WeakMap`), case-insensitive. Type chips show counts. Task and node `<select>`s list only values present.
3. Windowing: fixed row height, a ~30-line `computeWindow` of your own (copy the idea from `features/agents/windowing.ts`, don't import it), so only visible rows + overscan are in the DOM.
4. **Follow vs pause:** auto-scroll to the newest while at the bottom; scrolling up or pressing Pause freezes the list on a snapshot and shows a "N new events, resume" pill. The selection survives filtering.
5. Row expand: click/Enter shows pretty JSON (`<pre>`, monospace, wraps) with "Copy event"; a task key in a row is a button → `onSelectTask`.
6. **Copy as JSONL** of the *filtered* rows (`navigator.clipboard.writeText`, textarea fallback, both guarded) with a toast-free inline "Copied 42 events" confirmation. A footer notes "showing the active run + flock events, last 5,000" (import `EVENT_CAP`).
7. `ConsolePanel` (kind `panel`): toolbar (search input, type chips, task/node selects, pause/resume, copy, clear filters), the list, monospace timestamps as `T+m:ss.S` with an absolute-time tooltip. Keyboard: `/` focuses search while the panel has focus, ↑/↓ moves the selection, Enter expands, Esc collapses (then lets the shell close the panel).
8. `index.ts` manifest: id `console`, kind `panel`, icon `SquareTerminal`, hotkey `` ` ``. Playground with the slider and a "burst" button that appends 2,000 synthetic `log` events to test windowing.
9. Tests: ≥ 16 derive tests (summary per known type, unknown type, key extraction, filters combined, search over JSON) and ≥ 10 component tests (windowed DOM count < 100 at 5,000 rows, pause freezes and the pill counts, copy writes the filtered JSONL, expand, select task).""",
        "oos": """- Persisting or exporting whole runs (Epic 123 owns export). Server log endpoints. Changing the event caps (Epic 204).""",
        "dod": [
            "`cd apps/web && bun test src/features/console` → 0 fail, ≥ 26 new tests",
            "`bunx tsc --noEmit -p apps/web` clean, `bunx biome check apps/web/src/features/console` clean",
            "A happy-dom test with 5,000 events renders fewer than 100 row elements and copies exactly the filtered events as JSONL",
        ],
        "carryover": "",
        "extra_locked": WEB_NOTES,
    },
    # ─────────────────────────────────────────────────────────────────────────────────────────────
    {
        "nn": "118",
        "slug": "web-settings",
        "title": "Web: settings drawer (typed, persisted, safe)",
        "lane": f"`{W}/settings/**`",
        "wave": "3",
        "convention": "web",
        "budget": "60–120 min",
        "goal": """Demo day needs a few knobs without touching code: theme, motion, sound, demo speed, density, which server to talk to, and the access token Epic 110 is adding. One drawer, one typed schema, persisted locally, and impossible to brick: a corrupted `localStorage` must fall back to defaults, never a blank dashboard.""",
        "deliverables": """1. `settings/schema.ts`: `StarlingSettings = { version: 1, theme: 'dark' | 'light' | 'system', motion: 'system' | 'reduced' | 'full', sound: boolean, demoSpeed: 1 | 4 | 16, density: 'comfortable' | 'compact', serverUrl: string, token: string }`, `DEFAULT_SETTINGS`, `parseSettings(raw: unknown): StarlingSettings` (hand-written guards, no zod in `apps/web`; field-by-field fallback so one bad field doesn't reset the rest), `SETTINGS_STORAGE_KEY = 'starling.settings.v1'`.
2. `settings/storage.ts`: `readSettings(storage?)`, `writeSettings(next, storage?)`, both try/catch-guarded (private mode, quota). **Interop with existing keys:** theme also reads/writes `lib/theme` (`readTheme`/`writeTheme`/`applyTheme`, key `starling.theme`), sound reads/writes `features/sky`'s `readSoundEnabled`/`writeSoundEnabled` (key `starling.sky.sound`), demo speed validates with `lib/speed` `isDemoSpeed`, so the settings work with today's shell before C3.
3. `settings/apply.ts`: `applySettings(settings, doc = document)` sets `data-theme` (resolving `system` via `prefers-color-scheme`), `data-motion="reduced|full"` (absent for `system`) and `data-density` on `<html>`. Epic 112 adds the CSS for `data-motion`/`data-density` in parallel; until then the attributes are harmless.
4. `useSettings()`: hook returning `[settings, update(patch)]`, syncs across tabs via the `storage` event.
5. **Server URL:** accept '' (same origin) or an absolute `http(s)://` URL with no path tricks (`new URL` parse, reject `javascript:`/`data:`/credentials in the URL), shown with a "Test" button calling `${serverUrl}/api/health` through an optional `fetchImpl` prop (2 s timeout; shows ok/failed, never throws).
6. **Token:** masked input with show/hide, "stored only in this browser" note, Clear button, never logged or rendered in plain text by default. Export `authHeaders(settings): Record<string, string>` (`{ 'x-flock-token': token }` when set, per SEC-01's header) for C3 and Epic 204 to use.
7. `SettingsDrawer` (kind `overlay`): right-side drawer (`role="dialog"`, `aria-modal`, labelled), focus moves in on open and returns on close, Tab is trapped, Esc → `onClose`. Grouped sections: Appearance (theme, density), Motion & sound, Demo (speed), Connection (server URL, token). "Reset to defaults" with a confirm. Changes apply immediately and call an optional `onSettingsChange?(next)` prop (C3 wires it to the shell's theme/speed state).
8. `index.ts` manifest: id `settings`, kind `overlay`, icon `Settings`, hotkey `,`. Export the schema, storage, apply and `authHeaders` helpers. Playground showing the drawer over a sample background with a live JSON view of the stored value.
9. Tests: ≥ 20 schema/storage tests (defaults, each field's fallback, corrupted JSON, wrong version, throwing storage, legacy theme/sound keys honoured, URL validation table incl. hostile values) and ≥ 10 component tests (focus trap, Esc, theme change applies `data-theme`, token masked by default, reset, health test ok/failed with a fake fetch).""",
        "oos": """- Editing `lib/theme.ts`, `app/*` or the data layer to *consume* the settings (C3 / Epic 112 / Epic 204). Sending the token on requests (Epic 204). Server-side auth (Epic 110).""",
        "dod": [
            "`cd apps/web && bun test src/features/settings` → 0 fail, ≥ 30 new tests",
            "`bunx tsc --noEmit -p apps/web` clean, `bunx biome check apps/web/src/features/settings` clean",
            "A test writes `{\"version\":1,\"theme\":\"neon\",\"sound\":\"yes\"}` to storage and `readSettings()` returns defaults for those two fields and keeps the rest",
        ],
        "carryover": """- **SEC-01 (69, web half):** provide token storage and `authHeaders()`. Attaching it to `fetch`/SSE is in `apps/web/src/data` (Wave 3b, Epic 204): say so in the handback.""",
        "extra_locked": WEB_NOTES,
    },
    # ─────────────────────────────────────────────────────────────────────────────────────────────
    {
        "nn": "119",
        "slug": "web-tour",
        "title": "Web: guided tour for judges",
        "lane": f"`{W}/tour/**`",
        "wave": "3",
        "convention": "web",
        "budget": "60–120 min",
        "goal": """A judge walks up to the laptop mid-demo. In under a minute a spotlight tour should explain the Sky, the flight plan, the flock, an agent's transcript, the landing strip and the cost meter, using the real UI in demo mode. It must never get stuck: a missing anchor, a resized window or a collapsed region degrades to a centred card.""",
        "deliverables": """1. `tour/steps.ts`: `TOUR_STEPS: readonly TourStep[]` (7 steps), `TourStep = { id, title, body, anchor?: string /* CSS selector */, placement: 'top' | 'bottom' | 'left' | 'right' | 'center', action?: 'select-first-running-task' }`. Anchors use **existing** hooks only: `[data-region="sky"]`, `[role="tablist"][aria-label="Centre view"]` (Sky/DAG tabs), `[data-region="flock"]`, `[data-region="drawer"]`, `[data-region="queue"]`, `[data-region="metrics"]`, plus Epic 112's new `[data-shell="views-menu"]` as an optional anchor with a centred fallback. Copy is short, friendly and specific to Starling (lanes, audits, merge queue, local vs API cost).
2. `tour/geometry.ts`: `spotlightRect(el, padding, viewport)` and `placeCard(target, card, viewport, placement)` (pure; flips when it would overflow; clamps inside the viewport with a 12 px margin; `center` when there's no target).
3. The drawer step calls `onSelectTask(key)` with the first task whose status is `running|auditing|fixing`, else the first task (from `activeRunOf(state)`), so the drawer is open when the spotlight arrives. If there are no tasks, it falls back to a centred card.
4. `Tour` (kind `overlay`): a dimmed backdrop with an SVG mask cut-out around the anchor, a card with step x/7, Back / Next / Skip, and Finish on the last step. Keys while open: →/Enter next, ← back, Esc skip (calls `onClose`). Focus is trapped in the card, `role="dialog"` with `aria-live="polite"` step text. Re-measures on resize/scroll (`ResizeObserver` guarded) and when the anchor appears late. Reduced motion: no spotlight animation.
5. **Persistence:** `localStorage['starling.tour.v1'] = { seen: true, at }` on finish/skip (guarded). Export `shouldAutoStartTour(search: string, storage?): boolean` (true on `?tour=1`, or first visit in demo mode when `?demo=1`; false when seen). C3 uses it for the shell's `defaultOpen`. "Restart tour" is just opening the overlay again (palette/menu).
6. `index.ts` manifest: id `tour`, kind `overlay`, icon `Compass`, hotkey undefined. Export `TOUR_STEPS`, `shouldAutoStartTour`.
7. Playground: renders a mock of the shell's six `data-region` boxes plus the tablist so every step has a real anchor, a toggle that removes two anchors to show the fallback, and the fixture state for the drawer step.
8. Tests: ≥ 12 geometry/steps tests (placement flips, clamping, center fallback, anchors listed exist in the playground mock, `shouldAutoStartTour` table) and ≥ 10 component tests (next/back/skip/finish, keyboard, Esc calls `onClose`, focus trap, missing anchor → centred card, drawer step calls `onSelectTask` with a running task, storage written on finish).""",
        "oos": """- Adding anchors or attributes to the shell or other features (ask Epic 112/C3 in the handback if one is missing). Auto-starting the tour from the shell (C3). Video/GIF recording.""",
        "dod": [
            "`cd apps/web && bun test src/features/tour` → 0 fail, ≥ 22 new tests",
            "`bunx tsc --noEmit -p apps/web` clean, `bunx biome check apps/web/src/features/tour` clean",
            "A happy-dom test walks all 7 steps with the keyboard over the playground mock and ends with `starling.tour.v1` written",
        ],
        "carryover": "",
        "extra_locked": WEB_NOTES,
    },
    # ─────────────────────────────────────────────────────────────────────────────────────────────
    {
        "nn": "120",
        "slug": "web-palette",
        "title": "Web: command palette (Cmd-K)",
        "lane": f"`{W}/palette/**`",
        "wave": "3",
        "convention": "web",
        "budget": "60–120 min",
        "goal": """With fifteen new features, the fastest way around the dashboard is one key: ⌘K/Ctrl-K, type three letters, Enter. The palette searches commands, features (from the manifests the shell hands it), the active run's tasks and all runs, remembers recent picks, and is fully keyboard-driven and screen-reader friendly.""",
        "deliverables": """1. `palette/fuzzy.ts`: `fuzzyScore(query, text): { score: number; ranges: [number, number][] } | undefined` (case-insensitive subsequence match, bonuses for word starts, consecutive runs and prefix; deterministic tie-break by label) and `rankItems(query, items, limit = 50)`.
2. `palette/items.ts`: `PaletteItem = { id, group: 'recent' | 'commands' | 'features' | 'tasks' | 'runs', label, hint?, keywords?: string[], hotkey?, run(): void }`. Builders: `taskItems(state, onSelectTask)` from `activeRunOf(state)?.plan?.tasks` (label = title, hint = key + `statusLabel(TaskRun.status)`), `runItems(state, onSelectRun)` from `sortedRuns(state)` (goal text, status), `featureItems(features, onOpenFeature)`.
3. **Extra optional props** (C3 passes them through the shell's `props(shell)` hook): `features?: readonly PaletteFeature[]` where `PaletteFeature = { id, title, description, kind, icon, hotkey? }` (a structural subset of the L39 manifest, so manifests can be passed directly), `onOpenFeature?(id: string): void`, `commands?: readonly PaletteCommand[]` (`{ id, label, hint?, hotkey?, run() }`, e.g. toggle theme, switch view, demo speed). Without them the palette still offers tasks and runs.
4. **Recent:** last 8 picked item ids in `localStorage['starling.palette.recent.v1']` (guarded), shown first when the query is empty; stale ids are dropped silently.
5. `CommandPalette` (kind `overlay`): centred dialog, input with the ARIA combobox pattern (`role="combobox"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`), grouped `role="listbox"` results with group headings, highlighted match ranges, hotkey hints via `Kbd`, an empty-result message. Keys: ↑/↓ (wrap), Home/End, Enter runs the item then calls `onClose`, Esc closes, Tab doesn't escape the dialog. Opening focuses the input; closing restores focus. Max 50 results, no lag at 500 tasks.
6. Icons: map `PaletteFeature.icon` names to a few local lucide imports with a fallback (don't `import *`).
7. `index.ts` manifest: id `palette`, kind `overlay`, icon `Command`, hotkey `mod+k`. Export `fuzzyScore`, `rankItems`, item builders and types.
8. Playground with the fixture state, a fake list of the 15 Wave 3 feature manifests (ids/titles/hotkeys from L39) and a log of what was picked.
9. Tests: ≥ 16 fuzzy/items tests (scoring order, ranges, ties, empty query, tasks/runs builders, recent persistence and pruning) and ≥ 10 component tests (combobox ARIA attributes, arrow wrap, Enter runs and closes, Esc, recent first, features group present only when passed, 500-item render).""",
        "oos": """- Binding ⌘K globally (the shell does it from your manifest). Opening features itself (it calls `onOpenFeature`). Editing other features to add commands.""",
        "dod": [
            "`cd apps/web && bun test src/features/palette` → 0 fail, ≥ 26 new tests",
            "`bunx tsc --noEmit -p apps/web` clean, `bunx biome check apps/web/src/features/palette` clean",
            "A test types \"csv\" over the fixture state and the top result is the `csv-export` task; Enter calls `onSelectTask('csv-export')` then `onClose`",
        ],
        "carryover": "",
        "extra_locked": WEB_NOTES,
    },
    # ─────────────────────────────────────────────────────────────────────────────────────────────
    {
        "nn": "121",
        "slug": "web-toasts",
        "title": "Web: toasts and notifications",
        "lane": f"`{W}/toasts/**`",
        "wave": "3",
        "convention": "web",
        "budget": "60–120 min",
        "goal": """The dashboard should tap you on the shoulder when something important happens: a task landed, an audit failed, a laptop joined or dropped out, the budget is running hot, the run finished. Toasts are derived from the event stream, deduplicated, stack calmly in a corner, are announced to screen readers, and can optionally become desktop notifications when the tab is hidden.""",
        "deliverables": """1. `toasts/derive.ts`: `toastsFromEvents(events: readonly StarlingEvent[], ctx: { nodes, run?, budgetUsd? }): ToastSpec[]`, `ToastSpec = { id /* stable dedupe key */, kind: 'merged' | 'audit-failed' | 'conflict' | 'node-joined' | 'node-left' | 'migrated' | 'budget' | 'run-finished' | 'error', tone: BadgeTone, title, body?, taskKey?, ts }`. Mapping from real events: `merge.result` `merged` → merged (`{taskKey} landed`), `conflict`/`tests-failed` → conflict; `audit.verdict` `pass: false` → audit-failed (first failing check name); `node.joined`/`node.left` (`reason`) with names from `ctx.nodes`; `task.migrated`; `log` with level `error`; `run.finished` (uses `payload.summary`); budget at 80% and 100% of `budgetUsd` from the latest `metrics` `apiCostUsd`. Dedupe key = `type:runId:taskKey:attempt-or-status`.
2. `toasts/cursor.ts`: `newEventsSince(prev: Cursor | undefined, events): { fresh: StarlingEvent[]; cursor: Cursor }`. Must be correct when `state.events` is re-filtered by a run switch (`setActiveRun`) or sliced at `EVENT_CAP`: track the last seen event by `(ts, type, runId)` plus a count, never by array index alone. **First mount and run switches don't replay history** (no toast storm when a demo loops or a backlog arrives): only events after the first observed state toast.
3. `toasts/queue.ts`: pure reducer for the visible stack: max 4 visible, newest on top, merge repeats ("3 tasks landed" within 4 s collapse into one), auto-dismiss after 6 s (errors and budget stay until dismissed), pause timers on hover/focus. Timers through an injectable `{ setTimeout, clearTimeout }` for tests.
4. `ToastHost` (kind `overlay`, meant for the shell's `mount: 'always'`): bottom-right stack (above the strip, below modals), each toast with icon, title, optional body, a "Show" action → `onSelectTask(taskKey)` when it has one, and a close button. `role="status"` + `aria-live="polite"` region (errors `assertive`), reduced-motion respected.
5. **Desktop notifications (opt-in):** a small bell toggle in the stack header; asks `Notification.requestPermission()` only on click, stores the opt-in in `localStorage['starling.toasts.desktop.v1']`, only notifies when `document.visibilityState === 'hidden'` and only for run-finished, audit-failed, node-left and budget. Fully guarded when `Notification` is undefined.
6. Optional props: `budgetUsd?: number`, `timers?`, `muted?: boolean`.
7. `index.ts` manifest: id `toasts`, kind `overlay`, icon `Bell`, hotkey undefined. Note in the handback: C3 registers it with `{ mount: 'always' }`.
8. Playground: replays the fixture over ~20 s with buttons for 1×/4×/16×, so all toast kinds appear (the Air joining and dropping, theme's failed audit, seven landings collapsing, the run finishing).
9. Tests: ≥ 18 derive/cursor/queue tests (each kind from fixture events, dedupe, no history replay on mount, run switch, cap slicing, collapse, auto-dismiss with fake timers, sticky errors) and ≥ 8 component tests (aria-live roles, Show selects task, close, desktop opt-in with a fake `Notification`, hidden-tab rule).""",
        "oos": """- Sound (the Sky owns cues). Server push or a service worker. Changing the store to emit notifications (you derive from `state.events`).""",
        "dod": [
            "`cd apps/web && bun test src/features/toasts` → 0 fail, ≥ 26 new tests",
            "`bunx tsc --noEmit -p apps/web` clean, `bunx biome check apps/web/src/features/toasts` clean",
            "A test feeds the whole fixture after mount and sees exactly one audit-failed toast (theme), a collapsed landings toast and a run-finished toast; mounting on the finished state shows none",
        ],
        "carryover": "",
        "extra_locked": WEB_NOTES,
    },
    # ─────────────────────────────────────────────────────────────────────────────────────────────
    {
        "nn": "122",
        "slug": "web-compare",
        "title": "Web: compare two runs",
        "lane": f"`{W}/compare/**`",
        "wave": "3",
        "convention": "web",
        "budget": "60–120 min",
        "goal": """"We re-ran it with two laptops and it got 40% faster" is a great demo line if you can show it. The compare page (`?page=compare&a=<runId>&b=<runId>`) puts two runs side by side: duration, cost, tasks, parallelism, failures and fix attempts, with a task-level plan diff. With only one run available (demo mode) it still works by comparing against a clearly labelled "one agent, one at a time" baseline derived from the same run.""",
        "deliverables": """1. `compare/derive.ts`: `runStats(run: Run, now: number): RunStats` = `{ id, goal, status, wallMs, serialMs, speedup, tasks, merged, failed, attempts, apiCostUsd, savedUsd, tokens, peakParallel, nodes: string[] }` from the **`Run` snapshot only** (`state.runs` holds every run, but `state.events` only has the active run's): peak parallelism from the `[startedAt, finishedAt]` intervals of `run.tasks`, attempts from `TaskRun.attempts`, cost from `run.metrics`. Reuse `summarizeRun` from `../launch` where it fits.
2. `compareStats(a, b): CompareRow[]` (`{ metric, a, b, delta, better: 'a' | 'b' | 'same', format }`), with "better" direction per metric (lower wall/cost/failures, higher merged/speedup).
3. `diffPlanTasks(a?: Plan, b?: Plan): PlanDiff` = `{ added: TaskSpec[], removed: TaskSpec[], changed: { key, fields: ('title' | 'lane.owns' | 'lane.reads' | 'dependsOn' | 'estimateMin' | 'deliverables')[] }[], same: string[] }` matched by task key. Local implementation (Epic 107 is adding `diffPlans` to the planner package; don't import it).
4. `serialBaseline(run: Run): Run`: a synthetic run with the same tasks laid end to end (`serialMs` from task flight times plus overhead, same cost), `id: '<id>:serial'`, labelled everywhere as "estimated baseline: one agent, one task at a time". Fixture truth: wall 5m 56s vs baseline ≈ 8m 31s.
5. `ComparePage` (kind `page`): two run pickers (`sortedRuns`, defaulting to `?a=`/`?b=` parsed locally from `location.search`, then active run vs the previous run, then active run vs its serial baseline), a metric table with delta chips (▲/▼ plus text, not colour only), a paired horizontal bar chart (wall, cost, peak parallel), per-node task counts, and the plan diff (added/removed/changed with the changed fields). Updating a picker calls `history.replaceState` to keep `?a=&b=` shareable. Clicking a run name → `onSelectRun`.
6. Optional enhancement: `GET /api/compare?a=&b=` (see the note below), e.g. for runs whose snapshots lack task timings.
7. Empty/edge states: no runs, same run picked twice, a run still flying ("live, numbers will move"), plans missing.
8. `index.ts` manifest: id `compare`, kind `page`, icon `GitCompareArrows`, hotkey `x`. Playground: the fixture run vs a second run made in `compare/test-fixtures.ts` (same events with a new run id, one task removed, one lane changed, costs scaled), plus the serial-baseline mode.
9. Tests: ≥ 18 derive tests (fixture stats, peak from intervals = 4, deltas and better-direction, plan diff added/removed/changed fields, serial baseline math and labelling, missing timings) and ≥ 8 component tests (pickers, URL sync via a stubbed `history`, baseline label visible, diff rendered, select run).""",
        "oos": """- Server-side comparison (Epic 111). Storing runs (the store/server own that). The single-run report (Epic 113).""",
        "dod": [
            "`cd apps/web && bun test src/features/compare` → 0 fail, ≥ 26 new tests",
            "`bunx tsc --noEmit -p apps/web` clean, `bunx biome check apps/web/src/features/compare` clean",
            "A happy-dom test with only the fixture run shows the run vs its \"estimated baseline\" with speedup ≈ 1.44×",
        ],
        "carryover": "",
        "extra_locked": WEB_NOTES + "\n" + INSIGHTS_NOTE,
    },
    # ─────────────────────────────────────────────────────────────────────────────────────────────
    {
        "nn": "123",
        "slug": "web-export",
        "title": "Web: export and share card",
        "lane": f"`{W}/export/**`",
        "wave": "3",
        "convention": "web",
        "budget": "60–120 min",
        "goal": """After the demo, people want to take the run with them: the raw JSONL to replay it, a Markdown summary to paste in a README or Slack, and a good-looking PNG "murmuration card" (stats + a mini sky) to post. One small dialog, three buttons, deterministic output.""",
        "deliverables": """1. `export/jsonl.ts`: `runToJsonl(state: SkyState): { text: string; count: number; truncated: boolean }`: the active run's `state.events` plus `'*'` events, one JSON object per line, in order, and `truncated` when `state.events.length === EVENT_CAP` or the first event isn't `run.created`. The dialog says so honestly ("last 5,000 events; use `starling replay` on the server recording for the full log").
2. `export/markdown.ts`: `runToMarkdown(state, now): string`: title (goal), status line, a table (tasks landed/failed, wall time, API spend, saved by local, local calls, nodes), per-task table (key, title, status, node, attempts, cost), notable audit failures from `state.verdicts`, and the `run.finished` `payload.summary` when present. Deterministic (no `Date.now()` inside; `now` is passed). Snapshot-tested against the fixture.
3. `export/card.ts`: `drawMurmurationCard(ctx: CanvasLike, model: CardModel, size = { w: 1200, h: 630 })` where `CanvasLike` is the subset of `CanvasRenderingContext2D` you use (so tests can pass a recording fake). `CardModel` from `cardModel(state)`: goal (ellipsised), big numbers (tasks landed, wall time, API cost, "N laptops"), and a **mini sky**: birds as small chevrons placed by a seeded PRNG (seed = run id) whose density follows task statuses (landed birds settle on a wire at the bottom). Colours from the dusk palette (hard-code the hex values from `lib/tokens.pcss`, canvas can't read CSS vars), a "Starling · open-weight murmuration" footer.
4. Download helpers: `downloadText(name, text, mime)` and `downloadCanvas(name, canvas)` via `Blob` + `URL.createObjectURL` + a temporary `<a download>` (revoke after), and `copyText(text)` (clipboard API with textarea fallback). All guarded when the APIs are missing (happy-dom has no 2D canvas: the card preview falls back to a text summary there). File names: `starling-<runId8>.jsonl|md|png`.
5. `ExportDialog` (kind `overlay`): modal with a live card preview (`<canvas>` scaled to fit), buttons "Download JSONL", "Copy Markdown", "Download Markdown", "Download PNG", and a status line ("Copied", "Saved"). Focus trap, Esc → `onClose`, disabled states when there's no run.
6. `index.ts` manifest: id `export`, kind `overlay`, icon `Share2`, hotkey `e`. Playground with the fixture at the end and mid-run.
7. Tests: ≥ 16 pure tests (JSONL round-trips through `parseJsonl` from `../../data/demo`, truncated flag, Markdown snapshot, card model numbers, PRNG determinism: same run id → same bird positions, recording-ctx draw calls include the stats text) and ≥ 8 component tests (buttons call the helpers with the right names/MIME types using spies, copy confirmation, no-run state, Esc).""",
        "oos": """- Server-side export or sharing links (no uploads, no network). Rendering the real Sky canvas (Epic 130 owns it; draw your own mini sky). The report page (Epic 113).""",
        "dod": [
            "`cd apps/web && bun test src/features/export` → 0 fail, ≥ 24 new tests",
            "`bunx tsc --noEmit -p apps/web` clean, `bunx biome check apps/web/src/features/export` clean",
            "Paste the fixture's Markdown export in the handback, and a test proves the exported JSONL re-parses into the same number of events",
        ],
        "carryover": "",
        "extra_locked": WEB_NOTES,
    },
    # ─────────────────────────────────────────────────────────────────────────────────────────────
    {
        "nn": "124",
        "slug": "web-scrubber",
        "title": "Web: replay scrubber",
        "lane": f"`{W}/scrubber/**`",
        "wave": "3",
        "convention": "web",
        "budget": "60–120 min",
        "goal": """In demo mode the presenter needs to jump to the interesting moment ("watch what happens when I close the Air's lid") instead of waiting. The scrubber is a timeline strip with play/pause, speed, a draggable head, and markers for merges, failures and node events. The store can't seek yet (Epic 204 adds that after Epic 40 merges), so the scrubber emits seek requests via props and C3 wires them. Until then it still works as a preview.""",
        "deliverables": """1. `scrubber/markers.ts`: `buildMarkers(events: readonly StarlingEvent[]): Marker[]`, `Marker = { index, ts, kind: 'merge' | 'fail' | 'conflict' | 'node-join' | 'node-leave' | 'migrate' | 'plan' | 'finish', label }`. Sources: `merge.result` (`merged` vs `conflict`/`tests-failed`), `audit.verdict` with `pass: false`, `task.status` to `failed`, `node.joined`/`node.left`, `task.migrated`, `plan.created`, `run.finished`. Plus `nextMarker(markers, index, dir)`, and `indexAtTime(events, ts)` / `timeAtIndex` (binary search; positions are proportional to **time**, not index, so the Air's quiet minute looks like a gap).
2. **Props** (all optional beyond `FeatureProps`): `events?: readonly StarlingEvent[]` (defaults to `state.events`), `index?: number` (current head; defaults to the end), `playing?: boolean`, `speed?: DemoSpeed` (from `lib/speed`), `onSeek?(index: number): void`, `onPlayPause?(playing: boolean): void`, `onSpeedChange?(speed: DemoSpeed): void`. **Controlled** when `onSeek` is given; otherwise **preview mode**: the scrubber keeps a local head and shows a preview card computed with `applyEvents(createInitialState(), events.slice(0, i + 1))` (memoised by index; tasks landed/flying, cost, last event summary), clearly labelled "preview: the live view keeps playing".
3. `Scrubber` (kind `panel`): play/pause button, speed `Tabs` (1×/4×/16×), a track with markers (icons + colours from status tokens, tooltips), an elapsed/total label (`T+1:35 / 5:56`), and the head. The head is `role="slider"` with `aria-valuemin/max/now` and `aria-valuetext` ("1:35, theme failed audit"). Keys when focused: ←/→ one event, Shift+←/→ previous/next marker, PageUp/PageDown ±10 s, Home/End, Space play/pause. Pointer drag with pointer capture; dragging emits throttled `onSeek` (≤ 1 per animation frame) and a final one on release.
4. Marker legend + filter chips (merges, failures, nodes), a "jump to next failure" button.
5. Reduced motion: the head moves without easing. Works with 5,000 events (markers clustered when closer than 4 px).
6. `index.ts` manifest: id `scrubber`, kind `panel`, icon `Rewind`, hotkey `.`. Document in the handback the C3 wiring (`props: (shell) => ({ events: demoEvents(), onSeek, ... })`) and the store API Epic 204 must add (`seek(index)` that resets and re-applies `events.slice(0, index + 1)` and repositions the demo player).
7. Playground: a **fully working** controlled example: it owns `index`/`playing`/`speed` state, re-derives a `SkyState` from the fixture at `index` and renders a small summary next to the scrubber, so seeking is real there.
8. Tests: ≥ 14 pure tests (fixture markers: 7 merges, theme's failed audit, Air join/leave, the migration, plan, finish; time/index mapping; next/prev marker; clustering) and ≥ 12 component tests (slider ARIA, each key, drag emits throttled seeks with fake rAF, preview mode label and numbers at an index, controlled mode calls `onSeek` and doesn't move on its own, speed change).""",
        "oos": """- Editing the store or demo player to seek (Epic 204, Wave 3b). Editing `app/` (C3). The Gantt (Epic 114).""",
        "dod": [
            "`cd apps/web && bun test src/features/scrubber` → 0 fail, ≥ 26 new tests",
            "`bunx tsc --noEmit -p apps/web` clean, `bunx biome check apps/web/src/features/scrubber` clean",
            "A test presses Shift+→ from the start until the theme audit failure marker and asserts `onSeek` received that event's index",
        ],
        "carryover": "",
        "extra_locked": WEB_NOTES,
    },
    # ─────────────────────────────────────────────────────────────────────────────────────────────
    {
        "nn": "125",
        "slug": "web-heatmap",
        "title": "Web: file churn heatmap",
        "lane": f"`{W}/heatmap/**`",
        "wave": "3",
        "convention": "web",
        "budget": "60–120 min",
        "goal": """Where did the flock actually work, and where was it risky? The heatmap shows every file the agents touched, sized by churn (lines added + removed) and coloured by risk: conflicts, lane violations and fix attempts. It answers "what changed" (the lanes map, Epic 115, answers "who was allowed to change it").""",
        "deliverables": """1. `heatmap/derive.ts`: `buildChurn(state: SkyState): ChurnFile[]`, `ChurnFile = { path, dir, added, removed, churn, tasks: string[], edits: number, fixAttempts: number, conflict: boolean, violation: boolean, risk: number }`. Sources: `state.agentLog[key]` events with `kind === 'file.edited'` (`data.path/added/removed`, validated), `state.diffs[diffKey(runId, key)]?.files` when present (wins over summed edits for that task), any structurally detected `task.diff` event in `state.events` (Epic 100 may add it), `merge.result.conflictedFiles` (`status: 'conflict'`), `verdict.laneViolations`, and `TaskRun.attempts` / failed verdict count per task spread over that task's files. Only the active run's task keys.
2. `riskScore(file)`: documented, monotonic formula (e.g. conflict +3, violation +2, +1 per fix attempt, +1 when ≥ 2 tasks touched it), clamped 0–5, with a legend explaining it.
3. `groupByDir(files, depth)` for the directory roll-up, and `layoutGrid(files, width)`: a pure packed-tile layout (tile area ∝ `sqrt(churn)` so small files stay visible; deterministic order by dir then churn).
4. `HeatmapView` (kind `view`): tiles grouped under directory headings, area = churn, fill = risk on a sequential scale built from tokens (calm teal → amber → red), text label + churn number on big tiles, an icon for conflict/violation (not colour alone). Hover: path, +added/−removed, tasks, attempts. Click → `onSelectTask(first task)`; `state.selectedTask` highlights its files. Toggle "Group by directory / Flat" and a sort selector (churn, risk, name).
5. Accessible table mode with the same data (sortable columns); tiles are focusable with roving tabindex inside the view.
6. Fixture truth: 8 files, `help/index.ts` the biggest (+112), `theme/index.ts` + `theme/index.test.ts` carry theme's fix attempt, 0 conflicts. Summary strip: "8 files · +599 −29 · 1 fix attempt · 0 conflicts".
7. `index.ts` manifest: id `heatmap`, kind `view`, icon `Flame`, hotkey `h`. Playground with the slider and a "spicy" toggle that injects a hand-made conflict + lane violation (in `heatmap/test-fixtures.ts`).
8. Tests: ≥ 16 derive/layout tests (fixture totals, diff overrides edits, malformed `file.edited` skipped, conflict/violation flags, risk formula table, foreign-run task keys ignored, layout determinism) and ≥ 8 component tests (tile count, click selects, selected highlight, table mode, sort, empty state "no files touched yet").""",
        "oos": """- Lane ownership and the treemap of lanes (Epic 115). Fetching diffs (the shell fetches the selected task's diff; you only read `state.diffs`). Editing `data/`.""",
        "dod": [
            "`cd apps/web && bun test src/features/heatmap` → 0 fail, ≥ 24 new tests",
            "`bunx tsc --noEmit -p apps/web` clean, `bunx biome check apps/web/src/features/heatmap` clean",
            "A happy-dom test of the fixture end state finds the summary \"8 files · +599 −29\"",
        ],
        "carryover": "",
        "extra_locked": WEB_NOTES,
    },
    # ─────────────────────────────────────────────────────────────────────────────────────────────
    {
        "nn": "126",
        "slug": "web-leaderboard",
        "title": "Web: flock leaderboard",
        "lane": f"`{W}/leaderboard/**`",
        "wave": "3",
        "convention": "web",
        "budget": "60–120 min",
        "goal": """A bit of fun for the audience: who is the fastest bird, the hungriest, the cleanest, the most stubborn, and which laptop is the busiest perch? Small cards with tiny generated bird avatars and ranks that slide when they change during a live run. Playful copy, honest numbers.""",
        "deliverables": """1. `leaderboard/derive.ts`: `buildBoards(state: SkyState): Board[]`, `Board = { id, title, blurb, unit, entries: { key, label, value, display, nodeId? }[] }` (top 5 each, stable tie-break by key). Boards and sources: **Fastest bird** = min `finishedAt − startedAt` over merged `TaskRun`s; **Hungriest** = max `usage.input + usage.output` (`cached` is a subset of `input`); **Cleanest audit** = passed on attempt 1 with every `checks[].ok` (from `state.verdicts`), ranked by fastest audit (`Σ checks[].durationMs` when present, else verdict `ts − task start`); **Most stubborn** = most fix attempts (`TaskRun.attempts`, then failed verdicts); **Busiest perch** = node with most tasks (`TaskRun.nodeId`, names via `state.nodes`, counting migrations in via `task.migrated`); **Thriftiest** = lowest `costUsd` per merged task. Only the active run's tasks. Boards with no data are hidden.
2. Fixture truths: fastest = `dates-fix` (33.4 s), busiest perch = `MacBook Pro` (hub, 5 tasks at the end), most stubborn = `theme` (1 fix).
3. `leaderboard/avatar.ts`: `birdAvatar(seed: string): AvatarSpec` (deterministic hue/pattern/eye from a string hash) + `BirdAvatar` SVG component (16–24 px, a simple starling silhouette with iridescent speckles), `aria-hidden` with the label next to it.
4. `leaderboard/rank-diff.ts`: `rankChanges(prev: Board[], next: Board[]): Map<string, number>` (moved up/down) driving a FLIP slide animation (measure, then transform with `--ease-flock`), and a small ▲/▼ badge for 2 s. Off when reduced motion is preferred.
5. `Leaderboard` (kind `panel`): responsive grid of board cards (fits the dock height at 1280 wide; horizontal scroll inside the panel if needed, never on the page), each with rank, avatar, label, value, and a one-line blurb ("landed in 33 s, a personal best for the flock"). Clicking an entry → `onSelectTask(key)` (or nothing for node entries). A "crown" for #1 using `Crown`/`Trophy` icons.
6. `index.ts` manifest: id `leaderboard`, kind `panel`, icon `Trophy`, hotkey `L` (capital, i.e. Shift+L; `l` is the lanes map). Playground with the slider so ranks visibly change mid-run.
7. Tests: ≥ 16 derive/avatar/rank tests (fixture truths, ties, missing timings, hidden empty boards, avatar determinism, rank diff) and ≥ 8 component tests (cards rendered, click selects task, rank badge appears after a state change, reduced motion disables the transform, empty state).""",
        "oos": """- Anything that ranks *people* or real users. Persisting high scores across runs. The flock panel (Epic 135) and Sky (Epic 130).""",
        "dod": [
            "`cd apps/web && bun test src/features/leaderboard` → 0 fail, ≥ 24 new tests",
            "`bunx tsc --noEmit -p apps/web` clean, `bunx biome check apps/web/src/features/leaderboard` clean",
            "A happy-dom test of the fixture end state shows `dates-fix` first on \"Fastest bird\" and \"MacBook Pro\" first on \"Busiest perch\"",
        ],
        "carryover": "",
        "extra_locked": WEB_NOTES,
    },
]
