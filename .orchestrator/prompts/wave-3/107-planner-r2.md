# Epic 107: Planner round 2: one repo-map renderer, swarm-size plans, plan diffing, lane suggestions

**Wave 3 · Branch `epic/107-planner-r2` · Issue: `gh issue list --search "Epic 107 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 60–120 min of autonomous work**

## Where you are
Starling (`.orchestrator/PRD.md`) is an open-source, open-weight-first harness. It turns one coding goal into a lane-safe task DAG, runs a flock of opencode agents in parallel git worktrees on this laptop and on other laptops ("perches"), audits each result, and merges everything through a queue, shown live in a murmuration dashboard.

**Waves 0, 1, C1 and 2 are merged** (tags `epic-NN-complete`). About 2,500 tests pass across every package, the CLI, server, web dashboard, skill, tools and evals. Epic 40 (integration captain) is landing the **real** composition (`starling run` driving real opencode agents) in parallel with you, so for now `apps/cli`, `packages/core`, `packages/llm`, `packages/runner` and `apps/web/src/data` are **off limits** (Wave 3b takes them after Epic 40 merges).

**Wave 3 is the big one: about 100 agents run at the same time on one laptop**, each in its own worktree and lane. That only works if everyone follows the rules below exactly.

**Read before you start:** `AGENTS.md`, `.orchestrator/ARCHITECTURE.md` (§6 contracts, §7 locked decisions), the `docs/epic-*.md` for every package you touch (their "Interfaces for future epics" sections), the handbacks in `.orchestrator/handbacks/` that mention your area, and **`.orchestrator/fix-requests-w2.md`**.

## Tech decisions already locked (build on these, don't relitigate)
ARCHITECTURE §7 **L1–L31** still hold (Bun 1.4.4, TS 5.9.3, zod 4, Biome 2.6.3; web tests run in their own process; Markdown formatter off; no local models; real LLM calls only via the `opencode` profile). Wave 3 adds:
- **L32 Lanes are absolute.** Write only inside your lane, plus your own `docs/epic-107-planner-r2.md` and `.orchestrator/handbacks/107-planner-r2.md`. Shared registration files you don't own (`apps/web/src/App.tsx` and `app/Layout.tsx`, `apps/cli/src/program.ts`, `apps/server/src/app.ts`, any package `index.ts` outside your lane) are **wired later by checkpoint C3**. Ship your work as a self-contained module with the manifest described in your prompt, and say in the handback exactly what C3 must add (file, line, code).
- **L33 Public APIs are additive only.** Never rename or remove an export, field, route, CLI flag or event other code uses. Deprecate instead. About 100 branches merge after yours.
- **L34 No new dependencies.** Don't touch any `package.json` dependency list, `bun.lock`, the root `package.json`, `tsconfig.base.json` or `biome.json`. Everything you need is already installed (React 19, lucide-react, zustand, @xyflow/react, Tailwind v4, Hono, commander, zod, bun:test, happy-dom, Playwright). If something is truly missing, write a CONTRACT REQUEST instead.
- **L35 Heavy commands go through the slot gate.** With 100 agents, everyone running the full suite at once would melt the laptop. While iterating, run **only your own tests** (`bun test <your dir>`; for web code `cd apps/web && bun test src/features/<x>`) and **only your own typecheck** (`bunx tsc --noEmit -p <your package or app>`). Run the full suite **once, at the end**, through the gate: `bash .orchestrator/bin/heavy.sh bun run test` and `bash .orchestrator/bin/heavy.sh bun run check` (also wrap `bun run build` and any Playwright run). The gate may print "waiting" for a few minutes. If your shell tool times out while it waits, just run it again.
- **L36 Bugs outside your lane are FIX REQUESTS, never edits.** QA epics record a confirmed bug as **`test.todo('BUG <area>: <one line>', () => { ... })`** with the real assertions inside, plus a FIX REQUEST. Never use `test.failing` and never commit a red test: about 100 fixes land in parallel, and a `test.failing` turns red the moment someone fixes the bug. **The one allowed cross-lane edit:** if your fix makes an existing `test.failing` probe in `tools/security/**` pass, change that probe's `test.failing(` to `test(` in the same PR (nothing else in that file) and say so in the handback.
- **L37 No real model calls and no real Starling runs in Wave 3a** unless your prompt says otherwise. Use the recorded runs in `fixtures/runs/*.jsonl`, `@starling/core/testing` fakes and the mock compose paths. No Ollama, no local models (L23).
- **L38 Tests live next to the code, and everything is deterministic.** No sleeps over 50 ms, no wall-clock assertions, no network beyond `127.0.0.1` on port `0`, and temp dirs under `os.tmpdir()` that clean up after themselves. Another 99 agents are hammering the CPU, so timing-sensitive tests will flake.


## FIRST TASK: carryover
Open `.orchestrator/fix-requests-w2.md`. Implement every request that targets a file in your lane, or decline it with a one-line reason. List each one in your handback under **Carryover done**.

Also, specifically for this epic:
- **56 #1:** the planner still carries its own renderer. Deprecate it and pin the repomap path (deliverable 1).
- **70 F7:** `maxTasks` is capped at 12 (deliverable 2).
- **56 open question:** warn when a lane owns more than ~40 files (deliverable 3).
- **48 deferred:** deleting `render-map.ts` is declined under L33. Deprecate instead.

## Your lane (you may write ONLY here)
`packages/planner/**`
plus `docs/epic-107-planner-r2.md` and `.orchestrator/handbacks/107-planner-r2.md`. Read anything.

## Goal
The planner decides how parallel the murmuration can be. Wave 3 needs it to plan at swarm scale (30–60 tasks, not 12), explain its validation findings so a human can act on them, suggest how to untangle overlapping lanes, and diff two plans so a re-plan can be highlighted in the DAG (Epic 131) and in run comparisons (Epic 122). Great looks like: `diffPlans` and `suggestLanes` are pure and well tested, and no prompt text changes, so the planner evals keep their scores.

## Deliverables
1. **One renderer** (56 #1, 48 deferred). `@starling/repomap`'s renderer is already the default (`DEFAULT_MAP_RENDERER = 'repomap'`, `src/prompt.ts:88`). Mark `renderRepoMap`/`RenderRepoMapOptions` from `src/render-map.ts` and `MapRenderer = 'verbose'` as `@deprecated` (JSDoc, with the reason and a removal note). Don't delete them (L33). Make sure nothing else in the package calls the verbose renderer, and test that `buildPlanPrompt` embeds exactly `renderRepomap(map, { maxTokens })` output.
2. **Swarm-size plans** (70 F7). `createPlanner({ maxTasks })` accepts `2..PLANNER_MAX_TASKS_LIMIT` (export it, `= 100`) instead of throwing above 12 (`src/planner.ts:141`). `DEFAULT_MAX_TASKS` stays 12. `validatePlan`'s count bound follows the option. Test 60-task plans for validation speed (op counts, not wall clock) and correctness.
3. **Lane-size warning** (56 open question). A `warn` `PlanIssue` (code `'other'`) when a task's globs match more than `ValidatePlanOptions.ownedFilesWarnAt` (default 40) files in the map, naming the count and suggesting a split. Only when a map is given.
4. **`diffPlans(a: Plan, b: Plan): PlanDiff`** (new `src/diff.ts`). Tasks match by key, then by normalised title (`stripTaskNumber` plus lower-cased title). `PlanDiff = { added: TaskSpec[]; removed: TaskSpec[]; renamed: Array<{ from: string; to: string }>; changed: Array<{ key: string; fields: Array<'title' | 'lane' | 'dependsOn' | 'definitionOfDone' | 'estimateMin' | 'description'>; laneAdded: string[]; laneRemoved: string[] }>; unchanged: string[]; summary: string }`. Deterministic order. Also `formatPlanDiff(d): string` (Markdown). 10+ tests including reorder-only and rename-only.
5. **`suggestLanes(plan: Plan, map?: RepoMap): LaneSuggestion[]`** (new `src/suggest.ts`). For every concurrent overlapping pair (the same detection as `validatePlan`'s `lane-overlap`), propose the cheapest fixes: `serialise` (add `dependsOn` in the direction that keeps the critical path shortest), `narrow` (replace a shared directory glob with the specific overlapping files moved to one owner), or `merge` (when the overlap is over 50% of both lanes). `LaneSuggestion = { kind: 'serialise' | 'narrow' | 'merge'; taskKeys: [string, string]; rationale: string; apply(plan: Plan): Plan }`, or a plain `patch` plus `applyLaneSuggestion(plan, s)` if you prefer JSON-serialisable output. Pick one and document it. Every applied suggestion re-validates with no new errors.
6. **Better messages.** Append a concrete hint to each `validatePlan` message, e.g. `…; fix: add "t03" to t05.dependsOn or narrow t05's lane`. **Keep each existing message's first clause byte-identical**, since evals and snapshots may match on it. Add `explainIssues(issues: PlanIssue[]): string` (grouped, human-readable) for the CLI. Table-driven tests for every code.
7. Write **at least 30 new tests**. Don't change `PLANNER_SYSTEM_PROMPT` or the doctrine text: evals (Epic 161) are calibrated against them.

## Explicitly out of scope
- `packages/repomap` (Epic 108) and the planner evals in `evals/planner/**` (Epic 161).
- New `PlanIssue` codes (a core enum, Epic 202): use `'other'` with a clear message.
- Any real model call (L37): tests use the existing MockLLM fixtures.

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree (it must not change `bun.lock`).
2. `bun test packages/planner` → 0 fail, ≥ 30 new tests, existing snapshots unchanged (prompt text untouched).
3. `bunx tsc --noEmit -p packages/planner` clean.
4. Paste `formatPlanDiff(diffPlans(a, b))` for `fixtures/plans/*` against a hand-edited copy (one task renamed, one lane widened, one added).
5. `bash .orchestrator/bin/heavy.sh bun run test` at the repo root → 0 fail (paste both halves' summary lines).
6. `bash .orchestrator/bin/heavy.sh bun run check` → clean.
7. `docs/epic-107-planner-r2.md` (AGENTS.md §6 sections) and `.orchestrator/handbacks/107-planner-r2.md` written. The handback has **Carryover done**, **C3 wiring** (exact code C3 must add, or "none") and **FIX REQUESTS** (or "none") sections. PR opened per AGENTS.md §6 with `Closes #<issue>`. Print the PR URL last.

## Git
Branch `epic/107-planner-r2`. Conventional Commits scoped to your lane, committed small and often (at least 5 commits). `git fetch origin && git rebase origin/main` before pushing. No merging, no tags. Never `git add -A` at the repo root without checking `git status` first: only your lane's files belong in the PR.
