# Seeded bug answer key

Two realistic bugs live in `src/py_ledger/`, one in the money layer and one in
the report. They are **untested on purpose**: the committed suite only asserts
unambiguous cases, so the baseline is green and Starling's agents (and its
auditor) have something real to find. Do not point coding agents at this
folder; `examples/scripts/make-demo-repo.sh` strips it.

Reproduce from `examples/py-ledger` (with the venv active, or `PYTHONPATH=src`).

---

## Bug A — amounts lose a cent because they round-trip through a float

```bash
python - <<'PY'
from py_ledger.money import parse_amount
for text in ("0.29", "19.99", "-0.29"):
    print(text, "->", parse_amount(text))
PY
# 0.29 -> 28
# 19.99 -> 1998
# -0.29 -> -28
```

**Cause.** `parse_amount` parses the string with `float()` and then does
`int(value * 100)`. Binary floats cannot represent `0.29` exactly — the product
is `28.999999999999996` — and `int()` truncates toward zero, so the cents are
one short. For negative values the truncation goes the other way relative to
zero, so `-0.29` becomes `-28` (`-$0.28`): the magnitude is a cent short and the
sign is right, which is why it hides.

**Expected behaviour.** Amounts are exactly what the user typed: `"0.29"` is
29 cents, `"-0.29"` is -29 cents, `"(0.29)"` is -29 cents. Values with more than
two decimals round half-up (or are rejected — pick one, document it and test
it). The rest of the app already treats amounts as integer cents; only this
conversion is wrong.

**Expected fix (one of two acceptable shapes).**

```python
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

def parse_amount(text: str) -> int:
    ...  # sign/parentheses/currency/separator handling stays as it is
    try:
        value = Decimal(cleaned)
    except InvalidOperation as exc:
        raise MoneyError(f"not an amount: {text!r}") from exc
    cents = int(value.scaleb(2).quantize(Decimal(1), rounding=ROUND_HALF_UP))
    return -cents if negative else cents
```

Or split on `.` and pad/truncate the fraction with integers (no Decimal import).
Either way `parse_amount(format_amount(n)) == n` must hold for every integer `n`
the tests try, including negatives.

**Regression tests to add (all currently fail).**

- `parse_amount("0.29") == 29`, `parse_amount("19.99") == 1999`,
  `parse_amount("1.13") == 113`.
- `parse_amount("-0.29") == -29`, `parse_amount("(0.29)") == -29`.
- `parse_amount(format_amount(29)) == 29` and the same for `-29` (round trip).
- The existing cases in `tests/test_money.py` still pass.

---

## Bug B — the monthly report merges the same month across years

```bash
python - <<'PY'
from datetime import date
from py_ledger.models import Transaction
from py_ledger.report import summarize

def tx(id_, day, cents):
    return Transaction(id=id_, day=date.fromisoformat(day), amount_cents=cents, merchant="m", category="coffee")

rows = summarize([tx("a", "2025-10-03", -1000), tx("b", "2026-10-04", -2000), tx("c", "2026-11-05", -500)], "month")
print([(row.key, row.count) for row in rows])
PY
# [('Oct', 2), ('Nov', 1)]   # wrong: two Octobers, one year apart, are one row
```

**Cause.** `report.group_key` labels a month with `transaction.day.strftime("%b")`,
which throws the year away, and `_sort_key` then orders rows by a hard-coded
month-name list. Two Octobers a year apart land in the same bucket, and the
table cannot say which year it is.

**Expected behaviour.** One row per calendar month, labelled unambiguously
(`2026-10`), ordered chronologically — including across a year boundary
(`2025-12` before `2026-01`). Amounts and counts per month stay exactly as they
are today.

**Expected fix.**

```python
def group_key(transaction: Transaction, group_by: str) -> str:
    ...
    if group_by == "month":
        return transaction.day.strftime("%Y-%m")
    ...

def _sort_key(total: GroupTotal, group_by: str) -> tuple[object, ...]:
    ...
    if group_by == "month":
        return (total.key,)
    ...
```

(If you prefer a pretty label in the table, keep the ISO key and format it in
`report_rows` — but the group key itself must carry the year.)

**Regression tests to add (all currently fail).**

- `2025-10` and `2026-10` produce two rows with one transaction each.
- Group keys are `["2025-12", "2026-01"]` for a December/January pair, in that
  order, regardless of insertion order.
- `summarize(..., "month")` of a single month still adds up (count and spend).
- The existing cases in `tests/test_report.py` still pass.

---

## Why the baseline stays green

- `tests/test_money.py` parses only amounts whose binary float product lands on
  or above the integer (`12.34`, `7.50`, `0.05`, `1234.56`, `-12.34`), never
  `0.29`/`19.99`-style values, and never asserts a negative fractional cent.
- `tests/test_report.py` groups months inside **one** year (2026-01, 2026-02) and
  asserts counts and sums, not the label format — so the year-merging bug is
  invisible.
- `tests/test_cli.py` exercises `report --by month` with a single month.

The show is better if the auditor finds these by reasoning about the request and
the diff rather than from a red test, so do not add coverage for the cases above
until the demo task runs.
