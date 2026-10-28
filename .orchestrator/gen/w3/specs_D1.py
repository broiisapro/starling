"""Wave 3 group D1: examples + docs/content (Epics 168–183)."""

# ── Shared text ──────────────────────────────────────────────────────────────

EXAMPLES_RULES = """- **D1 examples rules (Epics 168–171 run in parallel).**
  - Demo targets are **standalone projects**. Root `bun run test`, Biome and the root `tsc` loop all skip `examples/`, so you run your target's own suite yourself.
  - **Root test filter gotcha:** root `bun test packages apps/server apps/cli skills integrations tools evals` treats each word as a *substring filter*, not a directory. Any `*.test.ts` whose path contains `packages`, `apps/server`, `apps/cli`, `skills`, `integrations`, `tools` or `evals` (e.g. `examples/x/src/tools/a.test.ts`) gets pulled into the root suite. Never name a folder or test file like that.
  - **Frozen for other code:** the existing goal file names *and texts* (`apps/web/src/features/launch/goals.ts` copies them verbatim, and `fixtures/runs/*` plus Epic 40's `fixtures/real/*` recorded them), and the `make-demo-repo.sh` CLI (`make-demo-repo.sh /tmp/x`, `<example> [dir]`, `--list`, `--help`, `DEMO_SKIP_INSTALL`, `DEMO_SKIP_TESTS`, `SKY_TODO_SKIP_INSTALL`, `PY_LEDGER_SKIP_INSTALL`, last stdout line = absolute repo path). Epic 40, `tools/github-sandbox/setup.sh` and the docs all call it.
  - **Planner-evals coupling:** `evals/planner/cases.test.ts` asserts the number of sky-todo planner cases equals the number of `examples/sky-todo/demo-goals/*.expected.md` files. So a **new sky-todo answer key goes in `examples/sky-todo/.starling-answers/<goal>.expected.md`**, never in `demo-goals/`. Other targets aren't coupled yet.
  - **`examples/sky-todo/node_modules` breaks the root suite:** `packages/repomap/src/sky-todo.test.ts` `cp -r`s the folder and times out at 5 s. Test sky-todo through a demo copy (`bash examples/scripts/make-demo-repo.sh sky-todo /tmp/<x>`). If you do install in place, `rm -rf examples/sky-todo/node_modules` before any root run.
  - **Answer-key format v1** (what the existing `*.expected.md` use, and what Epic 171's validator parses): H1 `# Expected decomposition — <goal>`, a bold `**Goal (N tasks).**` sentence, a `## Task table` with columns `| # | key | title | depends on | lane owns |` (keys and globs in backticks, comma-separated; `—` for no dependency), and a line `Expected validator output: **no issues**` or one naming the expected issue codes (e.g. `lane-overlap`). Then `## Why the lanes are disjoint` and per-task details. Keep this format exactly."""

D1_DOCS = """- **D1 docs convention (shared by Epics 172–183, all writing in parallel).**
  - **Entry points:** every docs area has its index at `docs/<area>/README.md`. Link siblings by these planned paths even if they don't exist yet: `docs/guide/` (175), `docs/api/` (176), `docs/architecture/` (177), `docs/demo/` (178), `docs/blog/` (180), `docs/troubleshooting/` (181), `docs/models/` (182), `docs/flock/` (183), `docs/release/` + `CHANGELOG.md` (174), `CONTRIBUTING.md`, `SECURITY.md`, `docs/good-first-issues.md` (173), `examples/README.md` (171), `examples/birdwatch-api/` (168), `site/` (179).
  - **The pending marker:** anything not merged on `main` yet gets `⏳ Epic NN` (or `⏳ C3` for wiring) on the same line or table row. Checkers skip existence checks on marked lines but require the marker to name an epic. Never present unmerged behaviour as working.
  - **The real-run flow (Epic 40, branch `epic/40-integration-captain`, merging in parallel with you; read `git show epic/40-integration-captain:docs/epic-40-integration-captain.md`):** `starling run` is **real by default**: one private `opencode serve` on a free port, git worktrees under `worktreeRoot`, SQLite at `<repo>/.starling/starling.db`, the flock hub and the merge queue. It starts the dashboard server and prints its URL unless `--no-dash`, then prints a summary such as `✔ 5 merged · ✘ 0 failed · 0 conflicts / api $0.223 · local $0 / branch starling/3rcdzr/integration (7m 11s)`. Flags new in Epic 40 (all `⏳ Epic 40` until merged): `run --mock` (the old no-process demo stack), `run --budget <usd>` (overrides `budget.maxUsd`) and `status --repo <path>`. `plan --json` prints only `{ plan, issues }` on stdout. `starling dash` serves the repo's store read-only (`POST /api/runs` → 501, "use `starling run`"). The default LLM profile for real runs is `opencode` (`STARLING_LLM_PROFILE` overrides it; the library default stays `deepseek`). Recordings over 5 MB keep lifecycle events only. Real recordings: `fixtures/real/quick-wins.jsonl`, `fixtures/real/launch-day.jsonl`. Known limits: the auditor runs tests in the hub repo, opencode completions report `$0` for planner/auditor turns, a single machine only (perches come from Epic 42's `starling perch`), and no conflict-resolver wiring.
  - **Wave 3 CLI extensions** (built in `apps/cli/src/ext/*`, registered by C3/Epic 203, so mark them `⏳ C3`): `watch` (142), `gc` (143), `explain` (144), `completions` + `version --json` (145), `report` (146), `config` (147), `logs` (148), `try` (149).
  - **Verify against code, not memory.** The CLI surface is `createProgram()` in `apps/cli/src/program.ts`. Import it read-only (`import { createProgram } from '../../apps/cli/src/program.ts'`) and walk `program.commands` / `command.options` (`.long`, `.short`, `.negate`, `.required`, `.defaultValue`). It works from `docs/` today (verified). Core schemas: `../../packages/core/src/index.ts` (`StarlingEventTypeSchema.options`, `TaskStatusSchema.options`, `RunStatusSchema.options`, `defaultConfig`, `StarlingConfigSchema`). Never spawn the CLI binary, start servers or touch the network in a checker.
  - **Checker layout:** `docs/<area>/check.ts` (pure exported functions plus an `import.meta.main` CLI with `--check` (exit 1 on problems) and, where it generates content, `--write`), `docs/<area>/check.test.ts` beside it, and `docs/<area>/tsconfig.json` = `{ "extends": "../../tsconfig.base.json", "include": ["*.ts"] }`. Generated blocks sit between `<!-- generated:<name>:start -->` / `<!-- generated:<name>:end -->` markers. Tests are offline, deterministic and finish in under 2 s.
  - **Root `bun run test` does not cover `docs/`** (its filters are `packages apps/server apps/cli skills integrations tools evals`; keep those words out of your file paths). Run `bun test docs/<area>` and `bunx tsc --noEmit -p docs/<area>` yourself. Biome **does** lint `docs/**/*.ts`, so `bun run check` must stay clean. C3 wiring for every docs epic: "add `bun test docs` and the `docs/*/tsconfig.json` typechecks to the CI docs job (Epic 150) / root scripts".
  - Mermaid fenced blocks are fine (GitHub renders them). Reuse images from `docs/assets/**` (Epic 172 owns that folder; link, don't copy)."""

SPECS = []

# ── 168 ──────────────────────────────────────────────────────────────────────
SPECS.append(dict(
nn="168", slug="example-api", title="Demo target 3: birdwatch-api, a zero-dependency Bun TypeScript API",
lane="`examples/birdwatch-api/**`", wave="3", convention=None, budget="90–150 min",
goal="""Give Starling a third demo target that isn't a UI: **birdwatch-api**, a small Bun HTTP API where birdwatchers log sightings. It shows judges that Starling decomposes backend work (routes, middleware, validation, persistence) as cleanly as front-end features, on a repo with **zero dependencies** that installs in no time and tests in about a second. Great looks like this: adding an endpoint or a middleware means adding a file (so every demo goal splits into disjoint lanes), the baseline suite is green, two seeded bugs hide just outside what the tests cover, and three goals have answer keys good enough to grade a planner.""",
deliverables="""1. **Project shell** in `examples/birdwatch-api/`: `package.json` (`"name": "birdwatch-api"`, private, `"type": "module"`, scripts `start: bun src/server.ts`, `test: bun test`, `lint: bun scripts/lint.ts`, `check: bun run lint && bun test`; **no `dependencies` or `devDependencies` at all**), `tsconfig.json` (strict, `noUncheckedIndexedAccess`, `types: ["bun"]`; it typechecks from the Starling checkout with the root's `tsc` + `@types/bun`, and the demo copy just runs `bun test`), `.gitignore` (`node_modules/`, `data/*.jsonl`, `.starling/`), and `README.md`.
2. **Pure core, thin server.** `src/app.ts`: `createApp(deps: AppDeps): Promise<(req: Request) => Promise<Response>>`, with `AppDeps = { store: SightingStore; clock: () => Date; ids: () => string; log?: (line: string) => void }`. `src/server.ts`: `startServer({ port, ...deps })` wraps `Bun.serve`. Tests call the fetch handler directly, so no sockets are needed, except one `server.test.ts` on `port: 0`.
3. **Routing and HTTP helpers.** `src/router.ts` is a tiny router (`:param` segments, 404 and 405 with an `Allow` header, all as JSON). `src/http.ts` has `json(status, body)`, the error envelope `{ error: { code: string, message: string } }`, and `readJson(req, { maxBytes = 65536 })`, which returns 400 on bad JSON and 413 when the body is too big.
4. **Zero-edit discovery** (the property that makes lanes disjoint, like sky-todo's feature folders and py-ledger's `commands/`). Every `src/routes/*.ts` exports `export const routes: RouteDef[]` (`{ method, path, handler(ctx) }`), and every `src/middleware/*.ts` exports `export const middleware: Middleware` with an `order: number`. `createApp` loads both with `new Bun.Glob('*.ts').scan(dir)` and dynamic `import()` (skip `*.test.ts`), sorts deterministically, and rejects duplicate method+path pairs with a clear error. `src/routes/README.md` documents the contract plus a reserved-file table for the demo tasks.
5. **Domain.** `src/domain/sighting.ts` defines `Sighting { id, species, count, location: { lat, lng }, seenAt (ISO string), observer, notes?, tags: string[] }` and `validateSighting(input: unknown): { ok: true; value } | { ok: false; issues: string[] }` (hand-written, no zod). `src/store/sightings.ts` defines the `SightingStore` interface and `createMemoryStore()`. `src/store/jsonl-store.ts` is an optional file-backed store (atomic rewrite) used when `BIRDWATCH_DATA` is set. Helpers live in `src/lib/{ids,dates,geo,pagination,species}.ts`.
6. **Baseline endpoints:** `GET /health`, `GET /sightings` (filters `species`, `since`, `until`, `tag`; `limit` ≤ 100 and an opaque `cursor`), `GET /sightings/:id`, `POST /sightings` (201 + `Location`), `PATCH /sightings/:id`, `DELETE /sightings/:id` (204), and `GET /species` (distinct species with counts, sorted). Baseline middleware: JSON error handler and `x-response-time`.
7. **Two seeded bugs**, untested on purpose so the baseline stays green. (a) `src/lib/pagination.ts`: the cursor resumes at `index + 1` *after* the last item already returned, so following `next` silently skips one sighting per page boundary. The committed tests only use one page. (b) `src/lib/species.ts`: `normalizeSpecies` lower-cases but doesn't trim or collapse inner spaces, so `"Blue Jay "` and `"blue  jay"` count as different species in `GET /species` and in the `species` filter. Write `.starling-answers/BUGS.md` with a repro for each (a `curl` sequence against `bun run start`, and a `bun -e` one-liner), the cause, the expected fix, the regression tests to add, and the exact inputs the committed suite avoids.
8. **Tests:** ≥ 60 tests in ≥ 10 files, under 2 s, with an injected clock and ids (no `Date.now()` in assertions). Cover the router, the error envelope, the 413 path, validation, every endpoint's happy path plus 2 failure cases, discovery (a temp `routes` dir with a duplicate → error), and the JSONL store round trip (temp dir under `os.tmpdir()`, cleaned up). Follow the D1 naming rule (no `tools`/`evals`/`skills`… in paths).
9. **`scripts/lint.ts`:** a dependency-free linter that flags `console.log` in `src/` (except `server.ts`), `any` without a `// reason:` comment, files over 300 lines, and any `src/routes/*.ts` without a sibling `*.test.ts`. It exits 1 with `file:line message`. Add 4–6 tests for it in `scripts/lint.test.ts`.
10. **Demo goals**, each one line, each with `demo-goals/<goal>.expected.md` in answer-key format v1 (this target isn't eval-coupled, so keys live in `demo-goals/`):
    - `quick-wins.md`: 3 tasks, e.g. `GET /stats` totals, an `x-request-id` middleware, `GET /species/:name`.
    - `field-day.md`: 6 disjoint tasks: CSV export **with tests for quoting, commas and newlines** (the intended audit-failure beat), `GET /sightings/nearby?lat&lng&radiusKm` (haversine in a new file), full-text `q=` search, a per-IP rate-limit middleware, an API-key auth middleware for writes, and bulk import `POST /sightings/import`.
    - `bug-hunt.md`: fix both seeded bugs with failing-first regression tests.
11. **`README.md`:** the pitch, a quickstart (`bun test`, `bun run start`, three `curl` examples), the endpoint table, the module map, how discovery works ("adding an endpoint is adding a file"), the goals table (tasks, minutes, what each shows), and "not part of the Starling workspace". Also state the test command Starling's repo map will detect (`bun run test`).""",
oos="""- `examples/scripts/**` and `examples/README.md` belong to **Epic 171** (it adds generic install/test detection, so this target is picked up automatically). Put the README row and any script needs in your handback.
- `evals/planner/**` cases and `fixtures/repomaps/**` (Epic 161 / FIX REQUEST). The web launch form's goal chips (Epic 136).
- Any npm dependency, a database, auth libraries, or a real network listener in tests (only `port: 0`).""",
dod=["`cd examples/birdwatch-api && bun test` → 0 fail, ≥ 60 tests (paste the summary line), and `bun run lint` → clean.",
     "`bunx tsc --noEmit -p examples/birdwatch-api` (run from the repo root, so the root `tsc` and `@types/bun` are used) → clean.",
     "`bash examples/scripts/make-demo-repo.sh birdwatch-api /tmp/bw-168 && cd /tmp/bw-168 && bun test && git log --oneline && ls demo-goals` → one `chore: initial birdwatch-api` commit, green, no `.starling-answers/`, no `*.expected.md` (the current script copies and commits it; the install/test step arrives with Epic 171).",
     "Both seeded-bug repros from `BUGS.md` run in `/tmp/bw-168` and print the wrong result (paste the output)."],
carryover="",
extra_locked=EXAMPLES_RULES + """
- **Epic 171** is generalising `make-demo-repo.sh` in parallel. Detection rule it codes against: a `package.json` → `bun install` only if it declares dependencies, then `bun test`. Don't add a custom install step that would need special-casing."""))

