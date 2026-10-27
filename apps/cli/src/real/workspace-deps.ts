/**
 * Give a fresh task worktree the target repo's dependencies.
 *
 * A git worktree contains only tracked files, so `node_modules/` is missing and an agent that runs
 * `bun test` inside it meets `Cannot find package 'happy-dom'` — a pure integration artefact, not a
 * task failure. We symlink the repo's `node_modules` into the worktree.
 *
 * The symlink is **not** covered by `.gitignore`'s `node_modules/` pattern (the trailing slash only
 * matches a real directory; a symlink is mode 120000), so the first real run produced a commit that
 * added `node_modules` and every task failed its lane check. `ensureNodeModulesIgnored()` therefore
 * writes a local ignore rule into the repo's `.git/info/exclude` — never committed, never shared,
 * and it covers every worktree of that repo.
 *
 * Done through decorators rather than inside `@starling/workspace`/`@starling/merger` so those
 * packages keep one job. Best effort on purpose: a repo with no `node_modules` (a fresh clone, a
 * Python project) simply gets nothing, and a link failure must never fail the task.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Workspace } from '@starling/core';

/** What a linked `node_modules` needs to be invisible to `git status` / `commitAll`. */
const IGNORE_RULE = 'node_modules\n';

/** The repo's local exclude file, or `undefined` when this is not a plain git checkout. */
export function excludeFileFor(repo: string): string | undefined {
  const dotGit = join(repo, '.git');
  if (!existsSync(dotGit) || !statSync(dotGit).isDirectory()) return undefined;
  // A linked worktree (`.git` is a file) shares the main repo's exclude, and the composition always
  // targets a normal checkout, so only that case is handled.
  return join(dotGit, 'info', 'exclude');
}

/**
 * Make `node_modules` invisible to git in this repo by appending a local exclude rule.
 * Idempotent, and silent when the rule is already there.
 */
export function ensureNodeModulesIgnored(repo: string): boolean {
  const file = excludeFileFor(repo);
  if (file === undefined) return false;
  const current = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const covered = current
    .split('\n')
    .map((line) => line.trim())
    .some((line) => line === 'node_modules' || line === 'node_modules/');
  if (covered) return false;
  mkdirSync(dirname(file), { recursive: true });
  const prefix = current === '' || current.endsWith('\n') ? '' : '\n';
  appendFileSync(file, `${prefix}${IGNORE_RULE}`);
  return true;
}

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
