"""py-ledger — a small personal-finance ledger you can drive from the shell.

The package is deliberately split into small modules so several people (or
several agents) can add features at the same time:

``money``       integer cents in, formatted strings out
``models``      the ``Transaction`` dataclass and input normalisation
``storage``     the JSONL ledger file
``query``       filters shared by every command
``report``      aggregations (totals, by category, by month)
``csvio``       bank-style CSV import
``formatting``  plain-text tables
``commands/``   one module per CLI command, discovered automatically
"""

__version__ = "0.1.0"

__all__ = ["__version__"]
