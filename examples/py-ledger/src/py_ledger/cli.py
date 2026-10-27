"""Argument parsing and dispatch.

``main`` builds one subparser per discovered command, resolves the ledger file
and hands ``(args, ledger)`` to the command. Every expected failure becomes a
one-line message on stderr and exit code 1.
"""

from __future__ import annotations

import argparse
import sys
from collections.abc import Sequence
from pathlib import Path

from . import __version__
from .commands import Command, discover
from .errors import LedgerError
from .storage import ENV_PATH, Ledger, default_path

PROG = "py-ledger"


def build_parser(commands: dict[str, Command]) -> argparse.ArgumentParser:
    """The full CLI parser: global options plus one subparser per command."""
    parser = argparse.ArgumentParser(
        prog=PROG,
        description="A tiny personal-finance ledger: add, list, report and import.",
    )
    parser.add_argument(
        "--file",
        "-f",
        default=None,
        help=f"ledger file (default: ${ENV_PATH}, else ~/.py-ledger/ledger.jsonl)",
    )
    parser.add_argument("--version", action="version", version=f"{PROG} {__version__}")

    subparsers = parser.add_subparsers(dest="command", metavar="<command>")
    for command in commands.values():
        subparser = subparsers.add_parser(
            command.name, help=command.summary, description=command.summary
        )
        command.configure(subparser)
        subparser.set_defaults(handler=command.run)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    """Run the CLI. Returns the process exit code."""
    parser = build_parser(discover())
    args = parser.parse_args(argv)

    handler = getattr(args, "handler", None)
    if handler is None:
        parser.print_help()
        return 0

    ledger = Ledger(Path(args.file).expanduser() if args.file else default_path())
    try:
        return int(handler(args, ledger))
    except LedgerError as exc:
        print(f"{PROG}: {exc}", file=sys.stderr)
        return 1
    except BrokenPipeError:  # pragma: no cover - only when piped into `head`
        return 1


__all__ = ["PROG", "build_parser", "main"]
