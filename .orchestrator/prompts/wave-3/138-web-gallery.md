# Epic 138: Web: component gallery

**Wave 3 · Branch `epic/138-web-gallery` · Issue: `gh issue list --search "Epic 138 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 90–150 min of autonomous work**

## Where you are
Starling (`.orchestrator/PRD.md`) is an open-source, open-weight-first harness. It turns one coding goal into a lane-safe task DAG, runs a flock of opencode agents in parallel git worktrees on this laptop and on other laptops ("perches"), audits each result, and merges everything through a queue, shown live in a murmuration dashboard.

**Waves 0, 1, C1 and 2 are merged** (tags `epic-NN-complete`). About 2,500 tests pass across every package, the CLI, server, web dashboard, skill, tools and evals. Epic 40 (integration captain) is landing the **real** composition (`starling run` driving real opencode agents) in parallel with you, so for now `apps/cli`, `packages/core`, `packages/llm`, `packages/runner` and `apps/web/src/data` are **off limits** (Wave 3b takes them after Epic 40 merges).

**Wave 3 is the big one: about 100 agents run at the same time on one laptop**, each in its own worktree and lane. That only works if everyone follows the rules below exactly.

**Read before you start:** `AGENTS.md`, `.orchestrator/ARCHITECTURE.md` (§6 contracts, §7 locked decisions), the `docs/epic-*.md` for every package you touch (their "Interfaces for future epics" sections), the handbacks in `.orchestrator/handbacks/` that mention your area, and **`.orchestrator/fix-requests-w2.md`**.

## Tech decisions already locked (build on these, don't relitigate)
ARCHITECTURE §7 **L1–L31** still hold (Bun 1.4.4, TS 5.9.3, zod 4, Biome 2.6.3; web tests run in their own process; Markdown formatter off; no local models; real LLM calls only via the `opencode` profile). Wave 3 adds:
- **L32 Lanes are absolute.** Write only inside your lane, plus your own `docs/epic-138-web-gallery.md` and `.orchestrator/handbacks/138-web-gallery.md`. Shared registration files you don't own (`apps/web/src/App.tsx` and `app/Layout.tsx`, `apps/cli/src/program.ts`, `apps/server/src/app.ts`, any package `index.ts` outside your lane) are **wired later by checkpoint C3**. Ship your work as a self-contained module with the manifest described in your prompt, and say in the handback exactly what C3 must add (file, line, code).
- **L33 Public APIs are additive only.** Never rename or remove an export, field, route, CLI flag or event other code uses. Deprecate instead. About 100 branches merge after yours.
- **L34 No new dependencies.** Don't touch any `package.json` dependency list, `bun.lock`, the root `package.json`, `tsconfig.base.json` or `biome.json`. Everything you need is already installed (React 19, lucide-react, zustand, @xyflow/react, Tailwind v4, Hono, commander, zod, bun:test, happy-dom, Playwright). If something is truly missing, write a CONTRACT REQUEST instead.
- **L35 Heavy commands go through the slot gate.** With 100 agents, everyone running the full suite at once would melt the laptop. While iterating, run **only your own tests** (`bun test <your dir>`; for web code `cd apps/web && bun test src/features/<x>`) and **only your own typecheck** (`bunx tsc --noEmit -p <your package or app>`). Run the full suite **once, at the end**, through the gate: `bash .orchestrator/bin/heavy.sh bun run test` and `bash .orchestrator/bin/heavy.sh bun run check` (also wrap `bun run build` and any Playwright run). The gate may print "waiting" for a few minutes. If your shell tool times out while it waits, just run it again.
- **L36 Bugs outside your lane are FIX REQUESTS, never edits.** QA epics record a confirmed bug as **`test.todo('BUG <area>: <one line>', () => { ... })`** with the real assertions inside, plus a FIX REQUEST. Never use `test.failing` and never commit a red test: about 100 fixes land in parallel, and a `test.failing` turns red the moment someone fixes the bug. **The one allowed cross-lane edit:** if your fix makes an existing `test.failing` probe in `tools/security/**` pass, change that probe's `test.failing(` to `test(` in the same PR (nothing else in that file) and say so in the handback.
- **L37 No real model calls and no real Starling runs in Wave 3a** unless your prompt says otherwise. Use the recorded runs in `fixtures/runs/*.jsonl`, `@starling/core/testing` fakes and the mock compose paths. No Ollama, no local models (L23).
- **L38 Tests live next to the code, and everything is deterministic.** No sleeps over 50 ms, no wall-clock assertions, no network beyond `127.0.0.1` on port `0`, and temp dirs under `os.tmpdir()` that clean up after themselves. Another 99 agents are hammering the CPU, so timing-sensitive tests will flake.
- Pure consumer: import components, features, `app/RegionPlaceholder`, `data/selectors`, `data/reducer` and `data/demo`, but edit none of them. Features change in parallel (Epics 130–137): use only exports and props that exist on `main` now. Their new optional props can be registered after C3.
- Don't import unmerged Wave 3 features (stage, topology, health, report, …). `registerGalleryEntry` is how they join later.

## FIRST TASK: carryover
Open `.orchestrator/fix-requests-w2.md`. Implement every request that targets a file in your lane, or decline it with a one-line reason. List each one in your handback under **Carryover done**.


## Your lane (you may write ONLY here)
`apps/web/src/gallery/**`, `apps/web/gallery.html`
plus `docs/epic-138-web-gallery.md` and `.orchestrator/handbacks/138-web-gallery.md`. Read anything.

## Goal
About 25 web features and components will be changing at once in Wave 3, and nobody can open a dashboard in every state to check them. The gallery is one dev page that renders every shared component and every feature in each meaningful state, from the recorded fixture: empty, loading, error, live mid-run, demo and finished. Light and dark sit side by side. It doubles as a crash matrix: a test mounts every (entry × state × theme) in happy-dom, so a feature that throws on an empty run is caught before the stage. Great looks like this: open `/gallery.html`, see 9 components × states and 8 features × 6 states, in both themes, with zero red cells.

## Deliverables
1. **Entry**: `apps/web/gallery.html` (copy `index.html`'s head; `<script type="module" src="/src/gallery/main.tsx">`). Vite's dev server serves it at `/gallery.html` with no config change. It's dev-only: adding it to the production build would mean editing `vite.config.ts` (Epic 112), so just mention it as an optional C3 line.
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
8. **More tests (≥ 25 total)**: `galleryState` invariants (live has ≥ 3 running tasks, finished is `finished`), registry/filter, URL parsing, and the theme wrapper.

## Explicitly out of scope
- Editing components, the shell or `vite.config.ts` (Epic 112), or any feature (its own lane).
- Playwright and visual baselines (Epic 140). The a11y audit (Epic 139).

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree (it must not change `bun.lock`).
2. `cd apps/web && bun test src/gallery` → 0 fail (todos allowed), ≥ 25 tests, with the crash matrix covering every entry × state × theme (paste the matrix size).
3. `bunx tsc --noEmit -p apps/web` clean and `bunx biome check apps/web/src/gallery apps/web/gallery.html` clean.
4. `bun run --cwd apps/web dev` → `/gallery.html` loads with no console errors. Commit 2 PNGs ≤ 300 KB to `apps/web/src/gallery/__screens__/` (components page; DAG across states, light vs dark).
5. `bash .orchestrator/bin/heavy.sh bun run test` at the repo root → 0 fail (paste both halves' summary lines).
6. `bash .orchestrator/bin/heavy.sh bun run check` → clean.
7. `docs/epic-138-web-gallery.md` (AGENTS.md §6 sections) and `.orchestrator/handbacks/138-web-gallery.md` written. The handback has **Carryover done**, **C3 wiring** (exact code C3 must add, or "none") and **FIX REQUESTS** (or "none") sections. PR opened per AGENTS.md §6 with `Closes #<issue>`. Print the PR URL last.

## Git
Branch `epic/138-web-gallery`. Conventional Commits scoped to your lane, committed small and often (at least 5 commits). `git fetch origin && git rebase origin/main` before pushing. No merging, no tags. Never `git add -A` at the repo root without checking `git status` first: only your lane's files belong in the PR.
