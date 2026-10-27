# py-ledger

A small but real personal-finance ledger you drive from the shell. It is
**Starling's second demo target**: a Python 3.12 CLI with `pytest` tests, ruff
config and deliberately clear module boundaries, so one goal can be planned
into six lanes that never touch the same file.

> Not part of the Starling Bun workspace. This folder has its own `pyproject.toml`,
> virtualenv instructions and test suite.

## Quick start

```bash
python3.12 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
py-ledger add -a -12.34 -m "Blue Bottle" -c coffee -d 2026-03-01
py-ledger add -a 2500.00 -m "Employer" -c salary -d 2026-03-02
py-ledger list
py-ledger report --by category
pytest          # 136 tests, no network
ruff check .
```

No dependencies at runtime — everything is the standard library. The `dev`
extra installs `pytest` and `ruff`.

`py-ledger` stores transactions in `~/.py-ledger/ledger.jsonl` unless you pass
`--file`, and honours `PY_LEDGER_FILE` for scripts:

```bash
py-ledger --file ./demo.jsonl add -a -4.50 -m "Tram" -c transit
PY_LEDGER_FILE=./demo.jsonl py-ledger list --month 2026-03
```

## Commands

| Command            | What it does                                                      |
| ------------------ | ----------------------------------------------------------------- |
| `add`              | Record one transaction (`-a`, `-m`, `-c`, `-d`, `-n`).             |
| `list`             | Show transactions; filter by `--category`, `--month`, `--since`, `--until`. |
| `report`           | Totals by `--by category` (default), `--by month` or `--by none`.  |
| `import`           | Load a bank CSV (`date,amount,merchant[,category,note]`), with `--dry-run`. |

Every command also accepts `--json` where the output is tabular, and the CLI
prints `py-ledger: <message>` with exit code 1 for anything a human can fix.

## Module map

```
src/py_ledger/
  cli.py            argparse wiring; one subparser per discovered command
  commands/         one module per command — adding a command is adding a file
    __init__.py     Command dataclass + discover() (pkgutil-based)
    add.py list.py report.py import_csv.py
  money.py          integer cents <-> strings (the only float-free zone)
  models.py         Transaction, normalisation, JSON (de)serialisation
  storage.py        the JSONL ledger file (append, atomic rewrite)
  query.py          filters shared by commands (category, month, since/until)
  report.py         GroupTotal, totals(), summarize() by category or month
  csvio.py          bank-style CSV import
  formatting.py     plain-text table rendering
tests/              pytest, one module per package module + CLI end-to-end
demo-goals/         ready-to-run goals + *.expected.md answer keys
.starling-answers/  seeded-bug answer key (never copied into a demo repo)
```

That split is the point: a feature like "add a `budget` command" needs
`budget.py` plus `commands/budget.py` and nothing else, so several features can
land in parallel without a merge conflict.

## Adding a command

```python
# src/py_ledger/commands/count.py
from __future__ import annotations

import argparse

from ..storage import Ledger
from . import Command


def _configure(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--json", action="store_true")


def _run(args: argparse.Namespace, ledger: Ledger) -> int:
    print(len(ledger.load()))
    return 0


COMMAND = Command(name="count", summary="Count transactions", configure=_configure, run=_run)
```

Drop the file in and `py-ledger count` works: `commands/__init__.py` imports
every sibling module and collects `COMMAND`. There is no registration list to
edit (the same trick as sky-todo's feature folders).

## The ledger file

JSON Lines, one transaction per line, amounts as signed integer cents:

```json
{"id": "txn_9f2c41ab", "date": "2026-03-01", "amount_cents": -1234, "merchant": "Blue Bottle", "category": "coffee", "note": "flat white"}
```

Negative is spending, positive is income. The file is append-only in normal
use and rewritten atomically (temp file + rename) by commands that change
existing rows.

## Demo goals

| File                        | Tasks | Use it for                                         |
| --------------------------- | ----- | -------------------------------------------------- |
| `demo-goals/quick-wins.md`  | 3     | Smoke test of a non-JS repo, ~2 minutes            |
| `demo-goals/feature-day.md` | 6     | The main Python demo: six disjoint feature lanes   |
| `demo-goals/bug-hunt.md`    | 2     | Two seeded bugs, both fixed with regression tests  |

Each goal is the literal text Starling receives:

```bash
source .venv/bin/activate          # so the auditor's `pytest` resolves
starling run "$(cat demo-goals/feature-day.md)" --repo .
```

The sibling `*.expected.md` files are the answer keys for evals: ideal task
keys, lanes, dependencies and why the lanes are disjoint. They are excluded
from demo repos by `examples/scripts/make-demo-repo.sh`.

## Seeded bugs

`money.py` and `report.py` each hide one realistic, intentionally untested bug:

- `parse_amount` converts through a float and truncates, so `0.29` is stored as
  `28` cents (`19.99` → `1998`, `-0.29` → `-28`).
- `summarize(..., "month")` groups by the short month name, so October 2025 and
  October 2026 land in one row.

The baseline is green because the committed tests only cover unambiguous cases.
Repro steps, the expected fixes and the regression tests to add live in
[`.starling-answers/BUGS.md`](.starling-answers/BUGS.md) (answer key — do not
point coding agents at it).

## Resetting a demo

```bash
bash ../scripts/make-demo-repo.sh            # sky-todo, the default
bash ../scripts/make-demo-repo.sh py-ledger  # this app, into $TMPDIR
```

The script copies the project (without the answer key and expected-goal files)
into a fresh git repo, creates `.venv` and installs `.[dev]` when Python 3.12 is
available, runs `pytest` against the baseline and prints the repo path. Re-run
it with the same path to get a clean repo again. Pass `PY_LEDGER_SKIP_INSTALL=1`
to skip the virtualenv.

## License

MIT.