# ── 169 ──────────────────────────────────────────────────────────────────────
SPECS.append(dict(
nn="169", slug="sky-todo-r3", title="sky-todo round 3: big-day, conflict-storm and fix-loop goals",
lane="`examples/sky-todo/**`", wave="3", convention=None, budget="60–120 min",
goal="""sky-todo is the main stage app, and Wave 3 wants three new demo moments from it: a **12-task "big day"** that fills two laptops' worth of birds, a **conflict-heavy** goal that shows the lane validator, `merge-tree` prediction and the resolver doing real work, and a **fix-loop** goal that reliably fails audit once and passes on retry. Great looks like this: each goal is a single sentence a judge can read aloud, the answer keys are precise enough to grade a planner, the app affords every task without edits to shared files, and nothing that other code depends on moves.""",
deliverables="""1. **Read first:** `examples/sky-todo/README.md`, `src/features/README.md` (the reserved-folder table), the five `demo-goals/*.expected.md`, `.starling-answers/stage.expected.md` and `BUGS.md`, plus Epic 40's notes on how the real planner split launch-day into 6 tasks (`git show epic/40-integration-captain:docs/epic-40-integration-captain.md`, "Deviations"). That tells you how a real model groups items.
2. **`demo-goals/big-day.md`** (12 tasks). Use the 12 reserved folders that already exist (`due-dates export help search shortcuts stats tag-count tags theme title-count today undo`) or swap in up to four new reserved folders, each with a `.gitkeep` and a row in the `src/features/README.md` table (e.g. `priority/`, `archive/`, `pin/`, `markdown/`). Requirements: ≥ 9 tasks ready at t0, ≤ 3 DAG edges, every lane a `src/features/<x>/**` folder, no task touching `src/ui/render.ts` or `src/main.ts`. Answer key: `.starling-answers/big-day.expected.md`.
3. **`demo-goals/conflict-storm.md`**: 3 tasks that genuinely must edit the same files (`src/ui/render.ts` footer plus `src/ui/styles.css`), e.g. a sort toggle, a "Delete done" button and an item-density switch. The answer key states the expected validator output (`lane-overlap` on which task pairs), which merges `git merge-tree` should predict to conflict, and what a correct resolver merge looks like (the final footer markup). It complements the 2-task `conflict-bait`, which stays untouched. Answer key: `.starling-answers/conflict-storm.expected.md`.
4. **`demo-goals/fix-loop.md`**: 1–2 tasks whose first attempt predictably misses a mechanically checkable item. Example: "Add undo/redo with tests for: redo is cleared after a new edit, undoing a delete restores the item at its old position, and history is capped at 50 steps". The answer key documents attempt 1 (the likely miss), the auditor's expected `dod` item that fails, the fixer instruction it should produce, and attempt 2. Answer key: `.starling-answers/fix-loop.expected.md`.
5. **Affordances.** If a new goal needs a hook the app lacks (a new slot, command or filter), add it **additively** to `src/ui/slots.ts`, `src/lib/commands.ts` or `src/ui/filters.ts` with tests. Keep every existing export, slot id and command name (the recordings and the repo-map fixture rely on them).
6. **Keep `stage` where it is:** `stage.expected.md` stays in `.starling-answers/` (see carryover). Re-check that all existing goals and answer keys still describe the code accurately, and fix stale facts in the keys, the README or `BUGS.md` without renaming anything or changing goal texts.
7. **One guard test** inside the app, `src/features/reserved.test.ts`: every folder listed in the `src/features/README.md` reserved table exists, and every folder under `src/features/` is either listed or a real feature (has `index.ts`). It runs in demo copies too, so it must not read `.starling-answers/` or `demo-goals/`.
8. **README:** the goals table now has all 9 goals (tasks, rough minutes, what each demonstrates, which laptop count). Add a "Which goal for which demo?" table (smoke, 3-minute stage, flock big-day, conflicts, audit retry). Mark the minute estimates as sizing estimates (no real runs in this wave).
9. **Hand the goal texts to C3:** list the exact text of the three new goals in the handback so Epic 136/C3 can add them as launch-form chips.""",
oos="""- Moving `stage.expected.md` or adding any `*.expected.md` to `demo-goals/` (breaks `evals/planner/cases.test.ts`, Epic 161's lane).
- `examples/scripts/**` and `examples/README.md` (Epic 171), `evals/**`, `fixtures/**`, `apps/web/src/features/launch/**` (Epic 136).
- Implementing any demo feature (that's Starling's live work). Real Starling runs.""",
dod=["`bash examples/scripts/make-demo-repo.sh sky-todo /tmp/st-169 && cd /tmp/st-169 && bunx tsc --noEmit` → the script reports `0 fail`, tsc is clean, and `ls demo-goals` shows the 3 new goals with no `*.expected.md` and no `.starling-answers/` (paste).",
     "`bun test evals/planner packages/repomap/src/sky-todo.test.ts` at the repo root → 0 fail (proves the answer-key placement and repo-map floors still hold). Make sure `examples/sky-todo/node_modules` doesn't exist first.",
     "`git diff origin/main --stat -- examples/sky-todo/demo-goals` shows only **added** files (no existing goal changed)."],
carryover="""- **From 58-demo-targets, FIX REQUEST 1** (the `stage` answer key should move back to `demo-goals/` once `evals/planner` has a `sky-todo-stage` case): **decline here**. The move is only safe in the same merge as the eval case (Epic 161's lane), and nobody can order two parallel branches. Keep it in `.starling-answers/`. C3 note for the handback: "if Epic 161 added `sky-todo-stage`, run `git mv examples/sky-todo/.starling-answers/stage.expected.md examples/sky-todo/demo-goals/` and drop its 'Where this file lives' note".
- **From 58, FIX REQUEST 2** (`packages/repomap/src/sky-todo.test.ts` copies `node_modules`): not your lane (Epic 108). Mitigate as the D1 rules say, and mention it in the handback if you hit it.""",
extra_locked=EXAMPLES_RULES + """
- **Epic 171** (validator) parses your answer keys from both `demo-goals/` and `.starling-answers/` using format v1. Run its validator if it has landed on `origin/main`; otherwise eyeball the format against `launch-day.expected.md`."""))

# ── 170 ──────────────────────────────────────────────────────────────────────
SPECS.append(dict(
nn="170", slug="py-ledger-r2", title="py-ledger round 2: more goals, a pure-Python test runner fallback, README polish",
lane="`examples/py-ledger/**`", wave="3", convention=None, budget="90–150 min",
goal="""py-ledger proves Starling is language-agnostic, but on demo day it has one fragile step: `pip install` of pytest on venue wifi. Round 2 removes that risk with a **pure-standard-library test runner fallback** that runs the existing suite with the same pass count, adds goals that exercise the flock and the fix loop on Python, and polishes the README so a judge can run it in a minute. Great looks like this: `python3 scripts/minitest.py` and `pytest` agree on every test, and the new goals are as crisp as the existing three.""",
deliverables="""1. **`scripts/minitest.py`**: a fallback runner using only the stdlib (Python ≥ 3.12). It discovers `tests/test_*.py` and module-level `test_*` functions, loads `tests/conftest.py`, and runs every test in-process with `src/` on `sys.path` (mirroring `pythonpath = ["src"]` in `pyproject.toml`). CLI: `python3 scripts/minitest.py [-k substr] [-x] [-q] [paths...]`. Output ends with pytest's summary shape: `N passed, M failed in X.XXs`. Exit code 0/1, and 5 when nothing is collected. Failures print the test id, assertion location and traceback.
2. **`scripts/_pytest_shim/pytest.py`**: a minimal `pytest` module placed on `sys.path` **only** when `importlib.util.find_spec("pytest") is None` (or when `MINITEST_FORCE_SHIM=1`), so a real pytest always wins. It supports exactly what the suite uses (grep `tests/`): `fixture` (function scope, dependency injection by parameter name, fixtures depending on fixtures, `yield` teardown), `raises(exc, match=...)` as a context manager, and `mark.parametrize` (a single name or a comma-separated string, list of values or tuples, `ids=`). Built-in fixtures: `tmp_path` (unique dir under `tempfile.gettempdir()`, removed after), `capsys` (`readouterr()` → `.out`/`.err`), and `monkeypatch` (`setattr`, `setenv`, `delenv`, `chdir`, undone after each test). Include `CaptureFixture` and `MonkeyPatch` names so annotations resolve.
3. **Parity:** with the real pytest installed, `python -m pytest -q` and `python scripts/minitest.py` report the **same passed count** (136 today, plus your new tests). Add `tests/test_minitest.py` (≥ 10 tests: discovery, parametrize ids, fixture teardown order, `raises` match failure, `capsys`, `monkeypatch` undo, `-k`). It runs under both runners.
4. **New goals** (one line each, with `demo-goals/<goal>.expected.md` in answer-key format v1; py-ledger isn't eval-coupled):
   - `big-day.md` (8–10 disjoint command/module tasks for the flock demo, ≤ 2 edges). Python commands are discovered via `pkgutil`, so new commands are new files in `src/py_ledger/commands/`.
   - `fix-loop.md` (1 task: make `import` de-duplicate repeated rows by `(date, amount, merchant)` **with tests for exact duplicates, near-duplicates that must stay, and a `--allow-duplicates` flag**; the known gap from the README). The key documents the expected first-attempt miss.
   - `refactor.md` (a cross-cutting goal, e.g. "add an optional `--currency` code end to end", which touches models/storage/formatting/commands). The key shows how a good planner serialises it with dependencies rather than overlapping lanes.
   Keep the existing `quick-wins`, `feature-day` and `bug-hunt` files byte-identical.
5. **Seeded bugs:** keep the two from Wave 2 working and still untested. Re-verify `BUGS.md` repros against the current code (`py-ledger add -a 0.29 …` → `$0.28`).
6. **README polish:** a 60-second quickstart (venv path **and** the no-pytest path: `python3 scripts/minitest.py`), the commands table, the module map, a goals table with all 6 goals, a "how Starling sees this repo" section (test command `pytest`, why the venv must be active, the fallback runner for offline laptops), and an updated test count.
7. **Quality:** `ruff check .` and `ruff format --check .` stay clean, including `scripts/`. Use the existing ruff config in `pyproject.toml` (add `scripts` to the include if the config is path-scoped). No new runtime or dev dependencies.""",
oos="""- `examples/scripts/make-demo-repo.sh` (Epic 171 will use `scripts/minitest.py` as the fallback when the venv/pip step fails; it codes against the path and CLI above, so keep them).
- `evals/planner/**` and `fixtures/repomaps/**` (Epic 161), and `apps/web/src/features/launch/**`.
- Changing the app's behaviour beyond what new tests need. Real Starling runs.""",
dod=["`cd examples/py-ledger && python3 -m venv /tmp/pl-170 && /tmp/pl-170/bin/pip install -q -e '.[dev]' && /tmp/pl-170/bin/python -m pytest -q` → all pass (paste the summary). If pip has no network, say so and skip to the next item.",
     "`cd examples/py-ledger && MINITEST_FORCE_SHIM=1 python3 scripts/minitest.py` → the **same passed count** as pytest, 0 failed (paste both lines side by side).",
     "`/tmp/pl-170/bin/ruff check examples/py-ledger && /tmp/pl-170/bin/ruff format --check examples/py-ledger` → clean.",
     "`bash examples/scripts/make-demo-repo.sh py-ledger /tmp/pl-demo-170` → green baseline, the 3 new goals present, no `*.expected.md` (paste). Then `rm -rf examples/py-ledger/src/*.egg-info` if the editable install created one."],
carryover="""- **From 58-demo-targets, FIX REQUEST 1 (optional follow-up):** planner cases for py-ledger's goals. **Decline**: they live in `evals/planner/**` (Epic 161) and need a `fixtures/repomaps/py-ledger.json`. Put a ready-to-paste case JSON for `bug-hunt` and `feature-day` in your handback for Epic 161/C3.""",
extra_locked=EXAMPLES_RULES))

