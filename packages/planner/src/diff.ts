/**
 * Plan diffing for re-plans: what changed between plan A and plan B?
 *
 * Written for the dashboard (Epic 131 highlights changed tasks in the DAG) and for run comparisons
 * (Epic 122), so it is pure, deterministic and free of presentation dependencies. Tasks are matched
 * by `key` first — the stable `tNN-kebab` scheme means a re-plan usually reuses keys — and by
 * normalised title second, so a plan that re-keyed a task reads as a rename rather than an
 * add+remove pair.
 *
 * `TaskSpec` has no `description` field; the `description` change bucket covers `goal`,
 * `deliverables` and `outOfScope` (everything a human reads as "what the task is").
 */
import type { Plan, TaskSpec } from '@starling/core';
import { stripTaskNumber } from './keys';

export type PlanDiffField =
  | 'title'
  | 'lane'
  | 'dependsOn'
  | 'definitionOfDone'
  | 'estimateMin'
  | 'description';

export interface PlanDiffChange {
  /** The key in the newer plan (`b`). Use `renamed` to find the old key. */
  key: string;
  /** Changed fields in the fixed order above. */
  fields: PlanDiffField[];
  /** Writable globs added in `b` (owns only; reads changes surface as the `lane` field). */
  laneAdded: string[];
  /** Writable globs removed in `b`. */
  laneRemoved: string[];
}

export interface PlanDiffRename {
  from: string;
  to: string;
}

export interface PlanDiff {
  /** Tasks in `b` with no match in `a`, in `b` task order. */
  added: TaskSpec[];
  /** Tasks in `a` with no match in `b`, in `a` task order. */
  removed: TaskSpec[];
  /** Matched-by-title pairs whose keys differ, in `a` task order. */
  renamed: PlanDiffRename[];
  /** Key-matched or renamed pairs with at least one changed field, in `a` task order. */
  changed: PlanDiffChange[];
  /** Keys that exist in both plans, are not renamed, and did not change, in `a` task order. */
  unchanged: string[];
  /** One-line counts, e.g. `1 added, 0 removed, 1 renamed, 1 changed, 5 unchanged`. */
  summary: string;
}

/**
 * Identity of a title for matching: drop a leading `tNN-` (a model sometimes copies its key into
 * the title), lower-case and collapse whitespace. Punctuation is left alone: it is part of the title.
 */
