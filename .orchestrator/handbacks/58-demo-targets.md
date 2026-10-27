## Epic 58 Handback — Demo targets: sky-todo polish + a Python target

**Status:** Complete. Branch `epic/58-demo-targets` @ `303c9bb` (docs + this handback land in the commit on top). One documented deviation: the `stage` answer key lives in `.starling-answers/` instead of `demo-goals/` — see FIX REQUESTS.

**Delivered:**

- **`examples/scripts/make-demo-repo.sh` generalised** to `<example-name> [target-dir]` with `sky-todo` as the default. The old one-argument form still works: an argument is an example name only when it is a project folder under `examples/` (has `package.json`/`pyproject.toml`); anything else — `/tmp/x`, `./demo` — is still a target directory. Adds `--list`, `--help`, `DEMO_SKIP_INSTALL` / `DEMO_SKIP_TESTS` / `BUN_BIN` / `PYTHON_BIN`, verifies the baseline suite and fails loudly if it is red, warns on a dirty tree, still prints the repo path as the last stdout line.
- **py-ledger venv setup** in that script: prefers `python3.12`, accepts any Python ≥ 3.12, creates `.venv`, `pip install -e '.[dev]'`, prints the `source .venv/bin/activate` reminder; degrades to a warning plus the exact command when the interpreter or PyPI is missing.
- **`examples/sky-todo/demo-goals/stage.md`** — a 6-task, ≤ 8-minute goal (6 agents): `today`, `stats`, `search`, `theme`, `shortcuts`, `csv-export`. Intended moments documented minute by minute in `.starling-answers/stage.expected.md`, including the audit beat: `csv-export` ships without the quoting tests, `definition-of-done` fails, the fixer names commas/quotes/newlines/header/empty list, attempt 2 passes.
- **sky-todo affordances**: `today/`, `tag-count/`, `title-count/` feature folders reserved with `.gitkeep`; `src/features/README.md` gained a reserved-folder → demo-task table; README documents the new goal and the new script forms. All five existing goal file names are untouched.
- **`examples/py-ledger/`** — a real Python 3.12 CLI (personal-finance ledger: `add`, `list`, `report`, `import`, category filters, JSON output), 16 modules / 1,023 lines, 136 pytest tests in 9 files (871 lines), `pyproject.toml` with setuptools + pytest (`pythonpath = ["src"]`) + ruff config, `.gitignore`, README. Commands are discovered from `commands/` via `pkgutil`, so a new command is a new file.
- **Two seeded bugs** in py-ledger with `examples/py-ledger/.starling-answers/BUGS.md` (repro, cause, expected fix, regression tests, and the exact inputs the committed suite avoids): `parse_amount` truncates through a float (`0.29 → 28`, `19.99 → 1998`, `-0.29 → -28`) and `report` groups months by `%b` (Oct 2025 and Oct 2026 merge).
- **py-ledger demo goals**: `quick-wins` (3 tasks, new command files only), `feature-day` (6 disjoint lanes, one deliberate audit failure on `csv-export`), `bug-hunt` (2 bug-fix lanes, each must add failing-first regression tests), each with an `.expected.md` decomposition: task table, lanes, dependencies, per-task deliverables/DoD, audit expectations, golden path.
- **`examples/README.md`** — the index for both targets: which goal to use, how to build a repo, how to add a target, why the venv must be active.

**Key design decisions:**

- **Classify the first argument by shape, not by a flag** — the prompt requires both the new `<example> [dir]` form and the old `[dir]` form while Epic 40’s prompt calls `make-demo-repo.sh /tmp/sky-e2e-1`. Shape classification (a project folder under `examples/` vs anything with a path separator) satisfies both with no new flag, and `--list`/`--help` document it.
- **The script verifies the baseline suite** — a demo target that is not green is worse than none, and one second of `bun test`/`pytest` catches it. Only a red suite is fatal; a missing toolchain or a failed `pip install` degrades to a warning so offline laptops still get a usable repo.
- **Integer cents + JSONL** — exact money, a file that diffs, and a reset that is `rm -rf`. The seeded money bug only exists because everything except one conversion keeps the cent invariant.
- **Command discovery in Python mirrors Vite feature discovery in TypeScript** — it is what makes `feature-day`’s six lanes provably disjoint, and `tests/test_commands.py` guards the contract (unique names, non-empty summaries, every module defines `COMMAND`).
- **Seeded bugs chosen so the baseline is green** — float truncation only bites `0.29`/`19.99`-style values, and month grouping only merges across year boundaries; the committed tests use `12.34`/`-12.34` and a single year. The answer key names the avoided inputs so the bug cannot be accidentally covered before the demo.
- **`stage`’s decomposition lives in `.starling-answers/`** — `evals/planner/cases.test.ts` asserts one planner case per `demo-goals/*.expected.md`; the planner-evals lane is Epic 48’s, so a sixth `*.expected.md` there would turn the root suite red in my worktree and collide with an in-flight epic. `.starling-answers/` is stripped by the demo script too, so nothing leaks. Alternatives considered: editing `evals/planner/**` (lane violation, conflict risk) and naming the key `stage.answer-key.md` inside `demo-goals/` (breaks the `*.expected.md` convention *and* needs a second exclude pattern or leaks the key).
- **Python ≥ 3.12, preferring 3.12** — the brief says 3.12, but refusing 3.13/3.14 would make the target unusable on a newer laptop; `requires-python = ">=3.12"` states the real contract.