# ── 171 ──────────────────────────────────────────────────────────────────────
SPECS.append(dict(
nn="171", slug="examples-scripts", title="Examples tooling: generic demo repos, an answer-key validator, a demo-day reset",
lane="`examples/scripts/**`, `examples/README.md`", wave="3", convention=None, budget="90–150 min",
goal="""On demo day, the examples have to just work: one script builds a clean repo for **any** target, one command proves every goal's answer key is consistent (lanes disjoint, dependencies acyclic, paths real), and one command resets a demo repo between rehearsals in seconds. Great looks like this: a fourth target needs zero script changes, the validator catches a broken answer key before a judge sees the planner "fail", and a reset after a messy run takes one line.""",
deliverables="""1. **Generalise `make-demo-repo.sh` without breaking its contract** (see the D1 rules: every existing form, flag, env var and the last-line path must keep working). Replace the per-name `case` blocks with **detection**:
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
6. **`examples/README.md`:** one index for all targets (sky-todo, py-ledger, birdwatch-api with `⏳ Epic 168` until its folder exists), the detection rules, the **answer-key format v1 spec** (copy it from the D1 rules and make it the canonical reference), the validator and reset usage, a "demo-day sequence" (build → validate → rehearse → reset), and "adding a target" (now: a folder with `package.json` or `pyproject.toml`, a green suite, goals plus keys; no script edits).""",
oos="""- Anything inside `examples/sky-todo`, `examples/py-ledger` or `examples/birdwatch-api` (Epics 169, 170, 168). If a key is wrong, file a FIX REQUEST.
- `tools/github-sandbox/**` (Epic 159), `evals/**`, `tools/qa/examples/**` (Epic 198 tests targets from the outside).""",
dod=["`bun test examples/scripts` → 0 fail, ≥ 34 tests (paste the summary), and `bunx tsc --noEmit -p examples/scripts` → clean.",
     "`bun examples/scripts/validate-goals.ts` → every goal of every present target passes (paste the table).",
     "`bash examples/scripts/make-demo-repo.sh /tmp/legacy-171` (legacy form) and `bash examples/scripts/make-demo-repo.sh --list` behave as before (paste). Then `bash examples/scripts/reset-demo.sh /tmp/legacy-171 --dry-run` prints its plan.",
     "`bash -n examples/scripts/*.sh` → ok."],
carryover="""- **From 43-github-e2e:** "`examples/scripts/make-demo-repo.sh`: no change needed — `SKY_TODO_SKIP_INSTALL=1` already exists and is what `setup.sh` uses". Keep `SKY_TODO_SKIP_INSTALL` (and `PY_LEDGER_SKIP_INSTALL`) working, and cover them with a test.""",
extra_locked=EXAMPLES_RULES + """
- **Epics 168/169/170 are adding targets, goals and `scripts/minitest.py` in parallel.** Code against detection plus format v1. Never against their files existing."""))

# ── 172 ──────────────────────────────────────────────────────────────────────
SPECS.append(dict(
nn="172", slug="readme-r2", title="README round 2: judge-ready, real-run quickstart, docs hub",
lane="`README.md`, `docs/assets/**`", wave="3", convention=None, budget="90–150 min",
goal="""The README is the first thing a judge opens. Today it still says "the CLI boots a mock composition" and promises v0.1. Round 2 makes it **judge-ready**: a 10-second hook, the real-run quickstart in three commands (Epic 40), the open-weight story told with the real profile table, flock mode in one picture, honest swarm numbers, and a docs hub linking the guide, API, architecture, demo, troubleshooting, models and flock docs being written in parallel. Great looks like this: every command in it is checked against the real CLI by a script, every link resolves, and nothing pending pretends to be done.""",
deliverables="""1. **Hook (above the fold):** logo line, one-sentence pitch, three "what you'll see" bullets (a plan with lanes, birds that are agents, an integration branch that's green), the hero image (`docs/assets/c1-dashboard-1920.png` or a newer screenshot you add), and the badges (keep the CI badge URL exactly; Epic 60's FIX REQUEST). Leave an HTML comment slot `<!-- demo-gif: docs/assets/demo.gif (record on demo day, see docs/assets/README.md) -->` and never link a GIF that doesn't exist.
2. **Status callout rewritten for the real run.** `starling run` is real by default, and `--mock` is the no-process demo stack (`⏳ Epic 40` until merged). Remove the "mock composition" / "two-terminal" / blanket `v0.1` wording (FIX REQUEST 60.2): search for `v0.1`, `mock composition` and `two-terminal`. Anything still unwired gets the `⏳ Epic NN` marker instead.
3. **Quickstart in 3 commands:** (1) clone + `bun install`; (2) `bun run starling init --yes` (it exists: Epic 61); (3) a real run on a fresh demo repo: `bun run starling run "$(cat examples/sky-todo/demo-goals/quick-wins.md)" --repo "$(bash examples/scripts/make-demo-repo.sh)"`. Add one sentence on the prerequisite (an opencode login) and the zero-setup paths: `bun run starling replay fixtures/runs/sky-todo-launch-day.jsonl --speed 20`, the dashboard's `?demo=1`, and `starling try` (`⏳ C3`, Epic 149). Show real output only (Epic 40's summary lines are in its doc).
4. **Open-weight story:** the role × profile table must match `applyProfile(defaultConfig, profile)` from `packages/llm/src/index.ts` for `opencode`, `deepseek`, `local` and `mixed`. The current README says `deepseek (default)` and omits `mixed`. Real runs default to `opencode` (Epic 40). Keep it short and link `docs/models/`.
5. **Flock in one picture:** `docs/assets/diagrams/flock-topology.svg`, four lines (hub, perch, bundles, rescheduling), the two real commands (`starling flock`, `starling perch --hub … --code …`), and a link to `docs/flock/`.
6. **Docs hub table:** one row per planned docs entry point (see the D1 convention) with a one-line "read this when…". Also link `site/`, `examples/README.md`, `CHANGELOG.md` and `CONTRIBUTING.md`.
7. **Commands table** regenerated from `createProgram()` (every command plus its key flags), plus the Wave 3 extension commands marked `⏳ C3`.
8. **Built by the flock** (FIX REQUEST 60.3): replace the placeholder table with real numbers from `tools/stats/out/stats.json` (`totals.epics`, `prs`, `commits`, `tests`, `peakConcurrentAgents`, `agentHours`, `waves`), cite `generatedAt`, and add a line on Wave 3 (about 100 agents on one laptop, `⏳ Epic 154` for the numbers). Delete the "coming in v0.2" note and update the Roadmap section so it no longer lists shipped things as future.
9. **Checker** `docs/assets/check/readme.ts` + `readme.test.ts` + `tsconfig.json` (your lane is `docs/assets/**`; one level deeper than the convention, so `extends` is `../../../tsconfig.base.json` and imports start `../../../`):
   - every relative link and image in `README.md` resolves to a file, or is in a `PLANNED_PATHS` list (the D1 entry points);
   - every `#anchor` matches a heading's GitHub slug;
   - every `starling <cmd> [--flags]` in fenced blocks and inline code exists in `createProgram()` (handle `bun run starling`, quotes, `$(…)`, trailing-backslash continuations, `--flag=value`, negated `--no-*`), unless the line carries `⏳`;
   - every number in the "Built by the flock" table equals the matching field in `tools/stats/out/stats.json`.
   `--check` exits 1 with `README.md:<line> <problem>`. Tests ≥ 15 (synthetic markdown plus the real README passes).
10. **`docs/assets/README.md`:** what each asset is, the diagram palette rules (link the existing `diagrams/README.md`), and how to record the demo GIF on demo day (`?demo=1`, 1280×720, ≤ 8 MB, where to save it, and the one README line to uncomment).
11. **Optional, if time allows:** one new hand-authored SVG `docs/assets/diagrams/lanes.svg` (two tasks, disjoint globs, one blocked overlap), following the existing palette rules and readable on GitHub light and dark.""",
oos="""- `CONTRIBUTING.md` (Epic 173 owns it this wave), `site/**` (Epic 179), any `docs/<area>/` content (the D1 docs epics); link their planned paths only.
- `apps/cli` help text (the stale footer in FIX REQUEST 60.2 belongs to Wave 3b / Epic 203; list it in the handback).""",
dod=["`bun test docs/assets` → 0 fail, ≥ 15 tests, and `bunx tsc --noEmit -p docs/assets/check` → clean.",
     "`bun docs/assets/check/readme.ts --check` → exit 0 on the final README (paste the output).",
     "`grep -nE 'mock composition|two-terminal|coming in v0.2' README.md` → no matches outside lines marked `⏳`.",
     "Every command in the quickstart that can run offline (`init --yes --dry-run`, `plan --help`, `replay … --speed 200`, `doctor`) was run, and its output pasted in the handback."],
carryover="""- **From 60-readme, FIX REQUEST 2:** update the `⏳ v0.1` markers and the status callout now that real wiring lands (Epic 40). Flag the CLI footer string "Wave 1 runs on the mock composition…" to Epic 203 (Epic 40's branch already rewrites it).
- **From 60, FIX REQUEST 3:** replace the placeholder "Built by the flock" table with collector output (`tools/stats/out/stats.json`) and delete the "coming in v0.2" note.
- **From 60, FIX REQUEST 4:** `starling init --yes` / `--dry-run` exist now (Epic 61), so use them in the quickstart. (The CONTRIBUTING half is Epic 173's.)
- **From 60, FIX REQUEST 5 / 59, FIX REQUEST 5:** keep one diagram set in `docs/assets/diagrams/`. Link the landing page `site/` and `site/screens/hero.png` from the README.""",
extra_locked=D1_DOCS))

