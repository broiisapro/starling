"""End-to-end CLI behaviour: exit codes, stdout and the file on disk."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from py_ledger.cli import main
from py_ledger.storage import Ledger

CSV_TEXT = (
    "date,amount,merchant,category\n"
    "2026-03-01,-12.34,Blue Bottle,coffee\n"
    "2026-03-02,2500.00,Employer,\n"
)


def run(capsys: pytest.CaptureFixture[str], *argv: str) -> tuple[int, str, str]:
    code = main(list(argv))
    captured = capsys.readouterr()
    return code, captured.out, captured.err


def test_add_writes_a_transaction(capsys: pytest.CaptureFixture[str], ledger_file: Path) -> None:
    code, out, err = run(
        capsys,
        "--file",
        str(ledger_file),
        "add",
        "--amount",
        "-12.34",
        "--merchant",
        "Blue Bottle",
        "--category",
        "Coffee",
        "--date",
        "2026-03-01",
    )
    assert (code, err) == (0, "")
    assert out.startswith("added txn_")
    (transaction,) = Ledger(ledger_file).load()
    assert transaction.amount_cents == -1234
    assert transaction.category == "coffee"


def test_list_renders_a_table(capsys: pytest.CaptureFixture[str], ledger_file: Path) -> None:
    run(
        capsys,
        "--file",
        str(ledger_file),
        "add",
        "-a",
        "-12.34",
        "-m",
        "Blue Bottle",
        "-d",
        "2026-03-01",
    )
    code, out, _ = run(capsys, "--file", str(ledger_file), "list")
    assert code == 0
    assert "Blue Bottle" in out
    assert "-$12.34" in out
    assert "1 transaction(s), net -$12.34" in out


def test_list_json_is_machine_readable(
    capsys: pytest.CaptureFixture[str], ledger_file: Path
) -> None:
    run(capsys, "--file", str(ledger_file), "add", "-a", "5.00", "-m", "Refund", "-d", "2026-03-01")
    code, out, _ = run(capsys, "--file", str(ledger_file), "list", "--json")
    assert code == 0
    rows = json.loads(out)
    assert rows[0]["amount_cents"] == 500
    assert rows[0]["merchant"] == "Refund"


def test_list_with_no_transactions_says_so(
    capsys: pytest.CaptureFixture[str], ledger_file: Path
) -> None:
    code, out, _ = run(capsys, "--file", str(ledger_file), "list")
    assert code == 0
    assert "no transactions" in out


def test_list_filters_by_category(capsys: pytest.CaptureFixture[str], ledger_file: Path) -> None:
    run(capsys, "--file", str(ledger_file), "add", "-a", "-1.00", "-m", "Cafe", "-c", "coffee")
    run(capsys, "--file", str(ledger_file), "add", "-a", "-900.00", "-m", "Landlord", "-c", "rent")
    code, out, _ = run(capsys, "--file", str(ledger_file), "list", "--category", "coffee")
    assert code == 0
    assert "Cafe" in out
    assert "Landlord" not in out


def test_report_groups_by_category(capsys: pytest.CaptureFixture[str], ledger_file: Path) -> None:
    run(capsys, "--file", str(ledger_file), "add", "-a", "-1.00", "-m", "Cafe", "-c", "coffee")
    code, out, _ = run(capsys, "--file", str(ledger_file), "report")
    assert code == 0
    assert "coffee" in out
    assert "spend $1.00" in out


def test_report_can_group_by_month(capsys: pytest.CaptureFixture[str], ledger_file: Path) -> None:
    run(capsys, "--file", str(ledger_file), "add", "-a", "-1.00", "-m", "Cafe", "-d", "2026-01-02")
    code, out, _ = run(capsys, "--file", str(ledger_file), "report", "--by", "month")
    assert code == 0
    assert "month" in out
    assert "$1.00" in out


def test_report_json_shape(capsys: pytest.CaptureFixture[str], ledger_file: Path) -> None:
    run(capsys, "--file", str(ledger_file), "add", "-a", "-1.00", "-m", "Cafe", "-c", "coffee")
    code, out, _ = run(capsys, "--file", str(ledger_file), "report", "--json")
    assert code == 0
    payload = json.loads(out)
    assert payload["groupBy"] == "category"
    assert payload["rows"][0]["key"] == "coffee"


def test_import_adds_every_row(
    capsys: pytest.CaptureFixture[str], ledger_file: Path, tmp_path: Path
) -> None:
    source = tmp_path / "export.csv"
    source.write_text(CSV_TEXT, encoding="utf-8")
    code, out, _ = run(capsys, "--file", str(ledger_file), "import", str(source))
    assert code == 0
    assert "imported 2 transaction(s)" in out
    assert len(Ledger(ledger_file).load()) == 2


def test_import_default_category(
    capsys: pytest.CaptureFixture[str], ledger_file: Path, tmp_path: Path
) -> None:
    source = tmp_path / "export.csv"
    source.write_text("date,amount,merchant\n2026-03-02,2500.00,Employer\n", encoding="utf-8")
    run(capsys, "--file", str(ledger_file), "import", str(source), "--category", "Salary")
    assert Ledger(ledger_file).load()[0].category == "salary"


def test_import_dry_run_writes_nothing(
    capsys: pytest.CaptureFixture[str], ledger_file: Path, tmp_path: Path
) -> None:
    source = tmp_path / "export.csv"
    source.write_text(CSV_TEXT, encoding="utf-8")
    code, out, _ = run(capsys, "--file", str(ledger_file), "import", str(source), "--dry-run")
    assert code == 0
    assert "would import 2 transaction(s)" in out
    assert not ledger_file.exists()


def test_env_var_selects_the_ledger(
    capsys: pytest.CaptureFixture[str], ledger_file: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("PY_LEDGER_FILE", str(ledger_file))
    run(capsys, "add", "-a", "-1.00", "-m", "Cafe", "-d", "2026-03-01")
    code, out, _ = run(capsys, "list")
    assert code == 0
    assert "Cafe" in out


def test_a_bad_amount_is_a_friendly_error(
    capsys: pytest.CaptureFixture[str], ledger_file: Path
) -> None:
    code, out, err = run(capsys, "--file", str(ledger_file), "add", "-a", "lots", "-m", "Cafe")
    assert code == 1
    assert out == ""
    assert err.startswith("py-ledger: not an amount")


def test_a_bad_filter_is_a_friendly_error(
    capsys: pytest.CaptureFixture[str], ledger_file: Path
) -> None:
    code, _, err = run(capsys, "--file", str(ledger_file), "list", "--month", "October")
    assert code == 1
    assert "months must look like YYYY-MM" in err


def test_an_unknown_command_prints_usage(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as exit_info:
        main(["nope"])
    assert exit_info.value.code == 2
    assert "invalid choice" in capsys.readouterr().err


def test_no_arguments_prints_help(capsys: pytest.CaptureFixture[str]) -> None:
    code = main([])
    out = capsys.readouterr().out
    assert code == 0
    assert "usage: py-ledger" in out
    assert "add" in out


def test_version_flag(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as exit_info:
        main(["--version"])
    assert exit_info.value.code == 0
    assert capsys.readouterr().out.strip().startswith("py-ledger ")
