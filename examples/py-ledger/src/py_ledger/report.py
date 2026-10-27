"""Aggregations for ``py-ledger report``.

Two shapes cover every report we need: a single all-transactions total, and a
grouped table (by category or by month). Both return the same ``GroupTotal`` so
the CLI has exactly one renderer.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass

from .errors import ReportError
from .models import Transaction
from .money import format_money

#: The groupings ``report --by`` accepts.
GROUPINGS = ("category", "month", "none")

MONTH_NAMES = (
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
)


@dataclass(frozen=True, slots=True)
class GroupTotal:
    """One row of a report. ``expense_cents`` is a positive magnitude."""

    key: str
    count: int = 0
    income_cents: int = 0
    expense_cents: int = 0

    @property
    def net_cents(self) -> int:
        return self.income_cents - self.expense_cents

    def to_dict(self) -> dict[str, object]:
        return {
            "key": self.key,
            "count": self.count,
            "income_cents": self.income_cents,
            "expense_cents": self.expense_cents,
            "net_cents": self.net_cents,
        }


def group_key(transaction: Transaction, group_by: str) -> str:
    """The bucket a transaction belongs to for the chosen grouping."""
    if group_by == "category":
        return transaction.category_or_uncategorized
    if group_by == "month":
        # A short month label keeps the table narrow enough for a laptop terminal.
        return transaction.day.strftime("%b")
    return "all"


def summarize(transactions: Iterable[Transaction], group_by: str = "category") -> list[GroupTotal]:
    """Aggregate transactions into ``GroupTotal`` rows, in display order."""
    if group_by not in GROUPINGS:
        raise ReportError(f"unknown grouping {group_by!r}; pick one of {', '.join(GROUPINGS)}")

    buckets: dict[str, list[int]] = {}
    for transaction in transactions:
        row = buckets.setdefault(group_key(transaction, group_by), [0, 0, 0])
        row[0] += 1
        if transaction.amount_cents >= 0:
            row[1] += transaction.amount_cents
        else:
            row[2] += -transaction.amount_cents

    totals = [
        GroupTotal(key=key, count=count, income_cents=income, expense_cents=expense)
        for key, (count, income, expense) in buckets.items()
    ]
    return sorted(totals, key=lambda total: _sort_key(total, group_by))


def totals(transactions: Iterable[Transaction]) -> GroupTotal:
    """The single all-transactions row."""
    rows = summarize(transactions, "none")
    return rows[0] if rows else GroupTotal(key="all")


def _sort_key(total: GroupTotal, group_by: str) -> tuple[object, ...]:
    if group_by == "category":
        # Biggest spend first; income-only categories end up at the bottom.
        return (total.net_cents, total.key)
    if group_by == "month":
        # Read the table like a calendar: Jan, Feb, Mar…
        index = MONTH_NAMES.index(total.key) if total.key in MONTH_NAMES else len(MONTH_NAMES)
        return (index, total.key)
    return (0,)


def report_rows(groups: Sequence[GroupTotal], group_by: str) -> list[list[str]]:
    """Turn grouped totals into the string grid ``format_table`` expects."""
    rows: list[list[str]] = []
    for group in groups:
        label = "total" if group_by == "none" else group.key
        rows.append(
            [
                label,
                str(group.count),
                format_money(group.income_cents),
                format_money(group.expense_cents),
                format_money(group.net_cents),
            ]
        )
    return rows


__all__ = ["GROUPINGS", "GroupTotal", "group_key", "report_rows", "summarize", "totals"]
