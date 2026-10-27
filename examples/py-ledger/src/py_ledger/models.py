"""The transaction record and the normalisation rules around it.

A transaction is immutable: commands build a new one with ``with_changes``
instead of mutating the stored value, which keeps undo-style features and the
JSONL file honest.
"""

from __future__ import annotations

import re
import secrets
from collections.abc import Mapping
from dataclasses import dataclass, replace
from datetime import date, datetime

from .errors import ModelError

#: Category shown by reports when a transaction was never categorised.
UNCATEGORIZED = "uncategorized"

_CATEGORY_WORDS = re.compile(r"[^a-z0-9]+")


def normalize_category(raw: str | None) -> str:
    """``"  Eating Out! "`` -> ``"eating-out"``; empty input stays empty."""
    if raw is None:
        return ""
    words = [word for word in _CATEGORY_WORDS.split(str(raw).strip().lower()) if word]
    return "-".join(words)


def parse_day(value: str | date | None) -> date:
    """Parse ``YYYY-MM-DD`` (or pass a ``date`` through). ``None`` means today."""
    if value is None:
        return date.today()
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = str(value).strip()
    try:
        return date.fromisoformat(text)
    except ValueError as exc:
        raise ModelError(f"dates must look like YYYY-MM-DD (got {value!r})") from exc


def new_id(prefix: str = "txn") -> str:
    """Short, collision-resistant, sortable-by-nothing id that is easy to type."""
    return f"{prefix}_{secrets.token_hex(4)}"


@dataclass(frozen=True, slots=True)
class Transaction:
    """One line in the ledger. Negative amounts are spending, positive income."""

    id: str
    day: date
    amount_cents: int
    merchant: str
    category: str = ""
    note: str = ""

    def __post_init__(self) -> None:
        if not str(self.id).strip():
            raise ModelError("a transaction needs an id")
        if not isinstance(self.day, date) or isinstance(self.day, datetime):
            raise ModelError("a transaction needs a calendar day")
        if isinstance(self.amount_cents, bool) or not isinstance(self.amount_cents, int):
            raise ModelError("amounts are stored as integer cents")
        if not str(self.merchant).strip():
            raise ModelError("a transaction needs a merchant")

        object.__setattr__(self, "id", str(self.id).strip())
        object.__setattr__(self, "merchant", str(self.merchant).strip())
        object.__setattr__(self, "category", normalize_category(self.category))
        object.__setattr__(self, "note", str(self.note).strip())

    @property
    def is_expense(self) -> bool:
        return self.amount_cents < 0

    @property
    def category_or_uncategorized(self) -> str:
        return self.category or UNCATEGORIZED

    def with_changes(
        self,
        *,
        day: date | None = None,
        amount_cents: int | None = None,
        merchant: str | None = None,
        category: str | None = None,
        note: str | None = None,
    ) -> Transaction:
        """Return a copy with the given fields replaced."""
        return replace(
            self,
            day=self.day if day is None else day,
            amount_cents=self.amount_cents if amount_cents is None else amount_cents,
            merchant=self.merchant if merchant is None else merchant,
            category=self.category if category is None else normalize_category(category),
            note=self.note if note is None else note,
        )

    def to_dict(self) -> dict[str, object]:
        """The on-disk shape: keys are stable, the day is an ISO string."""
        return {
            "id": self.id,
            "date": self.day.isoformat(),
            "amount_cents": self.amount_cents,
            "merchant": self.merchant,
            "category": self.category,
            "note": self.note,
        }

    @classmethod
    def from_dict(cls, data: Mapping[str, object]) -> Transaction:
        """Rebuild a transaction from an on-disk dict, with a readable error."""
        if not isinstance(data, Mapping):
            raise ModelError("a stored transaction must be an object")

        raw_id = data.get("id")
        if not isinstance(raw_id, str):
            raise ModelError("a stored transaction needs a string id")

        raw_day = data.get("date")
        if not isinstance(raw_day, str):
            raise ModelError("a stored transaction needs a date")

        raw_amount = data.get("amount_cents")
        if isinstance(raw_amount, bool) or not isinstance(raw_amount, int):
            raise ModelError("amount_cents must be an integer")

        raw_merchant = data.get("merchant")
        if not isinstance(raw_merchant, str):
            raise ModelError("merchant must be a string")

        raw_category = data.get("category", "")
        raw_note = data.get("note", "")

        return cls(
            id=raw_id,
            day=parse_day(raw_day),
            amount_cents=raw_amount,
            merchant=raw_merchant,
            category="" if raw_category is None else str(raw_category),
            note="" if raw_note is None else str(raw_note),
        )


__all__ = ["UNCATEGORIZED", "Transaction", "new_id", "normalize_category", "parse_day"]
