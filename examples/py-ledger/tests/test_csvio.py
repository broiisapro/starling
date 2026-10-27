"""CSV import: quoting, column handling and readable row errors."""

from __future__ import annotations

from pathlib import Path

import pytest

from py_ledger.csvio import parse_rows, read_transactions
from py_ledger.errors import CsvError

HEADER = "date,amount,merchant,category,note\n"


def test_parses_a_plain_export() -> None:
    csv_text = HEADER + "2026-03-01,-12.34,Blue Bottle,coffee,flat white\n"
    (transaction,) = parse_rows(csv_text)
    assert transaction.day.isoformat() == "2026-03-01"
    assert transaction.amount_cents == -1234
    assert transaction.merchant == "Blue Bottle"
    assert transaction.category == "coffee"
    assert transaction.note == "flat white"


def test_quoted_commas_and_newlines_survive() -> None:
    csv_text = HEADER + '2026-03-01,-12.34,"Coffee, Inc.","eating-out","two\nlines"\n'
    (transaction,) = parse_rows(csv_text)
    assert transaction.merchant == "Coffee, Inc."
    assert transaction.note == "two\nlines"


def test_quoted_quotes_are_unescaped() -> None:
    csv_text = HEADER + '2026-03-01,-1.00,"The ""Best"" Cafe",coffee,\n'
    (transaction,) = parse_rows(csv_text)
    assert transaction.merchant == 'The "Best" Cafe'


def test_headers_are_case_insensitive_and_optional_columns_may_be_missing() -> None:
    csv_text = "Date,Amount,Merchant\n2026-03-01,-12.34,Blue Bottle\n"
    (transaction,) = parse_rows(csv_text)
    assert transaction.category == ""
    assert transaction.note == ""


def test_money_formats_from_a_bank_export() -> None:
    csv_text = HEADER + '2026-03-01,"$1,234.56",Employer,salary,\n2026-03-02,(12.34),Cafe,coffee,\n'
    income, expense = parse_rows(csv_text)
    assert income.amount_cents == 123456
    assert expense.amount_cents == -1234


def test_blank_lines_are_skipped() -> None:
    csv_text = HEADER + "\n2026-03-01,-12.34,Blue Bottle,,\n\n"
    assert len(parse_rows(csv_text)) == 1


def test_empty_file_is_rejected() -> None:
    with pytest.raises(CsvError, match="empty"):
        parse_rows("")


def test_missing_column_is_named() -> None:
    with pytest.raises(CsvError, match="missing column"):
        parse_rows("date,merchant\n2026-03-01,Blue Bottle\n")


def test_duplicate_column_is_rejected() -> None:
    with pytest.raises(CsvError, match="duplicate column"):
        parse_rows("date,date,amount,merchant\n2026-03-01,2026-03-01,-1,x\n")


def test_short_row_is_rejected_with_its_line() -> None:
    with pytest.raises(CsvError, match="line 2"):
        parse_rows(HEADER + "2026-03-01,-12.34\n")


def test_bad_amount_is_reported_with_its_line() -> None:
    with pytest.raises(CsvError, match=r"line 3: not an amount"):
        parse_rows(HEADER + "2026-03-01,-1.00,ok,,\n2026-03-02,lots,Cafe,,\n")


def test_bad_date_is_reported_with_its_line() -> None:
    with pytest.raises(CsvError, match=r"line 2: dates must look like"):
        parse_rows(HEADER + "01/03/2026,-1.00,Cafe,,\n")


def test_missing_merchant_is_reported_with_its_line() -> None:
    with pytest.raises(CsvError, match=r"line 2: a transaction needs a merchant"):
        parse_rows(HEADER + "2026-03-01,-1.00, ,,\n")


def test_read_transactions_handles_a_utf8_bom(tmp_path: Path) -> None:
    path = tmp_path / "export.csv"
    path.write_text("\ufeff" + HEADER + "2026-03-01,-12.34,Blue Bottle,,\n", encoding="utf-8")
    (transaction,) = read_transactions(path)
    assert transaction.merchant == "Blue Bottle"


def test_read_transactions_reports_a_missing_file(tmp_path: Path) -> None:
    with pytest.raises(CsvError, match="no such file"):
        read_transactions(tmp_path / "nope.csv")
