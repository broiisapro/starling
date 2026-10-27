/**
 * Pure helpers over a `Run`'s task map. No I/O, no clock, no engine instance — easy to unit test.
 */

import type { Plan, Run, TaskRun, TaskSpec } from '@starling/core';
import { emptyUsage } from '@starling/core';
import { isActiveStatus, isTerminalStatus } from './transitions';

/** One `pending` TaskRun per plan task, in plan order. */
export function createTaskRuns(runId: string, plan: Plan): Record<string, TaskRun> {
  const tasks: Record<string, TaskRun> = {};
  for (const spec of plan.tasks) {
    tasks[spec.key] = {
      runId,
      taskKey: spec.key,
      status: 'pending',
      attempts: 0,
      usage: emptyUsage(),
      costUsd: 0,
    };
  }
  return tasks;
}

/** A task becomes ready only when every dependency has actually merged. */
export function dependenciesMerged(spec: TaskSpec, tasks: Record<string, TaskRun>): boolean {
  return spec.dependsOn.every((key) => tasks[key]?.status === 'merged');
}

/** Pending tasks whose dependencies are all merged, in plan order. */
export function promotableTaskKeys(run: Run): string[] {
  if (run.plan === undefined) return [];
  return run.plan.tasks
    .filter((spec) => run.tasks[spec.key]?.status === 'pending' && dependenciesMerged(spec, run.tasks))
    .map((spec) => spec.key);
}

/** Dispatchable tasks: already promoted to `ready` and still eligible. */
export function readyTaskKeys(run: Run): string[] {
  if (run.plan === undefined) return [];
  return run.plan.tasks
    .filter((spec) => run.tasks[spec.key]?.status === 'ready' && dependenciesMerged(spec, run.tasks))
    .map((spec) => spec.key);
}

export function activeCount(run: Run): number {
  return Object.values(run.tasks).filter((task) => isActiveStatus(task.status)).length;
}

/** How many of this run's tasks are currently assigned to each node. */
export function activeByNode(run: Run): Record<string, number> {
  const out: Record<string, number> = {};
  for (const task of Object.values(run.tasks)) {
    if (task.nodeId === undefined || !isActiveStatus(task.status)) continue;
    out[task.nodeId] = (out[task.nodeId] ?? 0) + 1;
  }
  return out;
}

export function countStatus(run: Run, status: TaskRun['status']): number {
  return Object.values(run.tasks).filter((task) => task.status === status).length;
}

/** True when every task has reached a terminal status (an empty plan is trivially complete). */
export function allTasksTerminal(run: Run): boolean {
  return Object.values(run.tasks).every((task) => isTerminalStatus(task.status));
}

/**
 * Dependency-aware cancellation. A failed, conflicted or cancelled task can never make its
 * dependents ready, so they are cancelled transitively instead of leaving the run hanging.
 * Returns the keys that still need a `cancelled` transition.
 */
export function dependentsToCancel(run: Run, rootKey: string): string[] {
  if (run.plan === undefined) return [];
  const cancelled = new Set<string>();
  const queue = [rootKey];
  while (queue.length > 0) {
    const key = queue.shift();
    if (key === undefined) continue;
    for (const spec of run.plan.tasks) {
      if (!spec.dependsOn.includes(key)) continue;
      const task = run.tasks[spec.key];
      if (task === undefined || isTerminalStatus(task.status) || cancelled.has(spec.key)) continue;
      cancelled.add(spec.key);
      queue.push(spec.key);
    }
  }
  return [...cancelled];
}

/** The tasks that still have no terminal status. */
export function unfinishedTaskKeys(run: Run): string[] {
  return Object.values(run.tasks)
    .filter((task) => !isTerminalStatus(task.status))
    .map((task) => task.taskKey);
}