# ── 173 ──────────────────────────────────────────────────────────────────────
SPECS.append(dict(
nn="173", slug="contributing", title="Community files: Hacktoberfest-ready CONTRIBUTING, CoC, SECURITY, issue forms, 15 good first issues",
lane="`CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `.github/ISSUE_TEMPLATE/**`, `.github/PULL_REQUEST_TEMPLATE.md`, `docs/good-first-issues.md`", wave="3", convention=None, budget="60–120 min",
goal="""Starling is a Hacktoberfest project, and the demo closes on "here are the good first issues". This epic makes that true: a CONTRIBUTING guide that turns our lane method into an on-ramp for humans, standard community files (Code of Conduct, a security policy that is honest about the LAN-only flock model and the open SEC findings), issue forms that route reports to the right area, and **15 concrete good first issues** with real file pointers and a literal definition of done. Great looks like this: a first-time contributor picks an issue, declares a lane, and opens a mergeable PR without asking a question.""",
deliverables="""1. **`CONTRIBUTING.md` refresh** (keep its structure and tone):
   - a **Hacktoberfest** section (how PRs count: the `hacktoberfest` topic and the `hacktoberfest-accepted` label; one concern per PR; no spam);
   - **"Adding things without touching shared files"**: the CLI extension module (`apps/cli/src/ext/<name>/` with `export const extension = { name, summary, register(program, io) }`) and the web feature manifest (`apps/web/src/features/<x>/index.ts` → `export const feature = {…}`), copied from the Wave 3 conventions so humans use the same seams;
   - **standalone projects** and how to test each: `examples/*` (own suites; `bun test examples/scripts`), `site/` (`bun run --cwd site test`), and the docs checkers (`bun test docs/<area>`);
   - replace "1,785 tests" with a count-free phrase ("≈2,500 tests; CI has the current number").
   Keep the handback section and "If you are an AI agent" consistent with `AGENTS.md` (read it; don't contradict it).
2. **Setup example** (FIX REQUEST 60.4): `bun run starling init --yes` and `bun run starling init --dry-run`. Verify both flags exist in `createProgram()` (they do). The real-run note: `starling run` is real by default once Epic 40 merges (`⏳ Epic 40` for `--mock`).
3. **`CODE_OF_CONDUCT.md`:** the Contributor Covenant 2.1, with the required attribution (CC BY 4.0) and the enforcement guidelines. For the reporting channel, don't invent an email address: point to GitHub's private reporting / a maintainer contact line marked clearly as to-be-filled, and list "conduct contact email" as an Open question in the handback.
4. **`SECURITY.md`:**
   - supported versions (`main`, 0.x);
   - how to report (GitHub private vulnerability reporting; no public issues);
   - the threat model in plain words (ARCHITECTURE L18: a LAN-only flock, the join code as a shared secret in `x-flock-token`, no TLS; agents run repo commands; run Starling only on repos and networks you trust);
   - a **known findings table** SEC-01…SEC-11 from `.orchestrator/fix-requests-w2.md` §69 (id, one line, status: SEC-04 fixed by Epic 41; the others `⏳ Epic 101/102/103/104/110` per the w3 list), each linking its probe in `tools/security/*.test.ts`.
   Link `docs/flock/` for the operational guide.
5. **Issue forms**, additive only: add `feature.yml`, `docs.yml` and `good-first-issue.yml` (a maintainer form with lane, files, DoD, test command and difficulty fields). Extend the `area` dropdown in `bug.yml` with any missing areas (`examples`, `docs`, `site`, `integrations`, `server`, `cli extensions`). **Don't rename or remove** `bug.yml`, `epic.yml`, `contract-request.yml` or `config.yml` (the orchestrator uses them). Add a contact link for security reports to `config.yml`.
6. **`.github/PULL_REQUEST_TEMPLATE.md`:** keep the handback block **verbatim** (the orchestrator parses those headings; agents use `--body-file`, so the template only affects humans). Add a short human preface ("Human contributor? Fill in Lane, what changed, how you tested; the handback fields are optional for small PRs") and two checklist items (lane declared; `hacktoberfest` rules read).
7. **`docs/good-first-issues.md`: 15 issues.** Each has: a title (Conventional-Commit style), area, **lane globs**, the files to read and the files to change (real paths that exist today), why it matters (one line), a literal DoD, the test command, difficulty (S/M), labels, and a ready `gh issue create --title … --label good-first-issue,hacktoberfest --body-file -` snippet. Source the ideas from the "Known limitations / deferred" sections of `docs/epic-*.md` and the handbacks' Open questions.
8. **Avoid stepping on Wave 3:** don't pick work that a Wave 3 epic already owns (check `.orchestrator/epics.tsv` and `gh issue list --label epic --state open --limit 200`). Good candidates live in quiet lanes: doctor hints, error messages, `skills/` examples, py-ledger import dedupe docs, etc. Each issue's lane must be **disjoint** from the other 14, so 15 people can work at once. Say so at the top of the doc.""",
oos="""- `README.md` (Epic 172), `.github/workflows/**` (Epic 150), `AGENTS.md`, `.orchestrator/**`.
- Actually creating GitHub issues or labels (done later by the maintainer; your doc has the snippets).""",
dod=["Every issue form parses: `for f in .github/ISSUE_TEMPLATE/*.yml; do bun -e \"Bun.YAML.parse(await Bun.file('$f').text())\" || echo BAD $f; done` → no `BAD` (if `Bun.YAML` is missing, use `cd packages/core && bun -e \"import {parse} from 'yaml'; …\"`).",
     "Every repo path in `docs/good-first-issues.md` exists: run a short `bun -e` script that extracts backticked paths containing `/` and `existsSync`s them, and paste it plus its output (0 missing). Same for the `tools/security/*.test.ts` links in `SECURITY.md`.",
     "The 15 issues' lane globs are pairwise disjoint: check with `globsOverlap` from `packages/core/src/glob.ts` in the same `bun -e` script (paste)."],
carryover="""- **From 60-readme, FIX REQUEST 4:** add `starling init --yes` / `--dry-run` to the CONTRIBUTING setup example (both flags are registered).
- **From 60, Open question:** the hard-coded test count in CONTRIBUTING goes stale. Replace it with a count-free phrase.""",
extra_locked=D1_DOCS + """
- This epic has no folder of its own, so it has no checker script. Verification is the inline `bun -e` commands in the DoD; paste them verbatim in the handback."""))

# ── 174 ──────────────────────────────────────────────────────────────────────
SPECS.append(dict(
nn="174", slug="changelog", title="CHANGELOG and release notes for v0.1.0, generated from tags and handbacks",
lane="`CHANGELOG.md`, `docs/release/**`", wave="3", convention=None, budget="60–120 min",
goal="""Ship v0.1.0 with a real paper trail: a Keep-a-Changelog `CHANGELOG.md` generated from the swarm's actual history (the `epic-NN-complete` tags, `.orchestrator/epics.tsv` and the handbacks), human release notes a judge can skim, and a release checklist the maintainer can follow on demo eve. Great looks like this: re-running one script after Wave 3 merges regenerates the changelog byte-for-byte deterministically, `--check` catches a stale file, and every line traces back to an epic.""",
deliverables="""1. **`docs/release/changelog.ts`:**
   - `type GitRunner = (args: string[]) => Promise<string>` (default: `Bun.spawn` of `git` in the repo root; injected in tests).
   - `collectEntries(git: GitRunner, repoRoot: string): Promise<ChangelogEntry[]>`. It reads `git tag --list 'epic-*-complete' --format='%(refname:short)%09%(creatordate:iso-strict)'`, joins each `NN` with `.orchestrator/epics.tsv` (columns `nn slug title wave machine lane depends`), and for epics missing from the TSV (Wave 3+) falls back to the first heading of `.orchestrator/handbacks/NN-*.md`, then to the merge subject `Merge branch 'epic/NN-slug'`.
   - `ChangelogEntry = { nn, slug, title, wave, date, section: Section, pr?: number }`, where `Section = 'Added' | 'Changed' | 'Fixed' | 'Security' | 'Deprecated' | 'Removed'`.
   An optional `--gh` flag adds PR numbers via `gh pr list --state merged --json number,headRefName --limit 500` (never in tests).
2. **`classify(entry, overrides)`:** deterministic keyword rules on slug/title. `security`/`SEC-`/`hardening` → Security; `fix`/`bug` → Fixed; `r2`/`r3`/`polish`/`tuning`/`round` → Changed; everything else → Added. `docs/release/overrides.json` (`{ "NN": "Section" }`) wins. Document the rules at the top of the file.
3. **`renderChangelog(entries, { version, date, unreleasedFromWave? })`:**
   - the Keep-a-Changelog header (link to keepachangelog.com and semver);
   - `## [Unreleased]` for entries newer than the release cut (a wave threshold option), then `## [0.1.0] - YYYY-MM-DD`;
   - within a version, sections in KaC order; within a section, sorted by wave then `nn`;
   - lines like `- **<area>**: <title> (Epic NN, wave W)`, where area is derived from the lane/slug;
   - stable output (no timestamps except the explicit `date`).
4. **CLI:** `bun docs/release/changelog.ts [--write] [--check] [--version 0.1.0] [--date 2026-10-28] [--gh]`. It prints to stdout by default. `--write` rewrites only the region between `<!-- changelog:start -->` and `<!-- changelog:end -->` in `CHANGELOG.md` (the intro above stays hand-written). `--check` exits 1 with a unified-diff-style summary when the file is stale.
5. **`CHANGELOG.md`** generated from the current history (28+ completion tags and the Wave 2 tags present on `main`), plus a short hand-written intro explaining that every entry is one epic built by one agent in one lane.
6. **`docs/release/notes-v0.1.0.md`:**
   - highlights for judges (real `starling run`, flock mode, open-weight routing, the murmuration dashboard, the Agent Skill, demo targets);
   - numbers from `tools/stats/out/stats.json` (cite `generatedAt`);
   - known limitations (copy them accurately from Epic 40's doc);
   - install (from source today; binaries and the installer `⏳ Epic 151/152`);
   - credits (the flock, opencode, the model makers).
7. **`docs/release/checklist.md`:** the step-by-step release checklist with exact commands:
   - freeze `main`;
   - `bash .orchestrator/bin/heavy.sh bun run test` and `… bun run check`;
   - `bun docs/release/changelog.ts --check`;
   - site build (`bun run --cwd site build`);
   - binaries (`⏳ Epic 151`: `tools/release/`) and checksums;
   - the version bump points (`apps/cli/src/program.ts` `.version('0.0.0')` is CLI-owned: a FIX REQUEST for Epic 203);
   - `git tag v0.1.0`;
   - `gh release create v0.1.0 --draft --notes-file docs/release/notes-v0.1.0.md`.
   Plus a rollback section.
8. **Tests** `docs/release/changelog.test.ts` (≥ 18):
   - TSV parsing (missing rows, extra columns);
   - tag parsing (non-epic tags ignored, malformed dates);
   - handback-title fallback;
   - classification table plus overrides;
   - rendering of a fixed fixture to an exact expected string;
   - idempotent `--write` region replacement (missing markers → clear error);
   - `--check` stale detection;
   - one integration test on a temp git repo (`git init`, 3 commits, 2 `epic-*-complete` tags, a tiny epics.tsv) under `os.tmpdir()`.
   Add `docs/release/README.md` (index + how to regenerate) and `docs/release/tsconfig.json`.""",
oos="""- Publishing anything: no `git tag`, `gh release`, pushes of tags or uploads. Version bumps in `apps/cli` (Epic 203). Release binaries (Epic 151) and the installer (Epic 152).""",
dod=["`bun test docs/release` → 0 fail, ≥ 18 tests, and `bunx tsc --noEmit -p docs/release` → clean.",
     "`bun docs/release/changelog.ts --write && bun docs/release/changelog.ts --check; echo exit=$?` → `exit=0`. Paste `head -40 CHANGELOG.md`.",
     "Run it twice and `git diff --exit-code CHANGELOG.md` after the second run → no diff (determinism)."],
carryover="",
extra_locked=D1_DOCS))

