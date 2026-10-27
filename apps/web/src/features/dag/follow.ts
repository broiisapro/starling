import type { TaskRun } from '@starling/core';
import { LIVE_STATUSES } from './status';

/**
 * "Follow the action": which node should the viewport pan to?
 *
 * The rule is deliberately simple and pure so it can be tested without React Flow:
 * - the *newest* live task wins (it just started doing something, so it is the news),
 * - when nothing new appeared, the oldest live task wins (the camera settles instead of jumping
 *   between two agents every tick),
 * - when nothing is live, there is no target and the viewport stays exactly where the user put it.
 */
export function activeKeys(tasks: Record<string, TaskRun>): string[] {
  return Object.values(tasks)
    .filter((run) => LIVE_STATUSES.includes(run.status))
    .sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0) || a.taskKey.localeCompare(b.taskKey))
    .map((run) => run.taskKey);
}

export function followTarget(
  tasks: Record<string, TaskRun>,
  previous: readonly string[] = [],
): string | undefined {
  const active = activeKeys(tasks);
  if (active.length === 0) return undefined;
  const seen = new Set(previous);
  const fresh = active.find((key) => !seen.has(key));
  return fresh ?? active[0];
}
