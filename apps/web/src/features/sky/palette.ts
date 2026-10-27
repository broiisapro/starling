/**
 * The Sky's colour vocabulary.
 *
 * Status colours come from the dashboard's one shared palette (`src/lib/status.ts`) — at C1 the
 * local fallback was deleted, so a bird in the sky, a DAG card and a queue chip are the same
 * colour for the same `TaskStatus`. What lives here is sky-only: the dusk scene colours and the
 * pre-blended iridescent sheens (they need per-status hex values, which the shared palette owns).
 */
import type { TaskStatus } from '@starling/core';
import { STATUS_COLORS, TASK_STATUSES } from '../../lib/status';

export { TASK_STATUSES };

/** Canvas hex for a status — the single source of truth is the shared palette. */
export function statusColor(status: TaskStatus): string {
  return STATUS_COLORS[status].hex;
}

/** Dusk colours that are not status-specific. */
export const SKY_COLORS = {
  zenith: '#070d1c',
  midSky: '#111a34',
  horizon: '#3a2b4d',
  ember: '#b96a5a',
  stars: '#cfe4ff',
  wire: 'rgba(190, 206, 232, 0.55)',
  wireLabel: '#c9d8f2',
  roost: '#0b1220',
  roostRim: 'rgba(170, 205, 255, 0.38)',
  label: '#a8bcd8',
  halo: 'rgba(255, 255, 255, 0.20)',
  /** Big readable roost plates (Epic 47): dark glass behind projector-sized type. */
  plate: 'rgba(5, 10, 22, 0.84)',
  plateRim: 'rgba(170, 205, 255, 0.30)',
  roostName: '#e6efff',
  roostGauge: '#93a8c4',
  crown: '#ffd479',
  glow: 'rgba(120, 220, 255, 0.55)',
  spark: '#ffe6a6',
  toast: 'rgba(6, 12, 24, 0.88)',
  toastRim: 'rgba(160, 196, 255, 0.34)',
  toastText: '#e6efff',
  shimmer: 'rgba(160, 255, 210, 0.85)',
} as const;

// ── iridescence ──────────────────────────────────────────────────────────────────────────────────
// Twelve pre-blended stroke colours per status: no per-frame string building in the hot loop, and
// enough variation that a flock shimmers instead of reading as a solid block.

const SHEEN_STOPS = ['#8ee8ff', '#c2b3ff', '#ffe6a6', '#7cf5d0'] as const;

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a: readonly [number, number, number], b: readonly [number, number, number], t: number) {
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)}, ${Math.round(a[1] + (b[1] - a[1]) * t)}, ${Math.round(
    a[2] + (b[2] - a[2]) * t,
  )})`;
}

function buildSheen(): Record<TaskStatus, readonly string[]> {
  const out = {} as Record<TaskStatus, readonly string[]>;
  for (const status of TASK_STATUSES) {
    const base = hexToRgb(statusColor(status));
    out[status] = Array.from({ length: 12 }, (_, i) => {
      const stop = hexToRgb(SHEEN_STOPS[i % SHEEN_STOPS.length] ?? '#ffffff');
      return mix(base, stop, 0.18 + 0.57 * (i / 11));
    });
  }
  return out;
}

/** `STATUS_SHEEN[status][k]` is a stable stroke colour; cycle `k` per bird for the sheen. */
export const STATUS_SHEEN: Record<TaskStatus, readonly string[]> = buildSheen();
