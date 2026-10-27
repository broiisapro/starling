import type { TaskStatus } from '@starling/core';

/**
 * Local fallback status palette for the DAG. ARCHITECTURE §8 says a shared palette lands at C1
 * (checkpoint 1, when the handshake mirrors move into core); until then every feature lane keeps its
 * own, so the dashboard is never blocked on a shared theme module.
 *
 * Classes are written out in full (no `bg-${colour}-500` interpolation) because Tailwind v4 only
 * emits utilities it can see as literal strings.
 */
export interface StatusMeta {
  /** Human label shown next to the status dot. */
  label: string;
  /** Border + background for the task card. */
  card: string;
  /** Small dot fill. */
  dot: string;
  /** Text colour for the status label. */
  text: string;
}

export const STATUS_META: Record<TaskStatus, StatusMeta> = {
  pending: {
    label: 'pending',
    card: 'border-slate-700/80 bg-slate-900/80',
    dot: 'bg-slate-500',
    text: 'text-slate-400',
  },
  ready: {
    label: 'ready',
    card: 'border-sky-700/80 bg-sky-950/60',
    dot: 'bg-sky-400',
    text: 'text-sky-300',
  },
  running: {
    label: 'running',
    card: 'border-blue-600/90 bg-blue-950/70',
    dot: 'bg-blue-400',
    text: 'text-blue-300',
  },
  auditing: {
    label: 'auditing',
    card: 'border-amber-600/90 bg-amber-950/60',
    dot: 'bg-amber-400',
    text: 'text-amber-300',
  },
  fixing: {
    label: 'fixing',
    card: 'border-orange-600/90 bg-orange-950/60',
    dot: 'bg-orange-400',
    text: 'text-orange-300',
  },
  merging: {
    label: 'merging',
    card: 'border-violet-600/90 bg-violet-950/60',
    dot: 'bg-violet-400',
    text: 'text-violet-300',
  },
  merged: {
    label: 'merged',
    card: 'border-emerald-600/80 bg-emerald-950/50',
    dot: 'bg-emerald-400',
    text: 'text-emerald-300',
  },
  failed: {
    label: 'failed',
    card: 'border-rose-600/90 bg-rose-950/60',
    dot: 'bg-rose-400',
    text: 'text-rose-300',
  },
  conflict: {
    label: 'conflict',
    card: 'border-yellow-500/90 bg-yellow-950/60',
    dot: 'bg-yellow-400',
    text: 'text-yellow-300',
  },
  cancelled: {
    label: 'cancelled',
    card: 'border-slate-700 bg-slate-900/60 opacity-70',
    dot: 'bg-slate-600',
    text: 'text-slate-500',
  },
};

/** Statuses where an agent (or the auditor/merger) is actively working on the task. */
export const LIVE_STATUSES: readonly TaskStatus[] = ['running', 'auditing', 'fixing', 'merging'];

/** Statuses where the task is waiting on its dependencies (or on the scheduler). */
export const WAITING_STATUSES: readonly TaskStatus[] = ['pending', 'ready'];

export function isLive(status: TaskStatus | undefined): boolean {
  return status !== undefined && LIVE_STATUSES.includes(status);
}

export function isWaiting(status: TaskStatus | undefined): boolean {
  return status !== undefined && WAITING_STATUSES.includes(status);
}

/**
 * An edge animates when work upstream is in flight and the downstream task is still waiting for it.
 * Decided as a pure function so the rule is testable without a browser.
 */
export function edgeAnimates(upstream: TaskStatus | undefined, downstream: TaskStatus | undefined): boolean {
  return isLive(upstream) && isWaiting(downstream);
}

export function statusMeta(status: TaskStatus | undefined): StatusMeta {
  return STATUS_META[status ?? 'pending'];
}
