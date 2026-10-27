/**
 * Where the release version comes from: `--version`, else the root `package.json`.
 *
 * Keeping the fallback in one function means `build.ts`, `dry-run.ts` and any future CI job agree on
 * the same answer, and that the version baked into the binary (`STARLING_VERSION`) is exactly the one
 * in the asset name.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { StarlingError } from '../../packages/core/src/index.ts';
import { normalizeVersion } from './targets.ts';

export const DEFAULT_REPO_ROOT = join(import.meta.dir, '..', '..');

export interface ResolveVersionOptions {
  /** `--version` on the command line; wins over the package file. */
  flag?: string;
  /** Defaults to `<repoRoot>/package.json`. */
  packageJsonPath?: string;
}

/** Read the root `package.json` version. Exported so tests can assert the fallback path directly. */
export async function packageVersion(packageJsonPath: string): Promise<string> {
  let raw: string;
  try {
    raw = await readFile(packageJsonPath, 'utf8');
  } catch (err) {
    throw new StarlingError('INVALID_ARGUMENT', `Cannot read ${packageJsonPath} to find the version`, {
      cause: err,
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new StarlingError('INVALID_ARGUMENT', `${packageJsonPath} is not valid JSON`, { cause: err });
  }
  const version = (parsed as { version?: unknown }).version;
  if (typeof version !== 'string') {
    throw new StarlingError('INVALID_ARGUMENT', `${packageJsonPath} has no string "version" field`);
  }
  return normalizeVersion(version);
}

/**
 * `--version 0.1.0` → `0.1.0`; otherwise the repo's own version.
 *
 * A leading `v` is accepted and stripped, because release tags carry one and humans copy tags.
 */
export async function resolveVersion(options: ResolveVersionOptions = {}): Promise<string> {
  if (options.flag !== undefined) return normalizeVersion(options.flag);
  return packageVersion(options.packageJsonPath ?? join(DEFAULT_REPO_ROOT, 'package.json'));
}
