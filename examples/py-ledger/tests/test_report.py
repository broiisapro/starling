"""Totals and grouped reports."""

from __future__ import annotations

from collections.abc import Callable

import pytest

from py_ledger.errors import ReportError
from py_ledger.models import Transaction
from py_ledger.report import GROUPINGS, GroupTotal, report_rows, summarize, totals


def test_totals_split_income_from_spending(
    make_transaction: Callable[..., Transaction],
) -> None:
    transactions = [
        make_transaction(250000, merchant="Employer", category="salary"),
        make_transaction(-10000, category="rent"),
        make_transaction(-1234, category="coffee"),
    ]
    total = totals(transactions)
    assert total.count == 3
    assert total.income_cents == 250000
    assert total.expense_cents == 11234
    assert total.net_cents == 238766


def test_totals_of_nothing_is_a_zero_row() -> None:
    assert totals([]) == GroupTotal(key="all")


def test_group_by_category_sorts_biggest_spend_first(
    make_transaction: Callable[..., Transaction],
) -> None:
    transactions = [
        make_transaction(250000, merchant="Employer", category="salary"),
        make_transaction(-500, category="coffee"),
        make_transaction(-100000, category="rent"),
    ]
    rows = summarize(transactions, "category")
    assert [row.key for row in rows] == ["rent", "coffee", "salary"]
    assert [row.net_cents for row in rows] == [-100000, -500, 250000]


def test_uncategorized_transactions_get_their_own_row(
    make_transaction: Callable[..., Transaction],
) -> None:
    rows = summarize(
        [make_transaction(-100), make_transaction(-100, category="coffee")], "category"
    )
    assert {row.key for row in rows} == {"uncategorized", "coffee"}


def test_group_by_month_keeps_months_separate_in_order(
    make_transaction: Callable[..., Transaction],
) -> None:
    january = make_transaction(-100, day="2026-01-10", category="coffee")
    february = make_transaction(-200, day="2026-02-10", category="coffee")
    rows = summarize([february, january], "month")
    assert [row.count for row in rows] == [1, 1]
    assert [row.net_cents for row in rows] == [-100, -200]


def test_group_by_month_adds_up_a_month(
    make_transaction: Callable[..., Transaction],
) -> None:
    rows = summarize(
        [make_transaction(-100, day="2026-01-10"), make_transaction(-250, day="2026-01-11")],
        "month",
    )
    assert len(rows) == 1
    assert rows[0].count == 2
    assert rows[0].expense_cents == 350


def test_none_grouping_is_one_row(make_transaction: Callable[..., Transaction]) -> None:
    rows = summarize([make_transaction(-100), make_transaction(-200)], "none")
    assert rows == [GroupTotal(key="all", count=2, income_cents=0, expense_cents=300)]


def test_unknown_grouping_is_rejected() -> None:
    with pytest.raises(ReportError):
        summarize([], "fortnight")


def test_groupings_are_documented() -> None:
    assert GROUPINGS == ("category", "month", "none")


def test_report_rows_are_strings_for_the_table(
    make_transaction: Callable[..., Transaction],
) -> None:
    rows = report_rows(
        summarize([make_transaction(-1234, category="coffee")], "category"), "category"
    )
    assert rows == [["coffee", "1", "$0.00", "$12.34", "-$12.34"]]


def test_report_rows_label_the_total_group(make_transaction: Callable[..., Transaction]) -> None:
    rows = report_rows(summarize([make_transaction(-1234)], "none"), "none")
    assert rows == [["total", "1", "$0.00", "$12.34", "-$12.34"]]
