"""The ledger file: JSON Lines, one transaction per line.

JSONL was chosen over SQLite because the demo needs a file that is easy to
diff, easy to hand-edit and easy to throw away. Appends are a single ``write``;
rewrites go through a temp file so a crash cannot truncate the ledger.
"""

from __future__ import annotations

import json
import os
import tempfile
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

from .errors import LedgerError, StorageError
from .models import Transaction

#: Environment variable that points at a ledger file, handy for scripts.
ENV_PATH = "PY_LEDGER_FILE"


def default_path() -> Path:
    """``$PY_LEDGER_FILE`` when set, otherwise ``~/.py-ledger/ledger.jsonl``."""
    override = os.environ.get(ENV_PATH)
    if override:
        return Path(override).expanduser()
    return Path.home() / ".py-ledger" / "ledger.jsonl"


@dataclass(slots=True)
class Ledger:
    """A ledger file, loaded on demand. No implicit caching, so edits show up."""

    path: Path

    def load(self) -> list[Transaction]:
        """Every stored transaction, in file order. A missing file is an empty ledger."""
        try:
            text = self.path.read_text(encoding="utf-8")
        except FileNotFoundError:
            return []
        except OSError as exc:
            raise StorageError(f"cannot read {self.path}: {exc}") from exc

        transactions: list[Transaction] = []
        for number, line in enumerate(text.splitlines(), start=1):
            if not line.strip():
                continue
            try:
                payload = json.loads(line)
            except json.JSONDecodeError as exc:
                raise StorageError(f"{self.path}:{number}: not valid JSON ({exc.msg})") from exc
            try:
                transactions.append(Transaction.from_dict(payload))
            except LedgerError as exc:
                raise StorageError(f"{self.path}:{number}: {exc}") from exc
        return transactions

    def append(self, transaction: Transaction) -> None:
        """Add one transaction without rewriting the file."""
        self._ensure_parent()
        line = json.dumps(transaction.to_dict(), ensure_ascii=False)
        try:
            with self.path.open("a", encoding="utf-8") as handle:
                handle.write(line + "\n")
        except OSError as exc:
            raise StorageError(f"cannot write {self.path}: {exc}") from exc

    def save_all(self, transactions: Iterable[Transaction]) -> None:
        """Replace the file atomically with the given transactions."""
        rows = list(transactions)
        self._ensure_parent()
        temp: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(
                "w",
                encoding="utf-8",
                dir=self.path.parent,
                prefix=".ledger-",
                suffix=".tmp",
                delete=False,
            ) as handle:
                temp = Path(handle.name)
                for row in rows:
                    handle.write(json.dumps(row.to_dict(), ensure_ascii=False) + "\n")
                handle.flush()
                os.fsync(handle.fileno())
            temp.replace(self.path)
        except OSError as exc:
            if temp is not None:
                temp.unlink(missing_ok=True)
            raise StorageError(f"cannot write {self.path}: {exc}") from exc

    def _ensure_parent(self) -> None:
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            raise StorageError(f"cannot create {self.path.parent}: {exc}") from exc


__all__ = ["ENV_PATH", "Ledger", "default_path"]