# ── 175 ──────────────────────────────────────────────────────────────────────
SPECS.append(dict(
nn="175", slug="guide", title="User guide: install to first real run, verified against the CLI",
lane="`docs/guide/**`", wave="3", convention=None, budget="90–150 min",
goal="""Write the guide a new user follows from `git clone` to a merged, green integration branch: install, the first real run on a demo repo (Epic 40's flow), writing goals that plan into clean lanes, reading the dashboard, budgets, flock setup, open-weight profiles and where to go when it breaks. Great looks like this: it reads like a friendly walkthrough, and **every command and flag in it is machine-checked** against `createProgram()`, so the guide can't drift when Wave 3b rewires the CLI.""",
deliverables="""1. **`docs/guide/README.md`:** a short "what Starling does" paragraph, the reading order, and a page index with one line per page.
2. **`install.md`:** prerequisites (Bun 1.4.4 (≥ 1.3 works), Git ≥ 2.38 for `merge-tree --write-tree`, opencode ≥ 2.1 with a provider login, Ollama optional), clone + `bun install`, the `alias starling='bun run --cwd <checkout> starling'` tip, and `starling doctor`: what each line means (read `apps/cli/src/doctor-probes.ts`). Then `starling init --yes` / `--dry-run` / `--profile auto|opencode|deepseek|local`. Binaries/installer get `⏳ Epic 151/152`.
3. **`first-run.md`**, the heart of the guide:
   - make a demo repo (`bash examples/scripts/make-demo-repo.sh`);
   - plan it read-only (`starling plan "$(cat …/quick-wins.md)" --repo <path>`, and `--json | jq '.plan.tasks[].key'`);
   - run it for real (`starling run … --repo <path> --max-parallel 3 --record run.jsonl`), with what you see in order: dashboard URL, live view, audits, merges, the final summary and the integration branch;
   - verify it (`git -C <repo> log --oneline starling/<run>/integration`, then `bun test` on that branch);
   - replay it (`starling replay run.jsonl --speed 20`) and inspect it (`starling status --file run.jsonl`).
   Include the no-agents variants: `--dry-run`, and `--mock` (`⏳ Epic 40`).
4. **`goals.md`:** how the planner reads a goal; good vs bad goal pairs (use the real `examples/*/demo-goals/*.md` texts as the good ones); naming files/folders to steer lanes; why "fix X and refactor everything" overlaps; how to read `plan` issues (the `PlanIssueCodeSchema.options` codes from core, each explained in one line); iterating with `plan --json`.
5. **`dashboard.md`:** the Sky (roosts, bird states mapped to `TaskStatus`), the DAG, the agent drawer, the merge queue, metrics and the cost meter, the flock panel, and the launch form. Hotkeys `1 2 b f ? Esc` (verify in `apps/web/src/app/Layout.tsx`). `?demo=1`, and how `starling run` vs `starling dash` vs `bun run --cwd apps/server dev:live` feed it. Wave 3 panels (report, timeline, costs, palette, …) get `⏳ C3` with their assigned hotkeys from the w3 conventions.
6. **`budgets.md`:** `budget.maxUsd` (default 5, from `defaultConfig`), `--budget` (`⏳ Epic 40`), what the engine does at the cap, API vs local spend in the meter and why opencode completions currently show `$0` (Epic 40 limitation), plus `maxParallel` and `maxAttempts`.
7. **`flock.md`, `models.md` and `troubleshooting.md`:** one-screen summaries that link the deep docs (`docs/flock/`, `docs/models/`, `docs/troubleshooting/`) so the guide stands alone but doesn't duplicate them.
8. **`commands.md`:** a full CLI reference **generated** from `createProgram()`: for each command, the signature, description, and an options table (flag, value, default, description), plus its examples text. Then a hand-written "Coming with Wave 3" table of extension commands marked `⏳ C3`. Generated between `<!-- generated:commands:start/end -->` markers.
9. **Checker `docs/guide/check.ts`:**
   - `cliSurface(program)` → `Record<string, { args: string[]; options: { flags: string; long?: string; short?: string; negate: boolean; takesValue: boolean; defaultValue?: unknown; description: string }[] }>`;
   - `extractInvocations(markdown, file)` → `{ file, line, command, flags[], pending: boolean }[]`. Scan fenced `bash`/`sh`/`text`-less blocks and inline code. Handle `bun run starling`, `starling`, quoted args, `$(…)`, trailing-backslash continuations, `--flag=value`, `# comments`, and the `⏳` marker;
   - `validateInvocations(invocations, surface)` → problems (unknown command, unknown flag, missing pending-marker epic);
   - `renderCommandsReference(surface)`;
   - `checkRepoPaths(markdown)`: backticked paths starting `examples/`, `fixtures/`, `docs/`, `apps/`, `packages/`, `tools/` exist, or are D1 planned paths, or are marked `⏳`.
   CLI `--check` / `--write`.
10. **Tests** `docs/guide/check.test.ts` (≥ 25): the extraction edge cases above, the negated `--no-dash` / `--no-flock`, `--max-parallel 8` vs `--max-parallel=8`, an unknown flag, a pending line with and without an epic, `commands.md` up to date, the whole real guide passes, and a fake surface showing a newly added flag doesn't break existing docs.""",
oos="""- Deep reference material owned by siblings: REST/SSE/config reference (176), architecture (177), troubleshooting entries (181), models (182), flock (183). Summarise and link.
- `README.md` (172). Any change to `apps/cli` (help text problems → FIX REQUEST for Epic 203).""",
dod=["`bun test docs/guide` → 0 fail, ≥ 25 tests, and `bunx tsc --noEmit -p docs/guide` → clean.",
     "`bun docs/guide/check.ts --check; echo exit=$?` → `exit=0` (paste the summary: pages, invocations checked, pending count).",
     "Offline commands from `first-run.md` that need no model were actually run (`make-demo-repo.sh`, `starling init --yes --dry-run`, `starling replay fixtures/runs/sky-todo-launch-day.jsonl --speed 200`, `starling status --file fixtures/runs/sky-todo-launch-day.jsonl`), with output pasted in the handback."],
carryover="",
extra_locked=D1_DOCS))

# ── 176 ──────────────────────────────────────────────────────────────────────
SPECS.append(dict(
nn="176", slug="api-docs", title="API reference: REST, SSE events, perch API and config, checked against the zod schemas",
lane="`docs/api/**`", wave="3", convention=None, budget="90–150 min",
goal="""Integrators (the VS Code extension, the MCP server, the GitHub Action, the notifier, the shell prompt, all being built this wave) need one reference for Starling's REST API, the SSE event stream, the perch API and `starling.config.yaml`. Great looks like this: every route and every `StarlingEvent` type is documented with a working example, **every JSON example is validated against the real zod schemas**, and a checker fails the moment a route, event or config key is added without docs.""",
deliverables="""1. **`docs/api/README.md`:** an overview (ports 7777/7778, JSON + SSE, the error envelope, auth today, versioning: contracts are additive-only per L33) and the page index.
2. **`rest.md`:** every route found in `apps/server/src/**/*.ts` (today: health, runs list/get/create/cancel, task abort, `runs/:id/events` SSE, `/api/events` SSE, replay, nodes, flock join/register/heartbeat/bundle, `runs/:id/diff/:taskKey`, `config/public`). Each gets method, path, request body / query with its core type, response type, status codes, the error envelope (read `apps/server/src/http.ts`), and a `curl` example. Document the **current** security posture honestly: SEC-04 replay confinement is fixed (403 outside `fixtures/` and `.starling/`); SEC-01 loopback default + token, SEC-05 413 body limits and SEC-06 SSE caps are `⏳ Epic 110`. Add the planned insights routes `GET /api/runs/:id/report|timeline|costs` and `GET /api/compare?a=&b=` as `⏳ Epic 111 (C3 mounts)`, and the `dash` read-only behaviour (`POST /api/runs` → 501) as `⏳ Epic 40`.
3. **`events.md`:**
   - the SSE wire format (read `apps/server/src/sse.ts`: `data:` framing, ids if any, backlog-then-live, `?since=` resume);
   - a reconnect recipe;
   - **one section per `StarlingEventTypeSchema.options` value** (today 14: `run.created`, `repomap.ready`, `plan.created`, `task.status`, `agent.event`, `audit.verdict`, `merge.result`, `metrics`, `log`, `node.joined`, `node.left`, `node.stats`, `task.migrated`, `run.finished`), plus `run.status` as `⏳ Epic 40`.
   Each section has: when it fires, the payload fields table, and a JSON example preceded by `<!-- event: <type> -->`. Take examples from `fixtures/runs/sky-todo-launch-day.jsonl` where present (trim long strings), and hand-write the rest.
4. **`perch.md`:** every route in `packages/perch/src/perch-app.ts` (`/perch/info`, tasks start/prompt/abort/collect/bundle/delete, `/perch/events`), the `x-flock-token` requirement, the `AgentEvent` SSE format, and SEC-10 ref validation `⏳ Epic 102`.
5. **`config.md`:** every leaf key of `starling.config.yaml` as a dotted path (`maxParallel`, `opencode.mode`, `models.planner.provider`, `providers.<name>.baseUrl`, `flock.offlineAfterMs`, `perch.cacheDir`, …) with type, default (from `defaultConfig`) and meaning, plus `STARLING_LLM_PROFILE`, provider `apiKeyEnv` vars (e.g. `DEEPSEEK_API_KEY`) and the other `STARLING_*` env vars you find by grepping `process.env` in `packages/` and `apps/` (each with the file that reads it). Note that `starling.config.example.yaml` exists, and validate it.
6. **Checker `docs/api/check.ts`:**
   - `scanRoutes(roots)`: a regex scan of non-test `.ts` files for `app.(get|post|put|patch|delete)('<path>'`, returning `{ method, path, file }`;
   - `docRoutes(markdown)`: parses route tables;
   - `eventTypes()` from `StarlingEventTypeSchema.options`;
   - `validateEventExamples(markdown)`: each `<!-- event: X -->` JSON block parses with `StarlingEventSchema.safeParse` and has `type === X`;
   - `configLeafKeys()`: walks `defaultConfig`, treating `providers` and `models` as maps with documented placeholder keys;
   - `validateExampleConfig()`: `StarlingConfigSchema.safeParse` on the parsed example YAML (core's `loadConfig(path)` does this).
   Checks run in both directions. Docs → code: no stale route, event or key unless marked `⏳`. Code → docs: everything is documented. `--check` exits 1 listing `file:line` problems.
7. **Tests** `docs/api/check.test.ts` (≥ 22): the route regex on synthetic sources (template literals, chained calls, comments), table parsing, an example with a wrong type / missing field, a pending event that later exists (allowed), config walking (nested defaults, records), the real docs pass, and a synthetic new route → reported missing.""",
oos="""- Server code (110/111), perch code (102), core schemas (202, Wave 3b). Mismatches become FIX REQUESTS or `⏳` notes.
- OpenAPI generation or any new dependency (a hand-written reference plus checker is the deliverable).""",
dod=["`bun test docs/api` → 0 fail, ≥ 22 tests, and `bunx tsc --noEmit -p docs/api` → clean.",
     "`bun docs/api/check.ts --check; echo exit=$?` → `exit=0`. Paste the summary (routes, events, examples validated, config keys).",
     "Paste the event section count: 14 present types + `run.status` pending, and every example validated by zod."],
carryover="",
extra_locked=D1_DOCS + """
- **Parallel siblings change this surface:** Epic 110 (server hardening), 111 (insights routes, mounted later by C3) and 40 (`run.status`, `dash` 501). Document what's on `main` and mark the rest `⏳`. Your checker must stay green both before and after those merge (pending items are allowed to exist)."""))

