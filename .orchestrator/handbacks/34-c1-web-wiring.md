## Epic 34 Handback — C1-b: wire the dashboard together

**Status:** Complete. Branch `epic/34-c1-web-wiring` @ HEAD (docs commit follows). No GitHub issue (checkpoint epic, as instructed).

**Delivered:**

- **One status palette.** `src/lib/status.ts` is now the only place a status colour lives: it gained
  `statusChip()`, `statusSurface()`, `taskTone()`, `NODE_STATUS_COLORS`, `HUB_BADGE` and
  `PERCH_BADGE`. The Sky (`statusColor`), DAG (`STATUS_META`), queue (`STATUS_STYLE`), flock
  (`STATUS_PALETTE`, `taskTone`) and the drawer's status pill are derivations of it; every local
  fallback palette is gone.
- **Node names, not ids.** `src/data/selectors.ts` exports `displayTasks(state, tasks)` and hands
  `dagProps`/`drawerProps`/`queueProps` a memoised display copy whose `TaskRun.nodeId` is
  `NodeInfo.name`. The store is untouched; unknown nodes keep their id; the Sky (roost lookup) and the
  flock panel (per-roost grouping) keep real ids. Prop **types** are unchanged.
- **Additive props compiled both ways.** `FlockExtras` (`compact`, `reducedMotion`, `now`,
  `onSelectTask`) and `MetricsExtras` (`live`) are declared as intersections with the frozen §8
  types, so `apps/web` compiles before **and** after Epic 33 adds `FlockPanelProps.onSelectTask`
  and `MetricsPanelProps.live`. `flockProps`/`metricsProps` take them as an optional third/second
  argument, so the wiring reads as a spread.
- **Drawer reads the optional audit fields.** `AuditCheck.durationMs` already worked; `AuditVerdict.dod`
  is now feature-detected (`agents/spec.ts`): each plan DoD item is matched to the auditor's own
  judgement (exact or substring), unmatched items fall back to the old all-or-nothing rule, per-item
  evidence renders under the item and the summary line reads "N of M items met". `ok` is accepted as
  a synonym for `met`.
- **Every region wired** in `src/app/Layout.tsx`: `SkyView`, `DagView`, `AgentDrawer` (mounted only
  while `selectedTask` is set), `FlockPanel`, `MergeQueue`, `MetricsPanel`, each fed by its selector
  and wrapped in a `components/ErrorBoundary` whose fallback is the (rewritten) `RegionPlaceholder`.
  `ResetKey` clears a caught error on run/selection change.
- **Projector layout**: Sky/DAG toggle in the top bar + keys `1`/`2`; collapsible bottom strip
  (chevron or `b`) with a one-line summary when collapsed; collapsible flock rail (`f`); `?` opens a
  shortcut card listing all bindings; shortcuts are ignored in text fields/`<select>`/contenteditable
  and with modifiers held; global `prefers-reduced-motion` CSS backstop plus `reducedMotion` props to
  the Sky and flock panels. The right column exists only while a task is selected, so the sky owns
  the centre when idle.
- **Flock rail adapts to the screen** (`src/lib/viewport.ts`: `useMediaQuery`, `useWideFlock`): at
  1180×800 and up it hosts Epic 32's full roost cards (hardware, session meter, lent model, the join
  card and **clickable task chips**); on a 720p laptop it falls back to the compact roost row, which
  fits both machines without scrolling. Two child-selector utilities force one column and let the
  roost name wrap — the panel's grid uses viewport breakpoints, not container ones.
- **`?playground=sky|dag|agents|queue|metrics|flock`** renders that feature's `Playground.tsx` full
  screen, bypassing the shell's data layer. `sky`/`flock` get `demoEvents()` directly (work in
  production builds); the other four are lazy chunks.
- **Demo smoke test** (`src/app/demo-smoke.test.tsx`) drives the full 252-event fixture through the
  real store (`ingestMany`, plus an `ingest` fold in a second test), renders the real `Layout` and
  asserts: all six panels mount with zero error fallbacks; the Sky receives 7 tasks and 2 nodes
  ("MacBook Pro", "MacBook Air"); 7 cards are in the queue's wire column; the meter shows `$0.03` API
  and 9 local calls; clicking the `csv-export` card opens the drawer, highlights the DAG node and
  lists its verdict history (audit tab count + verdict cards); closing it restores the sky.
- **Demo clocks rebased** (`data/demo.ts`: `rebaseEvents`, `DemoOptions.rebaseTo`): playback shifts
  envelope + payload clocks to the replay's start, once per loop, so elapsed/"last seen" read in
  seconds instead of "9d". Durations and sample spacing are preserved exactly.
- **No runtime `@starling/core` imports in feature browser code**: `dag/run-jsonl`,
  `queue/Playground` and `metrics/Playground` use the new dependency-free `src/lib/events.ts`
  (`isStarlingEvent`, `parseEventLines`), covered by `lib/events.test.ts`.
