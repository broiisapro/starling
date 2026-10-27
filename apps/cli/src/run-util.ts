import type { Run, TaskRun, TaskStatus } from '@starling/core';

export function cloneRun(run: Run): Run {
  return structuredClone(run);
}

/** Wall-clock (or replay-clock) duration of a run. */
export function runDuration(run: Run, now: number): number {
  const end = run.finishedAt ?? now;
  return Math.max(0, end - run.startedAt);
}

/** Duration a single task has been (or was) running. Zero before it starts. */
export function taskDuration(task: TaskRun, now: number): number {
  if (task.startedAt === undefined) return 0;
  return Math.max(0, (task.finishedAt ?? now) - task.startedAt);
}

export function countStatuses(run: Run): Record<TaskStatus, number> {
  const counts: Record<TaskStatus, number> = {
    pending: 0,
    ready: 0,
    running: 0,
    auditing: 0,
    fixing: 0,
    merging: 0,
    merged: 0,
    failed: 0,
    conflict: 0,
    cancelled: 0,
  };
  for (const task of Object.values(run.tasks)) counts[task.status] += 1;
  return counts;
}

/** Tasks in plan order when a plan exists, otherwise a stable key order. */
export function orderedTasks(run: Run): TaskRun[] {
  const keys = run.plan?.tasks.map((task) => task.key) ?? Object.keys(run.tasks).sort();
  const seen = new Set<string>();
  const out: TaskRun[] = [];
  for (const key of keys) {
    const task = run.tasks[key];
    if (task !== undefined && !seen.has(key)) {
      seen.add(key);
      out.push(task);
    }
  }
  for (const [key, task] of Object.entries(run.tasks)) {
    if (!seen.has(key)) out.push(task);
  }
  return out;
}
