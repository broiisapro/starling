import type { Plan, TaskSpec } from '@starling/core/browser';

/**
 * Task-level plan diff for the compare page.
 *
 * Epic 107 is adding `diffPlans` to `@starling/planner`; this is the local, dependency-free version
 * the prompt asks for (the web must not import a sibling package's internals, and the plan shape is
 * part of the frozen core contract anyway). Tasks are matched by `key`; list fields are compared as
 * sets so a reshuffled lane or dependency list is not reported as a change.
 */

export type PlanDiffField =
  | 'title'
  | 'lane.owns'
  | 'lane.reads'
  | 'dependsOn'
  | 'estimateMin'
  | 'deliverables';

export interface PlanDiffChange {
  key: string;
  fields: PlanDiffField[];
}

export interface PlanDiff {
  added: TaskSpec[];
  removed: TaskSpec[];
  changed: PlanDiffChange[];
  same: string[];
}

/** Order-insensitive comparison for globs and dependency lists. */
function sameList(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((item, index) => item === right[index]);
}

function changedFields(a: TaskSpec, b: TaskSpec): PlanDiffField[] {
  const fields: PlanDiffField[] = [];
  if (a.title !== b.title) fields.push('title');
  if (!sameList(a.lane.owns, b.lane.owns)) fields.push('lane.owns');
  if (!sameList(a.lane.reads, b.lane.reads)) fields.push('lane.reads');
  if (!sameList(a.dependsOn, b.dependsOn)) fields.push('dependsOn');
  if (a.estimateMin !== b.estimateMin) fields.push('estimateMin');
  if (!sameList(a.deliverables, b.deliverables)) fields.push('deliverables');
  return fields;
}

/**
 * Diff two plans by task key. A missing side means "everything on the other side is added/removed",
 * which is what the page shows while one run is still planning.
 */
export function diffPlanTasks(a?: Plan, b?: Plan): PlanDiff {
  const before = a?.tasks ?? [];
  const after = b?.tasks ?? [];
  const beforeByKey = new Map(before.map((task) => [task.key, task]));
  const afterByKey = new Map(after.map((task) => [task.key, task]));

  const added = after.filter((task) => !beforeByKey.has(task.key));
  const removed = before.filter((task) => !afterByKey.has(task.key));
  const changed: PlanDiffChange[] = [];
  const same: string[] = [];

  for (const task of after) {
    const previous = beforeByKey.get(task.key);
    if (previous === undefined) continue;
    const fields = changedFields(previous, task);
    if (fields.length === 0) same.push(task.key);
    else changed.push({ key: task.key, fields });
  }

  return { added, removed, changed, same };
}

/** A short human list for a changed row: "lane.owns · estimateMin". */
export function describeChangedFields(fields: readonly PlanDiffField[]): string {
  return fields.length === 0 ? 'no changes' : fields.join(' · ');
}
