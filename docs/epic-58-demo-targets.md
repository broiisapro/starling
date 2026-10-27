# Epic 58 — Demo targets: sky-todo polish + a Python target

## Goal

Give Starling something better to operate on in front of an audience:

- keep the `make-demo-repo.sh` contract other epics already call stable, but let
  one script build **any** demo target;
- add a middle-length `stage` goal to sky-todo (six agents, under eight minutes,
  one deliberate audit failure) and make sure every demo feature folder is
  visible in the tree;
- add `examples/py-ledger`, a real Python 3.12 CLI with pytest, ruff, two seeded
  bugs and three goals — Starling's proof that it is language-agnostic.

## How it works

### One script, two targets

```bash
bash examples/scripts/make-demo-repo.sh                       # sky-todo -> $TMPDIR/sky-todo-<ts>
bash examples/scripts/make-demo-repo.sh py-ledger             # py-ledger -> $TMPDIR/py-ledger-<ts>
bash examples/scripts/make-demo-repo.sh sky-todo ./demo       # explicit target
bash examples/scripts/make-demo-repo.sh ./demo                # legacy: sky-todo -> ./demo
bash examples/scripts/make-demo-repo.sh --list
```

The first positional argument is an example name only when it is a folder under
`examples/` that contains a `package.json` or a `pyproject.toml`. Everything
else (any path, anything with a slash) is still a target directory, which keeps
`make-demo-repo.sh /tmp/sky-e2e-1` — the form Epic 40’s prompt uses — working
unchanged.

Per target the script copies the project without `.starling-answers/` and
`demo-goals/*.expected.md`, `git init -b main`s it, installs dependencies,
commits one `chore: initial <example>`, runs the baseline suite, warns if the
tree is dirty, and prints the absolute path as the only stdout line.

Install steps are per target:

- **sky-todo** — `bun install --silent`.
- **py-ledger** — `python3.12 -m venv .venv` then
  `.venv/bin/pip install -e '.[dev]'`. It prefers `python3.12`, accepts any
  Python ≥ 3.12, and degrades to a printed recipe when no interpreter or no
  network is available. The venv is git-ignored; the repo still ends up as one
  clean commit.

Environment knobs: `BUN_BIN`, `PYTHON_BIN`, `DEMO_SKIP_INSTALL=1`,
`DEMO_SKIP_TESTS=1` (plus the legacy `SKY_TODO_SKIP_INSTALL` and the matching
`PY_LEDGER_SKIP_INSTALL`).

### sky-todo

- `demo-goals/stage.md` is a one-paragraph goal that decomposes into six
  independent feature folders: `today`, `stats`, `search`, `theme`,
  `shortcuts`, `csv-export`. All six are ready at t0, so six agents dispatch at
  once; `csv-export` is written to fail its first audit (see below).
- `src/features/README.md` now carries a **reserved folder → demo task** table,
  and `today/`, `tag-count/`, `title-count/` exist with a `.gitkeep` so a
  planner reading the tree sees where each `quick-wins`/`stage` task belongs.
- All pre-existing goal files and their names are untouched.

### py-ledger

A personal-finance ledger: `add`, `list`, `report`, `import` over a JSONL file,
amounts stored as integer cents, CSV import via the stdlib `csv` module.

```
src/py_ledger/
  cli.py               argparse: one subparser per discovered command
  commands/            one module per command, discovered by pkgutil
  money.py models.py storage.py query.py report.py csvio.py formatting.py
tests/                 136 pytest tests, no network
demo-goals/            quick-wins (3), feature-day (6), bug-hunt (2) + expected keys
.starling-answers/     BUGS.md - repro, cause, expected fix and the tests to add
```

`commands/__init__.py` imports every sibling module and collects its
`COMMAND`, so a new command is a new file. That is the Python twin of
sky-todo's feature folders and it is what makes `feature-day`’s six lanes
disjoint.

The two seeded bugs:

| Where | Symptom | Cause |
| ----- | ------- | ----- |
| `money.parse_amount` | `0.29` → 28 cents, `19.99` → 1998, `-0.29` → -28 | `float()` then `int(value * 100)`: binary floats land just below the integer and `int()` truncates |
| `report.group_key` for `month` | October 2025 and October 2026 share one row | groups by `strftime('%b')`, which drops the year |

Both are invisible to the committed suite (see the answer key for exactly which
cases were avoided) and both are reproduced, explained and fixed in
`examples/py-ledger/.starling-answers/BUGS.md`.

### Goals and the audit beats

`stage` (sky-todo) and `feature-day` (py-ledger) each include one task whose DoD
demands tests for CSV quoting (`csv-export`). The intended first attempt is a
working exporter with no test file: `definition-of-done` fails, the fixer prompt
names commas/quotes/newlines/header row/empty list, attempt 2 adds the test and
the merge lands. `stage.expected.md` and `feature-day.expected.md` document the
timeline minute by minute; sky-todo also keeps `will-fail-audit` for the isolated
version of the same beat.

## Key decisions & reasoning

- **Argument compatibility over a clean break.** The prompt requires both
  `make-demo-repo.sh <example> [dir]` and the old one-argument form. Rather than
  add flags, the first argument is classified by shape: an existing project
  folder under `examples/` is a target name, anything else is a path. It is
  documented in `--help`, and `--list` makes the valid names discoverable.
- **The script verifies the baseline.** It runs `bun test` / `pytest` in the new
  repo and exits non-zero on failure. A demo target that is not green is worse
  than no demo target, and the check costs a second. `DEMO_SKIP_TESTS=1` keeps a
  fast path for scripting.
