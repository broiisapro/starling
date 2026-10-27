"""Bank-style CSV import.

Most exports agree on four columns: a date, a signed amount, a merchant and an
optional category. We read with the stdlib ``csv`` module so quoted commas and
embedded newlines survive, and we fail on the first bad row with its line
number — silently skipping rows loses money.
"""

from __future__ import annotations

import csv
import io
from pathlib import Path

from .errors import CsvError, LedgerError
from .models import Transaction, new_id, parse_day
from .money import parse_amount

#: Columns the importer requires, in no particular order.
REQUIRED_COLUMNS = ("date", "amount", "merchant")

#: Columns that may be present; missing ones default to an empty string.
OPTIONAL_COLUMNS = ("category", "note")


def parse_rows(text: str) -> list[Transaction]:
    """Parse CSV text into transactions. Header names are case-insensitive."""
    reader = csv.reader(io.StringIO(text))
    try:
        header_row = next(reader)
    except StopIteration as exc:
        raise CsvError("the CSV file is empty") from exc

    headers = [cell.strip().lower() for cell in header_row]
    missing = [column for column in REQUIRED_COLUMNS if column not in headers]
    if missing:
        raise CsvError(f"missing column(s): {', '.join(missing)}")
    duplicates = {header for header in headers if headers.count(header) > 1}
    if duplicates:
        raise CsvError(f"duplicate column(s): {', '.join(sorted(duplicates))}")

    transactions: list[Transaction] = []
    for number, cells in enumerate(reader, start=2):
        if not any(cell.strip() for cell in cells):
            continue
        if len(cells) != len(headers):
            raise CsvError(f"line {number}: expected {len(headers)} columns, got {len(cells)}")
        row = dict(zip(headers, cells, strict=True))
        transactions.append(_transaction_from_row(row, number))
    return transactions


def read_transactions(path: Path) -> list[Transaction]:
    """Read and parse a CSV file from disk."""
    try:
        text = path.read_text(encoding="utf-8-sig")
    except FileNotFoundError as exc:
        raise CsvError(f"no such file: {path}") from exc
    except OSError as exc:
        raise CsvError(f"cannot read {path}: {exc}") from exc
    return parse_rows(text)


def _transaction_from_row(row: dict[str, str], number: int) -> Transaction:
    try:
        return Transaction(
            id=new_id(),
            day=parse_day(row["date"]),
            amount_cents=parse_amount(row["amount"]),
            merchant=row["merchant"],
            category=row.get("category", ""),
            note=row.get("note", ""),
        )
    except LedgerError as exc:
        raise CsvError(f"line {number}: {exc}") from exc


__all__ = ["OPTIONAL_COLUMNS", "REQUIRED_COLUMNS", "parse_rows", "read_transactions"]
