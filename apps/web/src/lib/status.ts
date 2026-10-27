import type { NodeStatus, TaskStatus } from '@starling/core';

/**
 * One palette per `TaskStatus`, shared by the web shell, the feature panels and the Sky canvas.
 *
 * This is the **only** status palette in `apps/web`: at C1 the Sky, DAG, queue and flock features
 * dropped their local fallbacks and read from here, so a task is the same colour in every panel.
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

/** Solid, one-line chip used by the queue board and the DAG's hover tooltip. */
export function statusChip(status: TaskStatus): string {
  const palette = STATUS_COLORS[status];
  return `${palette.border} ${palette.bg} ${palette.text}`;
}

/** Card chrome for the DAG's task nodes (border + translucent fill). */
export function statusSurface(status: TaskStatus): string {
  const palette = STATUS_COLORS[status];
  return `${palette.border} ${palette.bg}`;
}

/**
 * Node (roost) status is a different axis from `TaskStatus`: it describes a machine, not a task.
 * Epic 32's flock panel needs the same treatment, so its palette lives here too rather than in a
 * feature fallback. Colour language: emerald = online, amber = busy, slate = offline.
 */
export interface NodeStatusPalette {
  label: string;
  /** The solid status dot. */
  dot: string;
  /** The expanding ring behind the dot on a busy roost. */
  pulse: string;
  /** Text colour for the status word. */
  text: string;
  /** Filled session pip. */
  meter: string;
  /** Hairline accent across the top of the card. */
  accent: string;
  /** Pill styling for the hub/perch badge. */
  badge: string;
  /** Extra card chrome (border/ring) for this status. */
  card: string;
}

export const NODE_STATUS_COLORS: Record<NodeStatus, NodeStatusPalette> = {
  online: {
    label: 'online',
    dot: 'bg-emerald-400',
    pulse: 'bg-emerald-400',
    text: 'text-emerald-300',
    meter: 'bg-emerald-400/90',
    accent: 'bg-gradient-to-r from-transparent via-emerald-400/70 to-transparent',
    badge: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200',
    card: 'border-white/10 hover:border-emerald-300/30',
  },
  busy: {
    label: 'busy',
    dot: 'bg-amber-400',
    pulse: 'bg-amber-400',
    text: 'text-amber-300',
    meter: 'bg-amber-400/90',
    accent: 'bg-gradient-to-r from-transparent via-amber-400/70 to-transparent',
    badge: 'border-amber-400/25 bg-amber-400/10 text-amber-200',
    card: 'border-amber-300/20 hover:border-amber-300/40',
  },
  offline: {
    label: 'offline',
    dot: 'bg-slate-500',
    pulse: 'bg-slate-500',
    text: 'text-slate-400',
    meter: 'bg-slate-500/70',
    accent: 'bg-gradient-to-r from-transparent via-slate-500/40 to-transparent',
    badge: 'border-white/10 bg-white/5 text-slate-300',
    card: 'border-dashed border-white/10 hover:border-white/20',
  },
};

/** Hub and perch are not statuses: there is exactly one hub, and perches are the rest (§1). */
export const HUB_BADGE = 'border-sky-400/30 bg-sky-400/10 text-sky-200';
export const PERCH_BADGE = 'border-violet-400/25 bg-violet-400/10 text-violet-200';

/** The task chip inside a roost card: same task colours as every other panel. */
export function taskTone(status: TaskStatus): { dot: string; text: string } {
  const palette = STATUS_COLORS[status];
  return { dot: palette.dot, text: palette.text };
}

export function statusPalette(status: TaskStatus): StatusPalette {
  return STATUS_COLORS[status];
}

export function statusLabel(status: TaskStatus): string {
  return STATUS_COLORS[status].label;
}

export function isTerminalStatus(status: TaskStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}
