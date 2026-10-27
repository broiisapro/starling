"""Reading and writing the JSONL ledger file."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

import pytest

from py_ledger.errors import StorageError
from py_ledger.models import Transaction
from py_ledger.storage import Ledger, default_path


def test_a_missing_file_is_an_empty_ledger(ledger: Ledger) -> None:
    assert ledger.load() == []


def test_append_then_load_round_trips(
    ledger: Ledger, make_transaction: Callable[..., Transaction]
) -> None:
    transaction = make_transaction(-1234, day="2026-03-01", note="flat white")
    ledger.append(transaction)
    assert ledger.load() == [transaction]


def test_append_keeps_existing_rows_and_order(
    ledger: Ledger, make_transaction: Callable[..., Transaction]
) -> None:
    first = make_transaction(-100, day="2026-03-01")
    second = make_transaction(-200, day="2026-03-02")
    ledger.append(first)
    ledger.append(second)
    assert ledger.load() == [first, second]


def test_append_creates_missing_directories(
    tmp_path: Path, make_transaction: Callable[..., Transaction]
) -> None:
    ledger = Ledger(tmp_path / "nested" / "deeper" / "ledger.jsonl")
    ledger.append(make_transaction(-100))
    assert len(ledger.load()) == 1


def test_non_ascii_merchants_survive_a_round_trip(
    ledger: Ledger, make_transaction: Callable[..., Transaction]
) -> None:
    transaction = make_transaction(-400, merchant="Café Nöel")
    ledger.append(transaction)
    assert ledger.load()[0].merchant == "Café Nöel"


def test_blank_lines_are_ignored(
    ledger_file: Path, make_transaction: Callable[..., Transaction]
) -> None:
    ledger_file.write_text("\n\n", encoding="utf-8")
    Ledger(ledger_file).append(make_transaction(-100))
    ledger_file.write_text(ledger_file.read_text(encoding="utf-8") + "\n\n", encoding="utf-8")
    assert len(Ledger(ledger_file).load()) == 1


def test_malformed_json_names_the_line(ledger_file: Path) -> None:
    ledger_file.write_text(
        '{"id": "txn_1", "date": "2026-01-01", "amount_cents": 1, "merchant": "x"}\nnot json\n',
        encoding="utf-8",
    )
    with pytest.raises(StorageError, match=r"ledger\.jsonl:2: not valid JSON"):
        Ledger(ledger_file).load()


def test_invalid_rows_name_the_line(ledger_file: Path) -> None:
    ledger_file.write_text('{"id": "txn_1", "date": "2026-01-01"}\n', encoding="utf-8")
    with pytest.raises(StorageError, match=r"ledger\.jsonl:1: amount_cents"):
        Ledger(ledger_file).load()


def test_save_all_replaces_the_file(
    ledger: Ledger, make_transaction: Callable[..., Transaction]
) -> None:
    ledger.append(make_transaction(-100))
    replacement = [make_transaction(-500, day="2026-04-01")]
    ledger.save_all(replacement)
    assert ledger.load() == replacement


def test_save_all_with_no_rows_empties_the_file(
    ledger: Ledger, make_transaction: Callable[..., Transaction]
) -> None:
    ledger.append(make_transaction(-100))
    ledger.save_all([])
    assert ledger.load() == []


def test_save_all_writes_one_line_per_transaction(
    ledger: Ledger, ledger_file: Path, make_transaction: Callable[..., Transaction]
) -> None:
    ledger.save_all([make_transaction(-100), make_transaction(-200)])
    assert len(ledger_file.read_text(encoding="utf-8").splitlines()) == 2


def test_unreadable_file_is_reported(ledger_file: Path) -> None:
    ledger_file.mkdir()
    with pytest.raises(StorageError, match="cannot read"):
        Ledger(ledger_file).load()


def test_default_path_follows_the_environment(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("PY_LEDGER_FILE", str(tmp_path / "books.jsonl"))
    assert default_path() == tmp_path / "books.jsonl"


def test_default_path_falls_back_to_home(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("PY_LEDGER_FILE", raising=False)
    assert default_path() == Path.home() / ".py-ledger" / "ledger.jsonl"
