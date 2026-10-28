/**
 * Small filesystem helpers for staging a release.
 *
 * All of these are plain `node:fs/promises` so they behave the same on macOS and Linux, and so tests
 * can point them at `os.tmpdir()` directories. Nothing here follows symlinks out of the tree it was
 * given; the inputs are this repo's own files.
 */
import { copyFile, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

/** `mkdir -p`. */
export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

/** `rm -rf`, but only ever on paths the caller built (temp dirs, staging). */
export async function removeDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function fileSize(path: string): Promise<number> {
  return (await stat(path)).size;
}

/**
 * Recursively copy a directory. Used for `apps/web/dist` → `share/starling/web`.
 *
 * `.DS_Store` is dropped: it is Finder litter, not part of the release, and it would make two builds
 * from the same source produce different bytes.
 */
export async function copyDir(from: string, to: string): Promise<void> {
  await mkdir(to, { recursive: true });
  for (const entry of await readdir(from, { withFileTypes: true })) {
    if (entry.name === '.DS_Store') continue;
    const source = join(from, entry.name);
    const destination = join(to, entry.name);
    if (entry.isDirectory()) {
      await copyDir(source, destination);
    } else if (entry.isFile()) {
      await copyFile(source, destination);
    }
  }
}

/** Copy one file, creating its parent directory. */
export async function copyFileInto(from: string, to: string): Promise<void> {
  await mkdir(join(to, '..'), { recursive: true });
  await copyFile(from, to);
}
