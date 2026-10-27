"""``py-ledger add`` — record one transaction."""

from __future__ import annotations

import argparse

from ..models import Transaction, new_id, parse_day
from ..money import format_money, parse_amount
from ..storage import Ledger
from . import Command


def _configure(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--amount", "-a", required=True, help="signed amount, e.g. -12.50")
    parser.add_argument("--merchant", "-m", required=True, help="who was paid, e.g. 'Blue Bottle'")
    parser.add_argument("--category", "-c", default="", help="category slug, e.g. groceries")
    parser.add_argument("--date", "-d", default=None, help="YYYY-MM-DD (default: today)")
    parser.add_argument("--note", "-n", default="", help="free-form note")


def _run(args: argparse.Namespace, ledger: Ledger) -> int:
    transaction = Transaction(
        id=new_id(),
        day=parse_day(args.date),
        amount_cents=parse_amount(args.amount),
        merchant=args.merchant,
        category=args.category,
        note=args.note,
    )
    ledger.append(transaction)
    print(
        f"added {transaction.id}: {transaction.day.isoformat()} "
        f"{format_money(transaction.amount_cents)} {transaction.merchant}"
    )
    return 0


COMMAND = Command(name="add", summary="Record a transaction", configure=_configure, run=_run)