**Verification (exact commands + results):**

- `bun install` — clean (`Checked 162 installs across 221 packages (no changes)`).
- `bash examples/scripts/make-demo-repo.sh sky-todo /tmp/x1`:

  ```
  Installing dependencies with /Users/moksh/.bun/bin/bun
  Running the baseline tests (bun test)
   71 pass
   0 fail
  /tmp/x1
  ```

- `bash examples/scripts/make-demo-repo.sh py-ledger /tmp/x2`:

  ```
  Creating .venv with python3.12
  Installing py-ledger and its dev dependencies into .venv
  Running the baseline tests (pytest)
  136 passed in 0.66s
  Activate the virtualenv before running Starling (the auditor calls 'pytest'):
    cd /tmp/x2 && source .venv/bin/activate
  /tmp/x2
  ```

- Generated repos: `git -C /tmp/x1 log --oneline` → `e859d6d chore: initial sky-todo`, `rev-list --count HEAD` = 1, `status --porcelain` empty, `.starling-answers` absent, `demo-goals` = the six goal texts and **no** `*.expected.md`. Same for `/tmp/x2` (`8147cb5 chore: initial py-ledger`, 1 commit, clean, `.starling-answers` absent, 3 goals, `.venv` git-ignored).
- Legacy form and idempotency: `bash examples/scripts/make-demo-repo.sh /tmp/x3` still builds sky-todo (71 pass / 0 fail, prints `/tmp/x3`); re-running the same path replaced it and stayed at one clean commit. `--list` prints both targets.
- py-ledger source checks (venv with pytest 9.1.1 + ruff 0.17.3): `python -m pytest` → **136 passed in 0.07s**; `python -m ruff check .` → **All checks passed!**; `python -m ruff format --check .` → **25 files already formatted**.
- sky-todo source checks: `bun test` → **71 pass / 0 fail, 1,156 expect() calls, 12 files**; `bunx tsc --noEmit` → clean.
- Seeded bugs reproduce in the generated repo (`/tmp/x2`): `py-ledger add -a 0.29 …` → `added … $0.28`, so the demo has a real bug to hunt.
- `bun run test` (root): packages half — `1359 pass, 4 skip, 0 fail` / `Ran 1363 tests across 162 files`; web half — `426 pass, 0 fail` / `Ran 426 tests across 39 files`. **0 fail overall.**
  - Flake seen once in four post-rebase runs, in another lane: `packages/flock/src/remote-node.test.ts:213` (`RemoteNode against a fake perch > start → SSE events → collect → bundle download → fetch into the hub repo`) — `Expected to contain: "session.idle"`, `Received: []`. It is an SSE-timing race in Epic 30's test, not touched by this lane; the next run was green (`1359 pass, 0 fail`).
- `bun run check`: `Checked 705 files in 854ms. No fixes applied.` and the per-workspace `tsc --noEmit` loop exits 0 (no output).

**Dependencies added:** none (py-ledger’s runtime has zero dependencies; its `[dev]` extra pins nothing beyond `pytest>=8.3`, `ruff>=0.13` and is installed in a per-repo `.venv`, never in the workspace).

**FIX REQUESTS:**

