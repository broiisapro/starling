/**
 * Diff plumbing: `--numstat` parsing, untracked-file statistics, and patch assembly/truncation.
 *
 * Everything here is pure so it can be tested without a repository. The git calls that feed it live
 * in `workspace.ts`.
 */
import type { DiffSummary } from '@starling/core';

export interface FileStat {
  path: string;
  added: number;
  removed: number;
}

/** Audit prompts get a bounded patch: a 200 KB ceiling keeps a huge generated file from eating the context. */
export const PATCH_LIMIT_BYTES = 200 * 1024;

/** Untracked files above this size are counted as 0/0 and left out of the patch. */
export const UNTRACKED_MAX_BYTES = 4 * 1024 * 1024;

/** How far into a file we look for a NUL byte before calling it binary (git's own window). */
const BINARY_PROBE_BYTES = 8000;

const TRUNCATION_MARKER = '\n\n… [patch truncated] …\n';

/** Parse `git diff --numstat` output. Binary files report `-` and count as 0/0. */
export function parseNumstat(stdout: string): FileStat[] {
  const stats: FileStat[] = [];
  for (const line of stdout.split('\n')) {
    if (line.trim() === '') continue;
    const firstTab = line.indexOf('\t');
    const secondTab = line.indexOf('\t', firstTab + 1);
    if (firstTab < 0 || secondTab < 0) continue;
    const addedRaw = line.slice(0, firstTab);
    const removedRaw = line.slice(firstTab + 1, secondTab);
    const path = line.slice(secondTab + 1);
    if (path === '') continue;
    stats.push({
      path,
      added: addedRaw === '-' ? 0 : Number.parseInt(addedRaw, 10) || 0,
      removed: removedRaw === '-' ? 0 : Number.parseInt(removedRaw, 10) || 0,
    });
  }
  return stats;
}

/** Union of several file lists, preserving first-seen order and summing counts per path. */
export function mergeStats(...lists: FileStat[][]): FileStat[] {
  const byPath = new Map<string, FileStat>();
  for (const list of lists) {
    for (const stat of list) {
      const existing = byPath.get(stat.path);
      if (existing === undefined) {
        byPath.set(stat.path, { ...stat });
      } else {
        existing.added += stat.added;
        existing.removed += stat.removed;
      }
    }
  }
  return [...byPath.values()];
}

/** True when the file looks binary by git's heuristic (a NUL byte in the first 8 KB). */
export function isBinary(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length, BINARY_PROBE_BYTES);
  for (let i = 0; i < limit; i += 1) {
    if (bytes[i] === 0) return true;
  }
  return false;
}

/**
 * Line count for a file added as a whole: git reports one added line per newline, plus one for a
 * final line without a trailing newline. Binary and oversized files count as zero.
 */
export function countNewFileLines(bytes: Uint8Array): { added: number; binary: boolean } {
  if (bytes.length === 0) return { added: 0, binary: false };
  if (bytes.length > UNTRACKED_MAX_BYTES || isBinary(bytes)) return { added: 0, binary: true };
  let newlines = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    if (bytes[i] === 0x0a) newlines += 1;
  }
  const added = bytes[bytes.length - 1] === 0x0a ? newlines : newlines + 1;
  return { added, binary: false };
}

function decodeLines(bytes: Uint8Array): string[] {
  const text = new TextDecoder('utf-8').decode(bytes);
  const lines = text.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * Synthesise a `git diff` style patch for an untracked file.
 *
 * Doing this in-process avoids one `git` spawn per new file, which matters when an agent drops a
 * directory of new sources. The output is the subset git itself emits for a plain new text file:
 * header, `new file mode`, `/dev/null` source, one all-added hunk.
 */
export function newFilePatch(relPath: string, bytes: Uint8Array, mode = '100644'): string {
  const header = [`diff --git a/${relPath} b/${relPath}`, `new file mode ${mode}`];
  if (isBinary(bytes) || bytes.length > UNTRACKED_MAX_BYTES) {
    return `${header.join('\n')}\nBinary files /dev/null and b/${relPath} differ\n`;
  }
  if (bytes.length === 0) return `${header.join('\n')}\n`;

  const lines = decodeLines(bytes);
  const body = lines.map((line) => `+${line}`).join('\n');
  const noNewline = bytes[bytes.length - 1] === 0x0a ? '' : '\n\\ No newline at end of file';
  return [
    ...header,
    '--- /dev/null',
    `+++ b/${relPath}`,
    `@@ -0,0 +1,${lines.length} @@`,
    `${body}${noNewline}`,
    '',
  ].join('\n');
}

/**
 * Cut a patch at `limitBytes` (UTF-8 bytes, never mid-codepoint) and mark it.
 *
 * The marker is inside the budget, so `Buffer.byteLength(patch) <= limitBytes` always holds — a
 * consumer can rely on the cap rather than re-measuring.
 */
export function truncatePatch(
  patch: string,
  limitBytes: number = PATCH_LIMIT_BYTES,
): { patch: string; truncated: boolean } {
  const bytes = Buffer.from(patch, 'utf8');
  if (bytes.length <= limitBytes) return { patch, truncated: false };

  const markerBytes = Buffer.byteLength(TRUNCATION_MARKER, 'utf8');
  const room = Math.max(0, limitBytes - markerBytes);
  let head = bytes.subarray(0, room).toString('utf8');
  // A cut multi-byte sequence decodes to U+FFFD; drop it instead of shipping a replacement char.
  head = head.replace(/\uFFFD+$/u, '');
  return { patch: `${head}${TRUNCATION_MARKER}`, truncated: true };
}

/** Assemble a `DiffSummary` from already-collected pieces, applying the size cap. */
export function buildDiffSummary(files: FileStat[], patchParts: string[]): DiffSummary {
  const raw = patchParts
    .filter((part) => part !== '')
    .map((part) => (part.endsWith('\n') ? part : `${part}\n`))
    .join('');
  const { patch, truncated } = truncatePatch(raw);
  return {
    files: files.map(({ path, added, removed }) => ({ path, added, removed })),
    patch,
    truncated,
  };
}
