import { describe, expect, test } from 'bun:test';
import { isStarlingError } from '@starling/core';
import { bundlePathFor, sanitizeBranch, sanitizeBranchInput, shortRef, worktreePathFor } from './paths.ts';

describe('sanitizeBranch', () => {
  test('turns run-scoped branch names into one path component', () => {
    expect(sanitizeBranch('starling/01abc/t03-csv-export')).toBe('starling-01abc-t03-csv-export');
  });

  test('strips the ref prefix and collapses invalid runs', () => {
    expect(sanitizeBranch('refs/heads/feat/foo  bar')).toBe('feat-foo-bar');
  });

  test('keeps dots inside names but trims leading and trailing punctuation', () => {
    expect(sanitizeBranch('..weird..name..')).toBe('weird..name');
  });

  test('falls back to a usable name when nothing survives', () => {
    expect(sanitizeBranch('***')).toBe('worktree');
    expect(sanitizeBranch('   ')).toBe('worktree');
  });

  test('caps long names with a stable, unique hash suffix', () => {
    const prefix = 'a'.repeat(150);
    const first = sanitizeBranch(prefix);
    const again = sanitizeBranch(prefix);
    const sibling = sanitizeBranch(`${prefix}b`);

    expect(first).toBe(again);
    expect(first.length).toBeLessThanOrEqual(110);
    expect(first.startsWith('a'.repeat(100))).toBe(true);
    expect(sibling).not.toBe(first);
  });
});

describe('path helpers', () => {
  test('worktreePathFor joins the root and the sanitised branch', () => {
    expect(worktreePathFor('/tmp/wt', 'starling/run/task')).toBe('/tmp/wt/starling-run-task');
  });

  test('worktreePathFor resolves relative roots to absolute paths', () => {
    expect(worktreePathFor('relative/root', 'x/y').startsWith('/')).toBe(true);
  });

  test('shortRef strips heads and tags prefixes', () => {
    expect(shortRef('refs/heads/feat/a')).toBe('feat/a');
    expect(shortRef('refs/tags/v1')).toBe('v1');
    expect(shortRef('main')).toBe('main');
  });

  test('bundlePathFor keeps bundles in their own directory', () => {
    const path = bundlePathFor('/tmp/wt', 'refs/heads/feat/a', 1234, 2);
    expect(path).toBe('/tmp/wt/bundles/feat-a-1234-2.bundle');
  });

  test('sanitizeBranchInput accepts refs and rejects empty input', () => {
    expect(sanitizeBranchInput('refs/heads/feat/a')).toBe('feat/a');
    expect(() => sanitizeBranchInput('   ')).toThrow();
    try {
      sanitizeBranchInput('');
    } catch (err) {
      expect(isStarlingError(err, 'INVALID_ARGUMENT')).toBe(true);
    }
  });
});
