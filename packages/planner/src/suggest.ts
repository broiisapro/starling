/**
 * Lane suggestions: the validator finds an illegal overlap, this file proposes the fixes.
 *
 * For every pair of concurrent tasks whose writable lanes overlap (the same pairs
 * `validatePlan` reports as `lane-overlap`) three kinds of repair are considered:
 *
 * - **serialise** — add a `dependsOn` edge in the direction that keeps the critical path shortest;
 * - **narrow** — replace a broad glob with the concrete files it still needs, leaving the shared
 *   files to the other task (only possible with a repo map, because the files must be enumerable);
 * - **merge** — fold both tasks into one when more than half of each lane overlaps.
 *
 * Suggestions are plain, JSON-serialisable patches rather than closures: the dashboard can send
 * one over HTTP, a PR body can quote it, and `applyLaneSuggestion(plan, suggestion)` is the only
 * place that knows how to mutate a plan. Applying a suggestion never introduces a *new* validator
 * error (the targeted overlap disappears; serialising cannot create a cycle because the pair was
 * concurrent; narrowing only removes glob coverage; merging is skipped when the merged lane would
 * newly overlap a third task).
 */
import {
  globsOverlap,
  matchesGlob,
  normalizeGlobPath,
  type Plan,
  type RepoMap,
  StarlingError,
  type TaskSpec,
} from '@starling/core';
import { overlappingConcurrentPairs } from './lanes';

export type LaneSuggestionKind = 'serialise' | 'narrow' | 'merge';

export interface LaneSerialisePatch {
  kind: 'serialise';
  /** The task that waits. */
  task: string;
  /** The task that must land first. */
  dependsOn: string;
}

export interface LaneNarrowPatch {
  kind: 'narrow';
  task: string;
  /** The replacement writable lane: non-overlapping globs plus concrete files. */
  owns: string[];
}

export interface LaneMergePatch {
  kind: 'merge';
  keep: string;
  absorb: string;
}

export type LaneSuggestionPatch = LaneSerialisePatch | LaneNarrowPatch | LaneMergePatch;

