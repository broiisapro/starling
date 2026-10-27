import type { NodeStatus, TaskStatus } from '@starling/core';

/**
 * Local status palette — a **fallback until C1**, when the dashboard's shared theme tokens land.
 * Everything visual about a node's status is looked up here, so replacing this file with the shared
 * palette is a one-file change and no component needs to learn a new API.
 *
 * Colour language: emerald = online, amber = busy (working birds), slate = offline. The hub is
 * always the reference roost, so its card also carries a sky ring.
 */
export interface StatusTone {
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

export const STATUS_PALETTE: Record<NodeStatus, StatusTone> = {
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

/** Hub badge is fixed: there is exactly one hub, it is always the local node (ARCHITECTURE §1). */
export const HUB_BADGE = 'border-sky-400/30 bg-sky-400/10 text-sky-200';
export const PERCH_BADGE = 'border-violet-400/25 bg-violet-400/10 text-violet-200';

/** Local dot colours for task chips until C1's shared task palette. */
export function taskTone(status: TaskStatus): { dot: string; text: string } {
  switch (status) {
    case 'running':
    case 'fixing':
      return { dot: 'bg-amber-400', text: 'text-amber-200' };
    case 'auditing':
    case 'merging':
      return { dot: 'bg-sky-400', text: 'text-sky-200' };
    case 'merged':
      return { dot: 'bg-emerald-400', text: 'text-emerald-200' };
    case 'failed':
    case 'conflict':
      return { dot: 'bg-rose-400', text: 'text-rose-200' };
    case 'cancelled':
      return { dot: 'bg-slate-500', text: 'text-slate-400' };
    case 'pending':
    case 'ready':
      return { dot: 'bg-slate-400', text: 'text-slate-300' };
  }
}
