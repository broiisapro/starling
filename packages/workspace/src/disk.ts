/**
 * Disk accounting for worktrees.
 *
 * Every linked worktree shares the repository's object database, so its cost is its *checked-out
 * files* plus its private index — not a copy of the repo. That number matters: 60 worktrees on a
 * large repo is where a laptop runs out of disk, and `starling gc` should be able to say how much a
 * cleanup would free. Symlinks are counted by their own size and never followed (a lane that
 * symlinks a node_modules tree must not walk it).
 */
import type { Dirent } from 'node:fs';
import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';

export interface DiskUsage {
  /** Directory the walk started at. */
  path: string;
  /** Sum of file sizes in bytes (apparent size, not allocated blocks). */
  bytes: number;
  /** Regular files counted. */
  files: number;
  /** Directories visited, including the root. */
  dirs: number;
  /** Symlinks seen (not followed, not counted in `bytes`). */
  symlinks: number;
}

/** Recursively measure a directory. Missing directories read as an empty usage, not an error. */
export async function diskUsage(path: string): Promise<DiskUsage> {
  const usage: DiskUsage = { path, bytes: 0, files: 0, dirs: 0, symlinks: 0 };

  async function walk(dir: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    usage.dirs += 1;
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(abs);
        continue;
      }
      if (entry.isSymbolicLink()) {
        usage.symlinks += 1;
        continue;
      }
      // `withFileTypes` can report a stale type; lstat is the authority and it never follows links.
      try {
        const info = await lstat(abs);
        if (info.isDirectory()) await walk(abs);
        else if (info.isFile()) {
          usage.bytes += info.size;
          usage.files += 1;
        }
      } catch {
        // Vanished mid-walk (an agent deleting its own scratch files): skip it.
      }
    }
  }

  await walk(path);
  return usage;
}

/** Human-readable byte count, e.g. `4.2 MB`. Used by the stress report and future `starling gc`. */
export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unit]}`;
}
