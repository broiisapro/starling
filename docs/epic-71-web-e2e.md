# Epic 71 — Browser end-to-end tests (Playwright)

**Branch** `epic/71-web-e2e` · **Issue** #86 · **Lane** `apps/web/e2e/**`,
`apps/web/playwright.config.ts`, `@playwright/test` in `apps/web/package.json`

## Goal

Wave 1 and C1 made the dashboard real, and the demo is the thing the project is judged on: a live
murmuration of agents landing seven tasks in six minutes. A unit test cannot tell you that the
dashboard boots, that the canvas paints, that a click lands on the bird you aimed at, or that the
projector layout has no horizontal scrollbar. This epic locks those guarantees in with real Chromium:
twelve tests over the recorded launch-day run, at both stage sizes, with committed visual baselines.

## How it works

The suite lives in `apps/web/e2e`, driven by `apps/web/playwright.config.ts`, and runs with
`bun run --cwd apps/web e2e` (≈ 1.5–2 min). Playwright starts the Vite dev server itself; the demo
needs no Starling server, no API key, no network and no local models.

| File              | What it guarantees                                                                              |
| ----------------- | ----------------------------------------------------------------------------------------------- |
| `shell.pw.ts`     | boots in demo mode with **no console errors or page errors**; top bar, flock, sky, queue, metrics and strip all render with no `RegionPlaceholder`; `1`/`2` switch Sky↔DAG, `b` folds the strip, `f` folds the flock rail, `?` opens the shortcut card and `Esc` closes it |
| `replay.pw.ts`    | the real 16× replay reaches `run.finished`: 7 of 7 on the wire, 7 merged / 0 failed, two roosts (the Air dropped and rejoined), a frozen elapsed clock, real API spend (`$0.04`), `$0.00` local and 9 local calls |
| `sky.pw.ts`       | hovering a bird names it in the tooltip; clicking it opens **that task's** drawer (key, title, `merged` status); `Esc` closes it; a queue card opens the same drawer and re-selecting swaps the contents |
| `motion.pw.ts`    | the canvas is genuinely moving, then `prefers-reduced-motion: reduce` parks it: two pixel samples 500 ms apart are identical, the map is not blank, and every panel reports `data-reduced-motion`/`data-animated="false"` |
| `visual.pw.ts`    | at 1280×720 and 1920×1080, at the end of the replay: no page-level horizontal overflow, and a committed `toHaveScreenshot` baseline of the whole dashboard |

`support.ts` is the shared harness and the only place that knows *how* to reach a state:

- **`openReplay` / `waitForEndState`** play the fixture for real at 16× (`?demo=1&speed=16`). The end
  marker is the run picker reading `finished`, not "7 of 7 on the wire": the wire fills at ~265 s of
  run time, but the fixture keeps publishing metrics until `run.finished` at 356 s. The helper then
  reads the elapsed clock twice, 700 ms apart, to prove the player has stopped advancing.
- **`openEndState`** injects the whole fixture into the store in one shot so the other ten tests do
  not each pay 22 s of playback. It loads `?demo=0` (the live branch: no player timers rewriting the
  store), holds `/api/events` open so the EventSource never flaps between `live` and `offline`, then
  calls `reset()`, `setConnection('demo')` and `ingestMany(rebaseEvents(demoEvents(), Date.now()))`
  through the dev-only `window.__STARLING_SKY__` handle. Same reducer, same rebasing, same end state —
  only the waiting is skipped.
- **`wirePerchPoints` / `hoverBird`** make canvas clicks deterministic. At the end of the run every
  flock is `merged`, which parks it on its wire slot instead of flying, so a point computed with the
  Sky's own `makeWire`/`wireSlotX` is within the 54 px hit radius even mid-frame. The tooltip then
  names the task under the cursor, so the test never assumes a slot→task mapping.
- **`watchConsole`** collects `console.error` and `pageerror` for the tests that assert silence.

Snapshots are stored in `apps/web/e2e/__screenshots__/end-{width}x{height}.png` (169 KB and 269 KB).

## Key decisions & reasoning

- **Dev server, not `vite preview`.** Both are allowed by the issue. The dev server is what a
  developer's screen and the stage laptop actually run, needs no build step, and keeps the
  `import.meta.env.DEV` handles (`__STARLING_SKY__`, the sky's FPS counter) available. Trade-off: the
  production bundle is not exercised; deferred to CI wiring.
- **`*.pw.ts`, not `*.spec.ts`.** Bun's runner discovers `*.spec.*`/`*.test.*`, so a Playwright spec
  would have been executed by `bun run test` inside happy-dom and failed the whole repo. The custom
  `testMatch` keeps the two runners disjoint by construction.
- **The dev-server port is derived from the working directory**, and `reuseExistingServer` is off.
  The first run on a hardcoded `4173` attached to *another worktree's* dev server (another agent's
  landing page) and every test failed with an honest but confusing "no queue". Deriving the port from
  the worktree path also keeps concurrent agents from stepping on each other; `STARLING_E2E_PORT`
  overrides it.
- **Failure artifacts go to the OS temp dir.** Vite watches `apps/web`, and Playwright writes trace
  data *during* a run; with `outputDir` inside the project, Vite reloaded the page under a live test
  (observed in the log). Traces now land in `$TMPDIR/starling-web-e2e/<port>`, so nothing generated can
  be committed and nothing reloads mid-test.
- **One worker, `fullyParallel: false`.** Two tabs on one laptop fight for frames and would make the
  16× timing assertions and the canvas samples flaky. Serial is still under two minutes.
- **Hydration for everything except the replay.** Ten tests at 22 s each would be a four-minute suite
  that people stop running. The real player is still covered by `replay.pw.ts` and by both visual
  snapshots; the rest test the render, not the clock.
