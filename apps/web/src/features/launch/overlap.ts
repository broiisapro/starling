import type { Plan, PlanIssue, TaskSpec } from '@starling/core';
import { globsOverlap } from '@starling/core/browser';

/**
 * Lane-overlap preview.
 *
 * The planner only requires *concurrently runnable* tasks to have disjoint `lane.owns` globs; two
 * tasks where one depends on the other may legitimately touch the same file. So this module first
 * asks "can these two be in flight at the same time?" and only then compares globs with core's
 * conservative `globsOverlap` (the same matcher the planner validates with).
 *
 * The result is a preview, not a gate: the server's validator is authoritative and its `issues` are
 * folded into the report so a badge never claims "clear" when the planner said otherwise.
 */

export interface LaneOverlap {
  a: string;
  b: string;
  /** False when one task waits for the other — a shared file is then a hand-off, not a conflict. */
  concurrent: boolean;
  /** The glob pairs that could write the same paths. */
  globs: string[];
}

export interface OverlapReport {
  overlaps: LaneOverlap[];
  /** The subset that matters: pairs that can run at once. */
  concurrent: LaneOverlap[];
  errorCount: number;
  warnCount: number;
  /** Error issues from the validator (cycles, missing deps, empty lanes…). */
  errors: PlanIssue[];
  warnings: PlanIssue[];
  /** No concurrent overlap and no error-severity issue of any kind. */
  clear: boolean;
}

function taskOf(plan: Plan, key: string): TaskSpec | undefined {
  return plan.tasks.find((task) => task.key === key);
}

/** Does `from` need `target` (directly or through the chain)? Cycles terminate via `seen`. */
export function dependsOn(plan: Plan, from: string, target: string): boolean {
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    if (seen.has(current)) continue;
    seen.add(current);
    const task = taskOf(plan, current);
    if (task === undefined) continue;
    for (const dependency of task.dependsOn) {
      if (dependency === target) return true;
      stack.push(dependency);
    }
  }
  return false;
}

/** Every pair of tasks whose `lane.owns` globs could collide, annotated with concurrency. */
export function findLaneOverlaps(plan: Plan): LaneOverlap[] {
  const overlaps: LaneOverlap[] = [];
  for (let i = 0; i < plan.tasks.length; i += 1) {
    for (let j = i + 1; j < plan.tasks.length; j += 1) {
      const a = plan.tasks[i] as TaskSpec;
      const b = plan.tasks[j] as TaskSpec;
      const globs = globsOverlap(a.lane.owns, b.lane.owns);
      if (globs.length === 0) continue;
      const ordered = dependsOn(plan, a.key, b.key) || dependsOn(plan, b.key, a.key);
      overlaps.push({ a: a.key, b: b.key, concurrent: !ordered, globs });
    }
  }
  return overlaps;
}

export function overlapReport(plan: Plan, issues: readonly PlanIssue[] = []): OverlapReport {
  const overlaps = findLaneOverlaps(plan);
  const concurrent = overlaps.filter((overlap) => overlap.concurrent);
  const errors = issues.filter((issue) => issue.severity === 'error');
  const warnings = issues.filter((issue) => issue.severity === 'warn');
  return {
    overlaps,
    concurrent,
    errors,
    warnings,
    errorCount: errors.length,
    warnCount: warnings.length,
    clear: concurrent.length === 0 && errors.length === 0,
  };
}