export interface LaneSuggestion {
  kind: LaneSuggestionKind;
  /** The overlapping pair, ordered lexicographically for a stable identity. */
  taskKeys: [string, string];
  /** Why this fix was proposed, with the measured overlap or critical path. */
  rationale: string;
  /** JSON-serialisable instruction; apply it with `applyLaneSuggestion`. */
  patch: LaneSuggestionPatch;
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const clean = raw.trim();
    if (clean === '' || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out;
}

function writableGlobs(task: TaskSpec): string[] {
  return dedupe(task.lane.owns.map((glob) => normalizeGlobPath(glob)));
}

function findTask(plan: Plan, key: string, operation: string): TaskSpec {
  const task = plan.tasks.find((entry) => entry.key === key);
  if (task === undefined) {
    throw new StarlingError('INVALID_ARGUMENT', `${operation}: no task "${key}" in the plan`, {
      details: { taskKey: key },
    });
  }
  return task;
}

function withDependency(plan: Plan, taskKey: string, dependsOn: string): Plan {
  findTask(plan, taskKey, 'serialise');
  findTask(plan, dependsOn, 'serialise');
  return {
    ...plan,
    tasks: plan.tasks.map((task) =>
      task.key === taskKey ? { ...task, dependsOn: dedupe([...task.dependsOn, dependsOn]) } : task,
    ),
  };
}

function narrowOwns(task: TaskSpec, other: TaskSpec, map: RepoMap): string[] | undefined {
  const otherGlobs = writableGlobs(other);
  const files = map.files.map((file) => normalizeGlobPath(file.path));
  const replacement: string[] = [];
  let changed = false;

  for (const glob of writableGlobs(task)) {
    const matched = files.filter((file) => matchesGlob(file, glob));
    if (matched.length === 0) {
      // Nothing in the map proves an overlap inside this glob; keep it rather than guess.
      replacement.push(glob);
      continue;
    }
    const kept = matched.filter((file) => !otherGlobs.some((otherGlob) => matchesGlob(file, otherGlob)));
    if (kept.length === matched.length) {
      replacement.push(glob);
      continue;
    }
    changed = true;
    // Expand the surviving files so the shared ones stay with exactly one owner. Sorted for
    // deterministic patches; new (not-yet-existing) files are not covered by this fix.
    replacement.push(...kept.sort((a, b) => a.localeCompare(b)));
  }

  const owns = dedupe(replacement);
  if (!changed || owns.length === 0) return undefined;
  return owns;
}

function pickNarrow(
  first: TaskSpec,
  second: TaskSpec,
  map: RepoMap,
): { task: TaskSpec; owns: string[] } | undefined {
  const candidates: Array<{ task: TaskSpec; owns: string[] }> = [];
  const directions: Array<[TaskSpec, TaskSpec]> = [
    [first, second],
    [second, first],
  ];
  for (const [task, other] of directions) {
    const owns = narrowOwns(task, other, map);
    if (owns !== undefined) candidates.push({ task, owns });
  }
  if (candidates.length === 0) return undefined;
  // Prefer the direction that keeps the most concrete files: the least destructive narrow.
  const concrete = (owns: string[]): number => owns.filter((glob) => !/[*?[]/.test(glob)).length;
  candidates.sort((x, y) => concrete(y.owns) - concrete(x.owns) || x.task.key.localeCompare(y.task.key));
  return candidates[0];
}

/**
 * Longest dependency chain in minutes. Then engine schedules tasks by the DAG, so this is the
 * lower bound on run duration: the number a serialise suggestion must not grow more than necessary.
 */
export function criticalPathMinutes(tasks: TaskSpec[]): number {
  const byKey = new Map<string, TaskSpec>();
  for (const task of tasks) if (!byKey.has(task.key)) byKey.set(task.key, task);
  const memo = new Map<string, number>();
  const visiting = new Set<string>();

  const longest = (key: string): number => {
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    const task = byKey.get(key);
    if (task === undefined) return 0;
    if (visiting.has(key)) return 0; // Cycles are a validator error; stay total anyway.
    visiting.add(key);
    let upstream = 0;
    for (const dep of task.dependsOn) {
      const length = longest(dep);
      if (length > upstream) upstream = length;
    }
    visiting.delete(key);
    const total = upstream + Math.max(0, task.estimateMin);
    memo.set(key, total);
    return total;
  };

  let critical = 0;
  for (const task of tasks) critical = Math.max(critical, longest(task.key));
  return critical;
}

function serialiseSuggestion(plan: Plan, first: TaskSpec, second: TaskSpec, hits: string[]): LaneSuggestion {
  const firstBefore = criticalPathMinutes(withDependency(plan, second.key, first.key).tasks);
  const secondBefore = criticalPathMinutes(withDependency(plan, first.key, second.key).tasks);
  const wait = firstBefore <= secondBefore ? second : first;
  const dependency = wait === second ? first : second;
  const chosen = Math.min(firstBefore, secondBefore);
  const other = Math.max(firstBefore, secondBefore);
  return {
    kind: 'serialise',
    taskKeys: [first.key, second.key],
    rationale: `serialise "${wait.key}" after "${dependency.key}": the critical path becomes ${chosen} min instead of ${other} min the other way; overlap: ${hits.join('; ')}`,
    patch: { kind: 'serialise', task: wait.key, dependsOn: dependency.key },
  };
}

function mergeRatio(first: TaskSpec, second: TaskSpec, hits: string[], map: RepoMap | undefined): number {
  if (map === undefined) {
    const globsFirst = writableGlobs(first).length;
    const globsSecond = writableGlobs(second).length;
    if (globsFirst === 0 || globsSecond === 0) return 0;
    return hits.length / (globsFirst * globsSecond);
  }
  const firstFiles = new Set(
    map.files
      .map((file) => normalizeGlobPath(file.path))
      .filter((file) => writableGlobs(first).some((glob) => matchesGlob(file, glob))),
  );
  const secondFiles = new Set(
    map.files
      .map((file) => normalizeGlobPath(file.path))
      .filter((file) => writableGlobs(second).some((glob) => matchesGlob(file, glob))),
  );
  if (firstFiles.size === 0 || secondFiles.size === 0) return 0;
  let shared = 0;
  for (const file of firstFiles) if (secondFiles.has(file)) shared += 1;
  return Math.min(shared / firstFiles.size, shared / secondFiles.size);
}

function mergeWouldCollide(plan: Plan, keep: TaskSpec, absorb: TaskSpec): boolean {
  const mergedOwns = dedupe([...writableGlobs(keep), ...writableGlobs(absorb)]);
  for (const other of plan.tasks) {
    if (other.key === keep.key || other.key === absorb.key) continue;
    const mergedOverlap = globsOverlap(mergedOwns, writableGlobs(other)).length > 0;
    if (!mergedOverlap) continue;
    const keepOverlapped = globsOverlap(writableGlobs(keep), writableGlobs(other)).length > 0;
    const absorbOverlapped = globsOverlap(writableGlobs(absorb), writableGlobs(other)).length > 0;
    // A new error would be introduced only when neither half overlapped this task before.
    if (!keepOverlapped && !absorbOverlapped) return true;
  }
  return false;
}

function mergeSuggestion(
  plan: Plan,
  first: TaskSpec,
  second: TaskSpec,
  hits: string[],
  map: RepoMap | undefined,
): LaneSuggestion | undefined {
  const ratio = mergeRatio(first, second, hits, map);
  if (ratio <= 0.5) return undefined;
  if (mergeWouldCollide(plan, first, second)) return undefined;
  const percent = Math.round(ratio * 100);
  return {
    kind: 'merge',
    taskKeys: [first.key, second.key],
    rationale: `merge "${second.key}" into "${first.key}": ${percent}% of the smaller lane is shared, so one task covering both is cheaper than a serialised pair; overlap: ${hits.join('; ')}`,
    patch: { kind: 'merge', keep: first.key, absorb: second.key },
  };
}

/**
 * Every overlap between concurrent tasks, with the fixes that make sense for it. Pairs and kinds
 * are ordered deterministically; the function is pure and never mutates `plan`.
 */
export function suggestLanes(plan: Plan, map?: RepoMap): LaneSuggestion[] {
  const suggestions: LaneSuggestion[] = [];

  for (const { a, b, hits } of overlappingConcurrentPairs(plan.tasks)) {
    const first = a.key <= b.key ? a : b;
    const second = first === a ? b : a;

    suggestions.push(serialiseSuggestion(plan, first, second, hits));

    if (map !== undefined) {
      const narrow = pickNarrow(first, second, map);
      if (narrow !== undefined) {
        const otherKey = narrow.task.key === first.key ? second.key : first.key;
        suggestions.push({
          kind: 'narrow',
          taskKeys: [first.key, second.key],
          rationale: `narrow "${narrow.task.key}": keep ${narrow.owns.length} explicit path(s) from the repo map and leave the shared files to "${otherKey}"`,
          patch: { kind: 'narrow', task: narrow.task.key, owns: narrow.owns },
        });
      }
    }

    const merge = mergeSuggestion(plan, first, second, hits, map);
    if (merge !== undefined) suggestions.push(merge);
  }

  const rank: Record<LaneSuggestionKind, number> = { serialise: 0, narrow: 1, merge: 2 };
  return suggestions.sort(
    (x, y) =>
      x.taskKeys[0].localeCompare(y.taskKeys[0]) ||
      x.taskKeys[1].localeCompare(y.taskKeys[1]) ||
      rank[x.kind] - rank[y.kind],
  );
}

function mergedTask(keep: TaskSpec, absorb: TaskSpec): TaskSpec {
  const goal =
    keep.goal.trim() === ''
      ? absorb.goal
      : absorb.goal.trim() === ''
        ? keep.goal
        : `${keep.goal}\n\n${absorb.goal}`;
  return {
    ...keep,
    goal,
    deliverables: dedupe([...keep.deliverables, ...absorb.deliverables]),
    outOfScope: dedupe([...keep.outOfScope, ...absorb.outOfScope]),
    definitionOfDone: dedupe([...keep.definitionOfDone, ...absorb.definitionOfDone]),
    dependsOn: dedupe([...keep.dependsOn, ...absorb.dependsOn]).filter(
      (dep) => dep !== keep.key && dep !== absorb.key,
    ),
    lane: {
      owns: dedupe([...keep.lane.owns, ...absorb.lane.owns]),
      reads: dedupe([...keep.lane.reads, ...absorb.lane.reads]),
    },
    estimateMin: Math.max(keep.estimateMin, 0) + Math.max(absorb.estimateMin, 0),
  };
}

/**
 * Apply one suggestion. Pure: returns a new plan and never mutates the input. Throws
 * `StarlingError('INVALID_ARGUMENT')` when the patch names a task the plan does not have.
 */
export function applyLaneSuggestion(plan: Plan, suggestion: LaneSuggestion): Plan {
  const { patch } = suggestion;
  if (suggestion.kind !== patch.kind) {
    throw new StarlingError('INVALID_ARGUMENT', 'lane suggestion kind does not match its patch', {
      details: { kind: suggestion.kind, patchKind: patch.kind },
    });
  }

  if (patch.kind === 'serialise') {
    return withDependency(plan, patch.task, patch.dependsOn);
  }

  if (patch.kind === 'narrow') {
    findTask(plan, patch.task, 'narrow');
    if (patch.owns.length === 0) {
      throw new StarlingError('INVALID_ARGUMENT', 'narrow suggestion would leave an empty lane', {
        details: { taskKey: patch.task },
      });
    }
    return {
      ...plan,
      tasks: plan.tasks.map((task) =>
        task.key === patch.task ? { ...task, lane: { ...task.lane, owns: [...patch.owns] } } : task,
      ),
    };
  }

  const keep = findTask(plan, patch.keep, 'merge');
  const absorb = findTask(plan, patch.absorb, 'merge');
  if (keep.key === absorb.key) {
    throw new StarlingError('INVALID_ARGUMENT', 'merge suggestion needs two different tasks', {
      details: { taskKey: keep.key },
    });
  }
  const merged = mergedTask(keep, absorb);
  const tasks: TaskSpec[] = [];
  for (const task of plan.tasks) {
    if (task.key === absorb.key) continue;
    if (task.key === keep.key) {
      tasks.push(merged);
      continue;
    }
    // Anything that waited for the absorbed task now waits for the survivor.
    const dependsOn = dedupe(task.dependsOn.map((dep) => (dep === absorb.key ? keep.key : dep))).filter(
      (dep) => dep !== task.key,
    );
    tasks.push({ ...task, dependsOn });
  }
  return { ...plan, tasks };
}
