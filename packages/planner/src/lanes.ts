/**
 * Lane helpers shared by the validator and by lane suggestions.
 *
 * `overlappingConcurrentPairs` is the single implementation of the rule the validator enforces:
 * two tasks may share files only when the DAG already serialises them. `suggestLanes` consumes the
 * same pairs, so a suggestion can never target a pair the validator would consider legal.
 */
import { globsOverlap, matchesGlob, normalizeGlobPath, type RepoMap, type TaskSpec } from '@starling/core';
import { buildDepGraph, canRunConcurrently } from './graph';

export interface LaneOverlap {
  a: TaskSpec;
  b: TaskSpec;
  /** `"<a glob> <=> <b glob>"` for every overlapping glob pair, in lane order. */
  hits: string[];
}

function writableGlobs(task: TaskSpec): string[] {
  return task.lane.owns.filter((glob) => glob.trim() !== '');
}

/**
 * Every concurrent task pair whose writable lanes overlap, in plan order (`i < j`). This is the
 * exact work `validatePlan` performs for its `lane-overlap` check: one entry per pair, one pair
 * examined once.
 */
export function overlappingConcurrentPairs(tasks: TaskSpec[]): LaneOverlap[] {
  const graph = buildDepGraph(tasks);
  const pairs: LaneOverlap[] = [];
  for (let i = 0; i < tasks.length; i += 1) {
    const a = tasks[i] as TaskSpec;
    for (let j = i + 1; j < tasks.length; j += 1) {
      const b = tasks[j] as TaskSpec;
      if (a.key === b.key) continue;
      if (!canRunConcurrently(graph, a.key, b.key)) continue;
      const hits = globsOverlap(writableGlobs(a), writableGlobs(b));
      if (hits.length > 0) pairs.push({ a, b, hits });
    }
  }
  return pairs;
}

/**
 * Files under a task's writable lane, as repo-relative paths in map order, de-duplicated. Only
 * files the repo map knows about can be counted; a glob for a brand-new folder owns zero here.
 */
export function ownedFiles(task: TaskSpec, map: RepoMap): string[] {
  const globs = writableGlobs(task).map((glob) => normalizeGlobPath(glob));
  const seen = new Set<string>();
  const files: string[] = [];
  for (const file of map.files) {
    const path = normalizeGlobPath(file.path);
    if (seen.has(path)) continue;
    if (globs.some((glob) => matchesGlob(path, glob))) {
      seen.add(path);
      files.push(path);
    }
  }
  return files;
}

/** How many distinct map files a task's writable lane matches. */
export function ownedFileCount(task: TaskSpec, map: RepoMap): number {
  return ownedFiles(task, map).length;
}
