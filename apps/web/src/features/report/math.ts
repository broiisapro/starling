import type { TaskRun } from '@starling/core/browser';

/** A task's measured flight time, or `undefined` when either timestamp is missing. */
export function taskFlightMs(task: TaskRun): number | undefined {
  if (task.startedAt === undefined || task.finishedAt === undefined) return undefined;
  const delta = task.finishedAt - task.startedAt;
  return delta >= 0 ? delta : undefined;
}

/** Keys the plan knows about plus any task the run recorded (defensive: plans can lag). */
export function taskKeys(run: {
  tasks: Record<string, TaskRun>;
  plan?: { tasks: { key: string }[] };
}): string[] {
  const keys = new Set<string>(Object.keys(run.tasks));
  for (const task of run.plan?.tasks ?? []) keys.add(task.key);
  return [...keys];
}
