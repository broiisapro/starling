import type { StarlingErrorOptions } from '@starling/core';
import { StarlingError } from '@starling/core';

/**
 * GitHub-specific failure codes.
 *
 * These are first-class `StarlingErrorCode` members since checkpoint C1, so `err.code` reads
 * `GH_AUTH` / `GH_REPO` / `GH_COMMAND` / `GH_MISSING` and `isStarlingError(err, 'GH_AUTH')` works.
 * `GitHubError` stays as a subclass because it is a useful marker (and keeps `githubCode`, which is
 * now simply the same value as `code`).
 */
export type GitHubErrorCode = 'GH_AUTH' | 'GH_REPO' | 'GH_COMMAND' | 'GH_MISSING';

export class GitHubError extends StarlingError {
  /** The GitHub-domain code. Always identical to `code`; kept so older callers keep compiling. */
  readonly githubCode: GitHubErrorCode;

  constructor(githubCode: GitHubErrorCode, message: string, options: StarlingErrorOptions = {}) {
    super(githubCode, message, {
      ...options,
      details: { ...options.details, githubCode },
    });
    this.name = 'GitHubError';
    this.githubCode = githubCode;
  }
}

/** True when `err` is a `GitHubError` carrying `code` (or any GitHubError when code is omitted). */
export function isGitHubError(err: unknown, code?: GitHubErrorCode): err is GitHubError {
  return err instanceof GitHubError && (code === undefined || err.githubCode === code);
}
