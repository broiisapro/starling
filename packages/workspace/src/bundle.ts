/**
 * Git bundle helpers for Flock mode (ARCHITECTURE §1 "Repo transfer").
 *
 * A bundle is git's own answer to "ship a repository over HTTP without a shared filesystem or a
 * GitHub round trip": the hub bundles the integration ref, the perch clones it, works, commits, then
 * bundles `fromRef..branch` back and the hub fetches that into the real repo. The hub always keeps
 * the only authoritative copy; these helpers only move commits.
 */
import { existsSync } from 'node:fs';
import { mkdir, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { Clock, BundleOps as CoreBundleOps } from '@starling/core';
import { StarlingError, systemClock } from '@starling/core';
import type { Git } from './git';
import { gitFailure } from './git';
import { bundlePathFor, sanitizeBranch, shortRef } from './paths';
import { refExists, resolveRepo } from './repo';

/**
 * Bundle transport used by `packages/flock` and `packages/perch`.
 *
 * The shape lives in core since checkpoint C1 (`BundleOps`), so the flock and perch copies are
 * aliases of this one; this module owns the git-CLI implementation.
 */
export type BundleOps = CoreBundleOps;

export interface BundleOpsOptions {
  git: Git;
  /** Where generated bundles land (`<worktreeRoot>/bundles`). */
  worktreeRoot: string;
  clock?: Clock;
}

/** Fetch refusals that mean "this branch is checked out somewhere"; retried through a temp ref. */
const CHECKED_OUT = /checked out|refusing to fetch/i;

export function createBundleOps({ git, worktreeRoot, clock = systemClock }: BundleOpsOptions): BundleOps {
  let seq = 0;
  const nextSeq = () => {
    seq += 1;
    return seq;
  };

  async function createBundle(
    repo: string,
    ref: string,
    opts: { base?: string; outPath?: string } = {},
  ): Promise<string> {
    const ctx = await resolveRepo(git, repo);
    if (!(await refExists(git, ctx.root, ref))) {
      throw new StarlingError('INVALID_ARGUMENT', `cannot bundle unknown ref "${ref}" in ${ctx.root}`);
    }
    if (opts.base !== undefined && !(await refExists(git, ctx.root, opts.base))) {
      throw new StarlingError(
        'INVALID_ARGUMENT',
        `cannot bundle range from unknown base "${opts.base}" in ${ctx.root}`,
      );
    }

    const outPath =
      opts.outPath === undefined
        ? bundlePathFor(worktreeRoot, shortRef(ref), clock.now(), nextSeq())
        : resolve(opts.outPath);
    await mkdir(dirname(outPath), { recursive: true });

    const range = opts.base === undefined ? ref : `${opts.base}..${ref}`;
    const args = ['bundle', 'create', outPath, range];
    const result = await git.run(args, { cwd: ctx.root, lock: ctx.lockKey });
    if (result.code !== 0) throw gitFailure(args, result);
    return outPath;
  }

  async function cloneFromBundle(
    bundlePath: string,
    dir: string,
    ref: string,
  ): Promise<{ path: string; branch: string }> {
    const bundle = resolve(bundlePath);
    if (!existsSync(bundle)) {
      throw new StarlingError('INVALID_ARGUMENT', `bundle not found: ${bundle}`);
    }
    if (ref === 'HEAD') {
      throw new StarlingError('INVALID_ARGUMENT', 'cloneFromBundle needs a named ref, not HEAD');
    }

    const dest = resolve(dir);
    if (existsSync(dest)) {
      const entries = await readdir(dest);
      if (entries.length > 0) {
        throw new StarlingError('WORKSPACE_ERROR', `clone destination is not empty: ${dest}`);
      }
    }
    const parent = dirname(dest);
    await mkdir(parent, { recursive: true });

    const cloneArgs = ['clone', '--quiet', bundle, dest];
    const cloned = await git.run(cloneArgs, { cwd: parent });
    if (cloned.code !== 0) throw gitFailure(cloneArgs, cloned);

    // A bundle has no HEAD symref of its own, so a clone often lands with only origin/<branch>.
    const branch = shortRef(ref);
    if (!(await refExists(git, dest, `refs/heads/${branch}`))) {
      const hasRemote = await refExists(git, dest, `refs/remotes/origin/${branch}`);
      const source = hasRemote ? `origin/${branch}` : ref;
      const checkoutArgs = ['checkout', '--quiet', '-B', branch, source];
      const checkedOut = await git.attempt(checkoutArgs, { cwd: dest });
      if (checkedOut.code !== 0) throw gitFailure(checkoutArgs, checkedOut);
    }

    return { path: dest, branch };
  }

  async function fetchBundle(
    repo: string,
    bundlePath: string,
    ref: string,
    intoBranch: string,
  ): Promise<void> {
    const ctx = await resolveRepo(git, repo);
    const bundle = resolve(bundlePath);
    if (!existsSync(bundle)) {
      throw new StarlingError('INVALID_ARGUMENT', `bundle not found: ${bundle}`);
    }

    const target = `refs/heads/${intoBranch}`;
    const direct = ['fetch', '--force', '--no-tags', '--quiet', bundle, `${ref}:${target}`];

    await git.lock(ctx.lockKey, async () => {
      const result = await git.attempt(direct, { cwd: ctx.root });
      if (result.code === 0) return;
      if (!CHECKED_OUT.test(result.stderr)) throw gitFailure(direct, result);

      // The branch is checked out in a worktree, so git refuses to update it in place. Stage the
      // commits on a throwaway ref and move the branch with update-ref, which git allows.
      const temp = `refs/starling/tmp/${sanitizeBranch(intoBranch)}-${clock.now()}-${nextSeq()}`;
      const stagedArgs = ['fetch', '--force', '--no-tags', '--quiet', bundle, `${ref}:${temp}`];
      const staged = await git.attempt(stagedArgs, { cwd: ctx.root });
      if (staged.code !== 0) throw gitFailure(stagedArgs, staged);

      const sha = await git.text(['rev-parse', temp], { cwd: ctx.root });
      const updateArgs = ['update-ref', target, sha];
      const updated = await git.attempt(updateArgs, { cwd: ctx.root });
      await git.attempt(['update-ref', '-d', temp], { cwd: ctx.root });
      if (updated.code !== 0) throw gitFailure(updateArgs, updated);
    });
  }

  return { createBundle, cloneFromBundle, fetchBundle };
}
