/**
 * Queue-board presentation for a `TaskStatus`.
 *
 * At C1 the local fallback palette was deleted: the dot, text and chip classes are derived from the
 * dashboard's one shared palette (`src/lib/status.ts`), so a card here is the same colour as its DAG
 * node, its flock chip and its bird in the sky.
 */
import type { TaskStatus } from '@starling/core';
import { STATUS_COLORS, statusChip } from '../../lib/status';

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

function styleFor(status: TaskStatus): StatusStyle {
  const palette = STATUS_COLORS[status];
  return {
    label: palette.label.toLowerCase(),
    dot: palette.dot,
    text: palette.text,
    chip: statusChip(status),
  };
}

export const STATUS_STYLE: Record<TaskStatus, StatusStyle> = {
  pending: styleFor('pending'),
  ready: styleFor('ready'),
  running: styleFor('running'),
  auditing: styleFor('auditing'),
  fixing: styleFor('fixing'),
  merging: styleFor('merging'),
  merged: styleFor('merged'),
  failed: styleFor('failed'),
  conflict: styleFor('conflict'),
  cancelled: styleFor('cancelled'),
};

export const NEUTRAL_CHIP = 'border-white/10 bg-white/5 text-slate-400';
