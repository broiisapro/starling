"""``py-ledger report`` — totals by category, by month, or for everything."""

from __future__ import annotations

import argparse
import json

from ..formatting import format_table
from ..money import format_money
from ..query import filtered
from ..report import GROUPINGS, report_rows, summarize, totals
from ..storage import Ledger
from . import Command


def _configure(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--by", choices=GROUPINGS, default="category", help="how to group")
    parser.add_argument("--month", default=None, help="only this month (YYYY-MM)")
    parser.add_argument("--json", action="store_true", help="print JSON instead of tables")


def _run(args: argparse.Namespace, ledger: Ledger) -> int:
    transactions = ledger.load()
    if args.month:
        transactions = filtered(transactions, month=args.month)

    groups = summarize(transactions, args.by)
    total = totals(transactions)

    if args.json:
        print(
            json.dumps(
                {"groupBy": args.by, "rows": [group.to_dict() for group in groups]},
                indent=2,
            )
        )
        return 0

    if not groups:
        print("no transactions")
        return 0

    heading = {"category": "category", "month": "month", "none": "group"}[args.by]
    rows = report_rows(groups, args.by)
    print(format_table([heading, "count", "income", "spend", "net"], rows, right=(1, 2, 3, 4)))
    print(
        f"\n{total.count} transaction(s), income {format_money(total.income_cents)}, "
        f"spend {format_money(total.expense_cents)}, net {format_money(total.net_cents)}"
    )
    return 0


COMMAND = Command(
    name="report", summary="Totals by category or month", configure=_configure, run=_run
)
