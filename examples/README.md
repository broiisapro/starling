# Demo targets

The repos Starling operates on in demos and evals. They are **not** part of the
Bun workspace: each one has its own install, its own test runner and its own
answer keys. `bun run test` at the repo root skips `examples/` on purpose.

| Target      | Stack                                  | Test command | Goals                          |
| ----------- | -------------------------------------- | ------------ | ------------------------------ |
| `sky-todo`  | Vanilla TypeScript + Vite + happy-dom   | `bun test`   | 6 (3–10 tasks each)            |
| `py-ledger` | Python 3.12 + argparse, pytest, ruff    | `pytest`     | 3 (2–6 tasks each)             |

`sky-todo` is the main stage app (browser, slots, feature folders).
`py-ledger` proves Starling is language-agnostic: a Python CLI with a different
project layout, a different test runner and a virtualenv.

## Build a demo repo

```bash
bash examples/scripts/make-demo-repo.sh                     # sky-todo, timestamped in $TMPDIR
bash examples/scripts/make-demo-repo.sh py-ledger           # py-ledger, timestamped in $TMPDIR
bash examples/scripts/make-demo-repo.sh sky-todo ./demo     # sky-todo into ./demo
bash examples/scripts/make-demo-repo.sh ./demo              # legacy form: same thing
bash examples/scripts/make-demo-repo.sh --list              # what is available
```

The script:

- copies the example without `.starling-answers/` or `demo-goals/*.expected.md`,
- `git init -b main` and one commit, `chore: initial <example>`,
- installs dependencies (bun for sky-todo, a `.venv` via `pip install -e ".[dev]"`
  for py-ledger; both skip with a warning when the toolchain is missing),
- runs the baseline suite and fails loudly if it is not green,
- prints the absolute repo path on the last line, and nothing else on stdout.

Re-running with the same path rebuilds it. It only deletes a target that it
created itself (last commit `chore: initial …`); anything else is refused.

Useful environment variables: `BUN_BIN`, `PYTHON_BIN`, `DEMO_SKIP_INSTALL=1`,
`DEMO_SKIP_TESTS=1` (plus the legacy `SKY_TODO_SKIP_INSTALL` and
`PY_LEDGER_SKIP_INSTALL`). `bash -x` works if you want to see every step.

## Run a goal

```bash
REPO="$(bash examples/scripts/make-demo-repo.sh py-ledger)"
cd "$REPO"
source .venv/bin/activate        # so the auditor's `pytest` resolves
starling run "$(cat demo-goals/feature-day.md)" --repo . --max-parallel 6
```

For sky-todo, drop the `source` line (bun is on PATH).

If you forget to activate the venv, `pytest` is not on PATH and every audit's
`test-command` check fails — the run still works, but the auditor cannot confirm
the suite is green. The script prints the `source` line as a reminder.

## Goals at a glance

**sky-todo** — see [`sky-todo/README.md`](sky-todo/README.md).

| Goal                             | Tasks | Time      | Use it for                              |
| -------------------------------- | ----- | --------- | --------------------------------------- |
| `demo-goals/quick-wins.md`       | 3     | ~2 min    | Smoke test                              |
| `demo-goals/launch-day.md`       | 7     | ~3 min    | The main demo                           |
| `demo-goals/stage.md`            | 6     | ≤ 8 min   | Six agents, one audit failure and a retry |
| `demo-goals/launch-day-xl.md`    | 10    | ~8 min    | Flock mode, two laptops                 |
| `demo-goals/conflict-bait.md`    | 2     | ~2 min    | Lane-overlap warning, resolver          |
| `demo-goals/will-fail-audit.md`  | 1     | ~2 min    | Audit failure in isolation              |

**py-ledger** — see [`py-ledger/README.md`](py-ledger/README.md).

| Goal                          | Tasks | Time      | Use it for                                  |
| ----------------------------- | ----- | --------- | ------------------------------------------- |
| `demo-goals/quick-wins.md`    | 3     | ~2 min    | Smoke test of a non-JS repo                 |
| `demo-goals/feature-day.md`   | 6     | ~8 min    | Six disjoint feature lanes + one audit fail |
| `demo-goals/bug-hunt.md`      | 2     | ~2 min    | Two seeded bugs, fixed with tests           |

Every goal has a sibling `*.expected.md` answer key (ideal task keys, lanes,
dependencies and why the lanes are disjoint). Answer keys are stripped from demo
repos, and the seeded-bug walkthroughs live in each target's
`.starling-answers/BUGS.md`, which is stripped too.

## Adding a target

1. Make a folder here with a real install and a green test suite.
2. Give it `demo-goals/*.md` plus `*.expected.md` so the planner has something
   to be judged against.
3. Put seeded bugs (if any) in `.starling-answers/` with repro steps.
4. Teach `make-demo-repo.sh` two things: the install step and the baseline test
   command (`case "$EXAMPLE"` in `install_dependencies` and the verify block).
5. Add a row to the tables above.
