import { describe, expect, test } from 'bun:test';
import { isStarlingError } from '@starling/core';
import {
  assertGitVersion,
  compareGitVersions,
  formatGitVersion,
  GIT_TOO_OLD_CODE,
  MIN_MERGE_TREE_VERSION,
  parseGitVersion,
} from './version.ts';

describe('parseGitVersion', () => {
  test('parses a plain version', () => {
    expect(parseGitVersion('git version 2.54.0\n')).toEqual({ major: 2, minor: 54, patch: 0 });
  });

  test('tolerates vendor suffixes and missing patch numbers', () => {
    expect(parseGitVersion('git version 2.39.3 (Apple Git-152)')).toEqual({
      major: 2,
      minor: 39,
      patch: 3,
    });
    expect(parseGitVersion('git version 2.38\n')).toEqual({ major: 2, minor: 38, patch: 0 });
  });

  test('returns undefined for output that is not a git version', () => {
    expect(parseGitVersion('git: command not found')).toBeUndefined();
    expect(parseGitVersion('')).toBeUndefined();
  });
});

describe('version comparison', () => {
  test('orders by major, then minor, then patch', () => {
    const base = { major: 2, minor: 38, patch: 0 };
    expect(compareGitVersions(base, base)).toBe(0);
    expect(compareGitVersions({ major: 3, minor: 0, patch: 0 }, base)).toBeGreaterThan(0);
    expect(compareGitVersions({ major: 2, minor: 37, patch: 9 }, base)).toBeLessThan(0);
    expect(compareGitVersions({ major: 2, minor: 38, patch: 1 }, base)).toBeGreaterThan(0);
  });

  test('formats three components', () => {
    expect(formatGitVersion(MIN_MERGE_TREE_VERSION)).toBe('2.38.0');
  });

  test('assertGitVersion throws GIT_TOO_OLD below 2.38', () => {
    expect(() => assertGitVersion({ major: 2, minor: 30, patch: 0 })).toThrow();

    try {
      assertGitVersion({ major: 2, minor: 37, patch: 10 });
      throw new Error('expected a throw');
    } catch (err) {
      expect(isStarlingError(err) && err.code === GIT_TOO_OLD_CODE).toBe(true);
      expect((err as { details?: { found?: string } }).details?.found).toBe('2.37.10');
    }
  });

  test('assertGitVersion accepts the minimum and anything newer', () => {
    expect(() => assertGitVersion({ major: 2, minor: 38, patch: 0 })).not.toThrow();
    expect(() => assertGitVersion({ major: 3, minor: 0, patch: 0 })).not.toThrow();
  });
});
