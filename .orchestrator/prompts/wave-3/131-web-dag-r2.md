# Epic 131: Web: DAG round 2 (60-task plans, lane collapse, re-plan diff)

**Wave 3 · Branch `epic/131-web-dag-r2` · Issue: `gh issue list --search "Epic 131 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 90–150 min of autonomous work**

## Where you are
Starling (`.orchestrator/PRD.md`) is an open-source, open-weight-first harness. It turns one coding goal into a lane-safe task DAG, runs a flock of opencode agents in parallel git worktrees on this laptop and on other laptops ("perches"), audits each result, and merges everything through a queue, shown live in a murmuration dashboard.

**Waves 0, 1, C1 and 2 are merged** (tags `epic-NN-complete`). About 2,500 tests pass across every package, the CLI, server, web dashboard, skill, tools and evals. Epic 40 (integration captain) is landing the **real** composition (`starling run` driving real opencode agents) in parallel with you, so for now `apps/cli`, `packages/core`, `packages/llm`, `packages/runner` and `apps/web/src/data` are **off limits** (Wave 3b takes them after Epic 40 merges).

**Wave 3 is the big one: about 100 agents run at the same time on one laptop**, each in its own worktree and lane. That only works if everyone follows the rules below exactly.

**Read before you start:** `AGENTS.md`, `.orchestrator/ARCHITECTURE.md` (§6 contracts, §7 locked decisions), the `docs/epic-*.md` for every package you touch (their "Interfaces for future epics" sections), the handbacks in `.orchestrator/handbacks/` that mention your area, and **`.orchestrator/fix-requests-w2.md`**.

## Tech decisions already locked (build on these, don't relitigate)
ARCHITECTURE §7 **L1–L31** still hold (Bun 1.4.4, TS 5.9.3, zod 4, Biome 2.6.3; web tests run in their own process; Markdown formatter off; no local models; real LLM calls only via the `opencode` profile). Wave 3 adds:
- **L32 Lanes are absolute.** Write only inside your lane, plus your own `docs/epic-131-web-dag-r2.md` and `.orchestrator/handbacks/131-web-dag-r2.md`. Shared registration files you don't own (`apps/web/src/App.tsx` and `app/Layout.tsx`, `apps/cli/src/program.ts`, `apps/server/src/app.ts`, any package `index.ts` outside your lane) are **wired later by checkpoint C3**. Ship your work as a self-contained module with the manifest described in your prompt, and say in the handback exactly what C3 must add (file, line, code).
- **L33 Public APIs are additive only.** Never rename or remove an export, field, route, CLI flag or event other code uses. Deprecate instead. About 100 branches merge after yours.
- **L34 No new dependencies.** Don't touch any `package.json` dependency list, `bun.lock`, the root `package.json`, `tsconfig.base.json` or `biome.json`. Everything you need is already installed (React 19, lucide-react, zustand, @xyflow/react, Tailwind v4, Hono, commander, zod, bun:test, happy-dom, Playwright). If something is truly missing, write a CONTRACT REQUEST instead.
- **L35 Heavy commands go through the slot gate.** With 100 agents, everyone running the full suite at once would melt the laptop. While iterating, run **only your own tests** (`bun test <your dir>`; for web code `cd apps/web && bun test src/features/<x>`) and **only your own typecheck** (`bunx tsc --noEmit -p <your package or app>`). Run the full suite **once, at the end**, through the gate: `bash .orchestrator/bin/heavy.sh bun run test` and `bash .orchestrator/bin/heavy.sh bun run check` (also wrap `bun run build` and any Playwright run). The gate may print "waiting" for a few minutes. If your shell tool times out while it waits, just run it again.
- **L36 Bugs outside your lane are FIX REQUESTS, never edits.** QA epics record a confirmed bug as **`test.todo('BUG <area>: <one line>', () => { ... })`** with the real assertions inside, plus a FIX REQUEST. Never use `test.failing` and never commit a red test: about 100 fixes land in parallel, and a `test.failing` turns red the moment someone fixes the bug. **The one allowed cross-lane edit:** if your fix makes an existing `test.failing` probe in `tools/security/**` pass, change that probe's `test.failing(` to `test(` in the same PR (nothing else in that file) and say so in the handback.
- **L37 No real model calls and no real Starling runs in Wave 3a** unless your prompt says otherwise. Use the recorded runs in `fixtures/runs/*.jsonl`, `@starling/core/testing` fakes and the mock compose paths. No Ollama, no local models (L23).
- **L38 Tests live next to the code, and everything is deterministic.** No sleeps over 50 ms, no wall-clock assertions, no network beyond `127.0.0.1` on port `0`, and temp dirs under `os.tmpdir()` that clean up after themselves. Another 99 agents are hammering the CPU, so timing-sensitive tests will flake.
- **Legibility floor is enforced across lanes.** `apps/web/src/features/metrics/legibility.test.ts` (Epic 55, metrics lane) scans every non-test `.ts/.tsx` in `dag`, `agents`, `queue`, `metrics` and `flock`: no `text-[<12px]`, no `text-[13px]`, no `text-slate-500`…`900` (or gray/zinc/neutral/stone), no shell `text-micro`/`text-caption` tokens. New code in those folders must pass it; run it with your own tests (`cd apps/web && bun test src/features/metrics/legibility.test.ts`).
- **Additive props only, the existing way.** New inputs are optional props declared in your feature's `types.ts` extras intersection (pattern: `DagViewExtras`, `QueueExtras`, `MetricsExtras`, `FlockPanelExtras`), so the component still satisfies the frozen §8 props from `@starling/core`. `app/Layout.tsx` is Epic 112's: in the handback's **C3 wiring** give the exact prop expression C3 should add at the call site (e.g. `tasks={activeRunOf(state)?.tasks}`), and make the component behave well when it's absent.
- Test DOM pattern: copy `features/flock/test-dom.ts` (register happy-dom defensively, `react-dom/client` + `act`, no Testing Library `screen`). Web tests run in their own process: `cd apps/web && bun test src/features/<x>`.
- Visible changes will break the two e2e visual baselines (`apps/web/e2e/__screenshots__/end-*.png`, Epic 140's lane). Don't re-record them; write "C3: re-record e2e baselines (`bun run --cwd apps/web e2e:update`)" in the handback.
- e2e reads `data-testid="dag-canvas"` and `getByRole('region', { name: 'Flight plan region' })` (shell). Keep `dag-canvas`, and keep the recorded 7-task plan expanded by default (it's under the threshold).

## FIRST TASK: carryover
Open `.orchestrator/fix-requests-w2.md`. Implement every request that targets a file in your lane, or decline it with a one-line reason. List each one in your handback under **Carryover done**.

Also, specifically for this epic:
- No Wave 2 FIX REQUEST targets `features/dag`. Epic 55 already shipped the critical path, follow mode and status flash (`critical-path.ts`, `follow.ts`, `use-status-flash.ts`): build on them, don't redo them. Write "none" under **Carryover done**.

## Your lane (you may write ONLY here)
`apps/web/src/features/dag/**`
plus `docs/epic-131-web-dag-r2.md` and `.orchestrator/handbacks/131-web-dag-r2.md`. Read anything.

## Goal
The flight plan reads beautifully at 7 tasks; Wave 3's goals produce 30–60. At that size the Dagre graph becomes a wall of tiny cards. Round 2 keeps big plans readable. Collapse tasks into one node per lane, auto-enable the minimap, and switch to compact cards when zoomed out. It also makes the plan tell a story: the critical path visibly flows, and when the planner re-plans mid-run (Epic 107 adds plan diffing in parallel) the changed tasks light up. Great looks like this: a 60-task plan fits a 1280×720 centre region with every lane name readable, and expanding one lane takes a single click.

## Deliverables
1. **Big fixture**: `dag/fixtures-big.ts`: `bigPlan(n = 60, seed = 1): { plan: Plan; tasks: Record<string, TaskRun> }`. It's deterministic, uses about 8 lanes with layered dependencies and realistic `owns` globs, and mixes statuses. It's used by tests and the Playground, never by production code paths.
2. **Lane grouping (pure)**: `laneKeyOf(task: TaskSpec): string` is the first `owns` glob's directory prefix without the trailing `/**` or `*` (`src/features/export/**` → `src/features/export`), or `(no lane)`. `groupByLane(plan: Plan, tasks: Record<string, TaskRun>): LaneGroup[]` with `LaneGroup = { id: string; label: string; keys: string[]; counts: Record<TaskStatus, number>; critical: boolean }`, plus `aggregateEdges(plan, groups, expanded: ReadonlySet<string>)` that collapses edges between groups with a count label.
3. **Collapsed rendering**:
   - Plans with more than `COLLAPSE_AFTER = 24` tasks start collapsed: one group node per lane, showing the label, "12 tasks", and a mini status bar.
   - Click or Enter expands a group in place (re-layout with the expanded set; memoise the layout by `plan.id` + sorted expanded ids).
   - A toolbar toggle "Collapse by lane" uses `aria-pressed`.
   - The group containing `selectedTask` auto-expands.
   - Arrow-key navigation (Epic 25) works across group nodes.
4. **Minimap and zoom**:
   - The minimap toggle exists (`DagView.tsx:59`); turn it on automatically above 24 tasks, with nodes coloured by status and a labelled control.
   - Below zoom 0.6 cards render a compact variant (key + status dot). Read zoom with a narrow React Flow store selector so pan/zoom doesn't re-render every card.
   - `fitView` minimum zoom is 0.35.
5. **Critical path animation**: use the existing `criticalPath(plan)` / `criticalEdges`. Critical edges get a moving dash (`stroke-dashoffset` keyframes) and critical nodes a soft glow, only while the run has live tasks. Under `reducedMotion` (the existing `DagViewExtras`) the highlight is static.
6. **Re-plan diff**:
   - Pure `diffPlanTasks(prev: Plan, next: Plan): { added: string[]; removed: string[]; changed: string[] }`, where changed means a different title, `dependsOn`, `owns` or `estimateMin`. Write it locally: Epic 107 is adding `diffPlans` to the planner package in parallel, so don't import it.
   - When `plan.id` changes for the same `plan.goalId`, added tasks glow green and changed ones amber for 6 s. Removed tasks render as fading ghost nodes for 6 s.
   - A legend chip reads "re-planned: +2 −1 ~3". Under reduced motion it's badges only, no fades.
   - Keep the previous plan in a ref keyed by `goalId`.
7. **Performance**: node/edge arrays are memoised, and the layout runs once per (plan, expanded set). Test this with an injected or spied layout function and a call count.
8. **Playground**: a plan-size switch (7 recorded / 60 synthetic), a "re-plan" button (mutates the plan into a new id with +2/−1/~3), and the collapse toggle.
9. **Tests (≥ 30 new)**: `laneKeyOf` edge cases, grouping, aggregated edges, collapse threshold, expand/selection behaviour, `diffPlanTasks`, ghost timing with fake timers, the layout-call count, and the reduced-motion paths.

## Explicitly out of scope
- Planner `diffPlans` (Epic 107), lanes treemap (Epic 115), timeline (Epic 114): no imports from them.
- Shell layout, view switching and `Layout.tsx` (Epic 112).
- No core contract changes (Wave 3b).

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree (it must not change `bun.lock`).
2. `cd apps/web && bun test src/features/dag src/features/metrics/legibility.test.ts` → 0 fail, ≥ 30 new tests.
3. `bunx tsc --noEmit -p apps/web` clean and `bunx biome check apps/web/src/features/dag` clean.
4. Playground `/src/features/dag/playground.html`: commit 2 PNGs ≤ 300 KB (60 tasks collapsed at 1280×720; re-plan highlight) to `features/dag/__screens__/` and paste the number of rendered nodes collapsed vs expanded.
5. `bash .orchestrator/bin/heavy.sh bun run test` at the repo root → 0 fail (paste both halves' summary lines).
6. `bash .orchestrator/bin/heavy.sh bun run check` → clean.
7. `docs/epic-131-web-dag-r2.md` (AGENTS.md §6 sections) and `.orchestrator/handbacks/131-web-dag-r2.md` written. The handback has **Carryover done**, **C3 wiring** (exact code C3 must add, or "none") and **FIX REQUESTS** (or "none") sections. PR opened per AGENTS.md §6 with `Closes #<issue>`. Print the PR URL last.

## Git
Branch `epic/131-web-dag-r2`. Conventional Commits scoped to your lane, committed small and often (at least 5 commits). `git fetch origin && git rebase origin/main` before pushing. No merging, no tags. Never `git add -A` at the repo root without checking `git status` first: only your lane's files belong in the PR.
