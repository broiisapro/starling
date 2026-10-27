/**
 * Git version handling.
 *
 * `predictConflicts` needs `git merge-tree --write-tree`, which landed in git 2.38. Older gits still
 * have merge-tree, but without the tree-write mode, so they would silently answer the wrong question.
 * We check once per process and refuse loudly instead.
 */
import type { StarlingErrorCode } from '@starling/core';
import { StarlingError } from '@starling/core';

export interface GitVersion {
  major: number;
  minor: number;
  patch: number;
}

/** First git release with `merge-tree --write-tree`. */
export const MIN_MERGE_TREE_VERSION: GitVersion = { major: 2, minor: 38, patch: 0 };

/** Error code for "git is too old". A first-class `StarlingErrorCode` since checkpoint C1. */
export const GIT_TOO_OLD_CODE = 'GIT_TOO_OLD' as const satisfies StarlingErrorCode;

/** Parse the first `git version X.Y[.Z]` line, tolerating vendor suffixes. */
export function parseGitVersion(output: string): GitVersion | undefined {
  const match = /git version (\d+)\.(\d+)(?:\.(\d+))?/.exec(output);
  if (match === null) return undefined;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = match[3] === undefined ? 0 : Number(match[3]);
  if (!Number.isFinite(major) || !Number.isFinite(minor) || !Number.isFinite(patch)) return undefined;
  return { major, minor, patch };
}

/** Numeric comparison: negative when `a < b`, zero when equal, positive when `a > b`. */
export function compareGitVersions(a: GitVersion, b: GitVersion): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

export function formatGitVersion(v: GitVersion): string {
  return `${v.major}.${v.minor}.${v.patch}`;
}

/** Throw `StarlingError('GIT_TOO_OLD')` unless `found` is at least `min`. */
export function assertGitVersion(found: GitVersion, min: GitVersion = MIN_MERGE_TREE_VERSION): void {
  if (compareGitVersions(found, min) >= 0) return;
  throw new StarlingError(
    GIT_TOO_OLD_CODE,
    `git ${formatGitVersion(min)} or newer is required, found ${formatGitVersion(found)}`,
    { details: { required: formatGitVersion(min), found: formatGitVersion(found) } },
  );
}