export function normalizeTaskTitle(title: string): string {
  return stripTaskNumber(title.trim()).toLowerCase().replace(/\s+/g, ' ').trim();
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function addedIn(next: string[], previous: string[]): string[] {
  const before = new Set(previous);
  return uniqueSorted(next.filter((value) => !before.has(value)));
}

function sameStringSet(a: string[], b: string[]): boolean {
  const left = uniqueSorted(a);
  const right = uniqueSorted(b);
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameStringList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function sameDescription(a: TaskSpec, b: TaskSpec): boolean {
  return (
    a.goal === b.goal &&
    sameStringList(a.deliverables, b.deliverables) &&
    sameStringList(a.outOfScope, b.outOfScope)
  );
}

interface MatchedPair {
  a: TaskSpec;
  b: TaskSpec;
  /** True when the pair matched by normalised title rather than by key. */
  renamed: boolean;
}

function pairTasks(a: Plan, b: Plan): { pairs: MatchedPair[]; removed: TaskSpec[]; added: TaskSpec[] } {
  const bByKey = new Map<string, TaskSpec>();
  for (const task of b.tasks) if (!bByKey.has(task.key)) bByKey.set(task.key, task);

  const pairs: MatchedPair[] = [];
  const claimedB = new Set<string>();
  const unmatchedA: TaskSpec[] = [];

  // 1. stable keys win.
  for (const task of a.tasks) {
    const match = bByKey.get(task.key);
    if (match !== undefined && !claimedB.has(match.key)) {
      pairs.push({ a: task, b: match, renamed: false });
      claimedB.add(match.key);
    } else {
      unmatchedA.push(task);
    }
  }

  // 2. fallen-through tasks may have been re-keyed but kept their title.
  const unmatchedBByTitle = new Map<string, TaskSpec[]>();
  for (const task of b.tasks) {
    if (claimedB.has(task.key)) continue;
    const title = normalizeTaskTitle(task.title);
    const bucket = unmatchedBByTitle.get(title);
    if (bucket === undefined) unmatchedBByTitle.set(title, [task]);
    else bucket.push(task);
  }

  const removed: TaskSpec[] = [];
  for (const task of unmatchedA) {
    const bucket = unmatchedBByTitle.get(normalizeTaskTitle(task.title));
    const match = bucket?.shift();
    if (match === undefined) {
      removed.push(task);
      continue;
    }
    pairs.push({ a: task, b: match, renamed: true });
    claimedB.add(match.key);
  }

  const added = b.tasks.filter((task) => !claimedB.has(task.key));
  return { pairs, removed, added };
}

function diffPair(pair: MatchedPair): PlanDiffChange | undefined {
  const fields: PlanDiffField[] = [];
  const laneAdded = addedIn(pair.b.lane.owns, pair.a.lane.owns);
  const laneRemoved = addedIn(pair.a.lane.owns, pair.b.lane.owns);

  if (pair.a.title !== pair.b.title) fields.push('title');
  if (
    laneAdded.length > 0 ||
    laneRemoved.length > 0 ||
    !sameStringSet(pair.a.lane.owns, pair.b.lane.owns) ||
    !sameStringSet(pair.a.lane.reads, pair.b.lane.reads)
  ) {
    fields.push('lane');
  }
  if (!sameStringSet(pair.a.dependsOn, pair.b.dependsOn)) fields.push('dependsOn');
  if (!sameStringList(pair.a.definitionOfDone, pair.b.definitionOfDone)) fields.push('definitionOfDone');
  if (pair.a.estimateMin !== pair.b.estimateMin) fields.push('estimateMin');
  if (!sameDescription(pair.a, pair.b)) fields.push('description');

  if (fields.length === 0) return undefined;
  return { key: pair.b.key, fields, laneAdded, laneRemoved };
}

/** Compare two plans. Pure; neither plan is mutated. Order is derived from `a`'s task order. */
export function diffPlans(a: Plan, b: Plan): PlanDiff {
  const { pairs, removed, added } = pairTasks(a, b);

  const renamed: PlanDiffRename[] = [];
  const changed: PlanDiffChange[] = [];
  const unchanged: string[] = [];

  for (const pair of pairs) {
    if (pair.renamed) renamed.push({ from: pair.a.key, to: pair.b.key });
    const change = diffPair(pair);
    if (change !== undefined) changed.push(change);
    else if (!pair.renamed) unchanged.push(pair.a.key);
  }

  const count = (n: number, word: string): string => `${n} ${word}`;
  const summary = [
    count(added.length, 'added'),
    count(removed.length, 'removed'),
    count(renamed.length, 'renamed'),
    count(changed.length, 'changed'),
    count(unchanged.length, 'unchanged'),
  ].join(', ');

  return { added, removed, renamed, changed, unchanged, summary };
}

function quoteKeys(keys: string[]): string {
  return keys.map((key) => `\`${key}\``).join(', ');
}

/** Render a plan diff as Markdown for the CLI, a PR body or the dashboard. */
export function formatPlanDiff(diff: PlanDiff): string {
  const lines: string[] = ['# Plan diff', '', `**Summary:** ${diff.summary}`];
  const nothing =
    diff.added.length === 0 &&
    diff.removed.length === 0 &&
    diff.renamed.length === 0 &&
    diff.changed.length === 0;

  if (nothing) {
    lines.push('', 'No task changes.');
    return lines.join('\n');
  }

  if (diff.added.length > 0) {
    lines.push('', `## Added (${diff.added.length})`);
    for (const task of diff.added) lines.push(`- \`${task.key}\` — ${task.title}`);
  }

  if (diff.removed.length > 0) {
    lines.push('', `## Removed (${diff.removed.length})`);
    for (const task of diff.removed) lines.push(`- \`${task.key}\` — ${task.title}`);
  }

  if (diff.renamed.length > 0) {
    lines.push('', `## Renamed (${diff.renamed.length})`);
    for (const rename of diff.renamed) lines.push(`- \`${rename.from}\` -> \`${rename.to}\``);
  }

  if (diff.changed.length > 0) {
    lines.push('', `## Changed (${diff.changed.length})`);
    for (const change of diff.changed) {
      const laneParts: string[] = [];
      if (change.laneAdded.length > 0) laneParts.push(`+${change.laneAdded.join(', +')}`);
      if (change.laneRemoved.length > 0) laneParts.push(`-${change.laneRemoved.join(', -')}`);
      const lane = laneParts.length === 0 ? '' : ` (lane ${laneParts.join(' ')})`;
      lines.push(`- \`${change.key}\`: ${change.fields.join(', ')}${lane}`);
    }
  }

  if (diff.unchanged.length > 0) {
    lines.push('', `## Unchanged (${diff.unchanged.length})`, `- ${quoteKeys(diff.unchanged)}`);
  }

  return lines.join('\n');
}
