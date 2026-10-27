/**
 * LOCAL FALLBACK status palette — until C1.
 *
 * Epic 23 owns the design system and exports `STATUS_COLORS` from `apps/web/src/lib/status.ts`
 * (ARCHITECTURE §8 / epic-23 prompt). That file does not exist yet and sibling lanes must never be
 * imported while Wave 1 is in flight, so the queue board carries its own copy keyed by `TaskStatus`.
 * At C1 replace `STATUS_STYLE` with the shared palette; the shape is the same (dot + text + chip).
 */
import type { TaskStatus } from '@starling/core';

export interface StatusStyle {
  /** Short label for screen readers and card footers. */
  label: string;
  /** Tailwind class for the status dot's background. */
  dot: string;
  /** Tailwind class for the status label text. */
  text: string;
  /** Tailwind classes for the status chip (attempt / node badges use the neutral one). */
  chip: string;
}

export const STATUS_STYLE: Record<TaskStatus, StatusStyle> = {
  pending: {
    label: 'pending',
    dot: 'bg-slate-500',
    text: 'text-slate-400',
    chip: 'border-slate-600/60 bg-slate-500/10 text-slate-300',
  },
  ready: {
    label: 'ready',
    dot: 'bg-indigo-400',
    text: 'text-indigo-300',
    chip: 'border-indigo-400/40 bg-indigo-400/10 text-indigo-200',
  },
  running: {
    label: 'running',
    dot: 'bg-sky-400',
    text: 'text-sky-300',
    chip: 'border-sky-400/40 bg-sky-400/10 text-sky-200',
  },
  auditing: {
    label: 'auditing',
    dot: 'bg-amber-400',
    text: 'text-amber-300',
    chip: 'border-amber-400/40 bg-amber-400/10 text-amber-200',
  },
  fixing: {
    label: 'fixing',
    dot: 'bg-orange-400',
    text: 'text-orange-300',
    chip: 'border-orange-400/40 bg-orange-400/10 text-orange-200',
  },
  merging: {
    label: 'merging',
    dot: 'bg-fuchsia-400',
    text: 'text-fuchsia-300',
    chip: 'border-fuchsia-400/40 bg-fuchsia-400/10 text-fuchsia-200',
  },
  merged: {
    label: 'merged',
    dot: 'bg-emerald-400',
    text: 'text-emerald-300',
    chip: 'border-emerald-400/40 bg-emerald-400/10 text-emerald-200',
  },
  failed: {
    label: 'failed',
    dot: 'bg-rose-500',
    text: 'text-rose-300',
    chip: 'border-rose-400/40 bg-rose-400/10 text-rose-200',
  },
  conflict: {
    label: 'conflict',
    dot: 'bg-rose-400',
    text: 'text-rose-300',
    chip: 'border-rose-400/40 bg-rose-400/10 text-rose-200',
  },
  cancelled: {
    label: 'cancelled',
    dot: 'bg-slate-600',
    text: 'text-slate-400',
    chip: 'border-slate-600/60 bg-slate-500/10 text-slate-300',
  },
};

export const NEUTRAL_CHIP = 'border-white/10 bg-white/5 text-slate-400';
