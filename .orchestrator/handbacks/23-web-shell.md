## Epic 23 Handback — Web shell + data layer

**Status:** Complete. Branch `epic/23-web-shell` @ `530a094` (docs/handback commit follows).

**Delivered:**

- **Dusk-sky design system** in `apps/web/src/index.css` + `apps/web/src/lib/tokens.pcss`: Tailwind v4
  `@theme` palette (navy → violet → amber horizon), iridescent teal/purple/green accents, type scale,
  spacing/radius/shadow tokens, dark default + `data-theme="light"` toggle, focus-visible rings.
- **`STATUS_COLORS`** in `apps/web/src/lib/status.ts`: one palette per `TaskStatus` with canvas
  `hex` plus Tailwind `text` / `bg` / `border` / `dot` classes, `TASK_STATUSES`, `TERMINAL_STATUSES`,
  `statusLabel`, `isTerminalStatus`.
- **Components** in `apps/web/src/components/`: `Panel`, `Badge`, `StatusDot`, `Kbd`, `Tabs`,
  `Tooltip`, `EmptyState`, `Stat`. Keyboard-friendly tabs (←/→/Home/End, roving focus), labelled
  regions, `aria-describedby` tooltips, focus rings.
- **Five-region Layout** (`src/app/Layout.tsx`): top bar (logo, run picker, live/demo/offline badge,
  landed/total, 1×/4×/16× demo speed, theme toggle), centre sky with Sky/Flight-plan tabs, right agent
  drawer, bottom queue + metrics strip, collapsible left flock rail. Every region has a
  `RegionPlaceholder` and the exact `// WIRED AT C1: <SkyView {...skyProps(state)} />` comment.
  Verified at 1280×720 (no horizontal overflow) and 1920×1080.
- **Pure reducer** (`src/data/reducer.ts`): `applyEvent` / `applyEvents` / `createInitialState` /
  `initialState` / `SkyState`, with caps 5,000 events, 500 agent events per task, 100 verdicts per
  task, 500 merges, 2,000 metric samples. Handles every event in `StarlingEvent`, including
  `node.left` (marks offline), rejoin, `task.migrated`, audit history, plan attachment.
- **zustand store** (`src/data/store.ts`): `useSky` with `ingest`, `ingestMany`, `selectTask`,
  `setActiveRun` (re-filters timeline), `setConnection`, `setJoin`, `reset` (keeps mode).
- **Selectors** (`src/data/selectors.ts`): `skyProps`, `dagProps`, `drawerProps`, `queueProps`,
  `metricsProps`, `flockProps`, all typed with the §8 interfaces from `src/data/handshake.ts`
  (verbatim mirror + header comment). C1 wiring is one spread per region.
- **SSE client** (`src/data/sse.ts`): `/api/events` and `/api/runs/:id/events`, exponential backoff
  (1 s → 30 s, ±20 % jitter), `?since=<lastTs>` resume, status callback, injectable EventSource/timers.
- **Demo player** (`src/data/demo.ts` + `bootstrap.ts`): `?raw` fixture import, contract validation,
  original timing / speed, synchronous first event, 3 s pause + loop with store reset, auto-demo when
  `/api/health` fails, `?demo=1` / `?demo=0` overrides, `?speed=` and `?run=` routing.
- **Browser-safe core import**: Vite aliases `node:fs`/`node:path` to `src/lib/browser-stubs.ts` so
  `@starling/core`'s root barrel (StarlingError, schemas) loads in the browser.
- **Tests**: 104 new tests (106 tests across 10 files in `apps/web` including the Wave 0
  `App.test.tsx`), covering reducer over the full 252-event fixture, caps, purity, selectors prop
  shapes (type-level `satisfies` + runtime), SSE reconnect/since/backoff/malformed frames, demo
  timing/loop with fake timers, store actions, layout regions, theme/route formatting, and all
  primitives.

**Key design decisions:**

- **Event-sourced shell with plain props at the feature boundary** — feature epics never touch the
  store; the store only composes the pure reducer. Makes the UI replayable and C1 mechanical.
- **`events` keeps active-run + `runId: '*'` flock events** — node updates share the SSE wire; dropping
  them would starve the Sky/Flock panels. Foreign run events are filtered; `setActiveRun` re-filters.
- **`node.left` marks offline rather than deleting** — keeps perch history and matches the fixture's
  Air drop/rejoin; `node.joined` restores it.
- **Selector defaults call real store actions** — `skyProps(state)` is truly a one-liner at C1, while
  tests inject spies as the optional second argument.
- **Metrics history is the meter's source of truth** — intermediate samples update both history and the
  active run snapshot; avoids a stale `run.metrics` between `run.finished`.
- **`@theme` in `src/lib/tokens.pcss`** — root Biome has Tailwind directives disabled; a `.pcss` file
  is ignored by Biome but processed by Vite/Tailwind. Documented deviation + contract request.
- **Demo mode resets before replay** — a speed change or StrictMode remount must not double-ingest
  `run.created`; final state is exactly 252 events.
- **`App.tsx` left untouched** — it is outside the lane (only `src/main.tsx` is listed); `main.tsx`
  now boots `AppShell`. C1 can remove the old page.

