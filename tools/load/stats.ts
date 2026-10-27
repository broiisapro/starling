/** Tiny statistics and table helpers shared by the three load scripts. No deps, no I/O. */

export interface Summary {
  count: number;
  minMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  meanMs: number;
  totalMs: number;
}

/** Linear-interpolated percentile on an already-sorted array. */
export function percentileSorted(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0] ?? 0;
  const rank = Math.min(1, Math.max(0, fraction)) * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  const lowValue = sorted[low] ?? 0;
  const highValue = sorted[high] ?? lowValue;
  return lowValue + (highValue - lowValue) * (rank - low);
}

export function summarise(samples: readonly number[]): Summary {
  if (samples.length === 0) {
    return { count: 0, minMs: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0, maxMs: 0, meanMs: 0, totalMs: 0 };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const totalMs = sorted.reduce((sum, value) => sum + value, 0);
  return {
    count: sorted.length,
    minMs: sorted[0] ?? 0,
    p50Ms: percentileSorted(sorted, 0.5),
    p95Ms: percentileSorted(sorted, 0.95),
    p99Ms: percentileSorted(sorted, 0.99),
    maxMs: sorted[sorted.length - 1] ?? 0,
    meanMs: totalMs / sorted.length,
    totalMs,
  };
}

export function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function formatMs(value: number): string {
  if (value >= 1_000) return `${round(value / 1_000, 2)}s`;
  if (value >= 100) return `${round(value, 0)}ms`;
  if (value >= 1) return `${round(value, 1)}ms`;
  return `${round(value * 1_000, 1)}µs`;
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${round(bytes / 1024 ** 3, 2)}GB`;
  if (bytes >= 1024 ** 2) return `${round(bytes / 1024 ** 2, 1)}MB`;
  if (bytes >= 1024) return `${round(bytes / 1024, 1)}KB`;
  return `${Math.round(bytes)}B`;
}

export type Cell = string | number;

export interface TableRow {
  label: string;
  values: Cell[];
}

/** Render an aligned table: labels left, values right (numbers read better that way). */
export function renderTable(title: string, headers: string[], rows: TableRow[]): string {
  const labelWidth = Math.max('metric'.length, ...rows.map((row) => row.label.length));
  const columnWidths = headers.map((header, column) => {
    const cells = rows.map((row) => String(row.values[column] ?? ''));
    return Math.max(header.length, ...cells.map((cell) => cell.length));
  });

  const format = (label: string, values: Cell[], padLabel: boolean): string => {
    const cells = values.map((value, column) => String(value).padStart(columnWidths[column] ?? 0, ' '));
    const head = padLabel ? label.padEnd(labelWidth, ' ') : label;
    return `  ${head}  ${cells.join('  ')}`.trimEnd();
  };

  const header = format('metric', headers, true);
  const divider = '-'.repeat(header.length);
  const body = rows.map((row) => format(row.label, row.values, true));
  return [title, header, divider, ...body].join('\n');
}
