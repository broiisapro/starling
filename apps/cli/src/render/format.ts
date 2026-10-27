/** Pure formatting helpers shared by every renderer: ANSI-aware padding, durations, money, tables. */

// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI escapes is the point.
const ANSI = /\x1b\[[0-9;]*m/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI, '');
}

export function visibleLength(text: string): number {
  return stripAnsi(text).length;
}

/** Pad to `width` visible columns (colours in `text` do not count). Never truncates. */
export function padEndVisible(text: string, width: number): string {
  return text + ' '.repeat(Math.max(0, width - visibleLength(text)));
}

export function padStartVisible(text: string, width: number): string {
  return ' '.repeat(Math.max(0, width - visibleLength(text))) + text;
}

/** Truncate to `max` visible columns, appending an ellipsis when anything was cut. */
export function truncate(text: string, max: number, ellipsis = '…'): string {
  if (visibleLength(text) <= max) return text;
  if (max <= ellipsis.length) return ellipsis.slice(0, Math.max(0, max));
  return `${stripAnsi(text).slice(0, max - ellipsis.length)}${ellipsis}`;
}

/** `0.4s`, `1.2s`, `1:42`, `1:02:03` — compact and stable for snapshots. */
export function fmtDuration(ms: number): string {
  const clamped = Math.max(0, ms);
  if (clamped < 10_000) return `${(clamped / 1000).toFixed(1)}s`;
  const total = Math.max(0, Math.round(clamped / 1000));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** `$0.000`, `$0.042`, `$1.20` — more decimals for the small numbers the cost meter produces. */
export function fmtUsd(amount: number): string {
  if (!Number.isFinite(amount)) return '$0.000';
  if (amount === 0) return '$0.000';
  if (Math.abs(amount) >= 1) return `$${amount.toFixed(2)}`;
  return `$${amount.toFixed(3)}`;
}

/** `900`, `12.4k`, `1.2M`. */
export function fmtTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return String(tokens);
}

function fmtPercent(part: number, total: number): string {
  if (total <= 0) return '0%';
  return `${Math.round((part / total) * 100)}%`;
}

/** A fixed-width text progress bar, e.g. `██████░░░░ 60%`. */
export function progressBar(done: number, total: number, width = 16): string {
  if (total <= 0) return `${'░'.repeat(width)} 0%`;
  const filled = Math.max(0, Math.min(width, Math.round((done / total) * width)));
  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)} ${fmtPercent(done, total)}`;
}

/** ISO-ish UTC timestamp for the status view; timezone-stable, so snapshots do not depend on locale. */
export function fmtTimestamp(ts: number): string {
  return `${new Date(ts).toISOString().slice(0, 19).replace('T', ' ')}Z`;
}

export interface TableOptions {
  /** Per-column alignment; defaults to left. */
  align?: Array<'left' | 'right'>;
  /** Column separator, default two spaces. */
  gap?: number;
}

/**
 * Render a plain text table with ANSI-aware widths.
 *
 * The last column is never padded, which keeps `diff`-friendly output free of trailing spaces.
 */
export function renderTable(headers: string[], rows: string[][], options: TableOptions = {}): string {
  const gap = ' '.repeat(options.gap ?? 2);
  const columns = headers.length;
  const widths = headers.map((header) => visibleLength(header));

  for (const row of rows) {
    for (let i = 0; i < columns; i += 1) {
      widths[i] = Math.max(widths[i] ?? 0, visibleLength(row[i] ?? ''));
    }
  }

  const line = (cells: string[]): string =>
    cells
      .map((cell, index) => {
        if (index === columns - 1) return cell;
        const padded =
          options.align?.[index] === 'right'
            ? padStartVisible(cell, widths[index] ?? 0)
            : padEndVisible(cell, widths[index] ?? 0);
        return padded;
      })
      .join(gap)
      .replace(/\s+$/, '');

  return [line(headers), ...rows.map(line)].join('\n');
}

/** Remove trailing spaces from every line — renderers concatenate tables and blocks. */
export function trimLines(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .join('\n');
}
