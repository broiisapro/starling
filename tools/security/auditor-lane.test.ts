/**
 * Probes: the auditor's lane check, which is Starling's only defence against a worker editing outside
 * its assignment.
 *
 * The check takes `changedFiles` — from `Workspace.changedFiles` on the hub, or (for a remote task)
 * from the `TaskResult` a perch returned — and matches each path against `task.lane.owns`. Git itself
 * will not emit a `..` path, but `TaskResult.changedFiles` is just `string[]` on the wire, and a
 * hostile or buggy perch chooses it. `normalizeGlobPath` strips `./`, backslashes and duplicate
 * slashes but does **not** resolve `..`, so a path that starts inside the lane and climbs out still
 * matches `src/**`:
 *
 *   checkLane(['src/../secrets.env'], ['src/**']).ok === true   // today
 *
 * Every probe that must fail loudly (relative escape, absolute path, sibling lane) is a plain test;
 * the `..`-shaped bypass is `test.failing` until the lane check canonicalises first and rejects a
 * traversal that leaves the repo.
 */
import { describe, expect, test } from 'bun:test';
import { checkLane, isBookkeepingPath } from '../../packages/auditor/src/index.ts';

describe('lane check: paths it must catch', () => {
  test('flags a relative escape', () => {
    const result = checkLane(['../escape.ts'], ['src/**']);
    expect(result.ok).toBe(false);
    expect(result.violations).toEqual(['../escape.ts']);
  });

  test('flags a deep relative escape', () => {
    expect(checkLane(['../../etc/passwd'], ['src/**']).ok).toBe(false);
  });

  test('flags an absolute path', () => {
    expect(checkLane(['/etc/passwd'], ['src/**']).ok).toBe(false);
  });

  test('flags a sibling lane and a root file', () => {
    const result = checkLane(['docs/readme.md', 'package.json'], ['src/**']);
    expect(result.ok).toBe(false);
    expect(result.violations).toEqual(['docs/readme.md', 'package.json']);
  });

  test('flags everything when the lane owns nothing', () => {
    expect(checkLane(['src/a.ts'], []).ok).toBe(false);
  });

  test('accepts owned files and ignores Starling bookkeeping', () => {
    expect(checkLane(['src/a.ts', 'src/deep/b.ts', '.starling/events.jsonl'], ['src/**']).ok).toBe(true);
    expect(isBookkeepingPath('.starling-worktrees/t1/x')).toBe(true);
  });
});

describe('lane check: traversal bypasses', () => {
  test('flags a path that starts in the lane and climbs out', () => {
    // `src/../secrets.env` is outside `src/**` in every filesystem sense, but matches the glob today.
    expect(checkLane(['src/../secrets.env'], ['src/**']).ok).toBe(false);
  });

  test('flags a backslash traversal that normalises into the lane prefix', () => {
    expect(checkLane(['src\\..\\secrets.env'], ['src/**']).ok).toBe(false);
  });

  test('flags a deeper climb through the lane prefix', () => {
    expect(checkLane(['src/a/b/../../../.ssh/id_ed25519'], ['src/**']).ok).toBe(false);
  });
});
