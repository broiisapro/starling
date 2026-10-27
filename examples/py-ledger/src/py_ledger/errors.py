"""Error types the CLI knows how to explain to a human.

Every failure we expect from user input or a broken file is a ``LedgerError``;
``py_ledger.cli`` prints its message on stderr and exits with status 1. Anything
else is a real crash and keeps its traceback, which is what we want while
developing.
"""

from __future__ import annotations


class LedgerError(Exception):
    """Base class for expected, explainable failures."""


class MoneyError(LedgerError):
    """An amount could not be parsed."""


class ModelError(LedgerError):
    """A transaction is missing a required field or has the wrong type."""


class StorageError(LedgerError):
    """The ledger file could not be read or written."""


class CsvError(LedgerError):
    """An imported CSV file has the wrong shape or a bad row."""


class QueryError(LedgerError):
    """A filter argument (month, date) is malformed."""


class ReportError(LedgerError):
    """A report grouping or aggregation argument is unknown."""


__all__ = [
    "CsvError",
    "LedgerError",
    "ModelError",
    "MoneyError",
    "QueryError",
    "ReportError",
    "StorageError",
]
