import { mkdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { exec as coreExec, StarlingError } from '@starling/core';

/**
 * Git-bundle helpers used by Flock mode. This is a **local mirror** of Epic 14's `BundleOps`
 * (`packages/workspace/src/bundle.ts`), declared here so this package never imports a sibling Wave 1
 * package. At checkpoint C1 the integrator can point both at the single workspace export.
 *
 * `createWorkspace(...)` in Epic 14 returns a superset of `Workspace`, so a real workspace instance
 * can be passed straight to `createLocalNode` — the optional methods are detected at runtime.
 */
export interface BundleOps {
  /** `git bundle create <out>` of `ref`, or `base..ref` when `base` is given. Returns the file path. */
  createBundle(repo: string, ref: string, opts?: { base?: string; outPath?: string }): Promise<string>;
  /** Clone a bundle into `dir` and check out `ref`. */
  cloneFromBundle(bundlePath: string, dir: string, ref: string): Promise<void>;
  /** `git fetch <bundle> ref:intoBranch` in `repo`, forcing the update. */
  fetchBundle(repo: string, bundlePath: string, ref: string, intoBranch: string): Promise<void>;
}

export interface BundleOpsOptions {
  exec?: typeof coreExec;
  /** Where `createBundle` writes when the caller does not pass `outPath`. */
  dir?: string;
  timeoutMs?: number;
}

/** Strip anything that would escape a single path segment. Branch names and ULIDs are already safe. */
export function bundleFileName(ref: string): string {
  return ref.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+/, '');
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    // Only "not found" is expected here; anything else is also treated as missing, and the caller's
    // git command will surface the real problem.
    return false;
  }
}

/**
 * The real `BundleOps`, on the `git` CLI through core `exec` (L13: argv only, no shell strings).
 *
 * A failure is a `WORKSPACE_ERROR` carrying git's stderr, because a broken bundle is a repo/repo-transfer
 * problem rather than a network problem — the caller (LocalNode / the hub) decides whether that means
 * "this perch is unusable".
 */
export function createBundleOps(options: BundleOpsOptions = {}): BundleOps {
  const run = options.exec ?? coreExec;
  const timeoutMs = options.timeoutMs ?? 120_000;

  return {
    async createBundle(repo, ref, opts = {}) {
      const outPath =
        opts.outPath ??
        join(options.dir ?? join(tmpdir(), 'starling-bundles'), `${bundleFileName(ref)}.bundle`);
      await mkdir(dirname(outPath), { recursive: true });
      const range = opts.base === undefined ? ref : `${opts.base}..${ref}`;
      const res = await run(['git', 'bundle', 'create', outPath, range], { cwd: repo, timeoutMs });
      if (res.code !== 0) {
        throw new StarlingError(
          'WORKSPACE_ERROR',
          `git bundle create ${range} failed: ${res.stderr.trim()}`,
          {
            details: { repo, ref, base: opts.base, code: res.code },
          },
        );
      }
      return outPath;
    },

    async cloneFromBundle(bundlePath, dir, ref) {
      if (await exists(dir)) {
        throw new StarlingError('WORKSPACE_ERROR', `cloneFromBundle: ${dir} already exists`, {
          details: { bundlePath, dir, ref },
        });
      }
      await mkdir(dirname(dir), { recursive: true });
      // A bundle has no HEAD of its own, so a plain clone invents `master` and leaves our ref only as
      // `origin/<ref>`. `--branch` asks for the bundled branch by name and creates it locally.
      const branch = ref.replace(/^refs\/heads\//, '');
      const clone = await run(['git', 'clone', '--branch', branch, bundlePath, dir], {
        cwd: dirname(dir),
        timeoutMs,
      });
      if (clone.code !== 0) {
        throw new StarlingError('WORKSPACE_ERROR', `git clone from bundle failed: ${clone.stderr.trim()}`, {
          details: { bundlePath, dir },
        });
      }
      // Detach HEAD on purpose: the perch reuses this cache clone for every task in a run and fetches
      // the integration branch again. Git refuses to fetch into a branch that is checked out here, so
      // the cache repo must never sit on the ref it is going to update.
      const checkout = await run(['git', 'checkout', '--detach', ref], { cwd: dir, timeoutMs });
      if (checkout.code !== 0) {
        throw new StarlingError(
          'WORKSPACE_ERROR',
          `git checkout ${ref} in ${dir} failed: ${checkout.stderr.trim()}`,
          {
            details: { bundlePath, dir, ref },
          },
        );
      }
    },

    async fetchBundle(repo, bundlePath, ref, intoBranch) {
      const res = await run(['git', 'fetch', '--force', bundlePath, `${ref}:${intoBranch}`], {
        cwd: repo,
        timeoutMs,
      });
      if (res.code !== 0) {
        throw new StarlingError(
          'WORKSPACE_ERROR',
          `git fetch ${ref} -> ${intoBranch} failed: ${res.stderr.trim()}`,
          {
            details: { repo, bundlePath, ref, intoBranch },
          },
        );
      }
    },
  };
}
