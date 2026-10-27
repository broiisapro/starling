/**
 * Small display formatters for the About page.
 *
 * Kept separate from the components so the numbers are testable and so every number on the page
 * goes through the same "—" empty state.
 *
 * Everything here is hand-rolled on purpose: no `Intl`, no `toLocale*`. `Intl.DateTimeFormat`
 * output depends on the ICU version baked into the runtime, so `en-GB` renders a date-time
 * connector as "at" on macOS/ICU 74 and as ", " on Linux/ICU 76 — the same page, two different
 * strings, and a test that only passes on one of them. Building the string from UTC parts keeps
 * the page (and CI) identical everywhere.
 */

export const EMPTY = '—';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** `12345` → `12,345` (comma grouping, no locale lookup). */
export function formatCount(value: number): string {
  if (!Number.isFinite(value)) return EMPTY;
  const sign = value < 0 ? '-' : '';
  const [whole = '0', fraction] = String(Math.abs(value)).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fraction === undefined ? `${sign}${grouped}` : `${sign}${grouped}.${fraction}`;
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

/** `2026-10-27T15:18:16Z` → `27 Oct at 15:18 UTC`; the project fits in one day, so no year. */
export function formatTimestamp(iso: string | undefined): string {
  if (iso === undefined) return EMPTY;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return EMPTY;
  const date = new Date(ms);
  const month = MONTHS[date.getUTCMonth()];
  if (month === undefined) return EMPTY;
  return `${pad2(date.getUTCDate())} ${month} at ${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())} UTC`;
}

/** `HH:MM` UTC, used for the timeline's x-axis ticks. */
export function formatClock(ms: number): string {
  if (!Number.isFinite(ms)) return EMPTY;
  const date = new Date(ms);
  return `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}`;
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
