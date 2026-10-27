import type { TaskStatus } from '@starling/core';
import { STATUS_COLORS, statusSurface } from '../../lib/status';

/**
 * DAG presentation for a `TaskStatus`.
 *
 * At C1 the local fallback palette was deleted: the card chrome, dot and text colours all come from
 * the dashboard's one shared palette (`src/lib/status.ts`), so a task is the same colour here, in
 * the merge queue, in the flock chips and in the Sky.
 *
 * Classes are written out in full in `lib/status.ts` (no `bg-${colour}-500` interpolation) because
 * Tailwind v4 only emits utilities it can see as literal strings.
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

function metaFor(status: TaskStatus): StatusMeta {
  const palette = STATUS_COLORS[status];
  return {
    label: palette.label.toLowerCase(),
    card: statusSurface(status),
    dot: palette.dot,
    text: palette.text,
  };
}

export const STATUS_META: Record<TaskStatus, StatusMeta> = {
  pending: metaFor('pending'),
  ready: metaFor('ready'),
  running: metaFor('running'),
  auditing: metaFor('auditing'),
  fixing: metaFor('fixing'),
  merging: metaFor('merging'),
  merged: metaFor('merged'),
  failed: metaFor('failed'),
  conflict: metaFor('conflict'),
  cancelled: metaFor('cancelled'),
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
