/**
 * Stable, execution-ordered task keys: `t01-dates-fix`, `t02-theme`, …
 *
 * The model chooses descriptive keys to talk about its own DAG (`"dependsOn": ["dates-fix"]`), and
 * those keys are the right vocabulary for the plan's prose. They are the wrong vocabulary for
 * branches, worktree names and the dashboard: a re-plan can rename them, two plans can reuse the
 * same word for different work, and nothing tells a reader which task must land first.
 *
 * This pass renumbers a finished plan deterministically:
 *
 * - dependencies come before dependents (Kahn's algorithm, ties broken by the model's own order);
 * - the original descriptive slug is kept after the number, so `dates-fix` stays readable;
 * - `NN` is zero-padded so `t09-…` sorts before `t10-…` in a file browser;
 * - the pass is idempotent: an existing `tNN-` prefix is stripped before renumbering.
 *
 * Numbers are positions, not priorities: two tasks with no path between them may both be ready at
 * the same time, and the engine's scheduler decides which runs first.
 */
import type { Plan, TaskSpec } from '@starling/core';

const PREFIX = /^t\d{2,}-/;

/** `t03-dates-fix` -> `dates-fix`; anything else is left alone. */
export function stripTaskNumber(key: string): string {
  return key.replace(PREFIX, '');
}

/**
 * Order task indexes so that every dependency precedes its dependents. Ties (and any cycle, which
 * deterministic repair should already have broken) keep the caller's original order.
 */
export function dependencyOrder(tasks: TaskSpec[]): number[] {
  const firstIndex = new Map<string, number>();
  for (const [index, task] of tasks.entries()) {
    if (!firstIndex.has(task.key)) firstIndex.set(task.key, index);
  }

  const order: number[] = [];
  const emitted = new Set<number>();
  const remaining = tasks.map((_, index) => index);

  while (remaining.length > 0) {
    const ready = remaining.findIndex((index) => {
      const task = tasks[index] as TaskSpec;
      return task.dependsOn.every((dep) => {
        const source = firstIndex.get(dep);
        return source === undefined || source === index || emitted.has(source);
      });
    });
    const pick = ready === -1 ? 0 : ready;
    const [index] = remaining.splice(pick, 1);
    if (index === undefined) break;
    emitted.add(index);
    order.push(index);
  }
  return order;
}

/** Renumber a plan's task keys (and every `dependsOn` reference) to the stable `tNN-kebab` scheme. */
export function assignTaskKeys(plan: Plan): Plan {
  if (plan.tasks.length === 0) return plan;

  const order = dependencyOrder(plan.tasks);
  const renamed = new Map<string, string>();
  const tasks: TaskSpec[] = [];

  for (const [position, index] of order.entries()) {
    const task = plan.tasks[index] as TaskSpec;
    const key = `t${String(position + 1).padStart(2, '0')}-${stripTaskNumber(task.key)}`;
    if (!renamed.has(task.key)) renamed.set(task.key, key);
    tasks.push({ ...task, key });
  }

  return {
    ...plan,
    tasks: tasks.map((task) => ({
      ...task,
      dependsOn: [...new Set(task.dependsOn.map((dep) => renamed.get(dep) ?? dep))].filter(
        (dep) => dep !== task.key,
      ),
    })),
  };
}
