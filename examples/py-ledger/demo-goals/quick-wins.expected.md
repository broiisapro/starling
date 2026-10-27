# Expected decomposition — quick-wins (py-ledger)

**Goal (3 tasks, ~2 minutes total).** The smoke test for the Python target: each
task adds one command module and one test module, so every lane is a pair of new
files and no task edits a shared file. If this plan has warnings, the planner is
broken.

## Task table

| # | key                 | title                                | depends on | lane owns                                                          |
| - | ------------------- | ------------------------------------ | ---------- | ------------------------------------------------------------------ |
| 1 | `count-command`     | `count` command                      | —          | `src/py_ledger/commands/count.py`, `tests/test_count.py`            |
| 2 | `categories-command`| `categories` command                 | —          | `src/py_ledger/commands/categories.py`, `tests/test_categories.py`  |
| 3 | `version-command`   | `version` command                    | —          | `src/py_ledger/commands/version.py`, `tests/test_version.py`        |

Expected validator output: **no issues**. All three are ready at t0, so three
agents dispatch immediately.

## Why the lanes are disjoint

`src/py_ledger/commands/__init__.py` discovers every module in the package with
`pkgutil.iter_modules` and collects its module-level `COMMAND`, exactly like
sky-todo's feature folders. A new module is a new command; nothing under
`commands/` needs editing, and each task's test file is its own.

All three tasks *read* `models.py`, `storage.py`, `query.py` and `report.py`;
none writes them. `version` reads `py_ledger.__version__`.

## Task details

### count-command — `src/py_ledger/commands/count.py`, `tests/test_count.py`

Deliverables: `py-ledger count` prints the number of stored transactions;
`--month YYYY-MM` and `--category` narrow the count via `query.filtered`;
`--json` prints `{"count": n}`; an empty or missing ledger prints `0`.
DoD: tests cover zero, three transactions, a month filter and the JSON shape;
`pytest` green.

### categories-command — `src/py_ledger/commands/categories.py`, `tests/test_categories.py`

Deliverables: `py-ledger categories` lists each distinct category in use with its
transaction count and net total; uncategorised rows appear under
`uncategorized`; rows sort by count descending, then name; `--json` emits a list
of `{category, count, net_cents}`.
DoD: tests cover the uncategorised bucket, plural counts and the sort order;
`pytest` green.

### version-command — `src/py_ledger/commands/version.py`, `tests/test_version.py`

Deliverables: `py-ledger version` prints `py-ledger <version>` using
`py_ledger.__version__` (no hard-coded duplicate); `--json` prints
`{"name": "py-ledger", "version": "<version>"}`.
DoD: the test imports `__version__` and asserts the output, so bumping the
version cannot break it; `pytest` green.

## Golden path

Three agents, three new command modules, merges in any order, no conflicts,
~2 minutes. Afterwards `py-ledger count`, `py-ledger categories` and
`py-ledger version` all work — a good way to prove the extension point before
the main run.
