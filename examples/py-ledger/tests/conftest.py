"""Shared fixtures: a throwaway ledger file and a transaction factory."""

from __future__ import annotations

from collections.abc import Callable
from datetime import date
from itertools import count
from pathlib import Path

import pytest

from py_ledger.models import Transaction
from py_ledger.storage import Ledger


@pytest.fixture
def ledger_file(tmp_path: Path) -> Path:
    """A path inside pytest's temp directory; nothing is created up front."""
    return tmp_path / "ledger.jsonl"


@pytest.fixture
def ledger(ledger_file: Path) -> Ledger:
    return Ledger(ledger_file)


@pytest.fixture
def make_transaction() -> Callable[..., Transaction]:
    """Build transactions without repeating ids and dates in every test."""
    ids = count(1)

    def factory(
        amount_cents: int,
        *,
        day: str = "2026-01-15",
        merchant: str = "Blue Bottle",
        category: str = "",
        note: str = "",
    ) -> Transaction:
        return Transaction(
            id=f"txn_test{next(ids):02d}",
            day=date.fromisoformat(day),
            amount_cents=amount_cents,
            merchant=merchant,
            category=category,
            note=note,
        )

    return factory
