/**
 * The Sky's colour vocabulary.
 *
 * `src/lib/status.ts` (Epic 23) will own the canonical dashboard colours at checkpoint C1. Until it
 * lands, this module is the local fallback: `FALLBACK_STATUS_COLORS` has one entry per `TaskStatus`
 * and the same keys the shared module is expected to export, so switching over is a one-line import
 * swap (`statusColor()` is the only call site the rest of this feature uses).
 */
import type { TaskStatus } from '@starling/core';

/** Every task status, in lifecycle order. Handy for tables, tests and the live region. */
export const TASK_STATUSES: readonly TaskStatus[] = [
  'pending',
  'ready',
  'running',
  'auditing',
  'fixing',
  'merging',
  'merged',
  'conflict',
  'failed',
  'cancelled',
];

/** Fallback palette, keyed exactly like the future `src/lib/status.ts`. */
export const FALLBACK_STATUS_COLORS: Record<TaskStatus, string> = {
  pending: '#8fa2b8',
  ready: '#9be3ff',
  running: '#4fc3ff',
  auditing: '#ffc857',
  fixing: '#ff8a65',
  merging: '#b388ff',
  merged: '#4ade80',
  failed: '#6b7280',
  conflict: '#ff5c8a',
  cancelled: '#475569',
};

export function statusColor(status: TaskStatus): string {
  return FALLBACK_STATUS_COLORS[status];
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
  roost: '#1d2740',
  roostRim: 'rgba(150, 190, 255, 0.30)',
  label: '#a8bcd8',
  halo: 'rgba(255, 255, 255, 0.20)',
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
    const base = hexToRgb(FALLBACK_STATUS_COLORS[status]);
    out[status] = Array.from({ length: 12 }, (_, i) => {
      const stop = hexToRgb(SHEEN_STOPS[i % SHEEN_STOPS.length] ?? '#ffffff');
      return mix(base, stop, 0.18 + 0.57 * (i / 11));
    });
  }
  return out;
}

/** `STATUS_SHEEN[status][k]` is a stable stroke colour; cycle `k` per bird for the sheen. */
export const STATUS_SHEEN: Record<TaskStatus, readonly string[]> = buildSheen();
