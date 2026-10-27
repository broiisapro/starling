## Epic 71 Handback — Browser end-to-end tests (Playwright)

**Status:** Complete. Branch `epic/71-web-e2e` @ `083d3dd` (docs + this handback on top).
**Issue:** #86.

**Delivered:**
- `apps/web/playwright.config.ts` — Chromium project against the real Vite dev server, `testMatch: '**/*.pw.ts'` (so Bun's runner never picks the suite up), one worker, per-worktree port, artifacts in `$TMPDIR/starling-web-e2e/<port>`, snapshot template `e2e/__screenshots__/{arg}{ext}`, screenshot policy `animations: 'disabled'`, `caret: 'hide'`, `threshold: 0.25`, `maxDiffPixelRatio: 0.01`.
- `apps/web/e2e/support.ts` — harness: `openReplay`, `waitForEndState` (waits for `run.finished`, then proves the elapsed clock is frozen), `openEndState` (fixture hydrated into the store for the ten fast tests), `watchConsole`, `horizontalOverflow`, `wirePerchPoints`/`hoverBird` (deterministic canvas clicks), `taskTitle`, `LAPTOP`/`PROJECTOR`/`TASK_COUNT`.
- `apps/web/e2e/shell.pw.ts` (5 tests) — boots in demo mode with zero console/page errors, all five regions + panels render with no `RegionPlaceholder`, 7 DAG nodes, `1`/`2` switch Sky↔DAG, `b` folds the strip, `f` folds the flock rail, `?` opens the shortcut card, `Esc` closes it.
- `apps/web/e2e/replay.pw.ts` (1 test) — the real 16× replay reaches `run.finished`: 7 of 7 on the wire, 7 merged / 0 failed, the `grounded` column clear, two roosts (Air rejoined as `online`), `$0.04` API / `$0.00` local / `$0.02` saved / 9 local calls, no console errors over the whole 22 s.
- `apps/web/e2e/sky.pw.ts` (2 tests) — hovering a merged bird names its task in the tooltip; clicking it opens that task's drawer (aria-label, key, title, `merged`); `Esc` closes; queue card opens/swaps the drawer; ✕ closes it.
- `apps/web/e2e/motion.pw.ts` (2 tests) — canvas pixels change while the sim runs, then become identical under `prefers-reduced-motion: reduce` (and stay non-blank); `data-reduced-motion`/`data-animated="false"` on metrics/queue/roost cards; calm sky's aria summary is `7 tasks: 7 merged · 2 machines`.
- `apps/web/e2e/visual.pw.ts` (2 tests) — end-of-replay snapshot at 1280×720 and 1920×1080 with the boid canvas masked, plus zero page-level horizontal overflow at both sizes.
- Committed baselines: `apps/web/e2e/__screenshots__/end-1280x720.png` (169 KB), `end-1920x1080.png` (269 KB) — both ≤ 300 KB.
- `apps/web/e2e/README.md` (Chromium install, run, snapshot policy) and `e2e` / `e2e:update` scripts in `apps/web/package.json`.

**Key design decisions:**
- Real dev server + `?demo=1&speed=16`, not `vite preview` — that is what a developer and the stage laptop run, no build step, and the demo needs no server, key or network. Production-bundle coverage deferred to CI.
- End state is `run.status === 'finished'` (run picker label), not "7 of 7 on the wire": the wire fills at ~265 s of run time while the fixture publishes metrics until 356 s. The helper additionally reads the elapsed clock twice 700 ms apart to prove the player stopped advancing.
- Ten of twelve tests hydrate the same fixture through `?demo=0` + `__STARLING_SKY__` + `ingestMany(rebaseEvents(demoEvents()))` instead of replaying 22 s each; the real player stays covered by `replay.pw.ts` and both snapshots. `/api/events` is held open so the EventSource never flaps live/offline.
- Bird clicks are geometry + tooltip, not a hardcoded key: merged flocks perch on their wire slots (computed with the Sky's own `makeWire`/`wireSlotX`), the tooltip names the task under the cursor, and the drawer must show that key and its title.
- Reduced motion is verified in pixels (no Sky pause hook exists): moving → static, non-blank, plus the panels' `data-reduced-motion` switch.
- Port derived from the worktree path with `reuseExistingServer: false`. A hardcoded 4173 attached to *another worktree's* dev server on the first run — an obvious lesson with ~23 agents on one laptop.
- Failure artifacts moved to `$TMPDIR`: `outputDir` inside `apps/web` made Vite reload pages mid-test when Playwright wrote trace data.
- `*.pw.ts` naming keeps the suite out of `bun run test` by construction (Bun would otherwise run `*.spec.ts` in happy-dom).
- One worker: two tabs on one laptop fight for frames; serial is still ~2 min.

**Verification (exact commands + results):**
- `bun install`: `Checked 166 installs across 225 packages (no changes)`.
- `bunx playwright install chromium` (in `apps/web`): no download — Chromium 1.61.0 was already in `~/Library/Caches/ms-playwright`; documented in `e2e/README.md` for a clean machine.
- `bun run --cwd apps/web e2e` (after rebase onto `origin/main`): **12 passed (2.0m)**, snapshots compared against the committed baselines with no update.
- `bun run test` (root):
  - packages/apps: `1359 pass`, `4 skip`, `0 fail` — `23 snapshots, 6272 expect() calls` / `Ran 1363 tests across 162 files. [42.47s]`
  - web: `426 pass`, `0 fail` — `3527 expect() calls` / `Ran 426 tests across 39 files. [5.03s]` (no `*.pw.ts` picked up)
- `bun run check`: `Checked 713 files` — no fixes applied; `tsc --noEmit -p` loop completed with no output (clean).
- Manual: read both committed snapshots at the end state — run picker `finished`, `7/7 landed`, `7 of 7 on the wire`, 72 metric samples, elapsed frozen at `5m 55s`, `$0.04` API / `$0.02` saved, both roosts online.

**Dependencies added:** `@playwright/test@1.61.0` (devDependency in `apps/web`, exact pin). `bun.lock` updated by `bun install`; no hand edits.

**CONTRACT REQUESTS:** none.

**FIX REQUESTS:**
1. **Epic 47 (Sky)** — `features/sky/SkyView.tsx`: add `data-testid="sky-tooltip"` on the hover card and a freeze hook (e.g. `data-paused` / `window.__STARLING_SKY_FREEZE__`) that stops the rAF sim without reduced motion. The suite currently masks the canvas in snapshots and computes wire geometry to click a bird; both become exact with a hook.
2. **Epic 52 (CI)** — add a job: `bun install`, `bunx playwright install --with-deps chromium`, `bun run --cwd apps/web e2e`, upload traces on failure; add `e2e/**/*.ts` + `playwright.config.ts` to `apps/web/tsconfig.json` `include` (currently `bun run check` does not typecheck the e2e directory); decide per-platform snapshot dirs (baselines are macOS/font-specific).
3. **Epic 23 / 26 (shell + queue)** — at 1280×720 the merge-queue board scrolls horizontally and clips "On the wire": all seven cards are in the DOM (asserted) but only one is visible on a 720p projector. Consider a compact board (wire-first or fewer columns) at ≤1280.

**Deliberately deferred / out of scope:**
- CI wiring (FIX REQUEST 2), fixing any UI finding (FIX REQUESTS 1 and 3).
- Firefox/WebKit projects, light-theme and `?playground=` coverage, `vite preview` of the production build.
- Snapshotting the Sky canvas itself (masked until Epic 47 lands a hook).
- Live-server / real-flock browser journeys — Epic 42/43 territory.

**Open questions / flagged tradeoffs:**
- The visual baselines are locked to macOS rendering (system font stack, dark theme, DPR 1). If CI runs Linux with a different font, the first CI run will need its own baselines — is that acceptable, or should Epic 52 bundle Inter and pin a font?
- The suite hardcodes only `TASK_COUNT = 7`; a re-recorded fixture with a different plan size needs that one constant (and the keyboard/queue assertions read the same number) — fine as is, flagged for whoever re-records it.
- `openEndState` depends on the dev-only `__STARLING_SKY__` handle and the Vite `/src/data/demo.ts` URL. Both are dev-only by design; if another lane removes the handle, ten tests break loudly rather than silently — worth keeping in mind for Epic 41/55.
- A 720p projector shows one wire card (FIX REQUEST 3). If the stage machine is 720p, is that acceptable for the demo, or does the queue need a compact layout before the demo?

Closes #86
