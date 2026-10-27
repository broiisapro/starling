"""The Transaction record: validation, normalisation and the on-disk shape."""

from __future__ import annotations

from collections.abc import Callable
from datetime import date

import pytest

from py_ledger.errors import ModelError
from py_ledger.models import Transaction, new_id, normalize_category, parse_day


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        (None, ""),
        ("", ""),
        ("groceries", "groceries"),
        ("Eating Out!", "eating-out"),
        ("  Coffee   Shops ", "coffee-shops"),
        ("Rent/Mortgage", "rent-mortgage"),
        ("-weird--spacing-", "weird-spacing"),
        ("Ünïcode", "n-code"),
    ],
)
def test_normalize_category(raw: str | None, expected: str) -> None:
    assert normalize_category(raw) == expected


def test_parse_day_reads_iso_days() -> None:
    assert parse_day("2026-10-27") == date(2026, 10, 27)


def test_parse_day_defaults_to_today() -> None:
    assert parse_day(None) == date.today()


def test_parse_day_rejects_other_formats() -> None:
    with pytest.raises(ModelError):
        parse_day("27/10/2026")


def test_new_id_is_prefixed_and_short() -> None:
    identifier = new_id()
    assert identifier.startswith("txn_")
    assert len(identifier) == len("txn_") + 8


def test_category_is_normalised_on_construction(
    make_transaction: Callable[..., Transaction],
) -> None:
    transaction = make_transaction(-500, category="Eating Out!")
    assert transaction.category == "eating-out"
    assert transaction.category_or_uncategorized == "eating-out"


def test_missing_category_falls_back_to_uncategorized(
    make_transaction: Callable[..., Transaction],
) -> None:
    assert make_transaction(-500).category_or_uncategorized == "uncategorized"


def test_expense_flag(make_transaction: Callable[..., Transaction]) -> None:
    assert make_transaction(-500).is_expense
    assert not make_transaction(0).is_expense
    assert not make_transaction(500).is_expense


def test_merchant_is_trimmed(make_transaction: Callable[..., Transaction]) -> None:
    assert make_transaction(-500, merchant="  Blue Bottle  ").merchant == "Blue Bottle"


def test_missing_merchant_is_rejected(make_transaction: Callable[..., Transaction]) -> None:
    with pytest.raises(ModelError):
        make_transaction(-500, merchant="   ")


def test_amounts_must_be_integer_cents(make_transaction: Callable[..., Transaction]) -> None:
    with pytest.raises(ModelError):
        make_transaction(12.34)  # type: ignore[arg-type]


def test_to_dict_round_trips(make_transaction: Callable[..., Transaction]) -> None:
    transaction = make_transaction(-1234, day="2026-02-03", category="Coffee", note="flat white")
    assert Transaction.from_dict(transaction.to_dict()) == transaction


def test_to_dict_uses_iso_days(make_transaction: Callable[..., Transaction]) -> None:
    payload = make_transaction(-1234, day="2026-02-03").to_dict()
    assert payload["date"] == "2026-02-03"
    assert payload["amount_cents"] == -1234


@pytest.mark.parametrize(
    "payload",
    [
        {"id": "txn_1", "date": "2026-01-01", "merchant": "x"},
        {"id": "txn_1", "date": "2026-01-01", "amount_cents": "12", "merchant": "x"},
        {"id": "", "date": "2026-01-01", "amount_cents": 12, "merchant": "x"},
        {"id": "txn_1", "date": "nope", "amount_cents": 12, "merchant": "x"},
        {"id": "txn_1", "date": "2026-01-01", "amount_cents": 12, "merchant": ""},
    ],
)
def test_from_dict_rejects_broken_rows(payload: dict[str, object]) -> None:
    with pytest.raises(ModelError):
        Transaction.from_dict(payload)


def test_with_changes_keeps_the_id_and_builds_a_copy(
    make_transaction: Callable[..., Transaction],
) -> None:
    original = make_transaction(-1234, category="coffee")
    changed = original.with_changes(amount_cents=-1500, category="Eating Out!")
    assert changed.id == original.id
    assert changed.amount_cents == -1500
    assert changed.category == "eating-out"
    assert original.amount_cents == -1234
