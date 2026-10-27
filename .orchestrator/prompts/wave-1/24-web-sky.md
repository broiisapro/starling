# Epic 24: Web: The Sky murmuration

**Wave 1 · Branch `epic/24-web-sky` · Issue: find it with `gh issue list --search "Epic 24 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 60–120 min of autonomous work**

## Where you are
Starling (`.orchestrator/PRD.md`) is an open-source, open-weight-first harness. It turns one coding goal into a lane-safe task DAG, runs a flock of opencode agents in parallel git worktrees (on this laptop and on other laptops, "perches"), audits each result with tests, a lane check and a local model, and merges everything through a queue, all shown live in a murmuration dashboard.

**Wave 0 is merged** (tags `epic-00-complete`, `epic-01-complete`):
- `@starling/core`: every contract (zod-first), every port, the event bus, config, `exec`, globs (`matchesAny`, `globsOverlap`, `lanesDisjoint`), pricing/metrics, and **`@starling/core/testing`**, which has a mock for every port plus factories (`makePlan`, `makeRun`, `makeTaskSpec`, `makeNodeInfo`, `makeAgentEvent`, …). **Read `docs/epic-00-foundation.md` first.** Its "Interfaces for future epics" section lists every exported symbol.
- `fixtures/`: `repomaps/sky-todo.json`, `plans/sky-todo-launch-day.json`, `runs/sky-todo-launch-day.jsonl` (252 realistic events including flock events).
- `examples/sky-todo/`: the demo app Starling will operate on. `examples/scripts/make-demo-repo.sh` makes a fresh git repo of it.

**You are one of 23 agents building Wave 1 at the same time**, each in its own lane. Your siblings' packages are still placeholders while you work. **Never import a sibling Wave 1 package.** Depend only on `@starling/core` and its mocks. Where you meet a sibling, use the **handshake interfaces in ARCHITECTURE §8**, mirrored locally in `src/handshake.ts`, copied verbatim with the header comment the section specifies.

## Tech decisions already locked (build on these, don't relitigate)
ARCHITECTURE §7 **L1–L25**. Especially:
- **L21**: Bun 1.4.4, TS 5.9.3, zod 4.6.7, Biome 2.6.3; never touch root config.
- **L22**: add deps only to your own package.json, pinned exact.
- **L23**: **NO local models, no real LLM calls, no real opencode prompts, no GitHub calls from tests, no `ollama` commands at all.** Use the core mocks and in-process `Bun.serve({ port: 0 })` fakes. You may write `*.live.test.ts` files but do not run them. This laptop runs 20+ agents at once, so keep memory use low: no long-running servers left behind, no huge test fixtures.
- **L13/L14**: git and gh go through `exec` from core, injectable so tests can fake it.

## FIRST TASK: carryover
None. This is a Wave 1 epic built directly on Wave 0. (Stated explicitly so it's clear carryover was considered.)

## Your lane (you may write ONLY here)
`apps/web/src/features/sky/**` (you may also add a dependency line to `apps/web/package.json`, add-only, but prefer none).
plus `docs/epic-24-web-sky.md` and `.orchestrator/handbacks/24-web-sky.md`. Read anything; write nothing else.

## Goal
Build **the Sky**: the visual that makes judges lean in. A live murmuration on a canvas where every task is a bird-flock, every machine is a roost, and `main` is a telephone wire birds land on when their work merges. It's driven purely by props (`SkyViewProps`, ARCHITECTURE §8), so it works with live data, the replay, or the fixture.

## Deliverables
- `export function SkyView(props: SkyViewProps)` from `features/sky/index.ts` (mirror §8 in `features/sky/handshake.ts`).
- **Simulation** (`sim.ts`, pure, no DOM, a seeded RNG, deterministic given inputs and dt): a boids model (separation/alignment/cohesion plus goal attraction). Each task is a **flock of ~12 birds** around a leader, so 7 tasks ≈ 84 birds; support up to 30 tasks / 360 birds at 60 fps. Each node is a **roost**: a branch silhouette at the bottom-left for the hub and bottom-right for the perches, evenly spaced, labelled with the node name. **The wire** spans the top third: a catenary curve labelled `main`.
- **State → behaviour** (`behaviour.ts`, a table you document):
  - `pending`: perched on its node's roost, still, slight bob.
  - `ready`: hopping.
  - `running`: flying a wide murmuration loop above its roost; speed and spread scale with recent agent activity (count of `agent.event`s in the last 10 s from `recent`).
  - `auditing`: tight circle, amber tint.
  - `fixing`: agitated zig-zag, coral tint.
  - `merging`: glides to the wire.
  - `merged`: perched on the wire in merge order, gentle sway.
  - `failed`: falls slowly and greys out.
  - `conflict`: two-flock flicker.
  - `cancelled`: fades.
  - **Migration** (`task.migrated` in `recent`, or a `nodeId` change): the flock flies from one roost's sky to the other's in a long arc, with a fading trail.
  - **Node joined**: a new roost grows in with a soft glow. **Node left**: its roost dims and its birds scatter.
- **Rendering** (`render.ts`, Canvas 2D): devicePixelRatio aware, resize observer, bird glyphs as tiny chevrons with an iridescent sheen, a soft motion trail (alpha fade), the dusk gradient background drawn once to an offscreen canvas, and labels (task key) on hover. Uses the status colours from `src/lib/status.ts` once that lands at C1; until then, define a local fallback palette constant with the same keys.
- **Interaction**: click hit-tests the nearest flock leader → `onSelectTask(key)`; the selected flock gets a halo; hover shows a tooltip (title, status, node, attempts).
- **Accessibility**: `reducedMotion` (or the `prefers-reduced-motion` media query) switches to a calm static layout (birds placed in their state zones, no flocking). The canvas has an aria-label and an offscreen live region describing counts by state.
- Performance: one rAF loop, pausing when the tab is hidden. No per-frame allocations in the hot loop (pre-allocated Float32Arrays). Measure: log an fps estimate in dev mode.
- `features/sky/Playground.tsx`: a dev page component that drives `SkyView` from the fixture JSONL with a scrubber (no global store), for development and the demo backup.
- Tests: sim determinism (same seed and inputs → same positions after N steps); behaviour mapping for every status; migration targets the new roost; hit-testing; reduced-motion layout; performance budget (360 birds × 600 steps of `sim.step` in < 250 ms in bun).

## Explicitly out of scope
The global store and layout (Epic 23). Other panels. Three.js/WebGL (L11: Canvas 2D only). Sound (Wave 2).

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree.
2. `bun test apps/web/src/features/sky` passes, ≥ 15 tests.
3. Record a short description in your doc of what the Playground looks like at t=0, mid-run and the end of the fixture (and if you can, a PNG via Playwright screenshot committed under `features/sky/__screens__/`, ≤ 300 KB each).
4. `bun run test` at the repo root passes, all packages' tests and not just yours. Paste the summary line.
5. `bun run check` passes (Biome + typecheck for every workspace).
6. `docs/epic-24-web-sky.md` (sections per AGENTS.md §6; **"Interfaces for future epics"** must show exact exported signatures and a usage snippet) and `.orchestrator/handbacks/24-web-sky.md` written. PR opened per AGENTS.md §6 with `Closes #<issue>`; print the PR URL last.

## Git
Branch `epic/24-web-sky`. Conventional Commits scoped to your lane (`feat(sky): …`, `test(sky): …`, `docs(epic-24): …`), committed small and often: at least 6 commits that tell the story. `git fetch origin && git rebase origin/main` before pushing. No merging, no tags.
