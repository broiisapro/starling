# Epic 111: Server insights routes: report, timeline, costs, compare

**Wave 3 · Branch `epic/111-server-insights` · Issue: `gh issue list --search "Epic 111 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 60–120 min of autonomous work**

## Where you are
Starling (`.orchestrator/PRD.md`) is an open-source, open-weight-first harness. It turns one coding goal into a lane-safe task DAG, runs a flock of opencode agents in parallel git worktrees on this laptop and on other laptops ("perches"), audits each result, and merges everything through a queue, shown live in a murmuration dashboard.

**Waves 0, 1, C1 and 2 are merged** (tags `epic-NN-complete`). About 2,500 tests pass across every package, the CLI, server, web dashboard, skill, tools and evals. Epic 40 (integration captain) is landing the **real** composition (`starling run` driving real opencode agents) in parallel with you, so for now `apps/cli`, `packages/core`, `packages/llm`, `packages/runner` and `apps/web/src/data` are **off limits** (Wave 3b takes them after Epic 40 merges).

**Wave 3 is the big one: about 100 agents run at the same time on one laptop**, each in its own worktree and lane. That only works if everyone follows the rules below exactly.

**Read before you start:** `AGENTS.md`, `.orchestrator/ARCHITECTURE.md` (§6 contracts, §7 locked decisions), the `docs/epic-*.md` for every package you touch (their "Interfaces for future epics" sections), the handbacks in `.orchestrator/handbacks/` that mention your area, and **`.orchestrator/fix-requests-w2.md`**.

## Tech decisions already locked (build on these, don't relitigate)
ARCHITECTURE §7 **L1–L31** still hold (Bun 1.4.4, TS 5.9.3, zod 4, Biome 2.6.3; web tests run in their own process; Markdown formatter off; no local models; real LLM calls only via the `opencode` profile). Wave 3 adds:
- **L32 Lanes are absolute.** Write only inside your lane, plus your own `docs/epic-111-server-insights.md` and `.orchestrator/handbacks/111-server-insights.md`. Shared registration files you don't own (`apps/web/src/App.tsx` and `app/Layout.tsx`, `apps/cli/src/program.ts`, `apps/server/src/app.ts`, any package `index.ts` outside your lane) are **wired later by checkpoint C3**. Ship your work as a self-contained module with the manifest described in your prompt, and say in the handback exactly what C3 must add (file, line, code).
- **L33 Public APIs are additive only.** Never rename or remove an export, field, route, CLI flag or event other code uses. Deprecate instead. About 100 branches merge after yours.
- **L34 No new dependencies.** Don't touch any `package.json` dependency list, `bun.lock`, the root `package.json`, `tsconfig.base.json` or `biome.json`. Everything you need is already installed (React 19, lucide-react, zustand, @xyflow/react, Tailwind v4, Hono, commander, zod, bun:test, happy-dom, Playwright). If something is truly missing, write a CONTRACT REQUEST instead.
- **L35 Heavy commands go through the slot gate.** With 100 agents, everyone running the full suite at once would melt the laptop. While iterating, run **only your own tests** (`bun test <your dir>`; for web code `cd apps/web && bun test src/features/<x>`) and **only your own typecheck** (`bunx tsc --noEmit -p <your package or app>`). Run the full suite **once, at the end**, through the gate: `bash .orchestrator/bin/heavy.sh bun run test` and `bash .orchestrator/bin/heavy.sh bun run check` (also wrap `bun run build` and any Playwright run). The gate may print "waiting" for a few minutes. If your shell tool times out while it waits, just run it again.
- **L36 Bugs outside your lane are FIX REQUESTS, never edits.** QA epics record a confirmed bug as **`test.todo('BUG <area>: <one line>', () => { ... })`** with the real assertions inside, plus a FIX REQUEST. Never use `test.failing` and never commit a red test: about 100 fixes land in parallel, and a `test.failing` turns red the moment someone fixes the bug. **The one allowed cross-lane edit:** if your fix makes an existing `test.failing` probe in `tools/security/**` pass, change that probe's `test.failing(` to `test(` in the same PR (nothing else in that file) and say so in the handback.
- **L37 No real model calls and no real Starling runs in Wave 3a** unless your prompt says otherwise. Use the recorded runs in `fixtures/runs/*.jsonl`, `@starling/core/testing` fakes and the mock compose paths. No Ollama, no local models (L23).
- **L38 Tests live next to the code, and everything is deterministic.** No sleeps over 50 ms, no wall-clock assertions, no network beyond `127.0.0.1` on port `0`, and temp dirs under `os.tmpdir()` that clean up after themselves. Another 99 agents are hammering the CPU, so timing-sensitive tests will flake.
- Epic 110 is changing `apps/server/src/http.ts` and `app.ts` in parallel, additively. Import only `fail` and the existing `ApiErrorCode` values from `../http`, and don't depend on any of 110's new options.

## FIRST TASK: carryover
Open `.orchestrator/fix-requests-w2.md`. Implement every request that targets a file in your lane, or decline it with a one-line reason. List each one in your handback under **Carryover done**.

Also, specifically for this epic:
- No Wave 2 FIX REQUEST targets these paths.
- Be compatible with Epic 100's additive `diff` on `task.status` and Epic 40's `run.status` arm (deliverable 7).

## Your lane (you may write ONLY here)
`apps/server/src/routes/insights.ts`, `apps/server/src/routes/insights.test.ts`, `apps/server/src/insights/**`
plus `docs/epic-111-server-insights.md` and `.orchestrator/handbacks/111-server-insights.md`. Read anything.

## Goal
Four of the most demo-visible Wave 3 web features (flight report 113, timeline 114, costs 116, compare 122) all need the same thing: trustworthy numbers derived from a run's recorded events. Build them once, as pure functions over `StarlingEvent[]` plus a tiny Hono sub-app, so the dashboard, the CLI and the judges all see the same "6 birds in parallel, 3.1× faster than serial, $0.52" story. Great looks like: golden tests on the recorded launch-day fixture, a JSON shape documented well enough that four web agents can build against it today, and zero edits outside your three paths.

## Deliverables
1. **Types** (`src/insights/types.ts`, `INSIGHTS_VERSION = 1`, all JSON-serialisable). `TimelineSegment = { phase: 'queued' | 'working' | 'auditing' | 'fixing' | 'merging'; fromTs: number; toTs: number; open?: boolean }`, `TimelineRow = { taskKey; title; nodeId?; nodeName?; segments: TimelineSegment[]; final: TaskStatus }`, `Timeline = { runId; startTs; endTs; rows: TimelineRow[]; parallelism: Array<{ ts: number; active: number }>; peakParallelism: number; avgParallelism: number }`, `RunReport`, `CostBreakdown` and `RunComparison` (below).
2. **`buildTimeline(events: readonly StarlingEvent[]): Timeline`** (`src/insights/timeline.ts`) from `task.status` transitions (`running` → working, `auditing`, `fixing`, `merging`), titles from `plan.created`, nodes from `TaskRun.nodeId` / additive `nodeName` and `task.migrated`, and bounds from `run.created` / `run.finished`. Live runs leave segments `open` up to the last event ts. Parallelism = tasks in `running | fixing` at each change point, with a time-weighted average.
3. **`buildRunReport(run: Run | undefined, events): RunReport`**: `{ runId, goal, status, outcome: 'success' | 'partial' | 'failed' | 'cancelled' | 'running', counts: Record<TaskStatus, number>, wallMs, serialMs, timeSavedMs, speedup, cost: { apiUsd, estSavedUsd, tokensIn, tokensOut, localCalls }, perNode: Array<{ nodeId, name, tasks, merged, busyMs }>, notableVerdicts: Array<{ taskKey, attempt, pass, summary, failedChecks: string[] }> (≤ 8: failed audits plus passes after a fix), narrative: string[] }`. `serialMs` = Σ each task's working + auditing + fixing + merging time. Cost comes from the last `metrics` event. The narrative is 4–8 deterministic sentences, e.g. "7 tasks planned; 6 flew at once on 2 perches; all merged in 7:53, 3.1× faster than one agent in a row."
4. **`costBreakdown(run, events): CostBreakdown`**: `byTask` (`TaskRun.costUsd`, usage), `byNode`, `byModel` only where events record a model, and `byRole` = worker (Σ task costs) plus "orchestration: planner + auditor + resolver, not attributed per call" (= `metrics.apiCostUsd − Σ task costs`, floored at 0). Label anything estimated as such.
5. **`compareRuns(a: RunReport, b: RunReport, plans?: { a?: Plan; b?: Plan }): RunComparison`**: deltas for wall time, cost, tasks merged/failed, peak parallelism and speedup, plus a minimal plan diff (tasks added, removed and lane-changed by key/title). Epic 107's `diffPlans` can't be imported (`apps/server` depends only on core, L34), so note in the handback that C3 may swap it in.
6. **Routes** (`src/routes/insights.ts`). `mountInsights(app: Hono, deps: { store: Store; engine?: Pick<EngineApi, 'getRun'> }): void` serves `GET /api/runs/:id/report`, `/api/runs/:id/timeline`, `/api/runs/:id/costs` and `GET /api/compare?a=<id>&b=<id>`. Use `fail` from `../http` (404 `RUN_NOT_FOUND`, 400 `INVALID_QUERY`). Cache per `(runId, events.length)` in a 32-entry LRU, so live runs refresh and finished runs are free.
7. **Robustness:** unknown event types (`run.status` before or after Epic 40, a future `task.diff`), duplicate and out-of-order events, a run with no plan yet, and a cancelled run. One test each.
8. **Golden tests** on `fixtures/runs/sky-todo-launch-day.jsonl` (exact counts, outcome, node rows and parallelism peak). Also run the same assertions-by-invariant (no golden numbers) over `fixtures/real/*.jsonl` when present (`test.skipIf` absent, since Epic 40's recordings may land on main mid-wave). Route tests through `app.request`. Write **at least 35 tests**.
9. `src/insights/index.ts` barrel. In the handback, put the exact C3 lines: `export * from './insights'` and `export * from './routes/insights'` in `apps/server/src/index.ts`, and `mountInsights(app, { store: deps.store, engine: deps.engine })`, either in `createApp` or via Epic 110's `ServerOptions.mount` hook. Also put the JSON shapes, with one real example each, in your epic doc for Epics 113, 114, 116, 122 and 146.

## Explicitly out of scope
- Any other file in `apps/server` (Epic 110 owns it, including `app.ts` and `index.ts`). Don't mount yourself.
- Web rendering (Epics 113/114/116/122) and the CLI report (Epic 146): you provide data, not UI.
- New dependencies or imports of other packages besides `@starling/core`, `hono` and `zod` (L34).

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree (it must not change `bun.lock`).
2. `bun test apps/server/src/insights apps/server/src/routes/insights.test.ts` → 0 fail, ≥ 35 tests.
3. `bunx tsc --noEmit -p apps/server` clean.
4. Paste `buildRunReport(...).narrative` and the `peakParallelism` / `timeSavedMs` for the launch-day fixture, plus one `app.request('/api/runs/<id>/timeline')` response (truncated).
5. `bash .orchestrator/bin/heavy.sh bun run test` at the repo root → 0 fail (paste both halves' summary lines).
6. `bash .orchestrator/bin/heavy.sh bun run check` → clean.
7. `docs/epic-111-server-insights.md` (AGENTS.md §6 sections) and `.orchestrator/handbacks/111-server-insights.md` written. The handback has **Carryover done**, **C3 wiring** (exact code C3 must add, or "none") and **FIX REQUESTS** (or "none") sections. PR opened per AGENTS.md §6 with `Closes #<issue>`. Print the PR URL last.

## Git
Branch `epic/111-server-insights`. Conventional Commits scoped to your lane, committed small and often (at least 5 commits). `git fetch origin && git rebase origin/main` before pushing. No merging, no tags. Never `git add -A` at the repo root without checking `git status` first: only your lane's files belong in the PR.