- **Build hygiene**: `main.tsx` imports `@xyflow/react/dist/style.css` (without it the DAG's edges
  were invisible) and `index.css` repaints React Flow's light controls/attribution with dusk tokens
  (unlayered, because React Flow's CSS is unlayered).
- **Tests**: `apps/web` goes from 397 → 426 tests (+29): a rewritten 13-test `Layout.test.tsx`, the
  2-test demo smoke, 3 `ErrorBoundary` cases, 4 `lib/events` cases, 3 `lib/viewport` cases, 2
  status-palette cases, 2 drawer DoD cases, 3 demo-rebase cases (plus the two bootstrap assertions
  updated for rebasing).

**Key design decisions:**

- **`opacity-0` + `inert`, never `hidden`, for the inactive centre view.** `display: none` gave
  React Flow a zero-sized container: its fit-to-view computed a pixel-sized graph the first time `2`
  was pressed (caught in the browser pass). Keeping both views mounted also preserves the Sky's
  flocks and makes switching instant. Cost: the Sky's rAF loop keeps running behind a hidden DAG —
  flagged for Wave 2 (a `paused` prop).
- **Display-node-names in selectors, not in the components.** Mapping `nodeId → name` where the props
  are built keeps the frozen §8 types intact and keeps the store honest (an id stays an id). Identity
  is cached per `tasks` object + node-name signature so panel memos are not invalidated.
- **`live` is passed only when it is true.** The reducer has no intermediate `run.status` event, so
  passing `live: run.status === 'running'` unconditionally would freeze the meter during every replay.
  `metricsProps(state, running ? { live: true } : {})` keeps today's sample-age inference.
- **Flock cards on a projector, compact rows on a laptop.** Epic 32's card grid is driven by viewport
  media queries, so inside a 16rem rail it tried two columns and its one-row compact strip scrolled
  sideways. The shell picks the mode by screen (`useWideFlock`: ≥1180×800 → cards, else compact) and
  applies two child-selector utilities (one column, wrapping roost name) — no feature edit, and the
  chips are clickable wherever cards are shown.
- **The drawer lives in its region.** Epic 25's drawer is a `fixed` right-edge overlay; the shell
  pins it into its own 22rem region with `[&>aside]:absolute [&>aside]:inset-0 …` so it never covers
  the sky, and only mounts it while a task is selected.
- **Third-party chrome belongs to the shell.** The design system is `src/lib/tokens.pcss` +
  `index.css`, so React Flow's white zoom buttons and attribution chip are themed there (unlayered,
  to beat its unlayered stylesheet) instead of in the feature lane.
- **Rebasing the demo clock** rather than teaching six panels about replay time: one pure helper in
  the data layer fixes every elapsed/"last seen" read for free and is unit-tested (gaps preserved,
  payload clocks shifted, source log never mutated).

**Verification (exact commands + results):**

- `bun install` (worktree root): `Checked 162 installs across 221 packages (no changes) [13.00ms]` — clean.
- `cd apps/web && bun test`: `426 pass / 0 fail — 3527 expect() calls — Ran 426 tests across 39 files. [2.18s]`
- `cd apps/web && bun run build`:
  `dist/assets/index-CXutNLrw.js 867.76 kB │ gzip: 248.17 kB` · `✓ built in 211ms`.
  `grep -ci externaliz` → **0**, `grep -c "node:"` → **0**. The only note is Vite's generic
  "chunks larger than 500 kB" advisory (see limitations).
- `bunx tsc --noEmit -p apps/web/tsconfig.json`: clean (exit 0).
- `bunx biome check apps/web/src apps/web/index.html`: `Checked 171 files … No fixes applied.`
  Same for the doc: `Checked 1 file … No fixes applied.`
- `bun run typecheck` (all 18 workspaces): exit 0, no output.
- `bun run test` (root): **1735 pass / 4 skip / 17 fail**. The 17 failures are the documented C1-a
  cross-workspace pollution (happy-dom's `GlobalRegistrator` replaces the global `fetch`, breaking
  `packages/llm`'s opencode V2 client and `apps/server`'s SSE tests when they share a process with
  `apps/web`); Epic 33's item 1 fixes it by running `apps/web` in its own process. Proof it is not
  this branch: `bun test packages apps/server apps/cli skills integrations tools evals` →
  **1329 pass / 4 skip / 0 fail** (`Ran 1333 tests across 158 files`), i.e. everything but `apps/web`
  is green on its own.
- `bun run check` (root): fails **only** on pre-existing Biome markdown formatting in
  `docs/epic-01-demo-target.md`, `-02-repo-ops.md`, `-15-runner.md`, `-20-engine.md`,
  `-23-web-shell.md`, `-24-web-sky.md` — the exact list Epic 33's item 2 (`markdown.formatter.enabled: false`)
  fixes. No file in this lane is flagged, and the typecheck half passes as shown above.
