/**
 * Small display formatters for the About page.
 *
 * Kept separate from the components so the numbers are testable and so every number on the page
 * goes through the same "—" empty state. Locale is pinned to `en-US` so the page reads the same on
 * every demo laptop (the rest of the dashboard does not localise either).
 */

const COUNT = new Intl.NumberFormat('en-US');

export const EMPTY = '—';

/** `12345` → `12,345`. */
export function formatCount(value: number): string {
  return Number.isFinite(value) ? COUNT.format(value) : EMPTY;
}

/** `+12,345` / `−678` (typographic minus, matching the handbacks). */
export function formatSigned(value: number): string {
  if (!Number.isFinite(value)) return EMPTY;
  return value < 0 ? `−${formatCount(Math.abs(value))}` : `+${formatCount(value)}`;
}

/** `45 * 60_000` → `45m`, `141 * 60_000` → `2h 21m`, unknown → `—`. */
export function formatDuration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return EMPTY;
  const totalMinutes = Math.round(ms / 60_000);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

/** Wall-clock hours with one decimal: `16_024_000` → `4.5h`. */
export function formatHours(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms <= 0) return EMPTY;
  const hours = ms / 3_600_000;
  return `${hours >= 10 ? Math.round(hours) : Math.round(hours * 10) / 10}h`;
}

const TIME = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'UTC',
});

/** `2026-10-27T15:18:16Z` → `27 Oct, 15:18 UTC`; the project fits in one day, so no year. */
export function formatTimestamp(iso: string | undefined): string {
  if (iso === undefined) return EMPTY;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return EMPTY;
  return `${TIME.format(ms)} UTC`;
}

const CLOCK = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'UTC',
});

/** `HH:MM` UTC, used for the timeline's x-axis ticks. */
export function formatClock(ms: number): string {
  return Number.isFinite(ms) ? CLOCK.format(ms) : EMPTY;
}

/** Handback status → short human label; in-flight epics are "pending", not "missing". */
export function handbackLabel(status: string, inFlight: boolean): string {
  if (inFlight && (status === 'missing' || status === 'unavailable')) return 'pending';
  switch (status) {
    case 'complete':
      return 'complete';
    case 'partial':
      return 'partial';
    case 'missing':
      return 'missing';
    case 'unavailable':
      return 'no source';
    default:
      return 'unknown';
  }
}
