## Epic 24 Handback — The Sky murmuration

**Status:** Complete. Branch `epic/24-web-sky` @ HEAD (see PR). Lane: `apps/web/src/features/sky/**`, plus this handback and `docs/epic-24-web-sky.md`.

**Delivered:**
- `export function SkyView(props: SkyViewProps)` from `features/sky/index.ts`, with `features/sky/handshake.ts` as the verbatim §8 mirror. One rAF loop (paused while hidden), DPR + ResizeObserver, pointer hit-test → `onSelectTask`, arrow-key cycling, hover tooltip (title/status/node/attempts), on-canvas key label, selected-flock halo, `aria-live` summary and a focusable canvas.
- Deterministic, DOM-free `SkySimulation` (`sim.ts` + `boids.ts` + `layout.ts` + `calm.ts`): 12 birds per task, cap 30 tasks / 360 birds, seeded RNG, catenary `main` wire, hub roosts bottom-left / perch roosts bottom-right, per-status behaviour table, activity-scaled murmurations, migration arcs via `task.migrated` **and** `nodeId` diffs (deduped, with fading 48-point trail), roost grow-on-join / dim-and-scatter-on-leave, wire slots in merge order, reduced-motion zone layout.
- Canvas renderer (`render.ts`): dusk gradient + deterministic star field painted once offscreen, faded motion-trail layer, iridescent chevrons, branch silhouettes, wire and labels, hover/selected chrome. No per-frame string or object churn in the bird loop.
- Fixture/replay layer (`replay.ts`): `parseEventJsonl`, `buildFrame(events, i)` (pure, backwards-safe), `indexAtTs`, `nextBeat`, `statusCounts`, `describeSky`.
- `Playground.tsx` dev page (fixture/`src`/file input, scrubber, play/pause at 1–8×, beat stepping, reduced-motion toggle) and `preview.html`/`preview.tsx` (bundles the fixture with `?raw`; offline demo backup and screenshot source).
- 41 tests in the lane: determinism, seed divergence, caps/slot reuse, roost/wire geometry, activity, every status → behaviour, still/fall/fade, merge order + glide, migration (event and nodeId), node leave/join, hit-testing, reduced-motion stability + zones, performance budget, replay/reducer, Playground helpers, and DOM rendering/keyboard/click tests.
- 6 committed screenshots in `features/sky/__screens__/` (t=0, mid-run, end, calm, hover, selected), each 53–95 KB.
- `docs/epic-24-web-sky.md` with the required sections, exact exported signatures and a shell usage snippet.

**Key design decisions:**
- **Three layers, one direction:** props → pure sim → renderer. No DOM or timers in the sim, so behaviour and determinism are unit-testable without canvas.
- **Analytic leaders, boid birds.** Closed-form target paths + exponential smoothing for leader choreography; 12 birds do separation/alignment/cohesion. Predictable shapes, cheap integration, exact reproducibility.
- **Static placement for perched/hopping/wire-perched/falling** — still birds stay still (no boid jitter), which also makes reduced motion free.
- **Wire slots claimed at `merging`**, spaced by expected task count (stable positions) and ordered by merge order. Prevents sideways jumps as merges land.
- **Activity** = `agent.event` count in the last 10 s per task, with the wall clock extrapolated between inputs so murmurations calm down without new events.
- **Placeholder hub roost** when the node list is empty (frame 0); the real hub replaces it and grows in.
- **Reduced motion = a layout, not a slowdown.** Calm zones in `calm.ts`; the loop stops stepping and redraws on a dirty flag only. `reducedMotion === true` or `prefers-reduced-motion` both trigger it.
- **Playground is a reducer, not a store.** `buildFrame` rebuilds from event 0; manual scrubs remount `SkyView` so backwards scrubbing resets merge slots and wing state exactly.
- **No zod in the browser.** `@starling/core`'s barrel pulls `config.ts` → `node:fs`, which Vite cannot bundle; `replay.ts` uses a local envelope guard instead (CONTRACT REQUEST below). Every other core import in this lane is `import type`.
- **Accessibility:** wrapper `role="application"` + roledescription + live count label, focusable canvas with an instruction label, visually hidden `aria-live` sentence, DOM tooltip, keyboard selection.