# ── 177 ──────────────────────────────────────────────────────────────────────
SPECS.append(dict(
nn="177", slug="arch-docs", title="Architecture deep dive with Mermaid diagrams checked against the code",
lane="`docs/architecture/**`", wave="3", convention=None, budget="90–150 min",
goal="""Explain how Starling actually works, for judges who ask "how?" and contributors who need the map: the package graph, the life of a run, the flock protocol, the merge queue and lanes. Each is a Mermaid diagram on GitHub, and **each diagram is checked by a script against the real code** (package.json dependencies, the status enums, event names and routes), so the pictures can't lie. Great looks like this: a reader understands why the engine talks only to ports, why lanes make parallel agents safe, and what Epic 40 learned when the pieces met.""",
deliverables="""1. **`docs/architecture/README.md`:** a one-page overview (the big picture from ARCHITECTURE §1, the "engine only talks to ports" principle, mock vs real composition) and an index.
2. **`packages.md`:** a Mermaid `graph LR` of every workspace package/app and its `@starling/*` dependencies, **generated** from `packages/*/package.json` and `apps/*/package.json` (today: engine → core only; perch → core, flock, runner, workspace; planner → core, llm, repomap; cli → core, perch; …). It goes between `<!-- generated:packages:start/end -->`, with a `%% check: packages` directive. Add a prose section on what each package owns (one line each; read each `src/index.ts` header) and the off-workspace folders (`tools/`, `evals/`, `examples/`, `site/` import core by relative path). Note that Epic 40 adds CLI dependencies, so regenerate after rebasing.
3. **`run-lifecycle.md`:**
   - a `sequenceDiagram` of a real `starling run` (CLI → `compose` → `composeReal` → engine → repomap → planner → workspace/node → runner/opencode → auditor → merger serial queue → store/recorder → bus → server SSE → web), following Epic 40's doc and `packages/engine/src`;
   - a `stateDiagram-v2` for `TaskStatus` (`%% check: task-status`);
   - one for `RunStatus` (`%% check: run-status`).
   Derive transitions from the engine source (read `packages/engine/src/*.ts`, the transition/pipeline code) and cite file:line for the non-obvious ones (fixing loop, conflict, cancel).
4. **`flock-protocol.md`:** a `sequenceDiagram` of register → heartbeat → `startTask` (bundle fetch) → `/perch/events` SSE → collect → bundle back → `fetch` into the hub repo, plus the offline/reschedule path (`heartbeatMs` 3000, `offlineAfterMs` 15000 from `defaultConfig.flock`). Mark it `%% check: routes`: every `/api/...` and `/perch/...` path in it must exist in the code. Link `docs/flock/` for operations.
5. **`merge-queue.md`:** a flowchart: audit pass → `merge-tree` preflight → serial queue (Epic 40's `index.lock` finding and why the queue is the production path) → merge → regression suite → `merged` | `conflict` → resolver (Epic 45, wiring `⏳ Epic 100`) | rollback. Include the batch/bisect plans (`⏳ Epic 104`).
6. **`lanes.md`:** what a lane is (`owns`/`reads` globs), how the planner validates disjointness (`globsOverlap`/`lanesDisjoint` in `packages/core/src/glob.ts`, the `PlanIssueCodeSchema.options` codes), how the auditor enforces it after the fact (`packages/auditor/src/lane.ts`, the SEC-08 normalisation `⏳ Epic 103`), and a worked example from `examples/sky-todo/demo-goals/conflict-bait.expected.md`. Mark it `%% check: events` wherever event names appear.
7. **`decisions.md`:** the locked decisions L1–L31 condensed into "decision → why → consequence" (one line each, linking ARCHITECTURE §7), plus "what the build taught us": Epic 40's seven integration bugs, the duplicate event log, the hub heartbeat and the node_modules symlink. Use the correct current facts where older epic docs are stale (see carryover).
8. **Checker `docs/architecture/check.ts`:**
   - `parseMermaidBlocks(md)` → `{ directive, source, line }[]`;
   - `packageGraph(repoRoot)` → edges from package.json files;
   - `renderPackageGraph(edges)` (deterministic order);
   - `checkPackages(block, edges)`: both directions;
   - `checkStates(block, schemaOptions)`: every state in the diagram is a real status and every status appears;
   - `checkRoutes(block, routes)`: reuse a small route scan of `apps/server/src` and `packages/perch/src`;
   - `checkEvents(text)`: backticked `x.y` event names are in `StarlingEventTypeSchema.options` or marked `⏳`.
   `--write` regenerates the package graph; `--check` exits 1.
9. **Tests** `docs/architecture/check.test.ts` (≥ 18): Mermaid parsing (multiple blocks, comments, aliases like `A[label]`), an edge missing/extra, a state typo, an unknown route, a pending event, the generator's determinism, and the real docs pass.""",
oos="""- `docs/epic-*.md` and `.orchestrator/ARCHITECTURE.md` (orchestrator-owned; list stale facts as FIX REQUESTS), `docs/assets/**` (172), `docs/flock/**` (183), `docs/api/**` (176).""",
dod=["`bun test docs/architecture` → 0 fail, ≥ 18 tests, and `bunx tsc --noEmit -p docs/architecture` → clean.",
     "`bun docs/architecture/check.ts --check; echo exit=$?` → `exit=0` (paste the per-diagram summary).",
     "Every Mermaid block renders: paste each block into GitHub's preview, or keep the syntax to the documented subset (`graph`, `sequenceDiagram`, `stateDiagram-v2`, `flowchart`). State in the handback which you verified."],
carryover="""- **From 56-repomap-prompts, FIX REQUEST 2:** `docs/epic-11-repomap.md` and `docs/epic-13-prompts.md` are stale (heading symbols, `maxFiles` 5,000, "the prompt package has its own minimal renderer"). They're orchestrator-owned, so don't edit them. Use the corrected facts from `docs/epic-56-repomap-prompts.md` in your docs: one renderer, `renderRepoMap(map, { maxTokens, … })` in `@starling/repomap`; the planner's adoption is `⏳ Epic 107`.""",
extra_locked=D1_DOCS))

# ── 178 ──────────────────────────────────────────────────────────────────────
SPECS.append(dict(
nn="178", slug="demo-script", title="Demo script (3 and 5 minutes), backup plans, judge Q&A, pre-demo checklist",
lane="`docs/demo/**`", wave="3", convention=None, budget="60–120 min",
goal="""The live demo is where Starling wins or loses. Write the exact **3-minute and 5-minute scripts**, with timings, the words to say, the commands to type, and what appears on which laptop's screen. Add a backup plan for every failure (wifi down, API slow, laptop dies, auth expired), a judge Q&A that anticipates hard questions with honest, specific answers, and a checklist for T-24h / T-1h / T-10min. Great looks like this: someone who has never seen Starling could run the demo from these pages, and every command in them is verified to exist.""",
deliverables="""1. **`docs/demo/README.md`:** which script to use when (3 minutes for the pitch slot, 5 minutes for the expo table), the setup diagram (Laptop A = hub MacBook Pro + projector, Laptop B = MacBook Air perch) and the page index.
2. **`three-minute.md`:** start from PRD §7 and update it to the real flow (Epic 40). A timing table (`| 0:00–0:20 | Hook | …`), then per beat:
   - the talk track (short sentences, ≤ 35 words per beat);
   - the exact command in its own block (e.g. `starling run "$(cat demo-goals/stage.md)" --repo $REPO --max-parallel 6 --record demo.jsonl`);
   - what the audience sees (Sky, lanes, the amber bird and the audit verdict, the merge queue, the cost meter);
   - what to click and on which laptop.
   Use the `stage` goal (6 tasks, one designed audit failure: `examples/sky-todo/.starling-answers/stage.expected.md`), and say why.
3. **`five-minute.md`:** the 3-minute flow plus a live perch join on Laptop B (`starling perch --hub … --code …`), killing the perch mid-run to show rescheduling, `starling status`, the Agent Skill `/swarm` in opencode, and "built by the flock" stats. Mark Wave 3 extras `⏳` (`?page=stage` presenter mode 127, `?page=report` 113, `starling watch` 142, `starling try` 149).
4. **`backup-plans.md`:** a failure matrix (symptom → detect → switch in ≤ 15 s → what to say). Cover:
   - venue wifi down or client isolation (phone hotspot, `--hub` with an IP, the Thunderbolt bridge);
   - API slow or rate-limited (`--max-parallel 3`, the smaller `quick-wins` goal, then replay);
   - total model outage (`starling replay fixtures/real/launch-day.jsonl` `⏳ Epic 40`, else `fixtures/runs/sky-todo-launch-day.jsonl`, plus the dashboard `?demo=1`);
   - opencode auth expired (`opencode auth login`, `starling doctor`);
   - port 7777 busy (`starling dash --port`, `lsof -i :7777`);
   - dashboard blank (build `apps/web`, then the dev server);
   - perch won't join (the `docs/flock/` troubleshooting, the `tools/flock` preflight `⏳ Epic 158`);
   - demo repo dirty from a rehearsal (`examples/scripts/reset-demo.sh` `⏳ Epic 171`, else rebuild with `make-demo-repo.sh`);
   - a laptop dies (single-laptop script);
   - the projector is 720p (browser zoom, `?page=stage` `⏳ Epic 127`).
5. **`judge-qa.md`: ≥ 25 questions** grouped (product, technical, open-weight, safety, process, Hacktoberfest). Each answer is ≤ 4 sentences, specific, honest about limits, with a pointer path. Examples:
   - "What stops two agents editing the same file?"
   - "What if the planner gets lanes wrong?"
   - "Is the auditor just the same model grading itself?"
   - "What does a run cost?"
   - "Is the flock secure?" (L18 + the SEC table)
   - "How much of this did a human write?"
   - "Why opencode?"
   - "What happens when a merge conflicts?"
   - "Does it work on Python?" (py-ledger)
   - "What broke when you wired it for real?" (Epic 40's list)
   No claims about competitors' internals.
6. **`checklist.md`:** T-24h (re-record a fresh real run, `bun run --cwd apps/web build`, charge, a second copy of recordings on a USB stick), T-1h (`starling doctor` on both laptops, `opencode auth` status, fresh `make-demo-repo.sh`, `init`, open dashboard tabs, notifications off, font size, hotspot ready), T-10min (wifi check, perch preflight, terminal history cleared, `REPO` env var exported), and after the demo (`reset-demo.sh`).
7. **Checker `docs/demo/check.ts`:**
   - every `starling …` invocation validates against `createProgram()` (a small local copy of the extraction logic is fine; don't import other docs epics' code);
   - every repo path (`examples/…`, `fixtures/…`, `apps/…`, `tools/…`) exists or is marked `⏳`;
   - the timing tables parse (`m:ss–m:ss` rows contiguous, starting at 0:00) and total ≤ 3:00 / ≤ 5:00;
   - every Q&A entry has a non-empty answer and an existing pointer.
   `--check` exits 1.
8. **Tests** `docs/demo/check.test.ts` (≥ 15): the timing parser (gaps, overlaps, over-time), invocation extraction (`$REPO`, `$(cat …)`, continuations), Q&A parsing, and the real docs pass.""",
oos="""- Recording real runs (Epic 207, Wave 3b), editing `tools/flock/**` (Epic 158), the web stage page (127), and `examples/scripts` (171). Link with `⏳` markers instead.""",
dod=["`bun test docs/demo` → 0 fail, ≥ 15 tests, and `bunx tsc --noEmit -p docs/demo` → clean.",
     "`bun docs/demo/check.ts --check; echo exit=$?` → `exit=0`. Paste the timing totals for both scripts.",
     "A dry rehearsal of the offline fallback path was actually run: `bun run starling replay fixtures/runs/sky-todo-launch-day.jsonl --speed 50` and `bun run starling status --file fixtures/runs/sky-todo-launch-day.jsonl`. Paste the output."],
carryover="",
extra_locked=D1_DOCS))

