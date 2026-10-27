import { formatClock } from './format';
import type { EpicStats, SwarmStats } from './types';

/**
 * Pure layout for the swim-lane timeline.
 *
 * The SVG is hand-rolled (no chart library, per ARCHITECTURE L11) and this module holds all the
 * arithmetic: one row per wave, one bar per epic from its first commit (or agent session start) to
 * its merge, on a shared time axis. In-flight epics run to `generatedAt` and are drawn hollow.
 */

export const TIMELINE_WIDTH = 960;
export const TIMELINE_GUTTER = 168;
export const TIMELINE_TOP = 28;
export const TIMELINE_BOTTOM = 30;
export const TIMELINE_RIGHT = 24;
export const ROW_HEIGHT = 20;
export const BAR_HEIGHT = 12;
export const WAVE_GAP = 26;

/** Wave colours, cycled. Inline `var()` so the page follows the dusk/light theme tokens. */
export const WAVE_COLORS = [
  'var(--color-irid-teal)',
  'var(--color-irid-blue)',
  'var(--color-irid-purple)',
  'var(--color-irid-green)',
  'var(--color-amber-horizon)',
  'var(--color-irid-rose)',
];

export interface TimelineBar {
  epic: EpicStats;
  wave: string;
  x: number;
  width: number;
  y: number;
  height: number;
  color: string;
  inFlight: boolean;
  startMs: number;
  endMs: number;
}

export interface TimelineRow {
  wave: string;
  label: string;
  y: number;
  height: number;
  epics: number;
  merged: number;
  wallTimeMs?: number;
  bars: TimelineBar[];
}

export interface TimelineTick {
  ms: number;
  x: number;
  label: string;
}

export interface TimelineLayout {
  width: number;
  height: number;
  plotLeft: number;
  plotRight: number;
  startMs: number;
  endMs: number;
  rows: TimelineRow[];
  bars: TimelineBar[];
  ticks: TimelineTick[];
}

function msOf(iso: string | undefined): number | undefined {
  if (iso === undefined) return undefined;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : undefined;
}

/** `0` → `Wave 0`, `c1` → `Checkpoint 1`, anything else is shown as-is. */
export function waveLabel(wave: string): string {
  if (wave === 'unknown') return 'Wave ?';
  if (wave === 'c1') return 'Checkpoint 1';
  return `Wave ${wave}`;
}

/** Trim an epic title to fit a bar label without measuring text (deterministic and cheap). */
export function shortTitle(title: string, max = 34): string {
  return title.length <= max ? title : `${title.slice(0, max - 1).trimEnd()}…`;
}

export function timelineLayout(stats: SwarmStats): TimelineLayout {
  const generated = msOf(stats.generatedAt) ?? Date.now();
  const plotLeft = TIMELINE_GUTTER;
  const plotRight = TIMELINE_WIDTH - TIMELINE_RIGHT;

  const entries = stats.epics.flatMap((epic) => {
    const startMs = msOf(epic.startedAt);
    if (startMs === undefined) return [];
    const inFlight = epic.mergedAt === undefined;
    const mergedMs = msOf(epic.mergedAt);
    const endMs = inFlight ? Math.max(startMs, generated) : (mergedMs ?? startMs);
    return [{ epic, startMs, endMs: Math.max(startMs, endMs), inFlight }];
  });

  const startMs = entries.length === 0 ? generated - 3_600_000 : Math.min(...entries.map((e) => e.startMs));
  const rawEnd = entries.length === 0 ? generated : Math.max(...entries.map((e) => e.endMs));
  // A zero-width domain (one instant) would divide by zero; give it a minute.
  const endMs = rawEnd > startMs ? rawEnd : startMs + 60_000;
  const scale = (value: number): number =>
    plotLeft + ((value - startMs) / (endMs - startMs)) * (plotRight - plotLeft);

  const bars: TimelineBar[] = [];
  const rows: TimelineRow[] = [];
  let cursor = TIMELINE_TOP;

  for (const [index, wave] of stats.waves.entries()) {
    const rowEntries = entries
      .filter((entry) => entry.epic.wave === wave.wave)
      .sort((a, b) => a.startMs - b.startMs || a.epic.number.localeCompare(b.epic.number));
    const height = Math.max(1, rowEntries.length) * ROW_HEIGHT;
    const color = WAVE_COLORS[index % WAVE_COLORS.length] ?? WAVE_COLORS[0];

    const rowBars = rowEntries.map((entry, rowIndex) => {
      const x = scale(entry.startMs);
      const x1 = scale(entry.endMs);
      const bar: TimelineBar = {
        epic: entry.epic,
        wave: wave.wave,
        x,
        width: Math.max(4, x1 - x),
        y: cursor + rowIndex * ROW_HEIGHT + (ROW_HEIGHT - BAR_HEIGHT) / 2,
        height: BAR_HEIGHT,
        color: color ?? WAVE_COLORS[0] ?? 'currentColor',
        inFlight: entry.inFlight,
        startMs: entry.startMs,
        endMs: entry.endMs,
      };
      return bar;
    });

    rows.push({
      wave: wave.wave,
      label: waveLabel(wave.wave),
      y: cursor,
      height,
      epics: wave.epics,
      merged: wave.merged,
      wallTimeMs: wave.wallTimeMs,
      bars: rowBars,
    });
    bars.push(...rowBars);
    cursor += height + WAVE_GAP;
  }

  const height = Math.max(TIMELINE_TOP + ROW_HEIGHT, cursor - WAVE_GAP + TIMELINE_BOTTOM);
  const ticks = Array.from({ length: 5 }, (_, index) => {
    const ratio = index / 4;
    const at = startMs + (endMs - startMs) * ratio;
    return { ms: at, x: scale(at), label: formatClock(at) };
  });

  return { width: TIMELINE_WIDTH, height, plotLeft, plotRight, startMs, endMs, rows, bars, ticks };
}
