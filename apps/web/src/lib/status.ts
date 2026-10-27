import type { TaskStatus } from '@starling/core';

/**
 * One palette per `TaskStatus`, shared by the web shell, the feature panels and the Sky canvas.
 *
 * `hex` is what Canvas 2D paints (Epic 24's birds); the Tailwind class strings are for DOM badges.
 * The classes are written literally so Tailwind's scanner emits them; do not build them from a
 * template string.
 */
export interface StatusPalette {
  /** Human label, title case. */
  label: string;
  /** One-line explanation for tooltips and aria labels. */
  description: string;
  /** Canvas / inline-style colour. */
  hex: string;
  /** Text colour utility. */
  text: string;
  /** Translucent fill utility. */
  bg: string;
  /** Border utility. */
  border: string;
  /** Solid dot utility. */
  dot: string;
}

export const STATUS_COLORS: Record<TaskStatus, StatusPalette> = {
  pending: {
    label: 'Pending',
    description: 'Waiting for its dependencies to merge.',
    hex: '#94a3b8',
    text: 'text-slate-300',
    bg: 'bg-slate-400/15',
    border: 'border-slate-400/35',
    dot: 'bg-slate-400',
  },
  ready: {
    label: 'Ready',
    description: 'Dependencies merged — waiting for a free session.',
    hex: '#63d2ff',
    text: 'text-sky-300',
    bg: 'bg-sky-400/15',
    border: 'border-sky-400/40',
    dot: 'bg-sky-400',
  },
  running: {
    label: 'Flying',
    description: 'An agent is working on it in its own worktree.',
    hex: '#3fe0c5',
    text: 'text-teal-300',
    bg: 'bg-teal-400/15',
    border: 'border-teal-400/40',
    dot: 'bg-teal-400',
  },
  auditing: {
    label: 'Auditing',
    description: 'Tests, lane check and the local model are judging the diff.',
    hex: '#fbbf24',
    text: 'text-amber-300',
    bg: 'bg-amber-400/15',
    border: 'border-amber-400/40',
    dot: 'bg-amber-400',
  },
  fixing: {
    label: 'Fixing',
    description: 'The audit failed; the same agent is applying fix instructions.',
    hex: '#fb923c',
    text: 'text-orange-300',
    bg: 'bg-orange-400/15',
    border: 'border-orange-400/40',
    dot: 'bg-orange-400',
  },
  merging: {
    label: 'Merging',
    description: 'Landing on the integration branch through the merge queue.',
    hex: '#b18cff',
    text: 'text-violet-300',
    bg: 'bg-violet-400/15',
    border: 'border-violet-400/40',
    dot: 'bg-violet-400',
  },
  merged: {
    label: 'Landed',
    description: 'Merged into the integration branch — on the wire.',
    hex: '#4ade80',
    text: 'text-emerald-300',
    bg: 'bg-emerald-400/15',
    border: 'border-emerald-400/40',
    dot: 'bg-emerald-400',
  },
  failed: {
    label: 'Failed',
    description: 'Audit attempts exhausted or the run stopped it.',
    hex: '#f87171',
    text: 'text-red-300',
    bg: 'bg-red-400/15',
    border: 'border-red-400/40',
    dot: 'bg-red-400',
  },
  conflict: {
    label: 'Conflict',
    description: 'The merge queue found overlapping changes.',
    hex: '#fb7185',
    text: 'text-rose-300',
    bg: 'bg-rose-400/15',
    border: 'border-rose-400/40',
    dot: 'bg-rose-400',
  },
  cancelled: {
    label: 'Cancelled',
    description: 'Stopped by the user or by run cancellation.',
    hex: '#7c869c',
    text: 'text-slate-400',
    bg: 'bg-slate-500/15',
    border: 'border-slate-500/30',
    dot: 'bg-slate-500',
  },
};

/** Stable order for legends, filters and the Sky's status key. */
export const TASK_STATUSES: readonly TaskStatus[] = [
  'pending',
  'ready',
  'running',
  'auditing',
  'fixing',
  'merging',
  'merged',
  'failed',
  'conflict',
  'cancelled',
];

/** Statuses that mean "no more work will happen" — handy for progress maths. */
export const TERMINAL_STATUSES: readonly TaskStatus[] = ['merged', 'failed', 'conflict', 'cancelled'];

export function statusPalette(status: TaskStatus): StatusPalette {
  return STATUS_COLORS[status];
}

export function statusLabel(status: TaskStatus): string {
  return STATUS_COLORS[status].label;
}

export function isTerminalStatus(status: TaskStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}
