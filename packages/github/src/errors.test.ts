import { describe, expect, test } from 'bun:test';
import { isStarlingError, StarlingError } from '@starling/core';
import { GitHubError, isGitHubError } from './errors';

describe('GitHubError', () => {
  test('is a StarlingError carrying the GitHub code in details', () => {
    const err = new GitHubError('GH_AUTH', 'log in first');
    expect(err).toBeInstanceOf(StarlingError);
    expect(err.name).toBe('GitHubError');
    expect(isStarlingError(err)).toBe(true);
    expect(err.githubCode).toBe('GH_AUTH');
    expect(err.details?.githubCode).toBe('GH_AUTH');
    expect(err.code).toBe('EXEC_FAILED');
  });

  test('keeps caller details and promotes repo failures to CONFIG_INVALID', () => {
    const err = new GitHubError('GH_REPO', 'no repo', { details: { argv: 'gh repo view' } });
    expect(err.code).toBe('CONFIG_INVALID');
    expect(err.details).toEqual({ argv: 'gh repo view', githubCode: 'GH_REPO' });
  });

  test('isGitHubError matches only GitHub errors with the requested code', () => {
    const err = new GitHubError('GH_COMMAND', 'exit 1');
    expect(isGitHubError(err)).toBe(true);
    expect(isGitHubError(err, 'GH_COMMAND')).toBe(true);
    expect(isGitHubError(err, 'GH_AUTH')).toBe(false);
    expect(isGitHubError(new StarlingError('EXEC_FAILED', 'boom'))).toBe(false);
    expect(isGitHubError('nope')).toBe(false);
  });
});
