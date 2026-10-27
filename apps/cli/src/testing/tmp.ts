import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** A throwaway absolute path under the OS temp directory (never inside the repo). */
export function tmpFile(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'starling-cli-test-'));
  return join(dir, name);
}

/** A throwaway directory under the OS temp directory. */
export function tmpDir(prefix = 'starling-cli-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}