# ── 179 ──────────────────────────────────────────────────────────────────────
SPECS.append(dict(
nn="179", slug="site-r2", title="Landing site round 2: embedded murmuration replay, the 100-agent story, model table",
lane="`site/**`", wave="3", convention=None, budget="90–150 min",
goal="""The landing page is the link in the submission. Round 2 makes it show the product, not just describe it: an **embedded replay** of a real recorded run (birds take off, circle while audited, land on the wire), the story of how 100 agents built it, an open-weight model table that matches the code, and a quickstart for the real run. It stays a framework-free static page under 300 KB that scores well on Lighthouse. Great looks like this: a judge on a phone sees the murmuration replay a real run within two seconds, with no network calls beyond the page itself.""",
deliverables="""1. **Carryover first** (see below). Then extend `site/src/stats.ts` `normalizeStats` to also read the Wave 3 stats shape from Epic 154 (`tools/stats` v1 today: `totals.peakConcurrentAgents`, `totals.agentHours`, `totals.waves`, and a `waves[]` array of `{ wave, agents, wallTimeHours?, testsAfter? }`), with per-field fallbacks as now. Add ≥ 5 tests using a trimmed copy of `tools/stats/out/stats.json` as a fixture under `site/src/__fixtures__/`.
2. **Replay data:** `site/scripts/build-replay.ts` reads a JSONL recording (default `fixtures/real/launch-day.jsonl` if it exists, `⏳ Epic 40`; else `fixtures/runs/sky-todo-launch-day.jsonl`) and writes `site/data/replay.json`: `{ version: 1, source, goal, durationMs, tasks: { key, title, node }[], frames: { t, key, status }[], merges: { t, key }[], cost: { apiUsd, localUsd } }`, with `t` in ms from start, **≤ 25 KB**, and deterministic. `--check` exits 1 when stale. Commit the JSON. `build.ts` copies it to `dist/data/` like the stats file.
3. **`site/src/replay.ts`** (pure, no DOM): `stateAt(replay, tMs): { tasks: { key, status, node }[]; merged: number; failed: number; costUsd: number }` (binary search over frames), `nextEventAfter(replay, t)` and `formatClock(ms)`. ≥ 12 tests (empty, before start, exact frame, after end, out-of-order input rejected at build time, unknown status ignored).
4. **`site/src/replay-view.ts`:** a canvas section under the hero, reusing `boids.ts`/`sky.ts` patterns:
   - one bird per task; `running` birds flock over their node's roost, `auditing` pulse amber, `fixing` loop, `merged` perch on the wire, `failed` drop grey;
   - a merge ticker and a cost counter (`aria-live="polite"`, throttled);
   - controls: play/pause button, speed (1×/10×/30×), a scrub `<input type="range">`, all keyboard reachable;
   - pause when off-screen or the tab is hidden;
   - `prefers-reduced-motion` → the final frame plus a static `<table>` summary of tasks.
   Add a `<noscript>` fallback.
5. **"Built by 100 agents" section:** a wave timeline (Waves 0, 1, C1, 2, 3) drawn from `stats.waves` with fallbacks, the lanes-and-handbacks method in three steps, and a link to the blog post (`docs/blog/`, Epic 180). Numbers come from `data/stats.json` only (no hard-coded figures beyond the fallback object), labelled "snapshot".
6. **Open-weight model table:** roles × profiles (`opencode`, `deepseek`, `local`, `mixed`) in `site/src/models.ts` as data rendered into the page, plus a **drift test** that compares it to `applyProfile(defaultConfig, p)` imported from `../../packages/llm/src/index.ts` and `../../packages/core/src/index.ts`. If importing them breaks `site`'s typecheck, read the constants from `packages/llm/src/profiles.ts` as text instead.
7. **Quickstart** updated to the real flow (clone, `bun install`, `starling init --yes`, `starling run … --repo "$(bash examples/scripts/make-demo-repo.sh)"`), with `starling try` as `⏳ Epic 149` and the replay command for zero setup. Commands must exist in `createProgram()` (one site test checks the quickstart strings).
8. **Lighthouse-friendly:**
   - meta description, `og:*`/`twitter:*`, canonical (configurable in one constant), `<html lang>`;
   - explicit `width`/`height` on every `<img>`, and `loading="lazy"` below the fold;
   - landmark roles, a skip link, focus styles and contrast-safe tokens;
   - no render-blocking extras; total `dist` ≤ 300 KB (the existing `build.ts` budget).
   **`site/src/html-audit.test.ts`** (≥ 10 static checks on `index.html`): lang, viewport, description, one `h1`, heading order, every img has alt/width/height, every external link has `rel="noopener"`, no `http://` assets, a skip link, the canvas has `aria-hidden` or a label.
9. **Repo URL in one place:** `site/src/config.ts` exports `REPO_URL` (today hard-coded in `index.html` and the README per Epic 59's open question). `build.ts` substitutes a `%REPO_URL%` placeholder in the HTML, so a move is one edit.
10. **Docs:** update `site/README.md` (new files, `build-replay.ts`, the replay JSON contract, the deploy YAML from FIX REQUEST 59.1 kept for Epic 150) and `site/tsconfig.json` `include` (add `scripts/**/*.ts`).""",
oos="""- `.github/workflows/**` (Epic 150), root `package.json` scripts (C3/root owner), `tools/stats/**` (Epic 154), `apps/web/**` (no React in the site; don't import the dashboard).
- New dependencies, CDNs, web fonts, analytics.""",
dod=["`bun run --cwd site test` → 0 fail, ≥ 28 new tests, and `bun run --cwd site typecheck` → clean.",
     "`bun site/scripts/build-replay.ts --check; echo exit=$?` → `exit=0`, and `ls -l site/data/replay.json` ≤ 25 KB.",
     "`bash .orchestrator/bin/heavy.sh bun run --cwd site build` → succeeds under the 300 KB budget. Paste the size table before and after.",
     "`bun run --cwd site serve` and `curl -s localhost:4173/ | grep -c 'replay'` ≥ 1; `curl -s localhost:4173/data/replay.json | head -c 200` (paste). Stop the server afterwards."],
carryover="""- **From 59-landing-site, FIX REQUESTS 1–3** (Pages workflow, a `site` job in `ci.yml`, root `test:site`/`typecheck:site` scripts): these target `.github/workflows/**` (Epic 150) and the root `package.json` (C3), so **decline in this lane**. Keep the exact YAML in `site/README.md` and restate the asks in your handback's C3 wiring.
- **From 59, FIX REQUEST 4 / 68-swarm-stats, FIX REQUEST 2:** the site reads `site/data/stats.json`, regenerated by `bun tools/stats/collect.ts --out site/data/stats.json`. Make sure the normaliser handles the collector's v1 output (deliverable 1). You may refresh `site/data/stats.json` from `tools/stats/out/stats.json` (marking `source`).
- **From 59, FIX REQUEST 5:** reuse `docs/assets/diagrams/*.svg` rather than forking a second diagram set (copy into `site/` at build time if needed).
- **From 59, Open question:** the hard-coded repo URL and `og:image` → deliverable 9.""",
extra_locked="""- **D1 note:** `site/` is outside the workspace. Root `bun run test`/`check` don't typecheck or test it (Biome does lint it), so run `bun run --cwd site test` and `typecheck` yourself. Mark pending things `⏳ Epic NN` in visible copy only where a judge benefits; otherwise just omit them. Real-run facts: see Epic 40's doc (`git show epic/40-integration-captain:docs/epic-40-integration-captain.md`)."""))

# ── 180 ──────────────────────────────────────────────────────────────────────
SPECS.append(dict(
nn="180", slug="blog", title="Blog post: how a flock of 100 open-weight agents built Starling",
lane="`docs/blog/**`", wave="3", convention=None, budget="60–120 min",
goal="""Tell the story judges and the open-source crowd will share: how one student, two laptops and waves of up to ~100 DeepSeek V4.1 Flash agents built Starling with the same method Starling uses, lanes, audited handbacks and a merge queue. Use real numbers from the orchestration logs and stats, the real failures and the lessons. Great looks like this: an honest, specific, fun long-form post where **every number is sourced** by a script, plus a short social thread.""",
deliverables="""1. **Read the sources:** `.orchestrator/PROCESS.md`, `ROADMAP.md`, `PRD.md`, `ARCHITECTURE.md` §7 (L1–L31 and the lessons behind L23/L31), `.orchestrator/epics.tsv`, a sample of handbacks (00, 40 on its branch, 42, 45, 58, 69, 70), `.orchestrator/fix-requests-w2.md` (the cross-lane bug economy), `tools/stats/out/stats.json`, and `git tag --list 'epic-*-complete'`.
2. **`docs/blog/numbers.ts`:** `collectNumbers(repoRoot, git): Promise<Numbers>` → `{ key: { value: number | string; source: string; note? } }`. Include epics completed (tags), epics planned (epics.tsv rows plus the Wave 3 count if `.orchestrator/` lists it), PRs, commits, tests, `peakConcurrentAgents`, `agentHours`, `wallTimeMs`, waves, handbacks written, and FIX REQUESTS compiled (count `^[0-9]+\\.` items or headings in fix-requests-w2.md), each tagged with its file/command. Wave 3 numbers come from Epic 154's output if a newer `tools/stats/out/*.json` exists, else `⏳ Epic 154` placeholders. `--write` writes `docs/blog/numbers.json` and regenerates the "By the numbers" table in the post between markers; `--check` exits 1 when stale.
3. **`docs/blog/100-agents.md`** (~2,500–3,500 words). Sections:
   - The bet (why build a multi-agent harness with agents);
   - The method (orchestrator, epics, waves, lanes, handbacks, FIX/CONTRACT REQUESTS, checkpoints, the heavy-command slot gate);
   - By the numbers (generated table);
   - What broke (Epic 40's seven integration bugs; the `test.failing` collision from Epic 69; 32 GB of RAM vs local models (L23/L31); the merge `index.lock` race; the duplicated event log);
   - What agents were good and bad at (cite handbacks);
   - The open-weight story (DeepSeek V4.1 Flash via opencode-go, the local Qwen auditor, costs);
   - What we'd do differently;
   - Try it (the commands, verified as in the guide).
   **Honesty rules:** no invented quotes or numbers. "100 agents" and "in a day" must match the stats. If they don't (e.g. peak concurrency or wall time differ), adjust the wording and explain in the handback.
4. **Bold-number check:** every `**<number>**` figure in the post's prose must equal a value in `numbers.json` (formatting-insensitive: `1,873` = 1873, `20.5h`). Others are allowed only if followed by an HTML comment `<!-- src: <file or url> -->`.
5. **`docs/blog/thread.md`:** a 8–12 post social thread, each ≤ 280 characters (checked), with suggested images from `docs/assets/**` / `site/screens/hero.png` and the repo link.
6. **`docs/blog/README.md`:** an index, how to regenerate numbers on demo day (`bun tools/stats/collect.ts` then `bun docs/blog/numbers.ts --write`), and the honesty rules. Add `docs/blog/tsconfig.json`.
7. **Tests** `docs/blog/numbers.test.ts` (≥ 12): number normalisation, bold-figure extraction, a `src:` exemption, a stale table, the thread length check, a fake stats file with missing fields (placeholders), and the real post passes.""",
oos="""- `tools/stats/**` (Epic 154 extends the collector), `site/**` (179 links your post), `README.md` (172). No publishing anywhere.""",
dod=["`bun test docs/blog` → 0 fail, ≥ 12 tests, and `bunx tsc --noEmit -p docs/blog` → clean.",
     "`bun docs/blog/numbers.ts --write && bun docs/blog/numbers.ts --check; echo exit=$?` → `exit=0`. Paste `numbers.json`.",
     "`wc -w docs/blog/100-agents.md` within 2,500–3,500 words, and every post in `thread.md` ≤ 280 characters (the checker's output)."],
carryover="",
extra_locked=D1_DOCS))

# ── 181 ──────────────────────────────────────────────────────────────────────
SPECS.append(dict(
nn="181", slug="troubleshooting", title="Troubleshooting and FAQ: every StarlingErrorCode, every known symptom",
lane="`docs/troubleshooting/**`", wave="3", convention=None, budget="60–120 min",
goal="""When something breaks on a contributor's laptop or on stage, the answer should be one search away. Document **every `StarlingErrorCode`** (meaning, where it's thrown, likely causes, the fix, and a command to confirm it) and every symptom the real runs have shown (Epic 40's integration findings, the flock runbook's checks, the SEC notes), plus a FAQ. Great looks like this: a script proves every error code in core has an entry, and every suggested command actually exists.""",
deliverables="""1. **`docs/troubleshooting/README.md`:** a symptom → page index and "start with `starling doctor`" (what it checks: `apps/cli/src/doctor-probes.ts`).
2. **`errors.md`:** one `### CODE` section (the code in backticks) per code in the `StarlingErrorCode` union in `packages/core/src/errors.ts` (24 today: `EXEC_TIMEOUT`, `EXEC_FAILED`, `CONFIG_INVALID`, `INVALID_ARGUMENT`, `NOT_IMPLEMENTED`, `NOT_WIRED`, `LLM_ERROR`, `LLM_BAD_JSON`, `REPOMAP_ERROR`, `PLAN_INVALID`, `WORKSPACE_ERROR`, `GIT_TOO_OLD`, `RUNNER_ERROR`, `AUDIT_ERROR`, `MERGE_ERROR`, `NODE_OFFLINE`, `NODE_AUTH`, `GH_AUTH`, `GH_REPO`, `GH_COMMAND`, `GH_MISSING`, `STORE_ERROR`, `UNKNOWN`, plus any others the union lists). Each section has fixed sub-headings: **Means** · **Thrown by** (files from a grep of `'CODE'` in `packages/` and `apps/`, non-test) · **Likely causes** · **Fix** · **Check** (a real command) · **Related**.
3. **`symptoms.md`:** symptom-first entries (≥ 15), each with Cause → Fix → Check. Cover:
   - the run picker stuck at `mapping` (`run.status` `⏳ Epic 40/100`);
   - every task failing its lane check (the `node_modules` symlink, fixed in Epic 40);
   - 401s from opencode (a port clash with your own `opencode serve`; Epic 40 now uses a private free port);
   - cost meter at `$0.000` on the opencode profile;
   - tests failing inside a worktree (no dependencies);
   - `.git/index.lock` on simultaneous merges (fixed by the serial queue);
   - a perch going offline after 15 s;
   - mDNS finding nothing;
   - `GIT_TOO_OLD` (`merge-tree --write-tree` needs ≥ 2.38);
   - Ollama unreachable under `mixed` (`local-unavailable` warning);
   - port 7777 in use;
   - the dashboard stuck on demo data;
   - `pytest` not found (activate the venv);
   - replay 403 (confinement to `fixtures/`/`.starling/`);
   - 413 / 429 from the server (`⏳ Epic 110`);
   - root tests timing out on `examples/sky-todo/node_modules`.
4. **`faq.md`:** ≥ 15 questions (no API key? Windows? where state lives (`<repo>/.starling/starling.db`, worktrees under `worktreeRoot`)? how to clean up (`starling gc` `⏳ C3`/Epic 143, `git worktree prune`)? how to stop a run? does it push to GitHub (`--github`)? which models? can I use another agent CLI? …). Short answers, links to the guide and deep docs.
5. **Checker `docs/troubleshooting/check.ts`:**
   - `errorCodes(source)`: parse the union literals from `packages/core/src/errors.ts` text (there is no runtime array);
   - `documentedCodes(md)`;
   - `checkSections(md)`: required sub-headings present and non-empty per code;
   - `throwSites(repoRoot)`: grep of `StarlingError('CODE'` / `toStarlingError(…, 'CODE'`, which reports codes thrown nowhere as an info line, not an error;
   - command validation: `starling <cmd> --flags` via `createProgram()`, with `⏳` lines skipped.
   Both directions: every code documented, and no documented code missing from core unless marked `⏳`. `--check` exits 1.
6. **Tests** `docs/troubleshooting/check.test.ts` (≥ 14): union parsing (comments, trailing semicolon, a new code), a missing section, an empty Fix, an unknown documented code, a pending code, command validation, and the real docs pass.
7. **Cross-links:** the guide (175) links here by planned path. Link back to `docs/guide/first-run.md`, `docs/flock/troubleshooting.md` and `docs/models/` by planned path.""",
oos="""- Changing error codes or messages in code (core is Wave 3b / Epic 202). Wrong or unhelpful messages become FIX REQUESTS with file:line.""",
dod=["`bun test docs/troubleshooting` → 0 fail, ≥ 14 tests, and `bunx tsc --noEmit -p docs/troubleshooting` → clean.",
     "`bun docs/troubleshooting/check.ts --check; echo exit=$?` → `exit=0`. Paste the summary (codes in core, codes documented, throw sites).",
     "`starling doctor` and `starling doctor --json | head -20` were run and their output pasted (they anchor the README page)."],
carryover="",
extra_locked=D1_DOCS))

