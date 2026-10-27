"""Amounts are integer cents everywhere; this module is the only place that
converts between cents and the strings humans type and read.

Keeping the conversion in one module means the rest of the app never worries
about floating point, and a ledger file stays exact across platforms.
"""

from __future__ import annotations

import math

from .errors import MoneyError

CURRENCY = "$"


def parse_amount(text: str) -> int:
    """Parse a signed amount into cents.

    Accepts what people paste from a bank statement: ``12.34``, ``-12.34``,
    ``$1,234.56``, ``(12.34)`` for a debit and ``+3`` for income.
    """
    raw = str(text).strip()
    if not raw:
        raise MoneyError("an amount is required")

    negative = False
    if raw.startswith("(") and raw.endswith(")"):
        negative = True
        raw = raw[1:-1]

    cleaned = raw.replace(",", "").replace("_", "").replace(CURRENCY, "").strip()
    if cleaned in {"", "+", "-"}:
        raise MoneyError(f"not an amount: {text!r}")

    try:
        value = float(cleaned)
    except ValueError as exc:
        raise MoneyError(f"not an amount: {text!r}") from exc

    if not math.isfinite(value):
        raise MoneyError(f"not an amount: {text!r}")

    cents = int(value * 100)
    return -cents if negative else cents


def format_amount(cents: int) -> str:
    """``-1234`` -> ``'-12.34'``. Always two decimals, never a thousands separator."""
    sign = "-" if cents < 0 else ""
    whole, fraction = divmod(abs(int(cents)), 100)
    return f"{sign}{whole}.{fraction:02d}"


def format_money(cents: int) -> str:
    """``-1234`` -> ``'-$12.34'``; the form used in tables and one-line summaries."""
    sign = "-" if cents < 0 else ""
    return f"{sign}{CURRENCY}{format_amount(abs(int(cents)))}"


__all__ = ["CURRENCY", "format_amount", "format_money", "parse_amount"]
