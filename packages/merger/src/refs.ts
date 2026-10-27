import { StarlingError } from '@starling/core';
import { type Git, outputTail } from './git.ts';

/** Fail fast with a useful message when the repo path is not a git work tree. */
export async function assertGitRepo(git: Git, repo: string): Promise<string> {
  const result = await git.run(repo, ['rev-parse', '--show-toplevel']);
  if (result.code !== 0) {
    throw new StarlingError('MERGE_ERROR', `Not a git repository: ${repo}`, {
      details: { repo, tail: outputTail(result) },
    });
  }
  return result.stdout.trim();
}

/**
 * Assert that `branch` is a local branch with a commit.
 *
 * The merger only ever lands local task branches (`starling/<run>/<task>`) onto a local integration
 * branch; remote-tracking refs are resolved by the caller (the engine's bundle import).
 */
export async function assertBranch(git: Git, repo: string, branch: string, label: string): Promise<void> {
  if (branch.trim().length === 0) {
    throw new StarlingError('INVALID_ARGUMENT', `The ${label} branch name is empty`);
  }
  const result = await git.run(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}^{commit}`]);
  if (result.code !== 0) {
    throw new StarlingError('MERGE_ERROR', `The ${label} branch "${branch}" does not exist in ${repo}`, {
      details: { repo, branch, label },
    });
  }
}

/** True when `branch` is already contained in `integrationBranch`. */
export async function isAncestor(
  git: Git,
  repo: string,
  branch: string,
  integrationBranch: string,
): Promise<boolean> {
  const result = await git.run(repo, ['merge-base', '--is-ancestor', branch, integrationBranch]);
  return result.code === 0;
}