1. **`evals/planner/**` (Epic 48).** Add the `sky-todo-stage` case and then move the answer key back:
   - new `evals/planner/cases/sky-todo-stage.json`:
     ```json
     {
       "name": "sky-todo-stage",
       "goal": "Add dark mode with a persisted toggle, live search filtering, CSV export with tests for quoting and commas, keyboard shortcuts (n = new, / = search, ? = help), completion stats in the footer, and today's date in the header.",
       "repomap": "fixtures/repomaps/sky-todo.json",
       "taskCount": { "min": 5, "max": 7 },
       "features": [
         { "id": "theme", "summary": "Dark mode with a persisted toggle.", "keywords": [["dark", "theme"], ["toggle"]] },
         { "id": "search", "summary": "Live search filtering.", "keywords": [["search"], ["filter"]] },
         { "id": "csv-export", "summary": "CSV export with quoting tests.", "keywords": [["csv", "export"], ["test", "tests"]] },
         { "id": "shortcuts", "summary": "Keyboard shortcuts.", "keywords": [["shortcut", "keyboard", "key"]] },
         { "id": "stats", "summary": "Completion stats in the footer.", "keywords": [["stats", "completion"], ["footer", "percent"]] },
         { "id": "today", "summary": "Today's date in the header.", "keywords": [["today", "date"]] }
       ],
       "requiredDeps": [],
       "requiredLaneFiles": ["src/features/theme/index.ts", "src/features/export/index.ts", "src/features/stats/index.ts", "src/features/today/index.ts"],
       "forbiddenFiles": ["src/ui/render.ts", "src/main.ts", "package.json"],
       "notes": "Six independent feature folders; csv-export is the intended first-attempt audit failure (tests for quoting)."
     }
     ```
   - `evals/planner/reference.ts`: a `sky-todo-stage` reference plan (six seeds: `theme`, `search`, `csv-export`, `shortcuts`, `stats`, `today`; each `owns: ['src/features/<x>/**']`, `reads: ['src/features/README.md', 'src/ui/slots.ts', 'src/ui/filters.ts', 'src/lib/commands.ts', 'src/store/todos.ts']`; `definitionOfDone` includes `TEST_STEP` for every task).
   - `evals/planner/cases.test.ts`: `cases.length` 8 → 9, and rename the assertion `the five sky-todo cases…` → `the six sky-todo cases…` (the count itself is dynamic).
   - Then `git mv examples/sky-todo/.starling-answers/stage.expected.md examples/sky-todo/demo-goals/stage.expected.md` and delete the “Where this file lives” note at the top of it. That restores the one-file-per-goal convention.
   - Optional follow-up in the same lane: cases for py-ledger’s `quick-wins`/`feature-day`/`bug-hunt` (needs a `fixtures/repomaps/py-ledger.json`; `testCommand` is `pytest`).
2. **`packages/repomap/src/sky-todo.test.ts` (Epic 11).** Not blocking: it `cp -r`s `examples/sky-todo` into a temp dir, so a local `bun install` inside `examples/sky-todo` makes the three tests time out (5 s) by copying `node_modules`. Consider excluding `node_modules` in `copySkyTodo()` or mapping from a temp copy made with `cp` filters. Worked around locally by removing `examples/sky-todo/node_modules` before running the root suite; nothing is committed there.

**Deliberately deferred / out of scope:**

- No real Starling run from this lane (the prompt says other epics own that), so the “≤ 8 minutes with 6 agents” figure comes from per-task sizing plus the existing `quick-wins`/`launch-day` timings — not from a measured run. First real check should be `stage` with `--max-parallel 6`.
- `py-ledger import` does not de-duplicate repeated imports (documented in the README; a good candidate for a future demo task).
- The CSV export side of `csvio.py` is intentionally absent — it is what `feature-day`’s `csv-export` task (and its audit failure) builds.
- No `pytest` on `PATH` plumbing inside Starling; the venv has to be activated by whoever starts the CLI. Documented in both READMEs and printed by the script.
- `sky-todo`’s `will-fail-audit` goal was left as it is; it overlaps `stage`’s audit beat by design (isolated vs mixed run).

**Open questions / flagged tradeoffs:**

- The `evals/planner` coupling (one case per `demo-goals/*.expected.md`) means **any** new sky-todo goal now requires a cross-lane change. Worth an explicit rule for Wave 3: either the eval test tolerates extra answer keys, or goal additions are coordinated with the planner-evals lane.
- `stage` and `feature-day` both lean on the same audit-failure recipe (“tests for quoting”). It is the most reliable miss we know of, but if the models get better at following explicit test requirements, the demo loses its retry beat — `will-fail-audit` and `bug-hunt` are the fallbacks.
