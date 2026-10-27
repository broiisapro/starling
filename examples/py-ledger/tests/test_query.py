"""Filters used by `list` and by every command that narrows the ledger."""

from __future__ import annotations

from collections.abc import Callable

import pytest

from py_ledger.errors import QueryError
from py_ledger.models import Transaction
from py_ledger.query import filtered, parse_month


def test_filters_return_everything_by_default(
    make_transaction: Callable[..., Transaction],
) -> None:
    transactions = [make_transaction(-100), make_transaction(-200)]
    assert filtered(transactions) == transactions


def test_month_is_validated() -> None:
    assert parse_month("2026-10") == "2026-10"
    assert parse_month("2026-1") == "2026-01"
    with pytest.raises(QueryError):
        parse_month("October 2026")


def test_category_filter(make_transaction: Callable[..., Transaction]) -> None:
    coffee = make_transaction(-400, category="coffee")
    rent = make_transaction(-10000, category="rent")
    assert filtered([coffee, rent], category="Coffee") == [coffee]


def test_uncategorized_filter(make_transaction: Callable[..., Transaction]) -> None:
    loose = make_transaction(-400)
    tagged = make_transaction(-400, category="coffee")
    assert filtered([loose, tagged], category="uncategorized") == [loose]


def test_month_filter(make_transaction: Callable[..., Transaction]) -> None:
    january = make_transaction(-400, day="2026-01-31")
    february = make_transaction(-400, day="2026-02-01")
    assert filtered([january, february], month="2026-01") == [january]


def test_since_and_until_are_inclusive(make_transaction: Callable[..., Transaction]) -> None:
    early = make_transaction(-100, day="2026-03-01")
    middle = make_transaction(-200, day="2026-03-15")
    late = make_transaction(-300, day="2026-03-31")
    window = filtered([early, middle, late], since="2026-03-01", until="2026-03-31")
    assert window == [early, middle, late]
    assert filtered([early, middle, late], since="2026-03-02") == [middle, late]
    assert filtered([early, middle, late], until="2026-03-30") == [early, middle]


def test_results_are_oldest_first_regardless_of_storage_order(
    make_transaction: Callable[..., Transaction],
) -> None:
    late = make_transaction(-300, day="2026-03-31")
    early = make_transaction(-100, day="2026-03-01")
    assert filtered([late, early]) == [early, late]


def test_filters_combine_with_and(make_transaction: Callable[..., Transaction]) -> None:
    wanted = make_transaction(-400, day="2026-01-05", category="coffee")
    wrong_month = make_transaction(-400, day="2026-02-05", category="coffee")
    wrong_category = make_transaction(-400, day="2026-01-06", category="rent")
    result = filtered([wanted, wrong_month, wrong_category], category="coffee", month="2026-01")
    assert result == [wanted]


def test_unknown_month_is_rejected(
    make_transaction: Callable[..., Transaction],
) -> None:
    with pytest.raises(QueryError):
        filtered([make_transaction(-100)], month="2026-13")