- **Reduced motion is measured in pixels.** The Sky exposes no pause hook (see FIX REQUESTS), so the
  test samples the real canvas twice and requires the pixels to be identical, having first proved
  they change while the sim is running. That is stronger than asserting a class name: it fails if the
  calm layout is animated by accident.
- **Snapshot tolerance.** `threshold: 0.25` + `maxDiffPixelRatio: 0.01`: fonts fall back to the
  platform stack (Inter is not bundled), so a little anti-aliasing drift must not fail the build,
  while any real layout shift (a missing panel, a wrapped header, a bigger card) moves far more than
  1 % of the pixels. `animations: 'disabled'` and `caret: 'hide'` remove the remaining nondeterminism;
  the canvas is masked because boids are the one thing that is *supposed* to move.

## Interfaces for future epics

- **Reusable helpers** (`e2e/support.ts`): `openReplay`, `openEndState`, `waitForEndState`,
  `watchConsole`, `horizontalOverflow`, `wirePerchPoints`, `hoverBird`, `taskTitle`, plus `LAPTOP`,
  `PROJECTOR`, `TASK_COUNT`. Epic 42/43/52 can build browser journeys on top of these instead of
  re-deriving how to reach the end state.
- **DOM contract this suite depends on** (renaming any of these breaks the suite):
  `data-region="flock|sky|strip|queue|metrics"`, `data-view="sky|dag"` + `data-active`,
  `data-testid`: `sky-view`, `flock-panel` (+ `data-node-count`, `flock-summary`), `roost-card`
  (+ `data-animated`), `metrics-panel` (+ `data-reduced-motion`), `metrics-merged`,
  `metrics-elapsed`, `queue-landed`, `cost-api|cost-local|cost-saved`, `agent-drawer`,
  `drawer-status`, `keyboard-help`, `dag-canvas`, `task-node-*`; `data-starling-queue`,
  `data-starling-card` + `data-column`, `data-column-section`.
- **The `?demo=` route and `__STARLING_SKY__` are load-bearing**: `?demo=1` (player), `?demo=0`
  (live branch) and `?speed=16`, plus the dev-only store handle. Keep them.
- **Fixture-driven expectations**: the suite hardcodes only `TASK_COUNT = 7`. If the launch-day
  fixture is re-recorded with a different number of tasks, `support.ts` is the one place to change.

## Deviations from plan

- The issue suggested pausing canvas animation "via a test hook". None exists, so the canvas is
  masked in the snapshots (as the issue allows) and the calm-sky check reads pixels instead. A hook is
  filed as a FIX REQUEST to Epic 47.
- Added `e2e:update` (`playwright test --update-snapshots`) and `e2e/README.md` (install + run +
  snapshot policy) beyond the deliverables, because the browser install is a manual step.
- `@playwright/test@1.61.0` was added to `apps/web` devDependencies (allowed, add-only); Chromium was
  already present in `~/Library/Caches/ms-playwright`, so `bunx playwright install chromium` was a
  no-op on this machine and is documented in `e2e/README.md` for a clean one.
- The e2e directory is **not typechecked** by `bun run check`: `apps/web/tsconfig.json` includes only
  `src/**` and `vite.config.ts`, and that file is outside this lane. Biome does lint and format it.
  Filed to Epic 52.

## Known limitations / deferred

- **Baselines are darwin-only.** The commit contains the macOS rendering: dark theme, system font
  stack, device scale 1. A Linux CI runner will need its own snapshot directory (or a pinned,
  bundled font) — FIX REQUEST to Epic 52.
- **Chromium only.** Firefox/WebKit would triple runtime and are not what the stage uses.
- **Production build not covered.** `vite preview` of `dist/` may behave differently (no dev handles,
  minified React); a smoke run of the preview build belongs in CI.
- **The Sky is masked in the visual baselines**, so a drawing regression inside the canvas is only
  caught by the pixel-sampling tests (moving vs calm, not blank), not by a snapshot diff.
- **No light-theme snapshot** and no `?playground=` route coverage.
- **At 1280×720 the queue board scrolls horizontally** and the "On the wire" column is clipped at the
  right edge: the seven wire cards exist (asserted in the DOM) but only one is visible on a 720p
  projector. That is the shell/queue layout, not this lane — FIX REQUEST below.
- Real Starling runs (server, SSE, live flock) are out of scope; Epic 42/43 cover those against a
  mock server.

## FIX REQUESTS

| Epic | File | Change | Why |
| ---- | ---- | ------ | --- |
| 47 | `features/sky/SkyView.tsx` | Export a test hook (e.g. `data-testid="sky-tooltip"` on the hover card and a `window.__STARLING_SKY_FREEZE__` / `data-paused` switch that stops the rAF sim without reduced motion) | Lets the snapshots drop the canvas mask and lets a click test target a named bird deterministically instead of computing wire geometry |
| 52 | `.github/workflows/…`, `apps/web/tsconfig.json` | Add a CI job: `bun install`, `bunx playwright install --with-deps chromium`, `bun run --cwd apps/web e2e`, upload `trace/` on failure; add `e2e/**/*.ts` + `playwright.config.ts` to the web tsconfig `include`; per-platform snapshot dirs | The suite is opt-in today and its TypeScript is unlinted by `tsc` |
| 23 / 26 | `app/Layout.tsx`, `features/queue/MergeQueue.tsx` | At ≤1280×720 the merge queue needs a compact presentation (fewer columns, or wire-first) so "7 on the wire" is visible on a 720p projector | The suite proves the cards exist but a stage viewer at 720p sees one of them |