**Verification (exact commands + results):**
- `bun install --frozen-lockfile` (worktree): `Checked 133 installs across 192 packages (no changes) [9.00ms]` — clean.
- `bun test apps/web/src/features/sky`: `41 pass / 0 fail`, `1639 expect() calls`, `Ran 41 tests across 4 files. [~100ms]`.
- `bun run test` (root, all workspaces): `228 pass / 0 fail`, `2427 expect() calls`, `Ran 228 tests across 41 files. [269.00ms]`.
- `bun run check` (root): **fails on the base tree only** — biome reports 10 errors in files this epic never touches: `docs/epic-01-demo-target.md`, `docs/epic-02-repo-ops.md`, `tools/local-models/{host.ts,ollama.ts,ollama.test.ts,smoke.ts,results/*.json}` (format + one organizeImports). Reproduced identically on a pristine `origin/main` worktree with the same biome binary, so it is pre-existing and out of this lane. The lane itself is clean: `bunx biome check apps/web/src/features/sky` → `Checked 17 files. No fixes applied.` (exit 0). `bun run typecheck` (every workspace) → exit 0.
- Performance (measured, `bun`): 30 flocks / 360 birds, 600 × `step(1/60)` in **11.9 ms** (0.020 ms/frame), well inside the 250 ms budget (asserted by the perf test).
- Production build sanity: `bunx vite build` in `apps/web` → `✓ built in 550ms` (1938 modules, 223.52 kB JS / 70.37 kB gzip); `dist/` removed afterwards.
- Screenshots: `apps/web/src/features/sky/__screens__/{sky-t0,sky-mid,sky-end,sky-calm,sky-hover,sky-selected}.png` (53–95 KB each), captured via Playwright (Chromium) against `/src/features/sky/preview.html?t=…`.

**Dependencies added:** none (no `package.json` changes anywhere).

**CONTRACT REQUESTS:**
- **A browser-safe entry point for `@starling/core`.** The root barrel re-exports `config.ts` (which imports `node:fs`) and `exec.ts`, so any runtime value import from `@starling/core` in `apps/web` breaks the Vite client bundle (`Module "node:fs" has been externalized…`). Proposal: add a subpath such as `"@starling/core/browser"` (contracts + events + glob + ids + metrics, no fs) or move `config`/`exec` behind their own subpaths. Until then the Sky validates JSONL envelopes locally, and `apps/web` must only use `import type` from core. This will bite every web epic that needs `StarlingEventSchema` (E21's store, E23's shell).

**Deliberately deferred / out of scope:**
- Global store, layout, routing and other panels (Epic 23).
- Three.js/WebGL and sound (locked out / Wave 2).
- Dedicated resolver animation (no `resolver` TaskStatus in the contract).
- Pixel-diff/screenshot tests (screenshots are documentation; sim tests are the deterministic net).
- Reclaiming merged wire slots on an in-place backwards scrub (Playground remounts instead).
- Wiring the panel into the app shell.

**Open questions / flagged tradeoffs:**
- **Merged flock spacing:** slots are spread by total expected tasks so positions never jump, which leaves gaps at the end of a run. Packing from the left would look tighter but would shuffle every flock on each merge. Current choice favours stability; happy to switch if the demo reads better packed.
- **Migration timing** is a fixed 3.4 s for any distance (consistent demo beat). Distance-proportional timing is a one-line change if reviewers prefer physical fidelity.
- **`sim.ts` size** (~714 lines) exceeds the ~300-line style target; documented as a deviation. Splitting the class further would need shared mutable state plumbing; the pure pieces (boids, calm layout, geometry, choreography inputs) are already separate modules.
