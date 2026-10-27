"""``py-ledger import`` — load transactions from a bank CSV export."""

from __future__ import annotations

import argparse
from pathlib import Path

from ..csvio import read_transactions
from ..models import normalize_category
from ..storage import Ledger
from . import Command


def _configure(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("path", help="CSV file to import")
    parser.add_argument(
        "--category",
        "-c",
        default="",
        help="category for rows that do not name one",
    )
    parser.add_argument("--dry-run", action="store_true", help="validate without writing")


def _run(args: argparse.Namespace, ledger: Ledger) -> int:
    imported = read_transactions(Path(args.path))
    if args.category:
        fallback = normalize_category(args.category)
        imported = [
            transaction if transaction.category else transaction.with_changes(category=fallback)
            for transaction in imported
        ]

    if args.dry_run:
        print(f"would import {len(imported)} transaction(s) from {args.path}")
        return 0

    ledger.save_all([*ledger.load(), *imported])
    print(f"imported {len(imported)} transaction(s) from {args.path}")
    return 0


COMMAND = Command(
    name="import",
    summary="Import a CSV export",
    configure=_configure,
    run=_run,
)
