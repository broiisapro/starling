# Epic 205: Evals: end-to-end (plan → run → audit → merge) with scripted agents

**Wave 3b · Branch `epic/205-evals-e2e` · Issue: `gh issue list --search "Epic 205 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 90–150 min of autonomous work**

## Where you are
Starling (`.orchestrator/PRD.md`) is an open-source, open-weight-first harness. It turns one coding goal into a lane-safe task DAG, runs a flock of opencode agents in parallel git worktrees on this laptop and on other laptops ("perches"), audits each result, and merges everything through a queue, shown live in a murmuration dashboard.

**Waves 0, 1, C1 and 2 are merged** (tags `epic-NN-complete`). About 2,500 tests pass across every package, the CLI, server, web dashboard, skill, tools and evals. Epic 40 (integration captain) is landing the **real** composition (`starling run` driving real opencode agents) in parallel with you, so for now `apps/cli`, `packages/core`, `packages/llm`, `packages/runner` and `apps/web/src/data` are **off limits** (Wave 3b takes them after Epic 40 merges).

**Wave 3 is the big one: about 100 agents run at the same time on one laptop**, each in its own worktree and lane. That only works if everyone follows the rules below exactly.

**Read before you start:** `AGENTS.md`, `.orchestrator/ARCHITECTURE.md` (§6 contracts, §7 locked decisions), the `docs/epic-*.md` for every package you touch (their "Interfaces for future epics" sections), the handbacks in `.orchestrator/handbacks/` that mention your area, and **`.orchestrator/fix-requests-w2.md`**.

## Tech decisions already locked (build on these, don't relitigate)
ARCHITECTURE §7 **L1–L31** still hold (Bun 1.4.4, TS 5.9.3, zod 4, Biome 2.6.3; web tests run in their own process; Markdown formatter off; no local models; real LLM calls only via the `opencode` profile). Wave 3 adds:
- **L32 Lanes are absolute.** Write only inside your lane, plus your own `docs/epic-205-evals-e2e.md` and `.orchestrator/handbacks/205-evals-e2e.md`. Shared registration files you don't own (`apps/web/src/App.tsx` and `app/Layout.tsx`, `apps/cli/src/program.ts`, `apps/server/src/app.ts`, any package `index.ts` outside your lane) are **wired later by checkpoint C3**. Ship your work as a self-contained module with the manifest described in your prompt, and say in the handback exactly what C3 must add (file, line, code).
- **L33 Public APIs are additive only.** Never rename or remove an export, field, route, CLI flag or event other code uses. Deprecate instead. About 100 branches merge after yours.
- **L34 No new dependencies.** Don't touch any `package.json` dependency list, `bun.lock`, the root `package.json`, `tsconfig.base.json` or `biome.json`. Everything you need is already installed (React 19, lucide-react, zustand, @xyflow/react, Tailwind v4, Hono, commander, zod, bun:test, happy-dom, Playwright). If something is truly missing, write a CONTRACT REQUEST instead.
- **L35 Heavy commands go through the slot gate.** With 100 agents, everyone running the full suite at once would melt the laptop. While iterating, run **only your own tests** (`bun test <your dir>`; for web code `cd apps/web && bun test src/features/<x>`) and **only your own typecheck** (`bunx tsc --noEmit -p <your package or app>`). Run the full suite **once, at the end**, through the gate: `bash .orchestrator/bin/heavy.sh bun run test` and `bash .orchestrator/bin/heavy.sh bun run check` (also wrap `bun run build` and any Playwright run). The gate may print "waiting" for a few minutes. If your shell tool times out while it waits, just run it again.
- **L36 Bugs outside your lane are FIX REQUESTS, never edits.** QA epics record a confirmed bug as **`test.todo('BUG <area>: <one line>', () => { ... })`** with the real assertions inside, plus a FIX REQUEST. Never use `test.failing` and never commit a red test: about 100 fixes land in parallel, and a `test.failing` turns red the moment someone fixes the bug. **The one allowed cross-lane edit:** if your fix makes an existing `test.failing` probe in `tools/security/**` pass, change that probe's `test.failing(` to `test(` in the same PR (nothing else in that file) and say so in the handback.
- **L37 No real model calls and no real Starling runs in Wave 3a** unless your prompt says otherwise. Use the recorded runs in `fixtures/runs/*.jsonl`, `@starling/core/testing` fakes and the mock compose paths. No Ollama, no local models (L23).
- **L38 Tests live next to the code, and everything is deterministic.** No sleeps over 50 ms, no wall-clock assertions, no network beyond `127.0.0.1` on port `0`, and temp dirs under `os.tmpdir()` that clean up after themselves. Another 99 agents are hammering the CPU, so timing-sensitive tests will flake.
- **Wave 3b context.** Your `main` includes Epic 40 (the real `starling run`, `fixtures/real/*.jsonl`) and the Wave 3a epics merged so far (`git log --oneline origin/main | head -40`; Wave 3a handbacks are `.orchestrator/handbacks/1[0-9][0-9]-*.md`). `apps/cli`, `packages/core`, `packages/llm`, `packages/runner` and `apps/web/src/data` now belong to Epics 200–204, which run **in parallel** with you: import from them, never edit them, and never wait for them.
- **`evals/` is not a Bun workspace.** Import packages and apps by relative path (see `evals/lib/core.ts`). The root typecheck loop doesn't cover `evals/`, so typecheck it with `-p evals/tsconfig.json` yourself.

## FIRST TASK: carryover
Open `.orchestrator/fix-requests-w2.md`. Implement every request that targets a file in your lane, or decline it with a one-line reason. List each one in your handback under **Carryover done**.

Also, specifically for this epic:
- **Epic 44, FIX REQUEST 1:** `evals/real.ts` must document the profile env requirement next to `loadRealAuditor`, and should delegate to `evals/auditor/run-real.ts` to get the provider-hiccup retry and per-check detail.

## Your lane (you may write ONLY here)
`evals/e2e/**`, `evals/run.ts`, `evals/lib/**`, `evals/real.ts`
plus `docs/epic-205-evals-e2e.md` and `.orchestrator/handbacks/205-evals-e2e.md`. Read anything.

## Goal
The planner and auditor evals score the parts. Judges will ask whether the whole thing works. Build an **offline end-to-end eval** that drives the genuine stack: Epic 40's real composition with the real engine, git worktrees, auditor, merge queue and SQLite. Use the reference plan and **scripted agents** that write known-good (or deliberately bad) code, on each demo target. Score **task success**, **lane safety** and **time saved versus serial**. It runs with `bun evals/run.ts e2e` and needs no model and no API key. Great looks like this: one command prints a table that says, per demo goal, whether the pipeline merged what it should, kept every change inside its lane, and how much parallelism it bought.

## Deliverables
1. **Composition** (`evals/e2e/compose.ts`). Build the stack with Epic 40's `composeReal(config, options)` from `apps/cli/src/real/compose-real.ts`, imported by relative path the way `evals/lib/core.ts` imports core. Its documented test seams are `llm`, `runner`, `store`, `storePath` and `worktreeRoot`. Plug in:
   - a `MockLLM` from core testing whose planner returns the case's reference plan and whose auditor/reviewer passes unless the case scripts a failure. The deterministic audit checks (lane, tests) stay real;
   - an `OpencodeRunner` pointed at the runner's in-process fake server (`packages/runner/test/fake-opencode.ts`, imported exactly as Epic 40's `compose-real.test.ts` does). Its prompt handler copies the case's scripted solution files for that task into the session directory.
2. **Cases** (`evals/e2e/cases/<id>/case.json` plus `solutions/<taskKey>/**`). Fields: `{ id, target, goalFile, plan: { tasks: [{ key, lane, dependsOn }] }, expect: Record<taskKey, 'merged' | 'failed' | 'conflict'>, requires?: ('bun' | 'python3.12')[] }`. Plans come from the task tables in `examples/*/demo-goals/*.expected.md`. Ship at least:
   - `sky-todo-quick-wins`: 3 tasks, all merged;
   - `sky-todo-conflict-bait`: the expected conflict or serialisation outcome from its answer key;
   - `sky-todo-will-fail-audit`: one scripted lane escape that is audited out while the others merge;
   - `py-ledger-quick-wins`: skipped with a reason when Python 3.12+ isn't available;
   - `mini-two-lanes`: a synthetic tiny target with no dependencies, created in a temp dir, used by the unit tests.

   Keep the solutions minimal: they only have to pass the target's own tests. If `examples/birdwatch-api` is on main (Epic 168), add its quick goal too.
3. **Harness** (`evals/e2e/harness.ts`): `runE2ECase(c: E2ECase, opts?: { keepRepo?: boolean; log?: (line: string) => void }): Promise<E2EResult>`.
   - Demo targets come from `bash examples/scripts/make-demo-repo.sh <target> <tmp>`. Synthetic targets are written directly.
   - The run goes through `engine.start` → `waitForFinish`, with `close()` always called and temp dirs removed (`keepRepo` keeps them for debugging).
   - Cap each case with a 120 s timeout that fails the case rather than hanging.
4. **Scoring** (`evals/e2e/score.ts`, pure). From the event log and git:
   - `taskSuccess = merged / expected merged`;
   - `expectationMatch` = the share of tasks whose final status equals `expect`;
   - `laneSafety = 1 − (files changed on base..integration outside the union of merged tasks' lanes) / (files changed)`, using `git diff --name-only` and core's `matchesAny`;
   - `timeSaved = 1 − wallMs / serialMs`, where `serialMs` is the sum over tasks of first `working` → `merged | failed`, taken from `task.status` event timestamps;
   - export the thresholds `E2E_SUCCESS_THRESHOLD = 1`, `E2E_LANE_SAFETY_THRESHOLD = 1` and `E2E_EXPECTATION_THRESHOLD = 1`.

   Unit-test it on synthetic event lists **and** on `fixtures/real/quick-wins.jsonl`, which should score 5/5 merged.
5. **`evals/run.ts`.** Add suite `e2e`: `bun evals/run.ts e2e [--case <id>] [--out <path>]`. It prints a table (case, tasks, merged, expectation, lane safety, time saved, wall) and writes the JSON report under `evals/results/` like the other suites. `--impl` doesn't apply to e2e; say so in `--help`. Planner and auditor behaviour stays byte-identical, and the existing `run.test.ts` stays green.
6. **`evals/real.ts`** (Epic 44's carryover). Document next to `loadRealAuditor` that it needs `STARLING_LLM_PROFILE` (or `STARLING_AUDITOR_PROFILE`). If `evals/auditor/run-real.ts` exports a reusable entry, delegate to it to get its retry. That file belongs to Epic 162: read it, never edit it.
7. **Determinism and cost.**
   - `bun test evals/e2e` runs only the pure scoring tests plus **one** end-to-end case (`mini-two-lanes`, kept around 20 s at most) with no network.
   - The demo-target cases run only through `bun evals/run.ts e2e`, because `make-demo-repo.sh` may run `bun install`.
   - Time-based scores are asserted only loosely in tests (e.g. `timeSaved > 0` for a two-lane parallel case).
8. **Tests: at least 25.**
9. **`evals/e2e/README.md`:** how to add a case, what each score means, and how this differs from Epic 207's real-run matrix (scripted agents versus real models).

## Explicitly out of scope
- `evals/planner/**` (Epic 161) and `evals/auditor/**` (Epic 162): read only.
- `apps/cli/**` (Epic 203, in parallel): import `composeReal` as it is. If its seams don't fit, write a local adapter and file a FIX REQUEST.
- `packages/**`: FIX REQUESTS only.
- Real models and opencode. Epic 207 does real runs. Your agents are scripted.
- Changing `examples/**`. Scripted solutions live in your lane, never in the demo targets.

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree (it must not change `bun.lock`).
2. `bun test evals/e2e evals/run.test.ts` → 0 fail, at least 25 new tests.
3. `bunx tsc --noEmit -p evals/tsconfig.json` clean.
4. `bun evals/run.ts e2e --case sky-todo-quick-wins` → the table shows 3/3 merged, lane safety 1.00 and time saved > 0 (paste it).
5. `bun evals/run.ts e2e` → paste the full table, with every case passing or listed as skipped with a reason.
6. `bash .orchestrator/bin/heavy.sh bun run test` at the repo root → 0 fail (paste both halves' summary lines).
7. `bash .orchestrator/bin/heavy.sh bun run check` → clean.
8. `docs/epic-205-evals-e2e.md` (AGENTS.md §6 sections) and `.orchestrator/handbacks/205-evals-e2e.md` written. The handback has **Carryover done**, **C3 wiring** (exact code C3 must add, or "none") and **FIX REQUESTS** (or "none") sections. PR opened per AGENTS.md §6 with `Closes #<issue>`. Print the PR URL last.

## Git
Branch `epic/205-evals-e2e`. Conventional Commits scoped to your lane, committed small and often (at least 5 commits). `git fetch origin && git rebase origin/main` before pushing. No merging, no tags. Never `git add -A` at the repo root without checking `git status` first: only your lane's files belong in the PR.
