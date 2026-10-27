/**
 * Number formatting for the bottom strip (cost meter + merge queue cards).
 *
 * Everything here is pure and locale-independent: the dashboard must render byte-identical strings
 * on every machine (and in tests), so no `toLocaleString`. Grouping is done by hand.
 *
 * Lives in `features/metrics/` because the metrics panel is the primary consumer; the queue board
 * imports `formatDuration` from here too. At C1 these move to `src/lib/format.ts` (Epic 23's lane).
 */

/** Insert thousands separators: 1234567.5 → "1,234,567.5". */
function groupThousands(value: string): string {
  const [whole = '', fraction] = value.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fraction === undefined ? grouped : `${grouped}.${fraction}`;
}

/**
 * USD with two decimals and a hard floor at "$<0.01" for non-zero amounts that would round to zero.
 * Negative input is clamped to zero — a cost meter never shows a refund.
 */
export function formatUsd(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '$0.00';
  if (value < 0.005) return '$<0.01';
  return `$${groupThousands(value.toFixed(2))}`;
}

/**
 * Compact token counts: 742 → "742", 1_234 → "1.2k", 103_500 → "103k", 1_234_567 → "1.23M".
 * Three-ish significant digits is what fits in a bottom-strip tooltip; exact counts go through
 * `formatTokensExact`.
 */
export function formatTokens(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0';
  const n = Math.round(value);
  if (n < 1_000) return String(n);
  if (n < 1_000_000) {
    const k = n / 1_000;
    return `${k < 10 ? k.toFixed(1).replace(/\.0$/, '') : Math.round(k)}k`;
  }
  const m = n / 1_000_000;
  return `${m < 10 ? m.toFixed(2).replace(/\.?0+$/, '') : m < 100 ? m.toFixed(1).replace(/\.0$/, '') : Math.round(m)}M`;
}

/** Exact token count with separators, for tooltips and screen readers: 103500 → "103,500". */
export function formatTokensExact(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0';
  return groupThousands(String(Math.round(value)));
}

/**
 * Human duration. 0 → "0s", 950 → "950ms", 44_000 → "44s", 356_000 → "5m 56s",
 * 3_725_000 → "1h 02m". Deliberately compact: it sits inside a 10px card footer.
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0s';
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${Math.round(ms / 1_000)}s`;

  const totalSeconds = Math.round(ms / 1_000);
  if (totalSeconds < 3_600) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds - minutes * 60;
    return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  }

  const totalMinutes = Math.round(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes - hours * 60;
  return `${hours}h ${String(minutes).padStart(2, '0')}m`;
}

/** One-decimal rate for the throughput stat ("1.8"). Guards NaN/Infinity/negatives to "0.0". */
export function formatRate(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0.0';
  return value.toFixed(1);
}

/** Short commit sha for the wire column; tolerates undefined and already-short ids. */
export function shortSha(sha: string | undefined, length = 7): string | undefined {
  if (sha === undefined) return undefined;
  const trimmed = sha.trim();
  if (trimmed === '') return undefined;
  return trimmed.slice(0, length);
}
