/**
 * Give a fresh task worktree the target repo's dependencies.
 *
 * A git worktree contains only tracked files, so `node_modules/` is missing and an agent that runs
 * `bun test` or `tsc` inside it meets a wall of unresolved imports — a pure integration artefact, not
 * a task failure. We symlink the repo's `node_modules` into the worktree (both are gitignored, so
 * nothing can be committed by accident). Done through the `Workspace` decorator rather than inside
 * `@starling/workspace` so the workspace package keeps one job.
 *
 * Best effort on purpose: a repo with no `node_modules` (a fresh clone, a Python project) simply gets
 * nothing, and a link failure must never fail the task.
 */
import { existsSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { Workspace } from '@starling/core';

/** Symlink `<repo>/node_modules` into `worktreePath`. Returns true when a link now exists. */
export function linkNodeModules(repo: string, worktreePath: string): boolean {
  const source = join(repo, 'node_modules');
  const target = join(worktreePath, 'node_modules');
  if (!existsSync(source) || existsSync(target)) return false;
  try {
    // Type 'dir' (not 'junction'): junction is the Windows spelling, and this is a POSIX demo.
    symlinkSync(source, target, 'dir');
    return true;
  } catch {
    // Permission denied, a race with the agent, or a filesystem that dislikes links: not fatal.
    return false;
  }
}

/**
 * A `Workspace` whose `create()` also links `node_modules` into the new worktree.
 *
 * Implemented with `Object.create` so every other method (including the optional `BundleOps` ones a
 * `LocalNode` detects at runtime) keeps its original behaviour and `this` binding.
 */
export function withDependencies<W extends Workspace>(workspace: W): W {
  const wrapped = Object.create(workspace) as W;
  Object.defineProperty(wrapped, 'create', {
    configurable: true,
    enumerable: true,
    value: async (repo: string, branch: string, fromRef: string) => {
      const created = await workspace.create(repo, branch, fromRef);
      // The worktree's own repo wins: on a perch that is the bundle cache clone, not the hub repo.
      linkNodeModules(repo, created.path);
      return created;
    },
  });
  return wrapped;
}
