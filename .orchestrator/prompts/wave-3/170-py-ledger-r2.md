# Epic 170: py-ledger round 2: more goals, a pure-Python test runner fallback, README polish

**Wave 3 · Branch `epic/170-py-ledger-r2` · Issue: `gh issue list --search "Epic 170 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 90–150 min of autonomous work**

## Where you are
Starling (`.orchestrator/PRD.md`) is an open-source, open-weight-first harness. It turns one coding goal into a lane-safe task DAG, runs a flock of opencode agents in parallel git worktrees on this laptop and on other laptops ("perches"), audits each result, and merges everything through a queue, shown live in a murmuration dashboard.

**Waves 0, 1, C1 and 2 are merged** (tags `epic-NN-complete`). About 2,500 tests pass across every package, the CLI, server, web dashboard, skill, tools and evals. Epic 40 (integration captain) is landing the **real** composition (`starling run` driving real opencode agents) in parallel with you, so for now `apps/cli`, `packages/core`, `packages/llm`, `packages/runner` and `apps/web/src/data` are **off limits** (Wave 3b takes them after Epic 40 merges).

**Wave 3 is the big one: about 100 agents run at the same time on one laptop**, each in its own worktree and lane. That only works if everyone follows the rules below exactly.

**Read before you start:** `AGENTS.md`, `.orchestrator/ARCHITECTURE.md` (§6 contracts, §7 locked decisions), the `docs/epic-*.md` for every package you touch (their "Interfaces for future epics" sections), the handbacks in `.orchestrator/handbacks/` that mention your area, and **`.orchestrator/fix-requests-w2.md`**.

## Tech decisions already locked (build on these, don't relitigate)
ARCHITECTURE §7 **L1–L31** still hold (Bun 1.4.4, TS 5.9.3, zod 4, Biome 2.6.3; web tests run in their own process; Markdown formatter off; no local models; real LLM calls only via the `opencode` profile). Wave 3 adds:
- **L32 Lanes are absolute.** Write only inside your lane, plus your own `docs/epic-170-py-ledger-r2.md` and `.orchestrator/handbacks/170-py-ledger-r2.md`. Shared registration files you don't own (`apps/web/src/App.tsx` and `app/Layout.tsx`, `apps/cli/src/program.ts`, `apps/server/src/app.ts`, any package `index.ts` outside your lane) are **wired later by checkpoint C3**. Ship your work as a self-contained module with the manifest described in your prompt, and say in the handback exactly what C3 must add (file, line, code).
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

## FIRST TASK: carryover
Open `.orchestrator/fix-requests-w2.md`. Implement every request that targets a file in your lane, or decline it with a one-line reason. List each one in your handback under **Carryover done**.

Also, specifically for this epic:
- **From 58-demo-targets, FIX REQUEST 1 (optional follow-up):** planner cases for py-ledger's goals. **Decline**: they live in `evals/planner/**` (Epic 161) and need a `fixtures/repomaps/py-ledger.json`. Put a ready-to-paste case JSON for `bug-hunt` and `feature-day` in your handback for Epic 161/C3.

## Your lane (you may write ONLY here)
`examples/py-ledger/**`
plus `docs/epic-170-py-ledger-r2.md` and `.orchestrator/handbacks/170-py-ledger-r2.md`. Read anything.

## Goal
py-ledger proves Starling is language-agnostic, but on demo day it has one fragile step: `pip install` of pytest on venue wifi. Round 2 removes that risk with a **pure-standard-library test runner fallback** that runs the existing suite with the same pass count, adds goals that exercise the flock and the fix loop on Python, and polishes the README so a judge can run it in a minute. Great looks like this: `python3 scripts/minitest.py` and `pytest` agree on every test, and the new goals are as crisp as the existing three.

## Deliverables
1. **`scripts/minitest.py`**: a fallback runner using only the stdlib (Python ≥ 3.12). It discovers `tests/test_*.py` and module-level `test_*` functions, loads `tests/conftest.py`, and runs every test in-process with `src/` on `sys.path` (mirroring `pythonpath = ["src"]` in `pyproject.toml`). CLI: `python3 scripts/minitest.py [-k substr] [-x] [-q] [paths...]`. Output ends with pytest's summary shape: `N passed, M failed in X.XXs`. Exit code 0/1, and 5 when nothing is collected. Failures print the test id, assertion location and traceback.
2. **`scripts/_pytest_shim/pytest.py`**: a minimal `pytest` module placed on `sys.path` **only** when `importlib.util.find_spec("pytest") is None` (or when `MINITEST_FORCE_SHIM=1`), so a real pytest always wins. It supports exactly what the suite uses (grep `tests/`): `fixture` (function scope, dependency injection by parameter name, fixtures depending on fixtures, `yield` teardown), `raises(exc, match=...)` as a context manager, and `mark.parametrize` (a single name or a comma-separated string, list of values or tuples, `ids=`). Built-in fixtures: `tmp_path` (unique dir under `tempfile.gettempdir()`, removed after), `capsys` (`readouterr()` → `.out`/`.err`), and `monkeypatch` (`setattr`, `setenv`, `delenv`, `chdir`, undone after each test). Include `CaptureFixture` and `MonkeyPatch` names so annotations resolve.
3. **Parity:** with the real pytest installed, `python -m pytest -q` and `python scripts/minitest.py` report the **same passed count** (136 today, plus your new tests). Add `tests/test_minitest.py` (≥ 10 tests: discovery, parametrize ids, fixture teardown order, `raises` match failure, `capsys`, `monkeypatch` undo, `-k`). It runs under both runners.
4. **New goals** (one line each, with `demo-goals/<goal>.expected.md` in answer-key format v1; py-ledger isn't eval-coupled):
   - `big-day.md` (8–10 disjoint command/module tasks for the flock demo, ≤ 2 edges). Python commands are discovered via `pkgutil`, so new commands are new files in `src/py_ledger/commands/`.
   - `fix-loop.md` (1 task: make `import` de-duplicate repeated rows by `(date, amount, merchant)` **with tests for exact duplicates, near-duplicates that must stay, and a `--allow-duplicates` flag**; the known gap from the README). The key documents the expected first-attempt miss.
   - `refactor.md` (a cross-cutting goal, e.g. "add an optional `--currency` code end to end", which touches models/storage/formatting/commands). The key shows how a good planner serialises it with dependencies rather than overlapping lanes.
   Keep the existing `quick-wins`, `feature-day` and `bug-hunt` files byte-identical.
5. **Seeded bugs:** keep the two from Wave 2 working and still untested. Re-verify `BUGS.md` repros against the current code (`py-ledger add -a 0.29 …` → `$0.28`).
6. **README polish:** a 60-second quickstart (venv path **and** the no-pytest path: `python3 scripts/minitest.py`), the commands table, the module map, a goals table with all 6 goals, a "how Starling sees this repo" section (test command `pytest`, why the venv must be active, the fallback runner for offline laptops), and an updated test count.
7. **Quality:** `ruff check .` and `ruff format --check .` stay clean, including `scripts/`. Use the existing ruff config in `pyproject.toml` (add `scripts` to the include if the config is path-scoped). No new runtime or dev dependencies.

## Explicitly out of scope
- `examples/scripts/make-demo-repo.sh` (Epic 171 will use `scripts/minitest.py` as the fallback when the venv/pip step fails; it codes against the path and CLI above, so keep them).
- `evals/planner/**` and `fixtures/repomaps/**` (Epic 161), and `apps/web/src/features/launch/**`.
- Changing the app's behaviour beyond what new tests need. Real Starling runs.

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree (it must not change `bun.lock`).
2. `cd examples/py-ledger && python3 -m venv /tmp/pl-170 && /tmp/pl-170/bin/pip install -q -e '.[dev]' && /tmp/pl-170/bin/python -m pytest -q` → all pass (paste the summary). If pip has no network, say so and skip to the next item.
3. `cd examples/py-ledger && MINITEST_FORCE_SHIM=1 python3 scripts/minitest.py` → the **same passed count** as pytest, 0 failed (paste both lines side by side).
4. `/tmp/pl-170/bin/ruff check examples/py-ledger && /tmp/pl-170/bin/ruff format --check examples/py-ledger` → clean.
5. `bash examples/scripts/make-demo-repo.sh py-ledger /tmp/pl-demo-170` → green baseline, the 3 new goals present, no `*.expected.md` (paste). Then `rm -rf examples/py-ledger/src/*.egg-info` if the editable install created one.
6. `bash .orchestrator/bin/heavy.sh bun run test` at the repo root → 0 fail (paste both halves' summary lines).
7. `bash .orchestrator/bin/heavy.sh bun run check` → clean.
8. `docs/epic-170-py-ledger-r2.md` (AGENTS.md §6 sections) and `.orchestrator/handbacks/170-py-ledger-r2.md` written. The handback has **Carryover done**, **C3 wiring** (exact code C3 must add, or "none") and **FIX REQUESTS** (or "none") sections. PR opened per AGENTS.md §6 with `Closes #<issue>`. Print the PR URL last.

## Git
Branch `epic/170-py-ledger-r2`. Conventional Commits scoped to your lane, committed small and often (at least 5 commits). `git fetch origin && git rebase origin/main` before pushing. No merging, no tags. Never `git add -A` at the repo root without checking `git status` first: only your lane's files belong in the PR.
