import type { Plan, PlanIssue, TaskSpec } from '../lib/core';
import { globsOverlap } from '../lib/core';

/**
 * Deterministic plan validator used by the evals.
 *
 * This intentionally reimplements the checks instead of importing `@starling/planner`: the eval
 * must be able to score the planner even when the planner is the thing under test, and Wave 1
 * siblings are built in parallel. Glob overlap comes from `@starling/core` so both sides agree on
 * lane semantics.
 *
 * Lane overlap is only an error for tasks that can run concurrently. If A (transitively) depends on
 * B, their shared lane is serialised by the DAG and is the worker's problem, not the scheduler's.
 */
export function validatePlan(plan: Plan): PlanIssue[] {
  const issues: PlanIssue[] = [];
  const byKey = new Map<string, TaskSpec>();
  for (const task of plan.tasks) {
    if (byKey.has(task.key)) {
      issues.push({
        severity: 'error',
        code: 'other',
        message: `Duplicate task key "${task.key}".`,
        taskKeys: [task.key],
      });
    }
    byKey.set(task.key, task);
  }

  for (const task of plan.tasks) {
    if (task.lane.owns.length === 0) {
      issues.push({
        severity: 'error',
        code: 'empty-lane',
        message: `Task "${task.key}" owns no paths.`,
        taskKeys: [task.key],
      });
    }
    if (task.definitionOfDone.length === 0) {
      issues.push({
        severity: 'error',
        code: 'empty-dod',
        message: `Task "${task.key}" has an empty definition of done.`,
        taskKeys: [task.key],
      });
    }
    for (const dep of task.dependsOn) {
      if (!byKey.has(dep)) {
        issues.push({
          severity: 'error',
          code: 'missing-dep',
          message: `Task "${task.key}" depends on unknown task "${dep}".`,
          taskKeys: [task.key, dep],
        });
      }
    }
  }

  const cycle = findCycle(plan.tasks, byKey);
  if (cycle.length > 0) {
    issues.push({
      severity: 'error',
      code: 'cycle',
      message: `Dependency cycle: ${cycle.join(' -> ')}.`,
      taskKeys: cycle,
    });
  }

  const reaches = buildReachability(plan.tasks, byKey);
  for (let i = 0; i < plan.tasks.length; i += 1) {
    for (let j = i + 1; j < plan.tasks.length; j += 1) {
      const a = plan.tasks[i];
      const b = plan.tasks[j];
      if (a === undefined || b === undefined) continue;
      const ordered = reaches.get(a.key)?.has(b.key) === true || reaches.get(b.key)?.has(a.key) === true;
      if (ordered) continue;
      const overlaps = globsOverlap(a.lane.owns, b.lane.owns);
      if (overlaps.length > 0) {
        issues.push({
          severity: 'error',
          code: 'lane-overlap',
          message: `Concurrent tasks "${a.key}" and "${b.key}" share ${overlaps.join(', ')}.`,
          taskKeys: [a.key, b.key],
        });
      }
    }
  }

  return issues;
}

function findCycle(tasks: TaskSpec[], byKey: Map<string, TaskSpec>): string[] {
  const state = new Map<string, 'visiting' | 'done'>();
  const stack: string[] = [];

  const visit = (key: string): string[] => {
    const current = state.get(key);
    if (current === 'done') return [];
    if (current === 'visiting') {
      const start = stack.indexOf(key);
      return [...stack.slice(start), key];
    }
    const task = byKey.get(key);
    if (task === undefined) return [];
    state.set(key, 'visiting');
    stack.push(key);
    for (const dep of task.dependsOn) {
      const found = visit(dep);
      if (found.length > 0) return found;
    }
    stack.pop();
    state.set(key, 'done');
    return [];
  };

  for (const task of tasks) {
    const found = visit(task.key);
    if (found.length > 0) return found;
  }
  return [];
}

/** Transitive `dependsOn` closure per task key, excluding the task itself. */
function buildReachability(tasks: TaskSpec[], byKey: Map<string, TaskSpec>): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const task of tasks) {
    const seen = new Set<string>();
    const queue = [...task.dependsOn];
    while (queue.length > 0) {
      const key = queue.shift();
      if (key === undefined || seen.has(key)) continue;
      seen.add(key);
      const dep = byKey.get(key);
      if (dep !== undefined) queue.push(...dep.dependsOn);
    }
    out.set(task.key, seen);
  }
  return out;
}
