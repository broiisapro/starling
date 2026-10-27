# Expected decomposition — bug-hunt (py-ledger)

**Goal (2 tasks).** The goal names two symptoms and nothing else. Each bug lives
in a different module, so two agents can fix them in parallel, and each fix must
come with regression tests that fail on the old code. This is also the cheapest
way to show the auditor reasoning about a diff instead of watching a red suite:
the baseline `pytest` is green in both lanes.

## Task table

| # | key                | title                                     | depends on | lane owns                                    |
| - | ------------------ | ----------------------------------------- | ---------- | -------------------------------------------- |
| 1 | `fix-cents`        | Exact cent parsing for fractional amounts | —          | `src/py_ledger/money.py`, `tests/test_money.py` |
| 2 | `fix-month-merge`  | One report row per calendar month          | —          | `src/py_ledger/report.py`, `tests/test_report.py` |

Expected validator output: **no issues**. Two disjoint lanes, no dependencies,
both ready at t0.

## Why the lanes are disjoint

`money.py` owns `parse_amount`/`format_amount`; `report.py` owns grouping and
sorting. The only shared file is `models.py`, which neither task needs to touch.
`tests/test_money.py` and `tests/test_report.py` are separate files, so the two
both add tests without a conflict.

Note for the planner: do **not** create a third "update the CLI tests" task.
`tests/test_cli.py` asserts amounts and totals, not month labels, and survives
both fixes unchanged.

## Task details

### fix-cents — `src/py_ledger/money.py`, `tests/test_money.py`

Symptoms in the goal: `0.29`, `19.99` and `-0.29` are stored a cent off.

Deliverables: `parse_amount` converts exactly (no binary float in the path —
`Decimal` with `ROUND_HALF_UP`, or integer string splitting); signs,
parentheses, `$` and thousands separators keep working; values with more than
two decimals get one documented behaviour (round half-up is the expected one).
DoD: new tests assert `0.29 -> 29`, `19.99 -> 1999`, `1.13 -> 113`,
`-0.29 -> -29`, `(0.29) -> -29`, and `parse_amount(format_amount(n)) == n` for
`n` in `{29, -29, 1999}`; the pre-existing money tests still pass; `pytest`
green. The new tests must fail before the change — say so in the handback.

### fix-month-merge — `src/py_ledger/report.py`, `tests/test_report.py`

Symptom in the goal: the monthly report merges the same month from different
years.

Deliverables: month groups keyed by `YYYY-MM` (year included) and sorted
chronologically, including across a year boundary; counts, income, spend and net
unchanged; `report --by month` still renders through `format_table`.
DoD: new tests assert that 2025-10 and 2026-10 produce two rows, that
`2025-12` sorts before `2026-01`, and that a single month still aggregates its
rows; the pre-existing report tests still pass; `pytest` green.

## The audit beat

Neither task fails audit if the tests land. That is deliberate: after the
`feature-day` retry beat, this goal shows the other half of the story — a clean
two-agent run where the auditor's `definition-of-done` checks confirm the
regression tests exist and the full suite stayed green.

If a task does ship without tests, the auditor should fail it with
`fixInstructions` naming the exact assertions above, and the fix loop closes it
on attempt 2.

## Golden path

Two agents, two files, ~2 minutes. Then `py-ledger add -a 0.29` stores 29 cents
and `py-ledger report --by month` shows one row per calendar month.
