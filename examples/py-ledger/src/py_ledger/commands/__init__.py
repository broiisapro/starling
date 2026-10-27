"""One module per CLI command.

``discover()`` imports every module in this package and collects its ``COMMAND``
attribute, so adding a command means adding a file — never editing a shared
registration list. That is what lets two people add commands in parallel
without a merge conflict.

A command module looks like::

    from . import Command

    def _configure(parser): ...
    def _run(args, ledger): ...

    COMMAND = Command(name="count", summary="Count transactions", configure=_configure, run=_run)
"""

from __future__ import annotations

import argparse
import importlib
import pkgutil
from collections.abc import Callable
from dataclasses import dataclass

from ..errors import LedgerError
from ..storage import Ledger


@dataclass(frozen=True, slots=True)
class Command:
    """Everything the CLI needs to know about one subcommand."""

    name: str
    summary: str
    configure: Callable[[argparse.ArgumentParser], None]
    run: Callable[[argparse.Namespace, Ledger], int]


def discover() -> dict[str, Command]:
    """Import every command module and return them keyed by name, sorted."""
    commands: dict[str, Command] = {}
    for info in pkgutil.iter_modules(__path__):
        if info.name.startswith("_"):
            continue
        module = importlib.import_module(f"{__name__}.{info.name}")
        command = getattr(module, "COMMAND", None)
        if not isinstance(command, Command):
            raise LedgerError(f"{__name__}.{info.name} must define a COMMAND")
        if command.name in commands:
            raise LedgerError(f"two command modules both call themselves {command.name!r}")
        if not command.summary.strip():
            raise LedgerError(f"command {command.name!r} needs a summary")
        commands[command.name] = command
    return dict(sorted(commands.items()))


__all__ = ["Command", "discover"]
