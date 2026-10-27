# Epic 207: Real-run matrix: every demo target, for real

**Wave 3b · Branch `epic/207-real-run-matrix` · Issue: `gh issue list --search "Epic 207 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 90–150 min (most of it waiting on runs) of autonomous work**

## Where you are
Starling (`.orchestrator/PRD.md`) is an open-source, open-weight-first harness. It turns one coding goal into a lane-safe task DAG, runs a flock of opencode agents in parallel git worktrees on this laptop and on other laptops ("perches"), audits each result, and merges everything through a queue, shown live in a murmuration dashboard.

**Waves 0, 1, C1 and 2 are merged** (tags `epic-NN-complete`). About 2,500 tests pass across every package, the CLI, server, web dashboard, skill, tools and evals. Epic 40 (integration captain) is landing the **real** composition (`starling run` driving real opencode agents) in parallel with you, so for now `apps/cli`, `packages/core`, `packages/llm`, `packages/runner` and `apps/web/src/data` are **off limits** (Wave 3b takes them after Epic 40 merges).

**Wave 3 is the big one: about 100 agents run at the same time on one laptop**, each in its own worktree and lane. That only works if everyone follows the rules below exactly.

**Read before you start:** `AGENTS.md`, `.orchestrator/ARCHITECTURE.md` (§6 contracts, §7 locked decisions), the `docs/epic-*.md` for every package you touch (their "Interfaces for future epics" sections), the handbacks in `.orchestrator/handbacks/` that mention your area, and **`.orchestrator/fix-requests-w2.md`**.

## Tech decisions already locked (build on these, don't relitigate)
ARCHITECTURE §7 **L1–L31** still hold (Bun 1.4.4, TS 5.9.3, zod 4, Biome 2.6.3; web tests run in their own process; Markdown formatter off; no local models; real LLM calls only via the `opencode` profile). Wave 3 adds:
- **L32 Lanes are absolute.** Write only inside your lane, plus your own `docs/epic-207-real-run-matrix.md` and `.orchestrator/handbacks/207-real-run-matrix.md`. Shared registration files you don't own (`apps/web/src/App.tsx` and `app/Layout.tsx`, `apps/cli/src/program.ts`, `apps/server/src/app.ts`, any package `index.ts` outside your lane) are **wired later by checkpoint C3**. Ship your work as a self-contained module with the manifest described in your prompt, and say in the handback exactly what C3 must add (file, line, code).
- **L33 Public APIs are additive only.** Never rename or remove an export, field, route, CLI flag or event other code uses. Deprecate instead. About 100 branches merge after yours.
- **L34 No new dependencies.** Don't touch any `package.json` dependency list, `bun.lock`, the root `package.json`, `tsconfig.base.json` or `biome.json`. Everything you need is already installed (React 19, lucide-react, zustand, @xyflow/react, Tailwind v4, Hono, commander, zod, bun:test, happy-dom, Playwright). If something is truly missing, write a CONTRACT REQUEST instead.
- **L35 Heavy commands go through the slot gate.** With 100 agents, everyone running the full suite at once would melt the laptop. While iterating, run **only your own tests** (`bun test <your dir>`; for web code `cd apps/web && bun test src/features/<x>`) and **only your own typecheck** (`bunx tsc --noEmit -p <your package or app>`). Run the full suite **once, at the end**, through the gate: `bash .orchestrator/bin/heavy.sh bun run test` and `bash .orchestrator/bin/heavy.sh bun run check` (also wrap `bun run build` and any Playwright run). The gate may print "waiting" for a few minutes. If your shell tool times out while it waits, just run it again.
- **L36 Bugs outside your lane are FIX REQUESTS, never edits.** QA epics record a confirmed bug as **`test.todo('BUG <area>: <one line>', () => { ... })`** with the real assertions inside, plus a FIX REQUEST. Never use `test.failing` and never commit a red test: about 100 fixes land in parallel, and a `test.failing` turns red the moment someone fixes the bug. **The one allowed cross-lane edit:** if your fix makes an existing `test.failing` probe in `tools/security/**` pass, change that probe's `test.failing(` to `test(` in the same PR (nothing else in that file) and say so in the handback.
- **L37 No real model calls and no real Starling runs in Wave 3a** unless your prompt says otherwise. Use the recorded runs in `fixtures/runs/*.jsonl`, `@starling/core/testing` fakes and the mock compose paths. No Ollama, no local models (L23).
- **L38 Tests live next to the code, and everything is deterministic.** No sleeps over 50 ms, no wall-clock assertions, no network beyond `127.0.0.1` on port `0`, and temp dirs under `os.tmpdir()` that clean up after themselves. Another 99 agents are hammering the CPU, so timing-sensitive tests will flake.
- **Wave 3b context.** Your `main` includes Epic 40 (the real `starling run`, `fixtures/real/*.jsonl`) and the Wave 3a epics merged so far (`git log --oneline origin/main | head -40`; Wave 3a handbacks are `.orchestrator/handbacks/1[0-9][0-9]-*.md`). `apps/cli`, `packages/core`, `packages/llm`, `packages/runner` and `apps/web/src/data` now belong to Epics 200–204, which run **in parallel** with you: import from them, never edit them, and never wait for them.
- **L37 override (this epic only): real runs are allowed.** You may run real Starling runs through the `opencode` profile (L29):
  - **one at a time**, never two at once, smallest goal first;
  - each with `--budget` ≤ 1.50, and the whole matrix ≤ $6;
  - every real run wrapped in `bash .orchestrator/bin/heavy.sh`, so it never overlaps another agent's full-suite run.

  Still forbidden: Ollama and local models (L23/L31), `--fully-open`, and `--github`.
- **`fixtures/real/**` is yours for new files only.** Epic 40's two recordings stay byte-identical.
- **If `starling run` is broken on main,** record the failure as a matrix row with the error, file a FIX REQUEST to the owning Wave 3b epic, and continue with the next target. Don't patch other lanes.

- **Real-run gate (shared with Epics 46, 50, 54):** wrap every real run in `ORCH_HEAVY_SLOTS=1 ORCH_LOCKS=$HOME/Code/starling-wt/_locks-realrun bash .orchestrator/bin/heavy.sh <command>` so only one real Starling run happens on the machine at a time.

## FIRST TASK: carryover
Open `.orchestrator/fix-requests-w2.md`. Implement every request that targets a file in your lane, or decline it with a one-line reason. List each one in your handback under **Carryover done**.

Also, specifically for this epic:
- **Epic 42, FIX REQUEST 6:** a real flock smoke (hub + one perch on this Mac, `maxSessions: 1` on the hub, quick-wins goal) recorded to `fixtures/real/flock-loopback.jsonl`. Stretch: only after the matrix, only within budget, using `tools/flock`'s loopback docs. Otherwise decline it with the reason.
- **Epic 40, open question:** the launch-day goal planned 6 tasks, not 7. Record planned versus expected task counts for every row, so the demo script quotes the model's real behaviour.

## Your lane (you may write ONLY here)
`tools/realrun/**`, `fixtures/real/**` (new files only; see the rules)
plus `docs/epic-207-real-run-matrix.md` and `.orchestrator/handbacks/207-real-run-matrix.md`. Read anything.

## Goal
Starling's headline claim is that a flock of open-weight agents ships real, tested work. Epic 40 proved it on sky-todo, with 5/5 merged on quick-wins and 6/6 on launch-day. Now prove it across **every demo target**: run each target's main goal **for real**, one run at a time, record it, check the integration branch's own test suite, and publish a matrix of success, wall time, speedup versus serial, cost and tokens. The README, blog and about page can quote it. **Honest numbers beat pretty numbers:** a failed run is a row, not a secret. Great looks like this: a `REPORT.md` with at least 3 real runs, their recordings in `fixtures/real/matrix/`, and a reusable `matrix.ts` that reproduces it on demo day.

## Deliverables
1. **`tools/realrun/summarise.ts`** (pure). `summariseRecording(events: StarlingEvent[]): RunSummary`, where `RunSummary` is `{ runId, goal, tasksPlanned, merged, failed, conflicts, wallMs, serialMs, speedup, apiCostUsd, apiTokens: TokenUsage, localTokens: TokenUsage, auditFailures, fixAttempts }`. `serialMs` is the sum over tasks of first `working` → `merged | failed`. Test it on Epic 40's `fixtures/real/quick-wins.jsonl` and `launch-day.jsonl`; the summary must agree with Epic 40's handback (5 merged, $0.223; 6 merged, $0.517, within rounding).
2. **`tools/realrun/matrix.ts`**: `bun tools/realrun/matrix.ts [--only <target>:<goal>] [--dry-run] [--budget-per-run 1.50] [--total-budget 6]`. For each entry, strictly one at a time:
   - **Preflight.** `opencode --version` works; `bun run starling doctor --json` reports git, bun and opencode as OK; no other `starling run` is alive (`pgrep -f "starling run"`).
   - **Demo repo.** `bash examples/scripts/make-demo-repo.sh <target> <tmp>`.
   - **The run itself.** `bash .orchestrator/bin/heavy.sh bun run starling run "$(cat <goal file>)" --repo <tmp> --no-dash --budget <n> --record fixtures/real/matrix/<target>-<goal>.jsonl`, with a hard 25-minute timeout.
   - **Integration tests.** Check out the integration branch the run printed into a temp worktree and run the target's own tests: `bun test` for sky-todo, or `pytest` inside the target's `.venv` for py-ledger.
   - **Record.** Append a row to `tools/realrun/results/matrix.json` (`{ version: 1, rows: MatrixRow[] }`; export the TS type for Epics 154/137/180).
   - **Budget stop.** When cumulative API cost reaches `--total-budget`, stop.

   `--dry-run` prints the planned commands without executing anything. The unit tests drive it with an injected `exec`.
3. **Matrix order, smallest first.**
   1. sky-todo `quick-wins`
   2. py-ledger `quick-wins` (a "skipped: no Python 3.12+" row if the venv can't be made)
   3. `examples/birdwatch-api`'s quickest goal, only if Epic 168 merged (otherwise a skipped row)
   4. sky-todo `launch-day`
   5. sky-todo `conflict-bait`: it exercises the resolver if the engine wires it; record what happened

   Stretch, only if time and budget remain: sky-todo `will-fail-audit`. For each row, note the expected decomposition from the goal's `.expected.md` (planned versus expected task count; Epic 40 saw 6 planned where 7 were expected).
4. **Report.** `bun tools/realrun/report.ts` renders `tools/realrun/REPORT.md` from `matrix.json`. It contains:
   - one table row per run: target, goal, planned/merged/failed, wall, serial estimate, speedup, API cost, tokens, integration tests ✓/✗, recording;
   - totals;
   - a "what went wrong" note per failed or partial run, drawn from its `log` and `audit.verdict` events;
   - a reproduce section.
5. **Recording hygiene.**
   - New recordings go only to `fixtures/real/matrix/`, at most 5 MB each.
   - **Never overwrite or delete** Epic 40's `fixtures/real/quick-wins.jsonl` or `launch-day.jsonl`: other epics' tests and docs read them.
   - `secrets.test.ts` scans every committed recording for `OPENCODE_SERVER_PASSWORD`, `password`, `sk-`, `ghp_`, `Bearer ` and the user's home path, and must pass before you commit.
6. **Failures are data.** A failed, partial or timed-out run is a row with its reason. Retry a run at most once, and only for an infrastructure failure (opencode didn't start). Never edit goals or targets to make the matrix green. Every real-run problem with an owner becomes a FIX REQUEST (llm 200, runner 201, core 202, cli 203, engine and the others to their next owner).
7. **Tests: at least 20.** Cover summarise (both Epic 40 fixtures plus synthetic edge cases: no tasks, all failed, a missing `run.finished`), dry-run planning, the budget stop, skip logic, report rendering (assert rows, no snapshots) and the secret scan.

## Explicitly out of scope
- Editing any package or app. Real-run bugs are FIX REQUESTS to their owners (Epics 200–204 are changing llm, runner, core, cli and web data in parallel).
- `--github` runs: no GitHub side effects. `--fully-open` and local models (L23/L31).
- Two-laptop flock runs (that's the demo kit, Epic 158). Editing `examples/**`.

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree (it must not change `bun.lock`).
2. `bun test tools/realrun` → 0 fail, at least 20 tests (no real runs inside tests).
3. `bunx tsc --noEmit -p tools/realrun` clean (add `tools/realrun/tsconfig.json` like `tools/security/tsconfig.json`).
4. `bun tools/realrun/matrix.ts --dry-run` prints the planned matrix (paste it).
5. The real matrix ran: `tools/realrun/results/matrix.json` has at least 3 rows, including sky-todo quick-wins with its integration tests green. Paste REPORT.md's table and the total API cost (at most $6).
6. `bash .orchestrator/bin/heavy.sh bun run test` at the repo root → 0 fail (paste both halves' summary lines).
7. `bash .orchestrator/bin/heavy.sh bun run check` → clean.
8. `docs/epic-207-real-run-matrix.md` (AGENTS.md §6 sections) and `.orchestrator/handbacks/207-real-run-matrix.md` written. The handback has **Carryover done**, **C3 wiring** (exact code C3 must add, or "none") and **FIX REQUESTS** (or "none") sections. PR opened per AGENTS.md §6 with `Closes #<issue>`. Print the PR URL last.

## Git
Branch `epic/207-real-run-matrix`. Conventional Commits scoped to your lane, committed small and often (at least 5 commits). `git fetch origin && git rebase origin/main` before pushing. No merging, no tags. Never `git add -A` at the repo root without checking `git status` first: only your lane's files belong in the PR.
