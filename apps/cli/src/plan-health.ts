import type { Plan, PlanIssue, TaskSpec } from '@starling/core';
import { globsOverlap } from '@starling/core';

/**
 * Local plan validation for the CLI.
 *
 * The real validator lives in `packages/planner` (Wave 1 sibling). The CLI must not import it, but
 * `starling plan` still needs to show lane problems and cycles in every mode — including replay and
 * JSON recordings, where no engine issues are available. This is a small, conservative re-check on
 * top of `@starling/core` globs; it is presentation, not the gate the engine uses.
 */
export function analyzePlan(plan: Plan): PlanIssue[] {
  const issues: PlanIssue[] = [];
  const byKey = new Map<string, TaskSpec>();
  const duplicates = new Set<string>();

  for (const task of plan.tasks) {
    if (byKey.has(task.key)) duplicates.add(task.key);
    byKey.set(task.key, task);
  }

  if (duplicates.size > 0) {
    issues.push({
      severity: 'error',
      code: 'other',
      message: `Duplicate task keys: ${[...duplicates].sort().join(', ')}`,
      taskKeys: [...duplicates].sort(),
    });
  }

  const missing = plan.tasks.flatMap((task) => {
    const absent = task.dependsOn.filter((dep) => !byKey.has(dep));
    return absent.map((dep) => ({ task: task.key, dep }));
  });
  for (const { task, dep } of missing) {
    issues.push({
      severity: 'error',
      code: 'missing-dep',
      message: `${task} depends on ${dep}, which is not in the plan`,
      taskKeys: [task],
    });
  }

  for (const task of plan.tasks) {
    if (task.definitionOfDone.length === 0) {
      issues.push({
        severity: 'error',
        code: 'empty-dod',
        message: `${task.key} has no definition of done`,
        taskKeys: [task.key],
      });
    }
    if (task.lane.owns.length === 0) {
      issues.push({
        severity: 'error',
        code: 'empty-lane',
        message: `${task.key} owns no files`,
        taskKeys: [task.key],
      });
    }
  }

  const cycles = findCycles(plan);
  for (const cycle of cycles) {
    issues.push({
      severity: 'error',
      code: 'cycle',
      message: `Dependency cycle: ${cycle.join(' → ')}`,
      taskKeys: cycle,
    });
  }

  const reachable = dependencyClosure(plan);
  for (let i = 0; i < plan.tasks.length; i += 1) {
    const a = plan.tasks[i] as TaskSpec;
    for (let j = i + 1; j < plan.tasks.length; j += 1) {
      const b = plan.tasks[j] as TaskSpec;
      if (a.key === b.key) continue;
      if (dependsOn(reachable, a.key, b.key) || dependsOn(reachable, b.key, a.key)) continue;
      const overlap = findOverlap(a, b);
      if (overlap !== undefined) {
        issues.push({
          severity: 'error',
          code: 'lane-overlap',
          message: `${a.key} and ${b.key} can run together but both own ${overlap}`,
          taskKeys: [a.key, b.key],
        });
      }
    }
  }

  return issues;
}

/** True when `from` transitively depends on `to` (or is `to`). */
function dependsOn(closure: Map<string, Set<string>>, from: string, to: string): boolean {
  return from === to || (closure.get(from)?.has(to) ?? false);
}

/** For every task key, the set of tasks it depends on directly or transitively. */
export function dependencyClosure(plan: Plan): Map<string, Set<string>> {
  const direct = new Map(plan.tasks.map((task) => [task.key, task.dependsOn] as const));
  const closure = new Map<string, Set<string>>();

  const visit = (key: string, stack: Set<string>): Set<string> => {
    const cached = closure.get(key);
    if (cached !== undefined) return cached;
    if (stack.has(key)) return new Set();
    stack.add(key);
    const out = new Set<string>();
    for (const dep of direct.get(key) ?? []) {
      out.add(dep);
      for (const nested of visit(dep, stack)) out.add(nested);
    }
    stack.delete(key);
    closure.set(key, out);
    return out;
  };

  for (const task of plan.tasks) visit(task.key, new Set());
  return closure;
}

/** Every dependency cycle as a task-key path, each reported once. */
export function findCycles(plan: Plan): string[][] {
  const direct = new Map(plan.tasks.map((task) => [task.key, task.dependsOn] as const));
  const state = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];
  const found = new Map<string, string[]>();

  const visit = (key: string): void => {
    const flag = state.get(key) ?? 0;
    if (flag === 2) return;
    if (flag === 1) {
      const from = stack.indexOf(key);
      const cycle = stack.slice(from === -1 ? 0 : from);
      const canonical = canonicalCycle([...cycle, key]);
      found.set(canonical.join('>'), canonical);
      return;
    }
    state.set(key, 1);
    stack.push(key);
    for (const dep of direct.get(key) ?? []) visit(dep);
    stack.pop();
    state.set(key, 2);
  };

  for (const task of plan.tasks) visit(task.key);
  return [...found.values()];
}

/** Rotate a cycle so it always starts at its lexicographically smallest key. */
function canonicalCycle(cycle: string[]): string[] {
  const unique = cycle.slice(0, Math.max(0, cycle.length - 1));
  if (unique.length === 0) return cycle;
  let best = 0;
  for (let i = 1; i < unique.length; i += 1) {
    if ((unique[i] as string) < (unique[best] as string)) best = i;
  }
  const rotated = [...unique.slice(best), ...unique.slice(0, best)];
  return [...rotated, rotated[0] as string];
}

function findOverlap(a: TaskSpec, b: TaskSpec): string | undefined {
  return globsOverlap(a.lane.owns, b.lane.owns)[0];
}

/** A quick health summary for the plan header: three booleans a human can scan. */
export function planHealth(issues: PlanIssue[]): {
  acyclic: boolean;
  lanesDisjoint: boolean;
  everyTaskHasDod: boolean;
} {
  return {
    acyclic: !issues.some((issue) => issue.code === 'cycle'),
    lanesDisjoint: !issues.some((issue) => issue.code === 'lane-overlap'),
    everyTaskHasDod: !issues.some((issue) => issue.code === 'empty-dod'),
  };
}
