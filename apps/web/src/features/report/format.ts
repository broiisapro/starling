import type { TokenUsage } from '@starling/core/browser';
import { formatDuration, formatUsd, percent } from '../../lib/format';
import type { FlightOutcome, FlightReport } from './types';

/** The hero's one-line verdict, per outcome. The page never shows a bare status enum. */
export const OUTCOME_COPY: Record<
  FlightOutcome,
  { headline: string; line: string; tone: 'success' | 'warn' | 'danger' | 'accent' | 'neutral' }
> = {
  landed: {
    headline: 'Landed.',
    line: 'Every task merged into the integration branch.',
    tone: 'success',
  },
  partial: {
    headline: 'Mostly landed.',
    line: 'Some of the flock made it home; the rest are in the report below.',
    tone: 'warn',
  },
  failed: {
    headline: 'The flock did not land.',
    line: 'Nothing merged. The story below shows where it went wrong.',
    tone: 'danger',
  },
  'in-flight': {
    headline: 'Still flying.',
    line: 'The report is a live snapshot and keeps updating as the flock works.',
    tone: 'accent',
  },
  cancelled: {
    headline: 'Flight cancelled.',
    line: 'The run was stopped before the flock finished.',
    tone: 'neutral',
  },
};

/** `T+5:56` — minutes and seconds since the run started, for the story rail. */
export function beatClock(atMs: number): string {
  const safe = Number.isFinite(atMs) && atMs > 0 ? atMs : 0;
  const totalSeconds = Math.floor(safe / 1000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `T+${hours}:${mm}:${ss}` : `T+${minutes}:${ss}`;
}

/**
 * A token total is `input + output`. `cached` is a *subset* of `input` (ARCHITECTURE §6), so adding
 * it would double-count — `lib/format`'s `totalTokens()` is the wrong helper here.
 */
export function tokenTotal(usage: TokenUsage): number {
  return usage.input + usage.output;
}

/** "7/7 tasks landed" — the number the projector shot is built around. */
export function tasksLabel(report: FlightReport): string {
  return `${report.tasks.merged}/${report.tasks.total} tasks landed`;
}

/** "1.44× faster than one agent" or an honest "1.00× — no speed-up yet". */
export function speedupLabel(report: FlightReport): string {
  if (report.tasks.inFlight > 0 && report.tasks.merged === 0) return 'not enough data yet';
  if (!Number.isFinite(report.speedup) || report.speedup <= 0) return 'no estimate yet';
  if (report.speedup < 1.05) return `${report.speedup.toFixed(2)}× — no speed-up`;
  return `${report.speedup.toFixed(2)}× faster than one agent`;
}

/** "2m 35s saved" / "1m 03s slower" — always paired with the estimate label by the caller. */
export function savedLabel(ms: number): string {
  const abs = Math.abs(ms);
  return ms >= 0 ? `${formatDuration(abs)} saved` : `${formatDuration(abs)} slower`;
}

/** Width of a bar against a maximum, as a CSS percentage. Zero-max renders an empty bar. */
export function barWidth(value: number, max: number, minimum = 0): string {
  if (max <= 0 || value <= 0) return '0%';
  const width = Math.max(minimum, percent(value, max));
  return `${Math.min(100, width)}%`;
}

/** The money line on the hero, kept next to `formatUsd`'s precision rules. */
export function costLabel(report: FlightReport): string {
  return formatUsd(report.costUsd);
}

/** One sentence of context for the "one agent vs the flock" bars. */
export function comparisonCaption(report: FlightReport): string {
  if (report.tasks.merged === 0 && report.tasks.inFlight > 0) {
    return 'The flock is still working; the serial bar is the planner’s estimate.';
  }
  return `One agent would have spent about ${formatDuration(report.serialMs)} on these tasks one after another; the flock spent ${formatDuration(report.wallMs)} in parallel.`;
}