- **pip failing must not fail the build.** `pip install -e .[dev]` needs PyPI.
  On an offline laptop the repo is still perfectly usable and the message says
  how to finish the setup; only a *red test suite* is fatal.
- **Amounts as integer cents, JSONL on disk.** The ledger needs exact arithmetic
  and a file a human can `diff`. A database would be overkill and would make the
  demo harder to reset; the answer key’s bug is only possible because cents are
  integers everywhere except that one conversion.
- **Command discovery instead of a registry list.** sky-todo already proves the
  pattern (`src/features/*/index.ts`); repeating it in Python means feature-day’s
  six lanes cannot collide, and `tests/test_commands.py` guards the contract
  (unique names, non-empty summaries).
- **Seeded bugs chosen for a green baseline.** The float truncation only bites
  values such as `0.29`/`19.99`, and the month grouping only merges across
  years — so the existing tests (`12.34`, `-12.34`, a single year) pass while
  the bugs are real. The answer key lists the exact inputs the suite avoids, so
  the same mistake is not re-introduced by a future test.
- **`stage`’s decomposition lives in `.starling-answers/`, not `demo-goals/`.**
  `evals/planner/cases.test.ts` asserts one planner case per
  `demo-goals/*.expected.md`; the planner-evals lane belongs to Epic 48, so
  adding a sixth `*.expected.md` there would make the root suite red in this
  lane and collide with an in-flight epic. `.starling-answers/` is already
  stripped by the demo script, so the answer key is neither leaked nor lost. The
  handback carries the FIX REQUEST to add the `sky-todo-stage` case and move the
  file back.
- **Python 3.12 preferred, newer accepted.** The brief says 3.12; refusing 3.13+
  would make the target unusable on a newer laptop for no reason. `requires-python
  = ">=3.12"` states the real contract, and the script prefers 3.12 when present.

## Interfaces for future epics

- **`make-demo-repo.sh`** — `<example-name> [target-dir]`, legacy
  `[target-dir]`, `--list`, `--help`; last stdout line is the repo path; every
  other line goes to stderr; exit 1 on a red baseline or a foreign target dir.
  Per-target env overrides are listed in the script header and
  `examples/README.md`.
- **Demo targets are data, not code for Starling.** Goals are the literal text
  passed to `starling run "$(cat demo-goals/<goal>.md)"`; `*.expected.md` files
  are eval answer keys. Adding a target = a folder with a real install + a green
  suite + goals + optional `.starling-answers/`, plus two `case "$EXAMPLE"`
  branches in the script (documented in `examples/README.md`).
- **py-ledger extension point** — a command module defines
  `COMMAND = Command(name, summary, configure, run)`; discovery is automatic, so
  demo tasks never edit a shared registration file. `Ledger.save_all` is the
  only sanctioned way for a command to rewrite existing rows.
- **Detected commands (E11 / E16)** — a repo with `pyproject.toml` +
  `tests/test_*.py` is detected as `pytest`. Because the auditor shells out,
  the demo requires the venv on `PATH` (`source .venv/bin/activate`); the script
  prints that reminder and `examples/README.md` repeats it in the recipe.
- **Planner evals (E29/E48)** — the six sky-todo goals and three py-ledger goals
  are ready to become cases; the FIX REQUEST in the handback includes the exact
  JSON for `sky-todo-stage`.

## Deviations from plan

1. **`stage.expected.md` sits in `examples/sky-todo/.starling-answers/`** rather
   than `demo-goals/`. Reason and remediation in the handback FIX REQUEST; the
   alternative (editing `evals/planner/**`) is Epic 48’s lane.
2. **py-ledger is ~1,020 lines of application Python** (16 modules) and ~870
   lines of tests, slightly over the 600–900 target for the app. The extra is
   module-level documentation of the extension points plus explicit validation
   in `models.py`; the code itself is lean (largest module is 151 lines) and the
   six-lane decomposition depends on that documentation.
3. **`examples/README.md` added** (not requested) as the single index of both
   targets: which goal to use, how to build a repo, how to add a target.
4. **The script now runs the baseline tests** (not requested) — see Key
   decisions.
5. **`today/`, `tag-count/`, `title-count/` placeholder folders added** (not
   requested) because the brief asks that feature folders clearly afford each
   task; without them `quick-wins`’ lanes are invisible in the tree.

## Known limitations / deferred

- `py-ledger import` does not de-duplicate: importing the same CSV twice doubles
  the rows. Intentional (a demo task could add it) and documented in the README.
- `pytest` must be on `PATH` for the auditor. There is no PATH plumbing inside
  Starling; the venv has to be activated by whoever starts the CLI.
- `examples/sky-todo/node_modules` should not exist while the root suite runs:
  `packages/repomap/src/sky-todo.test.ts` copies the whole folder and can hit
  its 5 s timeout. This is pre-existing (Epic 11) and is only a local-state
  hazard, not a repo problem. The demo script installs into the *copy*, not into
  `examples/`.
- No planner eval case exists yet for `stage` or for py-ledger’s three goals —
  see the FIX REQUEST.
- No real Starling run was executed from this lane (explicitly out of scope).
  The goals are sized from the per-task work and from the existing
  `quick-wins`/`launch-day` timings, not from a measured run.
- The `will-fail-audit` goal still overlaps `stage`’s `csv-export` beat; both are
  kept because one is the isolated demo and the other is the mixed run.
