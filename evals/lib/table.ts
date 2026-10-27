/** Minimal fixed-width table for the CLI report. No dependency, no colour, stable in CI logs. */
export function formatTable(headers: string[], rows: string[][]): string {
  const all = [headers, ...rows];
  const widths = headers.map((_, column) => Math.max(...all.map((row) => (row[column] ?? '').length)));
  return all
    .map((row) =>
      row
        .map((cell, column) => {
          const width = widths[column] ?? 0;
          // First column is a label: left-align. Everything else reads better right-aligned.
          return column === 0 ? cell.padEnd(width) : cell.padStart(width);
        })
        .join('  ')
        .trimEnd(),
    )
    .join('\n');
}
