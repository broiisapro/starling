import type { StarlingErrorCode, StarlingErrorOptions } from '@starling/core';
import { StarlingError } from '@starling/core';

/**
 * GitHub-specific failure codes.
 *
 * `StarlingErrorCode` in `@starling/core` is frozen for Wave 1 and does not carry a GitHub member, so
 * these live here and ride along in `details.githubCode`. The core code is the closest existing
 * bucket (see `coreCodeFor`). `isStarlingError(err)` still works for every `GitHubError`.
 *
 * CONTRACT REQUEST (epic 18): add `GH_AUTH | GH_REPO | GH_COMMAND | GH_MISSING` to
 * `StarlingErrorCode` so this package can drop the local subclass.
 */
export type GitHubErrorCode = 'GH_AUTH' | 'GH_REPO' | 'GH_COMMAND' | 'GH_MISSING';

export class GitHubError extends StarlingError {
  /** The GitHub-domain code. Prefer this over `code` when branching on failure kind. */
  readonly githubCode: GitHubErrorCode;

  constructor(githubCode: GitHubErrorCode, message: string, options: StarlingErrorOptions = {}) {
    super(coreCodeFor(githubCode), message, {
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

function coreCodeFor(code: GitHubErrorCode): StarlingErrorCode {
  switch (code) {
    case 'GH_REPO':
      return 'CONFIG_INVALID';
    default:
      // gh/git are external processes: a missing binary, a bad exit and a login problem all surface
      // through `exec`'s EXEC_FAILED bucket rather than pretending to be a Starling internal bug.
      return 'EXEC_FAILED';
  }
}
