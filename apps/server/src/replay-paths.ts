/**
 * `POST /api/replay` reads a file from the hub's disk, so it must not become an arbitrary file-read
 * primitive. ARCHITECTURE §6 keeps the route; Epic 41 adds the allow-list E21 left as an open question:
 * a replay path must resolve inside the active repo's `fixtures/` or `.starling/` directory.
 *
 * The check is deliberately lexical *and* physical: `..` is normalised away, and an existing target is
 * `realpath`-ed so a symlink inside `fixtures/` cannot point at `~/.ssh/id_ed25519`. A path that does
 * not exist yet is allowed lexically and fails later in `loadReplayFile` with the usual 400.
 */
import { existsSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

/** The only two directories a hub will replay from, relative to the repo root. */
export const REPLAY_ROOT_NAMES = ['fixtures', '.starling'] as const;

export interface ReplayPathDecision {
  ok: boolean;
  /** Absolute, symlink-resolved path when `ok`. Empty on rejection. */
  path: string;
  reason?: string;
}

export function defaultReplayRoots(repoRoot: string = process.cwd()): string[] {
  return REPLAY_ROOT_NAMES.map((name) => resolve(repoRoot, name));
}

function physical(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return path;
  }
}

/** True when `target` is `root` itself or lives below it (no `../` prefix, no sibling with a shared prefix). */
export function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  if (rel === '') return true;
  if (isAbsolute(rel)) return false;
  return rel !== '..' && !rel.startsWith(`..${sep}`);
}

/**
 * Resolve a caller-supplied replay path and decide whether it is under one of `roots`.
 * Relative paths are resolved against `cwd` (the server process's working directory, matching
 * E21's documented behaviour).
 */
export function resolveReplayPath(
  candidate: string,
  roots: readonly string[],
  cwd: string = process.cwd(),
): ReplayPathDecision {
  const trimmed = candidate.trim();
  if (trimmed === '') return { ok: false, path: '', reason: 'path is empty' };

  const absolute = resolve(cwd, trimmed);
  const target = existsSync(absolute) ? physical(absolute) : absolute;

  for (const root of roots) {
    const resolvedRoot = physical(resolve(root));
    if (isInside(resolvedRoot, target)) return { ok: true, path: target };
  }

  const allowed = roots.map((root) => `${relative(cwd, resolve(root))}/`);
  return {
    ok: false,
    path: '',
    reason: `replay paths must live under ${allowed.join(' or ')}`,
  };
}
