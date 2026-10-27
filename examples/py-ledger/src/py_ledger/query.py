"""Filters shared by ``list`` and every command that needs a subset.

Keeping the predicates here means a new command can filter the ledger without
copying date maths, and ``list`` grows options without touching the model.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from datetime import date

from .errors import QueryError
from .models import UNCATEGORIZED, Transaction, normalize_category, parse_day

_MONTH = re.compile(r"^(\d{4})-(\d{1,2})$")


def parse_month(value: str) -> str:
    """Validate ``YYYY-MM`` and return it zero-padded (``2026-1`` -> ``2026-01``)."""
    match = _MONTH.match(str(value).strip())
    if not match:
        raise QueryError(f"months must look like YYYY-MM (got {value!r})")
    year, month = int(match.group(1)), int(match.group(2))
    if not 1 <= month <= 12 or not 1 <= year <= 9999:
        raise QueryError(f"months must look like YYYY-MM (got {value!r})")
    return f"{year:04d}-{month:02d}"


def filtered(
    transactions: Iterable[Transaction],
    *,
    category: str | None = None,
    month: str | None = None,
    since: str | date | None = None,
    until: str | date | None = None,
) -> list[Transaction]:
    """Transactions matching every supplied filter, oldest first."""
    month_key = parse_month(month) if month else None
    start = parse_day(since) if since is not None else None
    end = parse_day(until) if until is not None else None
    wanted = _normalize_category_arg(category)

    result: list[Transaction] = []
    for transaction in transactions:
        if wanted is not None and transaction.category_or_uncategorized != wanted:
            continue
        if month_key is not None and transaction.day.strftime("%Y-%m") != month_key:
            continue
        if start is not None and transaction.day < start:
            continue
        if end is not None and transaction.day > end:
            continue
        result.append(transaction)

    result.sort(key=lambda transaction: (transaction.day, transaction.id))
    return result


def _normalize_category_arg(category: str | None) -> str | None:
    if category is None:
        return None
    slug = normalize_category(category)
    return UNCATEGORIZED if slug == UNCATEGORIZED else slug


__all__ = ["filtered", "parse_month"]
