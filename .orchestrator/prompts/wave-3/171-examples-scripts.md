# Epic 171: Examples tooling: generic demo repos, an answer-key validator, a demo-day reset

**Wave 3 · Branch `epic/171-examples-scripts` · Issue: `gh issue list --search "Epic 171 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 90–150 min of autonomous work**

## Where you are
Starling (`.orchestrator/PRD.md`) is an open-source, open-weight-first harness. It turns one coding goal into a lane-safe task DAG, runs a flock of opencode agents in parallel git worktrees on this laptop and on other laptops ("perches"), audits each result, and merges everything through a queue, shown live in a murmuration dashboard.

**Waves 0, 1, C1 and 2 are merged** (tags `epic-NN-complete`). About 2,500 tests pass across every package, the CLI, server, web dashboard, skill, tools and evals. Epic 40 (integration captain) is landing the **real** composition (`starling run` driving real opencode agents) in parallel with you, so for now `apps/cli`, `packages/core`, `packages/llm`, `packages/runner` and `apps/web/src/data` are **off limits** (Wave 3b takes them after Epic 40 merges).

**Wave 3 is the big one: about 100 agents run at the same time on one laptop**, each in its own worktree and lane. That only works if everyone follows the rules below exactly.

**Read before you start:** `AGENTS.md`, `.orchestrator/ARCHITECTURE.md` (§6 contracts, §7 locked decisions), the `docs/epic-*.md` for every package you touch (their "Interfaces for future epics" sections), the handbacks in `.orchestrator/handbacks/` that mention your area, and **`.orchestrator/fix-requests-w2.md`**.

## Tech decisions already locked (build on these, don't relitigate)
ARCHITECTURE §7 **L1–L31** still hold (Bun 1.4.4, TS 5.9.3, zod 4, Biome 2.6.3; web tests run in their own process; Markdown formatter off; no local models; real LLM calls only via the `opencode` profile). Wave 3 adds:
- **L32 Lanes are absolute.** Write only inside your lane, plus your own `docs/epic-171-examples-scripts.md` and `.orchestrator/handbacks/171-examples-scripts.md`. Shared registration files you don't own (`apps/web/src/App.tsx` and `app/Layout.tsx`, `apps/cli/src/program.ts`, `apps/server/src/app.ts`, any package `index.ts` outside your lane) are **wired later by checkpoint C3**. Ship your work as a self-contained module with the manifest described in your prompt, and say in the handback exactly what C3 must add (file, line, code).
- **L33 Public APIs are additive only.** Never rename or remove an export, field, route, CLI flag or event other code uses. Deprecate instead. About 100 branches merge after yours.
- **L34 No new dependencies.** Don't touch any `package.json` dependency list, `bun.lock`, the root `package.json`, `tsconfig.base.json` or `biome.json`. Everything you need is already installed (React 19, lucide-react, zustand, @xyflow/react, Tailwind v4, Hono, commander, zod, bun:test, happy-dom, Playwright). If something is truly missing, write a CONTRACT REQUEST instead.
- **L35 Heavy commands go through the slot gate.** With 100 agents, everyone running the full suite at once would melt the laptop. While iterating, run **only your own tests** (`bun test <your dir>`; for web code `cd apps/web && bun test src/features/<x>`) and **only your own typecheck** (`bunx tsc --noEmit -p <your package or app>`). Run the full suite **once, at the end**, through the gate: `bash .orchestrator/bin/heavy.sh bun run test` and `bash .orchestrator/bin/heavy.sh bun run check` (also wrap `bun run build` and any Playwright run). The gate may print "waiting" for a few minutes. If your shell tool times out while it waits, just run it again.
- **L36 Bugs outside your lane are FIX REQUESTS, never edits.** QA epics record a confirmed bug as **`test.todo('BUG <area>: <one line>', () => { ... })`** with the real assertions inside, plus a FIX REQUEST. Never use `test.failing` and never commit a red test: about 100 fixes land in parallel, and a `test.failing` turns red the moment someone fixes the bug. **The one allowed cross-lane edit:** if your fix makes an existing `test.failing` probe in `tools/security/**` pass, change that probe's `test.failing(` to `test(` in the same PR (nothing else in that file) and say so in the handback.
- **L37 No real model calls and no real Starling runs in Wave 3a** unless your prompt says otherwise. Use the recorded runs in `fixtures/runs/*.jsonl`, `@starling/core/testing` fakes and the mock compose paths. No Ollama, no local models (L23).
- **L38 Tests live next to the code, and everything is deterministic.** No sleeps over 50 ms, no wall-clock assertions, no network beyond `127.0.0.1` on port `0`, and temp dirs under `os.tmpdir()` that clean up after themselves. Another 99 agents are hammering the CPU, so timing-sensitive tests will flake.
- **D1 examples rules (Epics 168–171 run in parallel).**
  - Demo targets are **standalone projects**. Root `bun run test`, Biome and the root `tsc` loop all skip `examples/`, so you run your target's own suite yourself.
  - **Root test filter gotcha:** root `bun test packages apps/server apps/cli skills integrations tools evals` treats each word as a *substring filter*, not a directory. Any `*.test.ts` whose path contains `packages`, `apps/server`, `apps/cli`, `skills`, `integrations`, `tools` or `evals` (e.g. `examples/x/src/tools/a.test.ts`) gets pulled into the root suite. Never name a folder or test file like that.
  - **Frozen for other code:** the existing goal file names *and texts* (`apps/web/src/features/launch/goals.ts` copies them verbatim, and `fixtures/runs/*` plus Epic 40's `fixtures/real/*` recorded them), and the `make-demo-repo.sh` CLI (`make-demo-repo.sh /tmp/x`, `<example> [dir]`, `--list`, `--help`, `DEMO_SKIP_INSTALL`, `DEMO_SKIP_TESTS`, `SKY_TODO_SKIP_INSTALL`, `PY_LEDGER_SKIP_INSTALL`, last stdout line = absolute repo path). Epic 40, `tools/github-sandbox/setup.sh` and the docs all call it.
  - **Planner-evals coupling:** `evals/planner/cases.test.ts` asserts the number of sky-todo planner cases equals the number of `examples/sky-todo/demo-goals/*.expected.md` files. So a **new sky-todo answer key goes in `examples/sky-todo/.starling-answers/<goal>.expected.md`**, never in `demo-goals/`. Other targets aren't coupled yet.
  - **`examples/sky-todo/node_modules` breaks the root suite:** `packages/repomap/src/sky-todo.test.ts` `cp -r`s the folder and times out at 5 s. Test sky-todo through a demo copy (`bash examples/scripts/make-demo-repo.sh sky-todo /tmp/<x>`). If you do install in place, `rm -rf examples/sky-todo/node_modules` before any root run.
  - **Answer-key format v1** (what the existing `*.expected.md` use, and what Epic 171's validator parses): H1 `# Expected decomposition — <goal>`, a bold `**Goal (N tasks).**` sentence, a `## Task table` with columns `| # | key | title | depends on | lane owns |` (keys and globs in backticks, comma-separated; `—` for no dependency), and a line `Expected validator output: **no issues**` or one naming the expected issue codes (e.g. `lane-overlap`). Then `## Why the lanes are disjoint` and per-task details. Keep this format exactly.
- **Epics 168/169/170 are adding targets, goals and `scripts/minitest.py` in parallel.** Code against detection plus format v1. Never against their files existing.

## FIRST TASK: carryover
Open `.orchestrator/fix-requests-w2.md`. Implement every request that targets a file in your lane, or decline it with a one-line reason. List each one in your handback under **Carryover done**.

Also, specifically for this epic:
- **From 43-github-e2e:** "`examples/scripts/make-demo-repo.sh`: no change needed — `SKY_TODO_SKIP_INSTALL=1` already exists and is what `setup.sh` uses". Keep `SKY_TODO_SKIP_INSTALL` (and `PY_LEDGER_SKIP_INSTALL`) working, and cover them with a test.

## Your lane (you may write ONLY here)
`examples/scripts/**`, `examples/README.md`
plus `docs/epic-171-examples-scripts.md` and `.orchestrator/handbacks/171-examples-scripts.md`. Read anything.

## Goal
On demo day, the examples have to just work: one script builds a clean repo for **any** target, one command proves every goal's answer key is consistent (lanes disjoint, dependencies acyclic, paths real), and one command resets a demo repo between rehearsals in seconds. Great looks like this: a fourth target needs zero script changes, the validator catches a broken answer key before a judge sees the planner "fail", and a reset after a messy run takes one line.

## Deliverables
1. **Generalise `make-demo-repo.sh` without breaking its contract** (see the D1 rules: every existing form, flag, env var and the last-line path must keep working). Replace the per-name `case` blocks with **detection**:
   - `package.json` → run `bun install` only when it declares any dependencies or devDependencies, then baseline `bun test`.
   - `pyproject.toml` → the existing venv + `pip install -e '.[dev]'` + `pytest` path. If the venv or pip step fails **and** `scripts/minitest.py` exists, run `python3 scripts/minitest.py` as the baseline instead (Epic 170 adds it in parallel; detect the file).
   - Anything else → copy, commit, and warn "no install/test step".
   Add generic `<NAME>_SKIP_INSTALL` (name upper-cased, `-` → `_`, so `BIRDWATCH_API_SKIP_INSTALL`) next to the legacy per-target variables. Stay bash 3.2-compatible (no `${var^^}`: use `tr`). `--list` prints each target with its detected stack, test command and number of goals.
2. **`examples/scripts/validate-goals.ts`** (Bun TypeScript). Import `globsOverlap`/`lanesDisjoint`/`matchesGlob` from `../../packages/core/src/glob.ts` (read-only, by relative path). Exports:
   - `parseAnswerKey(markdown: string): AnswerKey`, where `AnswerKey = { goal: string; declaredTasks?: number; tasks: { key: string; title: string; dependsOn: string[]; owns: string[] }[]; expectedIssues: string[] }`. This is format v1 from the D1 rules.
   - `findAnswerKey(targetDir, goal)`: looks in `demo-goals/<goal>.expected.md`, then `.starling-answers/<goal>.expected.md`.
   - `validateTarget(targetDir): Finding[]`, with `Finding = { target; goal; severity: 'error' | 'warn'; code; message }`.
3. **Validator rules:**
   - Every `demo-goals/*.md` (excluding `*.expected.md`) is one non-empty line and has an answer key.
   - Keys are unique kebab-case, and every `dependsOn` names a key in the table.
   - The DAG is acyclic, and `declaredTasks` equals the row count.
   - Any two tasks **not ordered by dependencies** have disjoint lanes, unless `expectedIssues` contains `lane-overlap` (conflict goals).
   - Every lane glob's static prefix is an existing path or a creatable file under an existing directory of the target.
   - Every file mentioned in `.starling-answers/BUGS.md` exists.
   CLI: `bun examples/scripts/validate-goals.ts [target...] [--json] [--run-tests]`. It prints a table per target and exits 1 on any error. `--run-tests` builds each target with `make-demo-repo.sh` into a temp dir and runs its baseline suite (slow; never in unit tests). It must pass on today's `sky-todo` and `py-ledger` (fix the validator, not the answer keys; report real key errors as FIX REQUESTS to Epics 169/170) and tolerate `birdwatch-api` being absent (Epic 168 is in flight).
4. **`examples/scripts/reset-demo.sh <repo> [--dry-run] [--rebuild]`**: the demo-day reset. It refuses unless the repo's **first** commit subject starts with `chore: initial `. Then it:
   - aborts any in-progress merge;
   - checks out `main` and `git reset --hard` to the initial commit;
   - deletes `starling/*` branches;
   - removes Starling worktrees registered to this repo (`git worktree list --porcelain`), then `git worktree prune`;
   - deletes `.starling/` and `git clean -fdx`, keeping `.venv/` and `node_modules/`.
   `--rebuild` instead re-runs `make-demo-repo.sh` for the detected example into the same path. `--dry-run` prints every action and changes nothing. Last stdout line is the path. bash 3.2.
5. **Tests** (`bun test examples/scripts`, under ~15 s total, temp dirs under `os.tmpdir()`, `DEMO_SKIP_INSTALL=1` so there's no network):
   - `validate-goals.test.ts` (≥ 20): parser on synthetic keys (missing columns, `—` deps, multi-glob lanes, conflict goal with `lane-overlap`, cycles, unknown dep, count mismatch), both lookup locations, and the real `sky-todo` + `py-ledger` → no errors.
   - `make-demo-repo.test.ts` (≥ 8): each target builds one clean commit with answers stripped; the legacy one-argument form; `--list`; refusal of a foreign non-empty dir; generic skip variable; last stdout line is the path.
   - `reset-demo.test.ts` (≥ 6): temp demo repo with fake `starling/x/integration` branches, a worktree, `.starling/`, a dirty file; `--dry-run` changes nothing; refusal on a foreign repo.
   Add `examples/scripts/tsconfig.json` extending `../../tsconfig.base.json`.
6. **`examples/README.md`:** one index for all targets (sky-todo, py-ledger, birdwatch-api with `⏳ Epic 168` until its folder exists), the detection rules, the **answer-key format v1 spec** (copy it from the D1 rules and make it the canonical reference), the validator and reset usage, a "demo-day sequence" (build → validate → rehearse → reset), and "adding a target" (now: a folder with `package.json` or `pyproject.toml`, a green suite, goals plus keys; no script edits).

## Explicitly out of scope
- Anything inside `examples/sky-todo`, `examples/py-ledger` or `examples/birdwatch-api` (Epics 169, 170, 168). If a key is wrong, file a FIX REQUEST.
- `tools/github-sandbox/**` (Epic 159), `evals/**`, `tools/qa/examples/**` (Epic 198 tests targets from the outside).

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree (it must not change `bun.lock`).
2. `bun test examples/scripts` → 0 fail, ≥ 34 tests (paste the summary), and `bunx tsc --noEmit -p examples/scripts` → clean.
3. `bun examples/scripts/validate-goals.ts` → every goal of every present target passes (paste the table).
4. `bash examples/scripts/make-demo-repo.sh /tmp/legacy-171` (legacy form) and `bash examples/scripts/make-demo-repo.sh --list` behave as before (paste). Then `bash examples/scripts/reset-demo.sh /tmp/legacy-171 --dry-run` prints its plan.
5. `bash -n examples/scripts/*.sh` → ok.
6. `bash .orchestrator/bin/heavy.sh bun run test` at the repo root → 0 fail (paste both halves' summary lines).
7. `bash .orchestrator/bin/heavy.sh bun run check` → clean.
8. `docs/epic-171-examples-scripts.md` (AGENTS.md §6 sections) and `.orchestrator/handbacks/171-examples-scripts.md` written. The handback has **Carryover done**, **C3 wiring** (exact code C3 must add, or "none") and **FIX REQUESTS** (or "none") sections. PR opened per AGENTS.md §6 with `Closes #<issue>`. Print the PR URL last.

## Git
Branch `epic/171-examples-scripts`. Conventional Commits scoped to your lane, committed small and often (at least 5 commits). `git fetch origin && git rebase origin/main` before pushing. No merging, no tags. Never `git add -A` at the repo root without checking `git status` first: only your lane's files belong in the PR.
