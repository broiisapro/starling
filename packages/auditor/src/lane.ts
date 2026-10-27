import { matchesAny, normalizeGlobPath } from '@starling/core';

/**
 * Paths Starling itself writes while a task runs. They are never a worker's responsibility, so the
 * lane check ignores them instead of blaming the worker for the framework's bookkeeping.
 *
 * - `.starling/**` — the SQLite store, per-run JSONL event logs, recordings.
 * - `.starling-worktrees/**` — only when `worktreeRoot` is configured inside the target repo.
 *
 * Lockfiles are deliberately **not** exempt: a dependency change is a real change and deserves the
 * integrator's attention. (The default `worktreeRoot` lives outside the repo, so this list is short
 * on purpose.)
 */
export const STARLING_BOOKKEEPING_GLOBS = ['.starling/**', '.starling-worktrees/**'] as const;

export interface LaneCheckResult {
  ok: boolean;
  /** Changed files outside the lane, in diff order. */
  violations: string[];
  /** Number of files examined (violations included). */
  checked: number;
}

/** True for framework bookkeeping paths that no worker owns. */
export function isBookkeepingPath(path: string): boolean {
  const normalized = normalizeGlobPath(path);
  return STARLING_BOOKKEEPING_GLOBS.some((glob) => matchesAny(normalized, [glob]));
}

/**
 * Enforce `task.lane.owns`. Directory semantics come from core's `matchesGlob` (`src/ui` owns
 * `src/ui/render.ts`), so a lane may be written either way.
 */
export function checkLane(changedFiles: readonly string[], owns: readonly string[]): LaneCheckResult {
  const violations: string[] = [];
  for (const file of changedFiles) {
    const path = normalizeGlobPath(file);
    if (isBookkeepingPath(path)) continue;
    if (owns.length === 0 || !matchesAny(path, [...owns])) violations.push(path);
  }
  return {
    ok: violations.length === 0,
    violations,
    checked: changedFiles.length,
  };
}
