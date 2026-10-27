"""``py-ledger list`` — show the transactions that match a few filters."""

from __future__ import annotations

import argparse
import json

from ..formatting import format_table
from ..money import format_money
from ..query import filtered
from ..report import totals
from ..storage import Ledger
from . import Command


def _configure(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--category", "-c", default=None, help="only this category")
    parser.add_argument("--month", default=None, help="only this month (YYYY-MM)")
    parser.add_argument("--since", default=None, help="on or after this day (YYYY-MM-DD)")
    parser.add_argument("--until", default=None, help="on or before this day (YYYY-MM-DD)")
    parser.add_argument("--json", action="store_true", help="print JSON instead of a table")


def _run(args: argparse.Namespace, ledger: Ledger) -> int:
    transactions = filtered(
        ledger.load(),
        category=args.category,
        month=args.month,
        since=args.since,
        until=args.until,
    )
    transactions.sort(key=lambda transaction: (transaction.day, transaction.id), reverse=True)

    if args.json:
        print(json.dumps([transaction.to_dict() for transaction in transactions], indent=2))
        return 0

    if not transactions:
        print("no transactions")
        return 0

    rows = [
        [
            transaction.day.isoformat(),
            format_money(transaction.amount_cents),
            transaction.merchant,
            transaction.category or "-",
        ]
        for transaction in transactions
    ]
    print(format_table(["date", "amount", "merchant", "category"], rows, right=(1,)))
    print(
        f"\n{len(transactions)} transaction(s), net {format_money(totals(transactions).net_cents)}"
    )
    return 0


COMMAND = Command(name="list", summary="List transactions", configure=_configure, run=_run)