- **Browser pass (Playwright 1.61 + installed Chromium, dev server `bun run dev`, `?demo=1&speed=16`)**
  at **1280×720** and **1920×1080**: after the replay finishes the page reports
  `events: 252, status: finished, tasks: 7, nodes: 2, wire: 7, apiCost: "$0.03", localCalls: 9,
  placeholders: 0, overflowX: 0, overflowY: 0`, `dagEdges: 2` (the fixture's plan really has two
  dependencies), the drawer opens on the `csv-export` card, and the console reports **no errors and
  no warnings** at both sizes. Layout: 1280×720 → sky 992×456, flock 256×456, strip 1280×192;
  1920×1080 → sky 1632×816. **Flock chips verified**: on the 1920 view the roost cards expose
  `csv-export, dates-fix, search, shortcuts, theme, due-badges, help-overlay`; clicking the
  `dates-fix` chip set `selectedTask: "dates-fix"`, opened the drawer (`aria-label` "Task dates-fix
  details", node "MacBook Pro" — the display-name mapping) and set the DAG node's `data-selected` to
  `true`. Screenshots committed:
  `docs/assets/c1-dashboard-1280.png` (216 KB), `-1920.png` (293 KB), `-1280-drawer.png` (234 KB),
  `-1280-dag.png` (237 KB), `-1280-collapsed.png` (180 KB), `-1280-help.png` (151 KB).
- **Playgrounds**: all six `?playground=<name>` routes render their own page with content and zero
  console errors (checked in Chromium); no shell chrome leaks through.
- **Reduced motion** (`reducedMotion: 'reduce'` in Chromium): `matchMedia(...).matches === true`,
  metrics/queue report `data-reduced-motion="true"`, a strip transition computes to `1e-05s`, no page
  errors, zero placeholders.
- **Keys**: `b` then `f` collapse the strip (`Landing strip · 7/7 landed · 7 on the wire · $0.031 API ·
  9 local calls · SHOW (B)`) and the flock rail (`skyWidth: 1196`); `?` opens/closes the shortcut card.

**Dependencies added:** none (no `package.json` change anywhere).

**CONTRACT REQUESTS:**

1. **`TaskRun.nodeName?: string`** (or `AgentDrawerProps`/`DagViewProps`/`MergeQueueProps` receiving
   `nodes: NodeInfo[]`). Why: three panels render `nodeId` as a human label, so C1 resolves ids to
   names in the selectors — a display concern leaking into prop building. A `nodeName` field lets the
   engine publish both and the UI stop renaming.
2. **`MergeQueueProps.selectedTask?: string`.** Why: the assignment asks that a selection be
   highlighted in every view; queue cards cannot highlight without this field (Sky and DAG can).
3. **`SkyViewProps.paused?: boolean`** (or an `active`/`visible` signal). Why: the shell keeps both
   centre views mounted (needed for React Flow's measurements and instant switching), so the Sky's
   rAF loop currently runs while the DAG is on screen.
4. **Adopt `@starling/core/browser`** here in Wave 2 (Epic 33 creates it): switch `src/lib/events.ts`
   callers and `data/demo.ts`/`data/sse.ts` to it, then delete the `node:fs`/`node:path` alias in
   `vite.config.ts` and `src/lib/browser-stubs.ts`. That also removes zod + yaml + the config loader
   from the initial bundle.

**Deliberately deferred / out of scope:**

- Real backend wiring (launch form, cancel/abort, diff fetch, `POST /api/replay`) — Wave 2, Epic 41.
- Sound, stats page, GitHub mode toggle, perch join UI.
- Route-level code splitting / a lazy DAG chunk (the initial bundle is 866 kB, 248 kB gzip).
- Pausing the Sky's rAF while the DAG is displayed, and queue column-level virtualisation.
- A committed Playwright suite: the browser pass above is manual, scripted per run, and recorded here.
- Any `packages/**`, root config, `apps/server`, `apps/cli` or `handshake.ts` change (Epic 33).

**Open questions / flagged tradeoffs:**

- **Flock chips only exist where cards are shown.** At 1920×1080 (the demo projector) the rail hosts
  the full roost cards and the chips open the drawer; on a 720p laptop it drops to the compact row,
  which has counts, not chips. If the demo is ever run on a 720p machine and the chips matter, the
  fix is a flock drawer (Wave 2) rather than a wider rail.
- **`run.status` never leaves `mapping`/`finished`.** The run picker keeps saying `mapping` until the
  end of a run (E23 finding). The dashboard's live signal is `landed/total` + the meter; one reducer
  case fixes it when the engine publishes transitions.
- **The queue board scrolls the strip** when a card below the fold is clicked (native
  scroll-into-view). E26's board is a six-column scroller by design; column-level scrolling is its
  call, not the shell's.
