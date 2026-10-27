# Epic 155: Load test round 2: 60 and 100 tasks, 20 dashboards, Wave 2 baseline

**Wave 3 · Branch `epic/155-load-r2` · Issue: `gh issue list --search "Epic 155 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 90–150 min of autonomous work**

## Where you are
Starling (`.orchestrator/PRD.md`) is an open-source, open-weight-first harness. It turns one coding goal into a lane-safe task DAG, runs a flock of opencode agents in parallel git worktrees on this laptop and on other laptops ("perches"), audits each result, and merges everything through a queue, shown live in a murmuration dashboard.

**Waves 0, 1, C1 and 2 are merged** (tags `epic-NN-complete`). About 2,500 tests pass across every package, the CLI, server, web dashboard, skill, tools and evals. Epic 40 (integration captain) is landing the **real** composition (`starling run` driving real opencode agents) in parallel with you, so for now `apps/cli`, `packages/core`, `packages/llm`, `packages/runner` and `apps/web/src/data` are **off limits** (Wave 3b takes them after Epic 40 merges).

**Wave 3 is the big one: about 100 agents run at the same time on one laptop**, each in its own worktree and lane. That only works if everyone follows the rules below exactly.

**Read before you start:** `AGENTS.md`, `.orchestrator/ARCHITECTURE.md` (§6 contracts, §7 locked decisions), the `docs/epic-*.md` for every package you touch (their "Interfaces for future epics" sections), the handbacks in `.orchestrator/handbacks/` that mention your area, and **`.orchestrator/fix-requests-w2.md`**.

## Tech decisions already locked (build on these, don't relitigate)
ARCHITECTURE §7 **L1–L31** still hold (Bun 1.4.4, TS 5.9.3, zod 4, Biome 2.6.3; web tests run in their own process; Markdown formatter off; no local models; real LLM calls only via the `opencode` profile). Wave 3 adds:
- **L32 Lanes are absolute.** Write only inside your lane, plus your own `docs/epic-155-load-r2.md` and `.orchestrator/handbacks/155-load-r2.md`. Shared registration files you don't own (`apps/web/src/App.tsx` and `app/Layout.tsx`, `apps/cli/src/program.ts`, `apps/server/src/app.ts`, any package `index.ts` outside your lane) are **wired later by checkpoint C3**. Ship your work as a self-contained module with the manifest described in your prompt, and say in the handback exactly what C3 must add (file, line, code).
- **L33 Public APIs are additive only.** Never rename or remove an export, field, route, CLI flag or event other code uses. Deprecate instead. About 100 branches merge after yours.
- **L34 No new dependencies.** Don't touch any `package.json` dependency list, `bun.lock`, the root `package.json`, `tsconfig.base.json` or `biome.json`. Everything you need is already installed (React 19, lucide-react, zustand, @xyflow/react, Tailwind v4, Hono, commander, zod, bun:test, happy-dom, Playwright). If something is truly missing, write a CONTRACT REQUEST instead.
- **L35 Heavy commands go through the slot gate.** With 100 agents, everyone running the full suite at once would melt the laptop. While iterating, run **only your own tests** (`bun test <your dir>`; for web code `cd apps/web && bun test src/features/<x>`) and **only your own typecheck** (`bunx tsc --noEmit -p <your package or app>`). Run the full suite **once, at the end**, through the gate: `bash .orchestrator/bin/heavy.sh bun run test` and `bash .orchestrator/bin/heavy.sh bun run check` (also wrap `bun run build` and any Playwright run). The gate may print "waiting" for a few minutes. If your shell tool times out while it waits, just run it again.
- **L36 Bugs outside your lane are FIX REQUESTS, never edits.** QA epics record a confirmed bug as **`test.todo('BUG <area>: <one line>', () => { ... })`** with the real assertions inside, plus a FIX REQUEST. Never use `test.failing` and never commit a red test: about 100 fixes land in parallel, and a `test.failing` turns red the moment someone fixes the bug. **The one allowed cross-lane edit:** if your fix makes an existing `test.failing` probe in `tools/security/**` pass, change that probe's `test.failing(` to `test(` in the same PR (nothing else in that file) and say so in the handback.
- **L37 No real model calls and no real Starling runs in Wave 3a** unless your prompt says otherwise. Use the recorded runs in `fixtures/runs/*.jsonl`, `@starling/core/testing` fakes and the mock compose paths. No Ollama, no local models (L23).
- **L38 Tests live next to the code, and everything is deterministic.** No sleeps over 50 ms, no wall-clock assertions, no network beyond `127.0.0.1` on port `0`, and temp dirs under `os.tmpdir()` that clean up after themselves. Another 99 agents are hammering the CPU, so timing-sensitive tests will flake.
- **Heavy runs only through the gate.** The 60/100-task scenarios create 60–100 git worktrees and run for minutes: always `bash .orchestrator/bin/heavy.sh …`, never in unit tests. Unit tests stay at ≤ 6 tasks.
- The rig imports `apps/web/src/data/reducer.ts` and packages under test by relative path; that's reading, which is allowed. Several of those packages change under you in Wave 3: if an import breaks after a rebase, adapt the rig (it's your lane), don't touch the package.

## FIRST TASK: carryover
Open `.orchestrator/fix-requests-w2.md`. Implement every request that targets a file in your lane, or decline it with a one-line reason. List each one in your handback under **Carryover done**.

Also, specifically for this epic:
- **70-load-test, F1–F8** (owners elsewhere): don't fix them, re-measure them (item 6) so each owner learns whether its fix worked: F1 merge-queue bypass (`--raw-merges`), F2 slot freed before cleanup (`--headroom 0`), F3 double persistence (`--double-record`), F4 stale replay timestamps (`--no-retime`), F5 audits in the hub repo (check `TaskRun.worktreePath` in stored runs), F6 synchronous backlog burst (late-joiner drain time), F7 planner `maxTasks` warning, F8 reducer `appendCapped` churn.
- **70, deferred:** "push the load test into CI as a performance budget". Provide `budgets.json` + `checkBudgets` (item 8); Epic 150 wires the job.

## Your lane (you may write ONLY here)
`tools/load/**`
plus `docs/epic-155-load-r2.md` and `.orchestrator/handbacks/155-load-r2.md`. Read anything.

## Goal
Epic 70 showed Starling flies 30 tasks with 20 agents and 20 dashboards, and found eight problems (F1–F8). Wave 3 is fixing them in parallel and the demo wants a 100-bird murmuration. This epic pushes the same honest, no-model rig to **60 and 100 tasks**, fans the SSE stream out to 20 dashboards at that scale, re-checks each F-finding so the owners know if their fix worked, and compares everything with the committed Wave 2 baseline. Great looks like: one command gives a comparison table with clear "better / same / worse" calls, the scale bugs in the rig itself are fixed, and default test runs stay tiny.

## Deliverables
1. **Freeze the baseline first** (first commit): copy the committed `tools/load/results/*.json` to `tools/load/results/baseline-w2/` unchanged, and make `writeResult` refuse to write into `baseline-*` directories. Round 2 results go to `tools/load/results/w3/`.
2. **Fix the rig's scale bugs:** `taskKeyFor`/`pad2` and `fileForTask`'s `/^t(\d{2})/` collide at ≥ 100 tasks (`t100-…` maps to `src/task-10/`). Use width = `max(2, digits(count))` everywhere (keys, lanes, files) and test 9, 10, 99, 100, 101 tasks for unique lanes and files. Check the planner's `maxTasks` (12 by default, F7) only warns at 60/100 tasks and pass `maxTasks` explicitly if `createPlanner` accepts it.
3. **DAG shapes:** `buildPlanDraft(count, { shape })` with `shape: 'two-waves'` (today's: first 2/3 independent, the rest depend on one root), `'chains'` (k independent chains), `'diamond-layers'` (layers of width w, each task depending on two in the previous layer). Validated by the real planner; tests check acyclicity and depth.
4. **Scenarios:** `tools/load/scenarios.ts` with named presets: `w2-baseline` (30 tasks, parallel 20, the exact Wave 2 settings), `t60` (60 tasks, parallel 20), `t100` (100 tasks, parallel 30), `t100-wide` (100 tasks, `diamond-layers`), and `fanout20` (the SSE test at 100 tasks with 20 dashboards). `bun tools/load/index.ts --scenario <name>` and `--scenario all`; `--quick` scales every preset down (≤ 12 tasks) for CI and tests.
5. **SSE fan-out at scale:** extend `sse.ts` to accept the scenario's plan size; add a `--clients 40` probe that records how many connections get a non-200 answer (Epic 110 is adding an SSE cap, about 32, in parallel: report the observed cap, don't fail on it) and a token option (`STARLING_TOKEN` → `x-flock-token` header) in case 110's auth lands. Measure per-client delivery latency percentiles, dropped/duplicate frames (must stay 0), backlog drain time for a late joiner (F6), and server RSS.
6. **Findings re-check:** `tools/load/findings.ts`: `bun tools/load/findings.ts [--quick]` re-runs each of Epic 70's reproductions (`--raw-merges`, `--headroom 0`, `--double-record`, `--no-retime` engine and SSE, backlog drain, reducer cap churn) and prints, per finding F1–F8, `still present` / `looks fixed` / `not measurable here` with the evidence number (e.g. "F3: 18,466 rows for 9,233 events → still present"). This is information for the owners (Epics 100, 104, 110, 201, 204), not a test gate. Writes `results/w3/findings.json`.
7. **Comparison:** `tools/load/compare.ts`: pure `compareReports(base, current, { thresholds })` → rows `{ metric, base, current, deltaPct, verdict: 'better' | 'same' | 'worse' }` with per-metric direction (lower-is-better for latencies/RSS, higher for events/s) and noise thresholds (±15 % and an absolute floor, e.g. 5 ms) because the laptop is shared with ~100 agents; record the load average with each run (`os.loadavg()`) and print it next to the table. `bun tools/load/compare.ts` writes `results/w3/compare.md` (Markdown table + a one-paragraph reading).
8. **Budgets for CI (Epic 70 deferred this):** `tools/load/budgets.json` with generous, op-count-style limits for the `--quick` run (all tasks merged, 0 dropped frames, reducer caps hold, events/task ≈ configured) and `checkBudgets(report)`; a unit test runs the `--quick` engine scenario at ≤ 6 tasks with `--events 30` and asserts only the count-based budgets (no timings). Epic 150's nightly job already runs `bun tools/load/index.ts --quick`: keep that command working.
9. **Docs:** update `tools/load/README.md` (scenarios, findings, compare, budgets) and add a "Round 2" section to your epic doc with the 60- and 100-task tables.
10. Tests (≥ 25 new): key/lane/file uniqueness at 99/100/101; each DAG shape (task count, acyclic, depth); scenario parsing; baseline write protection; `compareReports` directions, thresholds, missing metrics; findings classification from synthetic reports; budget checks; the tiny real engine scenario (≤ 6 tasks).

## Explicitly out of scope
- Fixing F1–F8 in the packages (owners: engine 100, merger 104, server 110, runner 201, web data 204). Report status only.
- Remote perches, real models, real agents (L37). Any change outside `tools/load/**`.
- Adding the load test as a blocking CI job (Epic 150 decides; you provide budgets).

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree (it must not change `bun.lock`).
2. `bun test tools/load` → 0 fail, ≥ 25 new tests; `bunx tsc --noEmit -p tools/load/tsconfig.json` clean.
3. `bash .orchestrator/bin/heavy.sh bun tools/load/index.ts --scenario t60` and `--scenario t100`: paste both engine tables (all tasks merged or the failures explained) and the load average.
4. `bash .orchestrator/bin/heavy.sh bun tools/load/index.ts --scenario fanout20` and `bun tools/load/findings.ts`: paste the SSE table and the F1–F8 status list.
5. `bun tools/load/compare.ts` → paste `results/w3/compare.md`.
6. `bash .orchestrator/bin/heavy.sh bun run test` at the repo root → 0 fail (paste both halves' summary lines).
7. `bash .orchestrator/bin/heavy.sh bun run check` → clean.
8. `docs/epic-155-load-r2.md` (AGENTS.md §6 sections) and `.orchestrator/handbacks/155-load-r2.md` written. The handback has **Carryover done**, **C3 wiring** (exact code C3 must add, or "none") and **FIX REQUESTS** (or "none") sections. PR opened per AGENTS.md §6 with `Closes #<issue>`. Print the PR URL last.

## Git
Branch `epic/155-load-r2`. Conventional Commits scoped to your lane, committed small and often (at least 5 commits). `git fetch origin && git rebase origin/main` before pushing. No merging, no tags. Never `git add -A` at the repo root without checking `git status` first: only your lane's files belong in the PR.
