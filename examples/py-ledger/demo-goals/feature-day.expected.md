# Expected decomposition — feature-day (py-ledger)

**Goal (6 tasks).** The main Python demo. Six independent feature tasks, one per
module pair, all ready at t0 so six agents fill the murmuration immediately.
One of them — `csv-export` — is written so its first attempt is likely to miss
the tests, which is the audit beat.

## Task table

| # | key            | title                                   | depends on | lane owns                                                                                   |
| - | -------------- | --------------------------------------- | ---------- | ------------------------------------------------------------------------------------------- |
| 1 | `search-list`  | `list --search` text filter             | —          | `src/py_ledger/query.py`, `src/py_ledger/commands/list.py`, `tests/test_query.py`, `tests/test_cli.py` |
| 2 | `csv-export`   | `export-csv` with RFC 4180 quoting      | —          | `src/py_ledger/csvio.py`, `src/py_ledger/commands/export_csv.py`, `tests/test_csvio.py`, `tests/test_export_csv.py` |
| 3 | `trend`        | Month-over-month net change             | —          | `src/py_ledger/trend.py`, `src/py_ledger/commands/trend.py`, `tests/test_trend.py`           |
| 4 | `budget`       | Spending limits per category            | —          | `src/py_ledger/budget.py`, `src/py_ledger/commands/budget.py`, `tests/test_budget.py`        |
| 5 | `recategorize` | Merchant rules for uncategorised rows   | —          | `src/py_ledger/rules.py`, `src/py_ledger/commands/recategorize.py`, `tests/test_rules.py`    |
| 6 | `edit-remove`  | `edit` and `remove` commands            | —          | `src/py_ledger/storage.py`, `src/py_ledger/commands/edit.py`, `src/py_ledger/commands/remove.py`, `tests/test_storage.py`, `tests/test_edit_remove.py` |

Expected validator output: **no issues**. Six tasks, six disjoint file sets, no
DAG edges, so all six dispatch at t0 with `maxParallel: 6`.

## Why the lanes are disjoint

- Five tasks add **new modules** (`trend.py`, `budget.py`, `rules.py` plus their
  command modules) and touch no existing file beyond their own tests.
- `search-list` owns the two files that implement filtering today (`query.py`,
  `commands/list.py`); nobody else writes them.
- `csv-export` extends `csvio.py` (import side already exists) and adds
  `commands/export_csv.py`.
- `edit-remove` is the only task that edits `storage.py` — it adds
  `Ledger.update()` and `Ledger.remove()` — and no other task calls those
  methods, so the file stays single-owner.

Every task reads `models.py`, `money.py`, `report.py` and `formatting.py`;
none writes them. Test files are per-task, so merges never touch the same test
file.

## The audit failure: `csv-export`

The goal says "with tests for quoting and commas", and the natural first attempt
for an exporter is the exporter plus a happy-path table print. Expected first
verdict: **fail**.

- `definition-of-done` check: the CSV quoting cases (comma, double quote,
  newline, header row) have no test naming them.
- LLM verdict should say the deliverable's test requirement is unmet and name
  the missing cases.

The fixer prompt must be specific: commas, embedded double quotes, embedded
newlines, the header row and the empty ledger. Second attempt adds
`tests/test_export_csv.py`; audit **pass**; merge. The retry is what makes the
cost meter move during the demo, so keep the first attempt genuinely
test-free — do not pre-write that test file in the baseline.

## Task details

### search-list — `query.py`, `commands/list.py`

Deliverables: `list --search TEXT` filters case-insensitively on merchant, note
and category; combines with `--category`, `--month`, `--since`, `--until` using
AND; an empty or whitespace-only query means "no filter"; `--json` honours it.
DoD: tests cover a merchant hit, a note hit, a category hit, case folding, an
empty query, and two filters together; `pytest` green.

### csv-export — `csvio.py`, `commands/export_csv.py`

Deliverables: `py-ledger export-csv [-o PATH] [--month YYYY-MM]` writes
`date,amount,merchant,category,note` with `format_amount` for amounts, RFC 4180
quoting (fields containing `,`, `"` or a newline are quoted; inner quotes
doubled) and CRLF row endings; stdout when `-o` is omitted; exit code 0 with a
`wrote N row(s)` line on stderr when a file is written.
DoD: tests cover a merchant with a comma, a merchant with a double quote, a note
with a newline, the header row and an empty ledger; `pytest` green.

### trend — `trend.py`, `commands/trend.py`

Deliverables: `py-ledger trend [--months N]` builds its own `YYYY-MM` buckets
(do not depend on `report`'s month labels), prints one row per month with net and
the change against the previous month, handles the first row and a zero previous
month without dividing by zero, and supports `--json`.
DoD: tests cover three months of rising spend, a zero-net month, the first row
and the JSON shape; `pytest` green.

### budget — `budget.py`, `commands/budget.py`

Deliverables: `py-ledger budget --limit groceries=250 --limit rent=1200
[--month YYYY-MM]` (repeatable, defaulting to the current month) compares spend
per category with its limit and prints limit, spend, remaining and a status per
category; categories without a limit are not invented; a malformed `--limit`
is a friendly `LedgerError`. Exits 0 even when over budget (a report, not a
gate).
DoD: tests cover under, exactly-at and over budget, two limits, a month filter
and a bad `--limit`; `pytest` green.

### recategorize — `rules.py`, `commands/recategorize.py`

Deliverables: `rules.py` exposes an ordered list of merchant-substring rules
with a `suggest(merchant) -> str | None` function and a table tests can extend;
`py-ledger recategorize` prints proposed changes and writes nothing, `--apply`
rewrites the ledger through `Ledger.save_all`, existing categories are never
overwritten, and the summary reports changed/skipped counts.
DoD: tests cover a rule hit, a rule miss, the no-overwrite rule, dry-run versus
`--apply`, and case-insensitive matching; `pytest` green.

### edit-remove — `storage.py`, `commands/edit.py`, `commands/remove.py`

Deliverables: `Ledger.update(id, **changes)` and `Ledger.remove(id)` returning
the updated transaction / a bool, both rewriting atomically via `save_all`;
`py-ledger edit <id>` takes `--amount/--merchant/--category/--date/--note` and
prints the new row; `py-ledger remove <id>` deletes one row and requires
`--yes`; unknown ids are a friendly error with exit code 1.
DoD: tests cover update of one row only, remove, unknown id for both commands,
and that the JSONL file holds exactly one line per remaining transaction;
`pytest` green.

## Golden path

Six dispatch at t0 → five merge first → `csv-export` fails audit → fixer adds
the quoting tests → audit passes → merge. 6/6 merged, 0 conflicts, one retry.
Wall clock with six agents: ~6–8 minutes on one laptop.
