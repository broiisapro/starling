"""Plain-text table rendering.

No colour and no box drawing: the output has to survive ``| less``, a code
block in a PR comment and a diff in a test assertion.
"""

from __future__ import annotations

from collections.abc import Sequence


def format_table(
    headers: Sequence[str],
    rows: Sequence[Sequence[str]],
    *,
    right: Sequence[int] = (),
) -> str:
    """Render an aligned table. ``right`` lists column indexes to right-align."""
    columns = len(headers)
    widths = [len(header) for header in headers]
    for row in rows:
        if len(row) != columns:
            raise ValueError(f"expected {columns} cells, got {len(row)}")
        for index, cell in enumerate(row):
            widths[index] = max(widths[index], len(cell))

    def line(cells: Sequence[str]) -> str:
        padded = [
            cell.rjust(widths[index]) if index in right else cell.ljust(widths[index])
            for index, cell in enumerate(cells)
        ]
        return "  ".join(padded).rstrip()

    lines = [line(headers), "  ".join("-" * width for width in widths)]
    lines.extend(line(row) for row in rows)
    return "\n".join(lines)


__all__ = ["format_table"]
