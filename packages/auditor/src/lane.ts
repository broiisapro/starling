import { posix } from 'node:path';
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

/** Why a raw path cannot be trusted as a diff path (SEC-08). */
export type LanePathProblem = 'traversal' | 'absolute' | 'invalid';

export interface CanonicalLanePath {
  /** `\` → `/`, then `normalizeGlobPath`, then `posix.normalize`. Never used for matching when `problem` is set. */
  path: string;
  /**
   * Set when the raw path is one `git diff` can never emit: a `..` segment, an absolute path, an
   * empty path or a NUL byte. `TaskResult.changedFiles` is a plain `string[]` on the wire, so a
   * hostile perch (or a buggy agent) chooses these values; git itself never produces them.
   */
  problem?: LanePathProblem;
}

/**
 * Canonicalise one changed-file path before it is matched against a lane.
 *
 * The raw string is checked **before** normalisation on purpose: `src/../secrets.env` normalises to
 * `secrets.env`, which is outside the lane, but `src/../src/a.ts` normalises back inside it. Both are
 * a hostile signal — a real diff path has no `..` segment — so the check must not depend on where
 * normalisation lands. `posix.normalize` only makes the reported path stable.
 *
 * A `..` segment is checked after converting backslashes, so `src\..\secrets.env` is caught too.
 */
export function canonicalLanePath(raw: string): CanonicalLanePath {
  const slashed = raw.replace(/\\/g, '/');
  const normalized = normalizeGlobPath(raw);
  if (normalized === '' || slashed.includes('\0')) return { path: normalized, problem: 'invalid' };
  if (posix.isAbsolute(slashed) || /^[A-Za-z]:\//.test(slashed)) {
    return { path: posix.normalize(normalized), problem: 'absolute' };
  }
  if (slashed.split('/').includes('..')) {
    return { path: posix.normalize(normalized), problem: 'traversal' };
  }
  return { path: posix.normalize(normalized) };
}

export interface LaneCheckResult {
  ok: boolean;
  /** Changed files outside the lane, in diff order. */
  violations: string[];
  /** Number of files examined (violations included). */
  checked: number;
  /**
   * Additive (Epic 103): why each violation was rejected. Keys are the strings in `violations`, so
   * the dashboard can tell "outside the lane" apart from a hostile `..` or an absolute path.
   */
  problems?: Record<string, LanePathProblem | 'outside-lane'>;
}

/**
 * True for framework bookkeeping paths that no worker owns.
 *
 * A path that is not canonical is never bookkeeping: `.starling/../package.json` would otherwise
 * match `.starling/**` and be exempt from the lane check (the SEC-08 bypass in its bookkeeping form).
 */
export function isBookkeepingPath(path: string): boolean {
  const canonical = canonicalLanePath(path);
  if (canonical.problem !== undefined) return false;
  return STARLING_BOOKKEEPING_GLOBS.some((glob) => matchesAny(canonical.path, [glob]));
}

/**
 * Enforce `task.lane.owns`. Directory semantics come from core's `matchesGlob` (`src/ui` owns
 * `src/ui/render.ts`), so a lane may be written either way.
 *
 * Paths with a `problem` are violations before glob matching happens (SEC-08): a traversal or an
 * absolute path is not a file inside the repo, so it can never be inside a lane. They are reported
 * as the raw path (trimmed) rather than the normalised one, because the raw path is the evidence.
 */
export function checkLane(changedFiles: readonly string[], owns: readonly string[]): LaneCheckResult {
  const violations: string[] = [];
  const problems: Record<string, LanePathProblem | 'outside-lane'> = {};
  for (const file of changedFiles) {
    const canonical = canonicalLanePath(file);
    if (canonical.problem !== undefined) {
      const reported = file.trim();
      violations.push(reported);
      problems[reported] = canonical.problem;
      continue;
    }
    if (isBookkeepingPath(canonical.path)) continue;
    if (owns.length === 0 || !matchesAny(canonical.path, [...owns])) {
      violations.push(canonical.path);
      problems[canonical.path] = 'outside-lane';
    }
  }
  return {
    ok: violations.length === 0,
    violations,
    checked: changedFiles.length,
    problems,
  };
}
