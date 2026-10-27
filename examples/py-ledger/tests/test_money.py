"""Amount parsing and formatting."""

from __future__ import annotations

import pytest

from py_ledger.errors import MoneyError
from py_ledger.money import format_amount, format_money, parse_amount


@pytest.mark.parametrize(
    ("text", "cents"),
    [
        ("12.34", 1234),
        ("7.50", 750),
        ("0.05", 5),
        ("1234.56", 123456),
        ("$1,234.56", 123456),
        ("1_000.00", 100000),
        ("100", 10000),
        ("+3", 300),
        ("0", 0),
        ("-12.34", -1234),
        ("-7.50", -750),
        ("(12.34)", -1234),
        ("(1,234.56)", -123456),
        ("  -1.10  ", -110),
    ],
)
def test_parse_amount_accepts_bank_style_input(text: str, cents: int) -> None:
    assert parse_amount(text) == cents


@pytest.mark.parametrize("text", ["", "   ", "abc", "$", "-", "+", "1.2.3", "nan", "inf"])
def test_parse_amount_rejects_garbage(text: str) -> None:
    with pytest.raises(MoneyError):
        parse_amount(text)


@pytest.mark.parametrize(
    ("cents", "expected"),
    [
        (0, "0.00"),
        (5, "0.05"),
        (750, "7.50"),
        (1234, "12.34"),
        (-1234, "-12.34"),
        (100000, "1000.00"),
    ],
)
def test_format_amount(cents: int, expected: str) -> None:
    assert format_amount(cents) == expected


@pytest.mark.parametrize(
    ("cents", "expected"),
    [(0, "$0.00"), (1234, "$12.34"), (-1234, "-$12.34"), (100000, "$1000.00")],
)
def test_format_money_puts_the_sign_before_the_symbol(cents: int, expected: str) -> None:
    assert format_money(cents) == expected


@pytest.mark.parametrize("cents", [0, 5, 100, 1234, -1234, 99999])
def test_format_then_parse_round_trips(cents: int) -> None:
    assert parse_amount(format_amount(cents)) == cents
