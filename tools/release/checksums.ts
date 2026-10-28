/**
 * `SHA256SUMS` — the checksum file the installer (Epic 152) verifies before unpacking anything.
 *
 * Format is exactly what `shasum -a 256` and `sha256sum` print: `<64 lowercase hex><two spaces><name>`,
 * one line per asset, sorted by name. Both tools also accept a ` *` binary marker, so parsing is
 * slightly more forgiving than writing — writing must never drift from the tools it imitates.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { StarlingError } from '../../packages/core/src/index.ts';

export interface ChecksumEntry {
  name: string;
  sha256: string;
}

export interface VerifiedEntry extends ChecksumEntry {
  ok: boolean;
  actual?: string;
}

export interface VerifyResult {
  ok: boolean;
  entries: VerifiedEntry[];
  /** Names listed in `SHA256SUMS` whose file is not in the directory. */
  missing: string[];
}

const SHA256_LINE = /^([0-9a-f]{64})[ \t]+\*?(\S.*?)\s*$/;

/** Stream the file through SHA-256 — a compiled binary is ~85–110 MB, so no `readFile`. */
export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

/** Stable byte-order comparison (`localeCompare` would vary with the machine's locale). */
function byName(a: { name: string }, b: { name: string }): number {
  if (a.name < b.name) return -1;
  if (a.name > b.name) return 1;
  return 0;
}

/** Render `SHA256SUMS` bytes: sorted, two spaces, trailing newline. */
export function formatChecksums(entries: readonly ChecksumEntry[]): string {
  if (entries.length === 0) return '';
  return `${[...entries]
    .sort(byName)
    .map((entry) => `${entry.sha256}  ${entry.name}`)
    .join('\n')}\n`;
}

/** Parse `SHA256SUMS`; blank lines are ignored, a malformed line is an error (never a silent skip). */
export function parseChecksums(text: string): ChecksumEntry[] {
  const entries: ChecksumEntry[] = [];
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (line.trim() === '') continue;
    const match = SHA256_LINE.exec(line);
    if (match === null) {
      throw new StarlingError(
        'INVALID_ARGUMENT',
        `SHA256SUMS line ${index + 1} is not "<64 hex>  <name>": ${line}`,
      );
    }
    const sha256 = match[1];
    const name = match[2];
    if (sha256 === undefined || name === undefined) {
      throw new StarlingError('INVALID_ARGUMENT', `SHA256SUMS line ${index + 1} is incomplete`);
    }
    entries.push({ name, sha256 });
  }
  return entries;
}

/**
 * Hash every file named in `entries` under `dir` and compare.
 *
 * A mismatch or a missing file makes `ok: false` but is *reported*, not thrown: the dry run needs to
 * print a red checklist line and still exit non-zero, and a release script should never die before
 * saying which asset was bad.
 */
export async function verifyChecksums(
  entries: readonly ChecksumEntry[],
  dir: string,
  hash: (path: string) => Promise<string> = sha256File,
): Promise<VerifyResult> {
  const verified: VerifiedEntry[] = [];
  const missing: string[] = [];
  for (const entry of entries) {
    let actual: string | undefined;
    try {
      actual = await hash(join(dir, entry.name));
    } catch {
      missing.push(entry.name);
      verified.push({ ...entry, ok: false });
      continue;
    }
    verified.push({ ...entry, actual, ok: actual === entry.sha256 });
  }
  return { ok: missing.length === 0 && verified.every((entry) => entry.ok), entries: verified, missing };
}

/** Convenience: read a `SHA256SUMS` file and verify the assets next to it. */
export async function verifyChecksumsFile(
  sumsPath: string,
  hash: (path: string) => Promise<string> = sha256File,
): Promise<VerifyResult> {
  const text = await readFile(sumsPath, 'utf8');
  return verifyChecksums(parseChecksums(text), join(sumsPath, '..'), hash);
}
