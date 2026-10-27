/**
 * The explicit task state machine (ARCHITECTURE §4).
 *
 * Every status change in the engine goes through `assertTaskTransition`, so an accidental edge is
 * caught by a test (strict mode) instead of silently corrupting a run's history.
 */

import type { TaskStatus } from '@starling/core';
import { StarlingError } from '@starling/core';

/**
 * Allowed edges. Terminal statuses have none.
 *
 * `running|fixing|auditing → ready` exists for flock: a perch that vanishes sends its work back to
 * the queue with its attempt count untouched (`task.migrated` when it lands elsewhere).
 * `merging → fixing` is the merge-queue regression path (`tests-failed`).
 */
export const TASK_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  pending: ['ready', 'cancelled'],
  ready: ['running', 'cancelled'],
  running: ['auditing', 'ready', 'failed', 'cancelled'],
  auditing: ['fixing', 'merging', 'failed', 'ready', 'cancelled'],
  fixing: ['auditing', 'failed', 'ready', 'cancelled'],
  merging: ['merged', 'conflict', 'fixing', 'failed', 'cancelled'],
  merged: [],
  failed: [],
  conflict: [],
  cancelled: [],
};

/** Statuses from which a task never moves again. */
export const TERMINAL_TASK_STATUSES: readonly TaskStatus[] = ['merged', 'failed', 'conflict', 'cancelled'];

/** Statuses that occupy a node session (and therefore a `maxParallel` slot). */
export const ACTIVE_TASK_STATUSES: readonly TaskStatus[] = ['running', 'fixing', 'auditing', 'merging'];

export function isTerminalStatus(status: TaskStatus): boolean {
  return TERMINAL_TASK_STATUSES.includes(status);
}

export function isActiveStatus(status: TaskStatus): boolean {
  return ACTIVE_TASK_STATUSES.includes(status);
}

export function allowedTransitions(from: TaskStatus): readonly TaskStatus[] {
  return TASK_TRANSITIONS[from];
}

export function isTaskTransitionAllowed(from: TaskStatus, to: TaskStatus): boolean {
  return from === to || TASK_TRANSITIONS[from].includes(to);
}

/**
 * Validate one edge.
 *
 * - `strict: true` (tests, and anything that wants a loud failure) throws a `StarlingError`.
 * - `strict: false` (production) returns `false` so the caller can log an `error` `log` event and
 *   keep the run alive: one bad edge must not take the whole flock down.
 *
 * A no-op transition (`from === to`) is always allowed and callers treat it as "nothing to do".
 */
export function assertTaskTransition(
  from: TaskStatus,
  to: TaskStatus,
  opts: { strict?: boolean; taskKey?: string } = {},
): boolean {
  if (isTaskTransitionAllowed(from, to)) return true;
  if (opts.strict !== true) return false;
  throw new StarlingError('INVALID_ARGUMENT', `Illegal task transition ${from} → ${to}`, {
    details: { from, to, taskKey: opts.taskKey ?? null },
  });
}
