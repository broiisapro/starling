# Epic 141: Web: performance budgets

**Wave 3 · Branch `epic/141-web-perf` · Issue: `gh issue list --search "Epic 141 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 60–120 min of autonomous work**

## Where you are
Starling (`.orchestrator/PRD.md`) is an open-source, open-weight-first harness. It turns one coding goal into a lane-safe task DAG, runs a flock of opencode agents in parallel git worktrees on this laptop and on other laptops ("perches"), audits each result, and merges everything through a queue, shown live in a murmuration dashboard.

**Waves 0, 1, C1 and 2 are merged** (tags `epic-NN-complete`). About 2,500 tests pass across every package, the CLI, server, web dashboard, skill, tools and evals. Epic 40 (integration captain) is landing the **real** composition (`starling run` driving real opencode agents) in parallel with you, so for now `apps/cli`, `packages/core`, `packages/llm`, `packages/runner` and `apps/web/src/data` are **off limits** (Wave 3b takes them after Epic 40 merges).

**Wave 3 is the big one: about 100 agents run at the same time on one laptop**, each in its own worktree and lane. That only works if everyone follows the rules below exactly.

**Read before you start:** `AGENTS.md`, `.orchestrator/ARCHITECTURE.md` (§6 contracts, §7 locked decisions), the `docs/epic-*.md` for every package you touch (their "Interfaces for future epics" sections), the handbacks in `.orchestrator/handbacks/` that mention your area, and **`.orchestrator/fix-requests-w2.md`**.

## Tech decisions already locked (build on these, don't relitigate)
ARCHITECTURE §7 **L1–L31** still hold (Bun 1.4.4, TS 5.9.3, zod 4, Biome 2.6.3; web tests run in their own process; Markdown formatter off; no local models; real LLM calls only via the `opencode` profile). Wave 3 adds:
- **L32 Lanes are absolute.** Write only inside your lane, plus your own `docs/epic-141-web-perf.md` and `.orchestrator/handbacks/141-web-perf.md`. Shared registration files you don't own (`apps/web/src/App.tsx` and `app/Layout.tsx`, `apps/cli/src/program.ts`, `apps/server/src/app.ts`, any package `index.ts` outside your lane) are **wired later by checkpoint C3**. Ship your work as a self-contained module with the manifest described in your prompt, and say in the handback exactly what C3 must add (file, line, code).
- **L33 Public APIs are additive only.** Never rename or remove an export, field, route, CLI flag or event other code uses. Deprecate instead. About 100 branches merge after yours.
- **L34 No new dependencies.** Don't touch any `package.json` dependency list, `bun.lock`, the root `package.json`, `tsconfig.base.json` or `biome.json`. Everything you need is already installed (React 19, lucide-react, zustand, @xyflow/react, Tailwind v4, Hono, commander, zod, bun:test, happy-dom, Playwright). If something is truly missing, write a CONTRACT REQUEST instead.
- **L35 Heavy commands go through the slot gate.** With 100 agents, everyone running the full suite at once would melt the laptop. While iterating, run **only your own tests** (`bun test <your dir>`; for web code `cd apps/web && bun test src/features/<x>`) and **only your own typecheck** (`bunx tsc --noEmit -p <your package or app>`). Run the full suite **once, at the end**, through the gate: `bash .orchestrator/bin/heavy.sh bun run test` and `bash .orchestrator/bin/heavy.sh bun run check` (also wrap `bun run build` and any Playwright run). The gate may print "waiting" for a few minutes. If your shell tool times out while it waits, just run it again.
- **L36 Bugs outside your lane are FIX REQUESTS, never edits.** QA epics record a confirmed bug as **`test.todo('BUG <area>: <one line>', () => { ... })`** with the real assertions inside, plus a FIX REQUEST. Never use `test.failing` and never commit a red test: about 100 fixes land in parallel, and a `test.failing` turns red the moment someone fixes the bug. **The one allowed cross-lane edit:** if your fix makes an existing `test.failing` probe in `tools/security/**` pass, change that probe's `test.failing(` to `test(` in the same PR (nothing else in that file) and say so in the handback.
- **L37 No real model calls and no real Starling runs in Wave 3a** unless your prompt says otherwise. Use the recorded runs in `fixtures/runs/*.jsonl`, `@starling/core/testing` fakes and the mock compose paths. No Ollama, no local models (L23).
- **L38 Tests live next to the code, and everything is deterministic.** No sleeps over 50 ms, no wall-clock assertions, no network beyond `127.0.0.1` on port `0`, and temp dirs under `os.tmpdir()` that clean up after themselves. Another 99 agents are hammering the CPU, so timing-sensitive tests will flake.
- **L39 QA epics.** You are a bug hunter, not a fixer. Read the code and docs of your area, then write **behaviour tests** that pin down what the docs/contracts promise, importing only public exports (`packages/<x>/src/index.ts` by relative path, or the app's exported factories). Tests that pass are kept as regression tests. A confirmed bug becomes `test.todo('BUG <area>: …', () => { …real assertions… })` plus a FIX REQUEST in your handback with file, line, a minimal repro, and a suggested fix. Aim for 40+ meaningful tests and every bug you can find. Don't invent behaviour the docs don't promise: if the contract is ambiguous, write it up as an **Open question** instead. Also write `REPORT.md` in your folder: what you covered, a bug table (id, severity, file:line, one-line repro), and what you'd test next.
- **L38 is strict here**: no wall-clock assertions in the default run. Timing tests exist only behind `STARLING_PERF=1` and never run in `bun run test`. Default assertions are counts, caps and identities only.
- Import `data/**`, `features/**` and `app/Layout` read-only. Don't edit them (FIX REQUESTS instead).

## FIRST TASK: carryover
Open `.orchestrator/fix-requests-w2.md`. Implement every request that targets a file in your lane, or decline it with a one-line reason. List each one in your handback under **Carryover done**.


## Your lane (you may write ONLY here)
`apps/web/src/__perf__/**`
plus `docs/epic-141-web-perf.md` and `.orchestrator/handbacks/141-web-perf.md`. Read anything.

## Goal
Wave 3's demos push the dashboard from 7 tasks to 60–100, and a long live run streams tens of thousands of events into one tab. Nobody has measured what the reducer, selectors and panels cost at that scale. This epic builds deterministic synthetic runs, measures the data path and the panels' render counts at 30/100/300 tasks and 50k events, and writes a budget file so regressions show up as failing numbers instead of a stuttering projector. Great looks like this: a bench table in the handback, render-count budgets enforced in the default test run, and precise FIX REQUESTS (e.g. "every agent.event re-renders the queue").

## Deliverables
1. **`synth.ts`**: `synthRun(opts: { tasks: number; events: number; nodes?: number; seed?: number }): StarlingEvent[]`.
   - Deterministic (a local mulberry32), with a realistic mix: `run.created`, `plan.created`, `task.status` walks, about 60% `agent.event`, `metrics` every 5 s of sim time, `node.stats`, verdicts, merges and a few `log`s.
   - Validate a sample against `StarlingEventSchema` (`@starling/core/browser`) in a test.
   - Scenarios: `S30`, `S100`, `S300` (tasks) and `L50K` (50,000 events, 100 tasks).
2. **`budgets.ts`**: `PERF_BUDGETS` as a typed table per scenario (`maxRendersPerPanel`, `maxHeldEvents`, `maxMs` (opt-in only), notes). It's generous (about 10× what you measure) and every number is commented with where it came from.
3. **`bench.ts`** CLI: `bun apps/web/src/__perf__/bench.ts [--json] [--scenario S100]` prints a table:
   - reducer throughput (`applyEvents` events/s) per scenario;
   - the 50k-event replay time;
   - per-call cost of `skyProps`, `dagProps`, `queueProps`, `flockProps`, `metricsProps`, `displayTasks`, `recentEvents` on the end state (median of 5).
   It writes nothing unless `--out <path>`. Run it through `heavy.sh`.
4. **Deterministic tests** (the default `bun test`, under ~3 s total):
   - **Caps hold** after `L50K`: `events.length ≤ EVENT_CAP`, every `agentLog[k].length ≤ AGENT_LOG_CAP`, `metricsHistory ≤ METRICS_CAP`, `merges ≤ MERGE_CAP`.
   - **No-op identity**: `applyEvent` returns the same object for events it ignores.
   - **Selector stability**: two calls on the same state return identity-equal `tasks`/`nodes`/`recent` props (`displayTasks` is cached; `recentEvents` likely isn't, so record what you find).
5. **Render counts**: mount `MergeQueue`, `MetricsPanel`, `FlockPanel`, `DagView` and `AgentDrawer` inside React `<Profiler onRender>`, fed by the real selectors from a state you advance with `applyEvent`.
   - Ingest 200 `agent.event`s for one task and count commits per panel. Panels that don't show agent events ideally don't commit.
   - Also count full `Layout` commits per ingested event.
   - Assert the measured counts against `PERF_BUDGETS` (they're deterministic). A panel over its realistic budget becomes `test.todo` + FIX REQUEST:
     - memoisation in the feature → its Wave 3 epic (queue 133, metrics 134, flock 135, dag 131, agents 132);
     - selector identity → Wave 3b (204);
     - Layout recomputation → Epic 112.
6. **Complexity probes**: suspects to measure and report are `appendCapped` copying the whole capped array per event (`data/reducer.ts`), `recentEvents` filtering all `state.events` per render, and the `displayTasks` signature string per call. Measure scaling (5k vs 50k events, 30 vs 300 tasks) **only** under `STARLING_PERF=1` (`test.if(process.env.STARLING_PERF === '1')`) and put the ratios in REPORT.md.
7. **`REPORT.md`**: what's covered, the bench table measured on this laptop (note the machine load), findings with severity and FIX REQUEST routing, and what to measure next (canvas fps lives in Epic 130).

## Explicitly out of scope
- Fixing the reducer or selectors (Wave 3b, Epic 204), features or shell.
- Package hot paths (Epic 199). Canvas fps (Epic 130). Server/SSE load (Epic 155).

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree (it must not change `bun.lock`).
2. `cd apps/web && bun test src/__perf__` → 0 fail (todos allowed), ≥ 40 tests, under ~3 s (paste the timing line).
3. `bunx tsc --noEmit -p apps/web` clean and `bunx biome check apps/web/src/__perf__` clean.
4. `bash .orchestrator/bin/heavy.sh bun apps/web/src/__perf__/bench.ts` → paste the table in the handback and REPORT.md. `STARLING_PERF=1 bash .orchestrator/bin/heavy.sh bash -c 'cd apps/web && bun test src/__perf__'` → pass.
5. `bash .orchestrator/bin/heavy.sh bun run test` at the repo root → 0 fail (paste both halves' summary lines).
6. `bash .orchestrator/bin/heavy.sh bun run check` → clean.
7. `docs/epic-141-web-perf.md` (AGENTS.md §6 sections) and `.orchestrator/handbacks/141-web-perf.md` written. The handback has **Carryover done**, **C3 wiring** (exact code C3 must add, or "none") and **FIX REQUESTS** (or "none") sections. PR opened per AGENTS.md §6 with `Closes #<issue>`. Print the PR URL last.

## Git
Branch `epic/141-web-perf`. Conventional Commits scoped to your lane, committed small and often (at least 5 commits). `git fetch origin && git rebase origin/main` before pushing. No merging, no tags. Never `git add -A` at the repo root without checking `git status` first: only your lane's files belong in the PR.
