# Epic 23: Web shell + data layer

**Wave 1 · Branch `epic/23-web-shell` · Issue: find it with `gh issue list --search "Epic 23 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 60–120 min of autonomous work**

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
`apps/web/` root files (`index.html`, `vite.config.ts`, `package.json`, `tsconfig.json`, `bunfig.toml`, `src/main.tsx`, `src/index.css`), and `apps/web/src/{app,data,components,lib}/**`. **Not** `apps/web/src/features/**`: six sibling epics own those folders right now.
plus `docs/epic-23-web-shell.md` and `.orchestrator/handbacks/23-web-shell.md`. Read anything; write nothing else.

## Goal
Build the dashboard's frame and nervous system: layout, theme, routing, the zustand store fed by a pure event reducer, the SSE client, and a **demo mode** that replays the fixture run so the whole UI is alive with no backend. The feature panels (Sky, DAG, agents, queue, metrics, flock) are being built in parallel as plain-props components (ARCHITECTURE §8). You provide the regions and data they'll be wired into.

## Deliverables
- **Design system**: a Tailwind v4 `@theme` in `src/index.css` with a *dusk sky* palette (deep navy → violet → amber horizon gradient background, starling-iridescent accents: teal/purple/green sheen), semantic status colours for every `TaskStatus` (export them as `STATUS_COLORS` in `src/lib/status.ts`; features will use them), and type scale and spacing tokens. Dark by default, with a light theme toggle. Components in `src/components/`: `Panel`, `Badge`, `StatusDot`, `Kbd`, `Tabs`, `Tooltip`, `EmptyState`, `Stat`. Accessible (focus rings, aria labels) and keyboard friendly.
- **Layout** (`src/app/Layout.tsx`): a top bar (logo "🐦 Starling", run picker, connection badge live/demo/offline, a demo speed control); a big centre **sky region**; a right **drawer region** (agent details); a bottom **strip** (queue + metrics); and a left or collapsible **flock region**. Each region renders a `<RegionPlaceholder name="sky" />` in Wave 1 with a comment `// WIRED AT C1: <SkyView {...skyProps(state)} />`. Responsive down to 1280×720 (projector resolution!) and usable at 1920×1080.
- **Data layer** (`src/data/`):
  - `reducer.ts`: a pure `applyEvent(state, e): SkyState` and `initialState`. SkyState = `{ runs: Record<id, Run>; activeRunId?; events: StarlingEvent[] (active run, capped 5,000); nodes: Record<id, NodeInfo>; agentLog: Record<taskKey, AgentEvent[]> (capped 500 each); verdicts: Record<taskKey, AuditVerdict[]>; merges: MergeResult[]; metricsHistory: {ts, metrics}[]; join?: JoinInfo; connection; selectedTask? }`.
  - `store.ts`: `useSky` (zustand) with actions `ingest(e)`, `ingestMany(es)`, `selectTask`, `setActiveRun`, `setConnection`.
  - `selectors.ts`: **prop builders for every §8 feature component**: `skyProps(state)`, `dagProps`, `drawerProps`, `queueProps`, `metricsProps`, `flockProps`. These make C1 wiring a one-liner per region.
  - `sse.ts`: connect to `/api/events` and `/api/runs/:id/events?since=` with exponential-backoff reconnect and resume from the last ts.
  - `demo.ts`: imports `fixtures/runs/sky-todo-launch-day.jsonl` (`?raw`), replays it with original timing × speed (1×, 4×, 16×), loops with a 3 s pause. Demo mode activates automatically when `/api/health` fails, or via `?demo=1`.
- Mirror §8 in `src/data/handshake.ts`.
- Tests (bun test + happy-dom): the reducer over the full fixture (final state: 7 tasks, all merged, 2 nodes, one migration, verdict history for the fixed task); caps enforced; selectors produce the exact §8 prop shapes (type-level `satisfies` plus runtime checks); the SSE client with a fake EventSource (reconnect + since); Layout renders all regions; the demo controller's timing with fake timers.

## Explicitly out of scope
The feature components themselves (Epics 24, 25, 26, 32). Wiring them in (C1). Run-launch form (Wave 2). Any change to `apps/web/src/features/**`.

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree.
2. `bun test apps/web` passes (your tests plus any sibling feature tests already on main), ≥ 25 of yours.
3. `cd apps/web && bun run build` succeeds. Then `bun run dev`, open `/?demo=1` with a headless browser (Playwright is available via `bunx playwright` if needed; otherwise curl the HTML and test the reducer), and paste evidence that demo mode reaches the final state.
4. `bun run test` at the repo root passes, all packages' tests and not just yours. Paste the summary line.
5. `bun run check` passes (Biome + typecheck for every workspace).
6. `docs/epic-23-web-shell.md` (sections per AGENTS.md §6; **"Interfaces for future epics"** must show exact exported signatures and a usage snippet) and `.orchestrator/handbacks/23-web-shell.md` written. PR opened per AGENTS.md §6 with `Closes #<issue>`; print the PR URL last.

## Git
Branch `epic/23-web-shell`. Conventional Commits scoped to your lane (`feat(web): …`, `test(web): …`, `docs(epic-23): …`), committed small and often: at least 6 commits that tell the story. `git fetch origin && git rebase origin/main` before pushing. No merging, no tags.
