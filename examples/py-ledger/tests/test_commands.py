"""Command discovery: adding a command is adding a file, never editing a list."""

from __future__ import annotations

import argparse

from py_ledger.cli import build_parser
from py_ledger.commands import Command, discover

BUILTINS = {"add", "list", "report", "import"}


def test_every_builtin_command_is_discovered() -> None:
    assert set(discover()) >= BUILTINS


def test_commands_are_sorted_and_well_formed() -> None:
    commands = discover()
    assert list(commands) == sorted(commands)
    for name, command in commands.items():
        assert isinstance(command, Command)
        assert command.name == name
        assert command.summary.strip()
        assert callable(command.configure)
        assert callable(command.run)


def test_names_are_kebab_case() -> None:
    for name in discover():
        assert name == name.lower()
        assert " " not in name
        assert "_" not in name


def test_builtin_summaries_read_like_help_text() -> None:
    commands = discover()
    assert commands["add"].summary == "Record a transaction"
    assert commands["import"].summary == "Import a CSV export"


def test_the_parser_exposes_every_command() -> None:
    parser = build_parser(discover())
    subparsers = next(
        action for action in parser._actions if isinstance(action, argparse._SubParsersAction)
    )
    assert set(subparsers.choices) == set(discover())