# ── 182 ──────────────────────────────────────────────────────────────────────
SPECS.append(dict(
nn="182", slug="models-guide", title="Open-weight models guide: roles, profiles, hardware sizing, adding a provider",
lane="`docs/models/**`", wave="3", convention=None, budget="60–120 min",
goal="""Starling's pitch is "open-weight first", and this guide makes it practical: which open-weight models work for each role (planner, worker, resolver, auditor, summarizer, writer), what the four routing profiles actually do, how big a model fits next to a flock on a 16 GB or 32 GB Mac (from our measured results), and how to plug in any OpenAI-compatible provider. Great looks like this: the profile table is **generated from `applyProfile`**, every model id mentioned exists in our config/candidates, and a reader with a fresh laptop can pick a setup in two minutes.""",
deliverables="""1. **`docs/models/README.md`:** the open-weight story in one paragraph, a decision tree ("have an opencode login? → `opencode`; want nothing to leave the laptop? → `local` via `--fully-open`; …") and the page index.
2. **`roles.md`:** the six `ModelRoleSchema.options` roles: what each does, call volume per run, what failure looks like, the recommended model class, and why the auditor shouldn't be the worker's model.
3. **`profiles.md`:** the **generated** role × profile table for `LLM_PROFILES` (`opencode`, `deepseek`, `local`, `mixed`) from `applyProfile(defaultConfig, profile, <hermetic options>)` exported by `packages/llm/src/index.ts`. Pass whatever option `packages/llm/src/routing.test.ts` uses to skip the on-disk recommendation, so the output is deterministic.
   Then how a profile is chosen:
   - `STARLING_LLM_PROFILE`; `--fully-open` → `local`; `parseProfile` accepts `fully-open` as an alias;
   - `starling init --profile auto|opencode|deepseek|local` (no `mixed` there);
   - the library default is `deepseek`, but **real runs default to `opencode`** (`⏳ Epic 40`);
   - the `mixed` fallback warnings `local-unavailable` / `local-model-missing`.
   Note the brief's names: "fully-open" = `local`, and "ollama" is a provider, not a profile.
4. **`hardware.md`:** sizing from measured data only:
   - `tools/local-models/candidates.json` (`selectionRules` for `mbp` 32 GB / `air` 16 GB, candidate sizes);
   - `tools/local-models/results/*.json` and `tools/fully-open/results/*` (tok/s, resident memory);
   - `docs/epic-28-local-bench.md`, ARCHITECTURE L24/L31 (≈18 GB resident, ~18 tok/s warm for `qwen3.8:27b-mlx`; the memory rails);
   - `init`'s `suggestMaxParallel` rule (2 GB per session; read `apps/cli/src/init.ts`).
   Produce a table: RAM → recommended local model → suggested `maxParallel` → what to expect. Cite the source file per row; mark estimates as estimates.
5. **`providers.md`:** how to add a provider. `providers.<name>: { baseUrl, apiKeyEnv? }` plus `models.<role>: { provider, model }` in `starling.config.yaml`. OpenAI-compatible endpoints are assumed (ARCHITECTURE L7), and `isLocalBaseUrl` decides "local" for the cost meter. The opencode provider's `opencode-go/<model>` split (`splitOpencodeModel`). Pricing comes from `pricingKeys()` / `costOf` (what happens for an unknown model). Include two worked examples (a local OpenAI-compatible server on `127.0.0.1`, and a hosted open-weight API), each validated by `StarlingConfigSchema.safeParse` in the checker.
6. **`open-weights.md`:** the models we use and their licences/sources as stated in our repo (site copy, `candidates.json` `$comment`/`source`, Epic 02/28 docs). Don't add licence claims you can't cite from the repo; mark them "verify upstream".
7. **Checker `docs/models/check.ts`:**
   - `profileTable()` → markdown (`--write` regenerates it between markers);
   - `checkProfiles(md)`: every `LLM_PROFILES` value is documented, and no unknown profile name appears in backticks;
   - `knownModelIds()`: the union of `defaultConfig.models`, the llm constants (`DEEPSEEK_DEFAULT_MODEL`, `LOCAL_DEFAULT_MODEL`, `OPENCODE_DEFAULT_MODEL`), the ids in `candidates.json` and `pricingKeys()`;
   - `checkModelIds(md)`: backticked tokens that look like model ids (contain `:` or `/` and a digit) must be known or carry `⏳`/`<!-- src: … -->`;
   - `checkConfigExamples(md)`: YAML blocks tagged `<!-- config-example -->` parse (Bun's YAML or core's `yaml`) and validate with `StarlingConfigSchema`.
   `--check` exits 1.
8. **Tests** `docs/models/check.test.ts` (≥ 14): table determinism, a missing profile, an unknown model id, a sourced exemption, a bad config example, and the real docs pass.""",
oos="""- `packages/llm/**` (Wave 3b / Epic 200): if an export you need is missing (e.g. `describeProfile`, `MIXED_LOCAL_ROLES` aren't exported; Epic 51's FIX REQUEST), work from what's exported and note it.
- `tools/local-models/**` (no benchmarks or model pulls: L23/L31, no local models in Wave 3a).""",
dod=["`bun test docs/models` → 0 fail, ≥ 14 tests, and `bunx tsc --noEmit -p docs/models` → clean.",
     "`bun docs/models/check.ts --write && bun docs/models/check.ts --check; echo exit=$?` → `exit=0`. Paste the generated profile table.",
     "No model was loaded or pulled. Every hardware row cites a file in `tools/local-models/` or `docs/epic-28-local-bench.md`."],
carryover="",
extra_locked=D1_DOCS))

# ── 183 ──────────────────────────────────────────────────────────────────────
SPECS.append(dict(
nn="183", slug="flock-guide", title="Flock guide: laptops as a cluster, join codes, security model, networking, runbook",
lane="`docs/flock/**`", wave="3", convention=None, budget="60–120 min",
goal="""Flock mode is the "wow" of the demo: a second laptop opens its lid, runs one command, and birds migrate to its roost. This guide makes it reliable for anyone: quickstart, how join codes and `x-flock-token` work, an honest security model (LAN-only, shared secret, the SEC findings and their mitigations), networking on hostile venue wifi, troubleshooting, and the two-laptop demo runbook. Great looks like this: the defaults and commands are machine-checked against the code, and the security page tells users exactly what's protected and what isn't today.""",
deliverables="""1. **`docs/flock/README.md`:** what a hub, perch, roost and bundle are (one diagram: link `docs/assets/diagrams/flock-topology.svg`), what runs where (audit and merge only on the hub: L20), and the page index.
2. **`quickstart.md`:**
   - **Laptop A (hub):** `starling run …` with `flock.enabled` (default true), then `starling flock` / `starling flock --json` for the join command and code.
   - **Laptop B (perch):** clone + `bun install` + opencode login, then `starling perch --hub http://<ip>:7777 --code <CODE> --name "M2 Air" --max-sessions 5`.
   Say what you should see (the second roost, `node.joined`, tasks migrating). Base it on `docs/epic-42-flock-e2e.md` (it has the two-laptop runbook and six checks) and the real perch daemon in `packages/perch/src/perch-daemon.ts`. Where the real `run` composition (Epic 40) still lacks something on a remote node (e.g. `setHubUrl` with a LAN URL), say so with `⏳`.
3. **`join-codes.md`:**
   - how the code is generated and verified (read `packages/perch/src/join-code.ts`, `packages/flock/src` and the `FlockHub.verifyToken` usage in `apps/server/src/routes/flock.ts`);
   - where it travels (`x-flock-token` on every hub ↔ perch call, `/api/flock/join` → `{ code, hubUrl, command }`, the dashboard QR);
   - rotation (restart the hub);
   - why mDNS TXT currently carries the code (SEC-07; the `--mdns-code` opt-in is `⏳ Epic 102`).
4. **`security.md`:** the threat model (L18: LAN, shared secret, no TLS; perches execute agent sessions with shell access; the hub runs repo test commands, per SEC-11). Then "safe defaults for demo day" (a trusted network or phone hotspot, a fresh code per event, firewall prompts, stopping perches after the demo). Then a **SEC table**: id, finding (one line), status (SEC-04 fixed by Epic 41; SEC-01/05/06/09 `⏳ Epic 110`; SEC-02/03 `⏳ Epic 101`; SEC-05/07/10 `⏳ Epic 102`; SEC-08/11 `⏳ Epic 103`/`104`), today's mitigation, and the probe file in `tools/security/` (e.g. `node-impersonation.test.ts`, `bundle-ref.test.ts`, `unauth-routes.test.ts`). Link `SECURITY.md` (Epic 173).
5. **`networking.md`:**
   - ports (hub/server 7777 = `server.port`, perch 7778 = `perch.port`);
   - mDNS `_starling._tcp` and when multicast is blocked (client isolation);
   - finding your IP (`ipconfig getifaddr en0`, `ip -4 addr`);
   - reachability checks (`curl http://<hub>:7777/api/health`, `curl -H "x-flock-token: <CODE>" http://<perch>:7778/perch/info`);
   - macOS firewall prompts;
   - a phone hotspot or a Thunderbolt bridge as the fallback;
   - bandwidth (bundle sizes).
6. **`troubleshooting.md`:** Epic 42's six checks, expanded with: offline after 15 s (`flock.offlineAfterMs`), heartbeats (`flock.heartbeatMs` 3000), auth failures (`NODE_AUTH`), bundle errors, a perch that has no opencode login, clock skew, and two perches on one laptop (ports). Link `docs/troubleshooting/` (181).
7. **`runbook.md`:** the two-laptop demo runbook. T-1h checks on both laptops, the join, the kill-the-perch reschedule moment, and teardown. Rehearse on one laptop with `bun tools/flock/loopback.ts` (exists today), and use the preflight checker plus the printable 1-page runbook `⏳ Epic 158` (`tools/flock/`). Link `docs/demo/` (178).
8. **Checker `docs/flock/check.ts`:**
   - `defaultsTable()`: generated from `defaultConfig.flock` and `defaultConfig.perch` + `server.port` (`--write` between markers);
   - command validation of `starling flock|perch|run …` flags via `createProgram()`;
   - `checkRoutes(md)`: every `/api/flock/...`, `/api/nodes` and `/perch/...` path exists in a route scan of `apps/server/src` and `packages/perch/src`;
   - `checkSecTable(md)`: SEC-01…SEC-11 all present, each probe file exists in `tools/security/`, and each status is `fixed` or `⏳ Epic NN`.
   `--check` exits 1.
9. **Tests** `docs/flock/check.test.ts` (≥ 14): the defaults table, an unknown flag, an unknown route, a missing SEC row, a missing probe file, and the real docs pass.""",
oos="""- `packages/flock/**`, `packages/perch/**`, `apps/server/**` (Epics 101, 102, 110 are fixing the SEC findings in parallel), `tools/flock/**` (Epic 158), `tools/security/**` (read-only).""",
dod=["`bun test docs/flock` → 0 fail, ≥ 14 tests, and `bunx tsc --noEmit -p docs/flock` → clean.",
     "`bun docs/flock/check.ts --write && bun docs/flock/check.ts --check; echo exit=$?` → `exit=0`. Paste the defaults table.",
     "`bun run starling perch --help` and `bun run starling flock --help` were run and their flags match the guide (paste)."],
carryover="""- No FIX REQUEST targets `docs/flock/**`. The SEC-01…SEC-11 findings (`.orchestrator/fix-requests-w2.md` §69) are being fixed in code by Epics 101/102/103/104/110. **Document their current status and today's mitigations** (deliverable 4) and keep the `⏳` markers accurate.""",
extra_locked=D1_DOCS))
