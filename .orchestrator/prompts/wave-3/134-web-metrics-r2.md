# Epic 134: Web: metrics round 2 (throughput, parallelism, time saved, tokens/s)

**Wave 3 · Branch `epic/134-web-metrics-r2` · Issue: `gh issue list --search "Epic 134 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 60–120 min of autonomous work**

## Where you are
Starling (`.orchestrator/PRD.md`) is an open-source, open-weight-first harness. It turns one coding goal into a lane-safe task DAG, runs a flock of opencode agents in parallel git worktrees on this laptop and on other laptops ("perches"), audits each result, and merges everything through a queue, shown live in a murmuration dashboard.

**Waves 0, 1, C1 and 2 are merged** (tags `epic-NN-complete`). About 2,500 tests pass across every package, the CLI, server, web dashboard, skill, tools and evals. Epic 40 (integration captain) is landing the **real** composition (`starling run` driving real opencode agents) in parallel with you, so for now `apps/cli`, `packages/core`, `packages/llm`, `packages/runner` and `apps/web/src/data` are **off limits** (Wave 3b takes them after Epic 40 merges).

**Wave 3 is the big one: about 100 agents run at the same time on one laptop**, each in its own worktree and lane. That only works if everyone follows the rules below exactly.

**Read before you start:** `AGENTS.md`, `.orchestrator/ARCHITECTURE.md` (§6 contracts, §7 locked decisions), the `docs/epic-*.md` for every package you touch (their "Interfaces for future epics" sections), the handbacks in `.orchestrator/handbacks/` that mention your area, and **`.orchestrator/fix-requests-w2.md`**.

## Tech decisions already locked (build on these, don't relitigate)
ARCHITECTURE §7 **L1–L31** still hold (Bun 1.4.4, TS 5.9.3, zod 4, Biome 2.6.3; web tests run in their own process; Markdown formatter off; no local models; real LLM calls only via the `opencode` profile). Wave 3 adds:
- **L32 Lanes are absolute.** Write only inside your lane, plus your own `docs/epic-134-web-metrics-r2.md` and `.orchestrator/handbacks/134-web-metrics-r2.md`. Shared registration files you don't own (`apps/web/src/App.tsx` and `app/Layout.tsx`, `apps/cli/src/program.ts`, `apps/server/src/app.ts`, any package `index.ts` outside your lane) are **wired later by checkpoint C3**. Ship your work as a self-contained module with the manifest described in your prompt, and say in the handback exactly what C3 must add (file, line, code).
- **L33 Public APIs are additive only.** Never rename or remove an export, field, route, CLI flag or event other code uses. Deprecate instead. About 100 branches merge after yours.
- **L34 No new dependencies.** Don't touch any `package.json` dependency list, `bun.lock`, the root `package.json`, `tsconfig.base.json` or `biome.json`. Everything you need is already installed (React 19, lucide-react, zustand, @xyflow/react, Tailwind v4, Hono, commander, zod, bun:test, happy-dom, Playwright). If something is truly missing, write a CONTRACT REQUEST instead.
- **L35 Heavy commands go through the slot gate.** With 100 agents, everyone running the full suite at once would melt the laptop. While iterating, run **only your own tests** (`bun test <your dir>`; for web code `cd apps/web && bun test src/features/<x>`) and **only your own typecheck** (`bunx tsc --noEmit -p <your package or app>`). Run the full suite **once, at the end**, through the gate: `bash .orchestrator/bin/heavy.sh bun run test` and `bash .orchestrator/bin/heavy.sh bun run check` (also wrap `bun run build` and any Playwright run). The gate may print "waiting" for a few minutes. If your shell tool times out while it waits, just run it again.
- **L36 Bugs outside your lane are FIX REQUESTS, never edits.** QA epics record a confirmed bug as **`test.todo('BUG <area>: <one line>', () => { ... })`** with the real assertions inside, plus a FIX REQUEST. Never use `test.failing` and never commit a red test: about 100 fixes land in parallel, and a `test.failing` turns red the moment someone fixes the bug. **The one allowed cross-lane edit:** if your fix makes an existing `test.failing` probe in `tools/security/**` pass, change that probe's `test.failing(` to `test(` in the same PR (nothing else in that file) and say so in the handback.
- **L37 No real model calls and no real Starling runs in Wave 3a** unless your prompt says otherwise. Use the recorded runs in `fixtures/runs/*.jsonl`, `@starling/core/testing` fakes and the mock compose paths. No Ollama, no local models (L23).
- **L38 Tests live next to the code, and everything is deterministic.** No sleeps over 50 ms, no wall-clock assertions, no network beyond `127.0.0.1` on port `0`, and temp dirs under `os.tmpdir()` that clean up after themselves. Another 99 agents are hammering the CPU, so timing-sensitive tests will flake.
- **You own `metrics/legibility.test.ts`** (Epic 55), which guards dag/agents/queue/metrics/flock. Keep it green and don't loosen it; other Wave 3 epics rely on it.
- e2e reads `metrics-panel`, `metrics-merged`, `metrics-failed`, `metrics-elapsed`, `cost-meter`, `cost-api`, `cost-local`, `cost-saved` testids. Keep them and their text formats.
- `usePrefersReducedMotion` and `MOTION_CSS` are imported by the shell and other features: signatures unchanged.
- **Additive props only, the existing way.** New inputs are optional props declared in your feature's `types.ts` extras intersection (pattern: `DagViewExtras`, `QueueExtras`, `MetricsExtras`, `FlockPanelExtras`), so the component still satisfies the frozen §8 props from `@starling/core`. `app/Layout.tsx` is Epic 112's: in the handback's **C3 wiring** give the exact prop expression C3 should add at the call site (e.g. `tasks={activeRunOf(state)?.tasks}`), and make the component behave well when it's absent.
- Test DOM pattern: copy `features/flock/test-dom.ts` (register happy-dom defensively, `react-dom/client` + `act`, no Testing Library `screen`). Web tests run in their own process: `cd apps/web && bun test src/features/<x>`.
- Visible changes will break the two e2e visual baselines (`apps/web/e2e/__screenshots__/end-*.png`, Epic 140's lane). Don't re-record them; write "C3: re-record e2e baselines (`bun run --cwd apps/web e2e:update`)" in the handback.

## FIRST TASK: carryover
Open `.orchestrator/fix-requests-w2.md`. Implement every request that targets a file in your lane, or decline it with a one-line reason. List each one in your handback under **Carryover done**.


## Your lane (you may write ONLY here)
`apps/web/src/features/metrics/**`
plus `docs/epic-134-web-metrics-r2.md` and `.orchestrator/handbacks/134-web-metrics-r2.md`. Read anything.

## Goal
The meter answers "is it cheap?". Round 2 makes it also answer "is it fast?":
- a throughput sparkline (merges over time);
- parallelism over time with a peak marker;
- a "4.1× faster than one agent, saved 18 min" counter computed honestly from task timings;
- live tokens per second for API vs local.

Every chart also gets a real text description for screen readers. All of it has to fit the shell's 12 rem strip at 1280×720 without reflowing digits, so a judge can read it from the back of the room.

## Deliverables
1. **Throughput**: pure `throughputSeries(history: MetricsSample[], bucketMs = 30_000): SparklinePoint[]` (merges per bucket from `tasksMerged` deltas; a negative delta means a new run, so reset). Render it with the existing `sparklineGeometry` + `SparklineChart`.
2. **Parallelism**: pure `parallelismStats(history): { peak: number; peakAt: number; mean: number }` (time-weighted mean of `agentsActive`). The existing agents sparkline gets a peak dot + "peak 5" label and a step-line option (`SparklineOptions` additive).
3. **Time saved vs serial**:
   - Additive extra `tasks?: Record<string, TaskRun>` on `MetricsExtras` (`types.ts`).
   - Pure `serialEstimate(tasks, wallMs, now): { serialMs: number; wallMs: number; savedMs: number; speedup: number } | undefined`, where serial = Σ((finishedAt ?? now) − startedAt) over tasks that started. It returns `undefined` with fewer than 2 started tasks or `wallMs <= 0`.
   - The counter reads "4.1× · saved 18m", with a tooltip spelling out the method and its limits (parallel time vs summed agent time; it isn't a benchmark).
   - C3 passes `tasks={activeRunOf(state)?.tasks}`.
4. **Tokens/s**: pure `tokenRate(history, windowMs = 60_000): { apiPerSec: number; localPerSec: number }` from `apiUsage`/`localUsage` (input + output) deltas over the window. It's robust to resets and returns 0 with fewer than 2 samples or a zero time span. Display it with `formatRate`/`formatTokens` and tabular digits.
5. **Accessible charts**: every SVG gets `role="img"` + `<title>` + `<desc>` from pure `describeSeries(label: string, points: SparklinePoint[], format: (v: number) => string): string` ("Agents active: rose from 0 to a peak of 5 at 2m 10s, now 0"). A "Show data" toggle reveals a small `<table>` with a caption (keyboard accessible). Count-ups stay snapped on replay and under reduced motion (Epic 55 behaviour).
6. **Fit the strip**: `useElementSize(ref)` (ResizeObserver with a graceful fallback). Below 200 px tall, `dense` mode hides the throughput sparkline first, then the data toggle; nothing reflows as values change (fixed `min-w` on figures).
7. **Exports**: add the new pure helpers to `metrics/index.ts` (additive). Keep `MetricsPanel`'s existing testids.
8. **Tests (≥ 30 new)**: the recorded fixture through `replayMetrics` (`replay.ts`) for peak/mean/throughput/tokens per second, plus synthetic histories (empty, one sample, reset mid-run, 2,000 samples = `METRICS_CAP`), `serialEstimate` edge cases, `describeSeries` strings, dense mode, and the data table.

## Explicitly out of scope
- Cost-by-role breakdown and frontier-price comparison (Epic 116), run report (113), timeline parallelism curve (114): don't import them, and don't build their features here.
- Pricing tables in core and the data layer (Wave 3b).

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree (it must not change `bun.lock`).
2. `cd apps/web && bun test src/features/metrics` → 0 fail, ≥ 30 new tests.
3. `bunx tsc --noEmit -p apps/web` clean and `bunx biome check apps/web/src/features/metrics` clean.
4. Paste the values the recorded run produces (peak agents, mean, speedup, saved, tokens/s at the end) and commit 1 PNG ≤ 300 KB of the panel at a 1280×720 strip size to `features/metrics/__screens__/`.
5. `bash .orchestrator/bin/heavy.sh bun run test` at the repo root → 0 fail (paste both halves' summary lines).
6. `bash .orchestrator/bin/heavy.sh bun run check` → clean.
7. `docs/epic-134-web-metrics-r2.md` (AGENTS.md §6 sections) and `.orchestrator/handbacks/134-web-metrics-r2.md` written. The handback has **Carryover done**, **C3 wiring** (exact code C3 must add, or "none") and **FIX REQUESTS** (or "none") sections. PR opened per AGENTS.md §6 with `Closes #<issue>`. Print the PR URL last.

## Git
Branch `epic/134-web-metrics-r2`. Conventional Commits scoped to your lane, committed small and often (at least 5 commits). `git fetch origin && git rebase origin/main` before pushing. No merging, no tags. Never `git add -A` at the repo root without checking `git status` first: only your lane's files belong in the PR.
