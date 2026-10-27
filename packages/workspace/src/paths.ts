/**
 * Naming rules for worktree directories and bundle files.
 *
 * Branch names carry slashes (`starling/<run>/<task>`) and the odd character that a filesystem or a
 * Windows checkout will not take, so paths are derived through one sanitizer used everywhere.
 */
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { StarlingError } from '@starling/core';

/** Longest directory component we create from a branch name, before the hash suffix. */
const MAX_COMPONENT = 100;

/** 8 hex chars of SHA-1: used only to keep truncated names unique, never as a trust boundary. */
function shortHash(value: string): string {
  return createHash('sha1').update(value).digest('hex').slice(0, 8);
}

/** Strip the `refs/heads/` prefix (and `refs/tags/`) so callers can log a friendly name. */
export function shortRef(ref: string): string {
  return ref.replace(/^refs\/heads\//, '').replace(/^refs\/tags\//, '');
}

/**
 * Turn a branch name into one safe path component.
 *
 * `starling/01abc/t03-csv-export` → `starling-01abc-t03-csv-export`. Anything outside
 * `[A-Za-z0-9._-]` becomes `-`, runs collapse, and leading/trailing dots and dashes are trimmed so
 * the result never looks like a hidden file or a CLI flag. Long names are cut and suffixed with a
 * hash of the full branch, so two branches can never sanitise to the same directory by truncation.
 */
export function sanitizeBranch(branch: string): string {
  const raw = shortRef(branch.trim());
  let cleaned = raw
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[.-]+/, '')
    .replace(/[.-]+$/, '');

  if (cleaned.length === 0) cleaned = 'worktree';
  if (cleaned.length > MAX_COMPONENT) {
    const head = cleaned.slice(0, MAX_COMPONENT).replace(/[.-]+$/, '');
    cleaned = `${head === '' ? 'worktree' : head}-${shortHash(raw)}`;
  }
  return cleaned;
}

/** Absolute path of the worktree for `branch` under `worktreeRoot`. */
export function worktreePathFor(worktreeRoot: string, branch: string): string {
  return resolve(worktreeRoot, sanitizeBranch(branch));
}

/**
 * Normalise a caller-supplied branch name: accept `feature/x` and `refs/heads/feature/x`, reject
 * empty input with a typed error rather than letting git produce a confusing message.
 */
export function sanitizeBranchInput(branch: string): string {
  const name = shortRef(branch.trim());
  if (name === '') {
    throw new StarlingError('INVALID_ARGUMENT', 'branch name is required');
  }
  return name;
}

/** Absolute path for a generated bundle file. `seq` keeps same-millisecond calls apart. */
export function bundlePathFor(worktreeRoot: string, ref: string, ts: number, seq: number): string {
  return join(resolve(worktreeRoot), 'bundles', `${sanitizeBranch(ref)}-${ts}-${seq}.bundle`);
}