**Verification (exact commands + results):**

- `bun install` (worktree): `Checked 133 installs across 192 packages (no changes) [10.00ms]`.
- `bun test apps/web`: `106 pass / 0 fail`, 658 `expect()` calls, 106 tests across 10 files.
- `cd apps/web && bun run build`: success; `dist/assets/index-DE8C5J0w.js 493.58 kB │ gzip: 128.40 kB`,
  `dist/assets/index-CDC-u7ZW.css 34.73 kB │ gzip: 7.67 kB`, built in 127 ms.
- `bun run test` (root): `291 pass / 0 fail`, 1433 `expect()` calls, 291 tests across 46 files.
- `bun run typecheck` (all workspaces): passes, no output.
- `bunx biome check apps/web`: `Checked 58 files … No fixes applied`, 0 errors.
- `bun run check` (root): **fails only on pre-existing Epic 02 files**, all outside this lane:
  `tools/local-models/host.ts`, `ollama.ts`, `ollama.test.ts`, `smoke.ts`, and two
  `tools/local-models/results/*.json` files (9 Biome format errors). `bun run typecheck`, which is the
  second half of `bun run check`, passes for every workspace. Not fixed: outside lane per AGENTS §1/§4.
- **Demo mode, dev (`http://localhost:5173/?demo=1&speed=16`)** with headless Chromium (Playwright):
  waited for the final state, then `window.__STARLING_SKY__.getState()` reported
  `{events: 252, status: 'finished', landed: 7, metrics: 7, badge: '7/7 landed', nodes: ['hub','air'],
  merges: 7, verdicts: {theme: ['1:false','2:true'], search: ['2:true'], …}}`; run-picker option text
  `… · finished`; no console/page errors. Screenshots: `/tmp/starling-demo-final.png`,
  `/tmp/starling-demo-7of7.png`.
- **Auto-demo without `?demo=1`** (`/?speed=16`, no server on 7777): health probe failed (502) and the
  store reported `connection: 'demo'`, 37 events after 1.2 s, 116 after 5 s.
- **Projector + theme check at 1280×720**: `horizontal_overflow_px: 0`, theme toggle produced
  `data-theme="light"`, Flight-plan tab visible, flock collapse reported `aria-expanded="false"`.
  Screenshots: `/tmp/starling-light-1280.png`, `/tmp/starling-dark-1280-collapsed.png`.
- **Production preview** (`vite preview` on :4173, 1920×1080, `?demo=1&speed=16`): final
  `7/7 landed`, option `… · finished`, zero page errors. Screenshot: `/tmp/starling-prod-1920.png`.

**Dependencies added:** none (used pre-installed React 19, zustand, lucide-react, Tailwind, Vite,
happy-dom, @testing-library/react).

**CONTRACT REQUESTS:**

1. **Root `biome.json`: enable Tailwind CSS syntax** —
   `"css": { "parser": { "tailwindDirectives": true } }` (or allow a package-level config extending
   the root one). Why: Tailwind v4 requires `@theme`/`@utility`; with the current root config those
   directives are parse errors in `.css`, so `bun run check` cannot pass for any epic that owns a
   design-token file. Workaround used: tokens in `apps/web/src/lib/tokens.pcss`.
2. **`@starling/core`: add a browser-safe entry point** (e.g. `"./browser": "./src/browser.ts"`
   exporting contracts/schemas, `StarlingError`, `glob`, `metrics`, `ids`, but not `config`/`exec`),
   or make `config.ts` lazy-load `node:fs`/`node:path`. Why: `@starling/core`'s root barrel imports
   the config loader, so the web bundle pulls `node:fs`/`node:path` and Vite externalises them. The
   shell currently aliases both to `apps/web/src/lib/browser-stubs.ts`; a browser entry would remove
   the shim and roughly 100 KB of zod/yaml/config from the initial bundle.

**Deliberately deferred / out of scope:**

- All feature panels (Sky, DAG, agents, queue, metrics, flock) and the C1 wiring — six sibling lanes
  own `apps/web/src/features/**`; the shell only provides regions, selectors and comments.
- Run-launch form (Wave 2), diff fetching for the drawer, perch join UI, GitHub mode toggle.
- Persisting selected run / demo speed across reloads (theme is persisted).
- A committed Playwright suite; browser verification is manual and recorded above.

**Open questions / flagged tradeoffs:**

- **`run.status` has no intermediate event.** `run.created` carries `mapping` and only
  `run.finished` updates the snapshot, so the picker says `mapping` until the run ends. Task progress
  (`landed/total`) is the live signal. If the engine adds `run.status` transitions, add one reducer
  case; no UI change needed.
- **`node.left` semantics**: marking offline (chosen) versus deleting the node. Deleting loses the
  perch's identity for a late rejoin; the Flock panel probably wants the history.
- **Demo speed control stays enabled in live mode.** Changing it restarts the data layer (with a
  store reset) even when SSE is live. Harmless in practice, but C1/Wave 2 may want to disable it
  unless `connection === 'demo'`.
- **`SkyState.events` includes `runId: '*'` events**, so `SkyViewProps.recent` receives flock events
  too. Documented in the reducer/docs; feature epics should ignore types they don't render.
