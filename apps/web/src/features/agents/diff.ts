import type { DiffSummary } from '@starling/core';

/**
 * A small unified-diff reader for the Diff tab. `DiffSummary.patch` is a plain `git diff` string; the
 * UI only needs per-line colouring, so this parser is intentionally shallow: it never applies hunks,
 * it just classifies lines and tracks which file each line belongs to.
 */
export type PatchLineKind = 'add' | 'del' | 'ctx' | 'hunk' | 'meta';

export interface PatchLine {
  kind: PatchLineKind;
  text: string;
}

export interface PatchFile {
  path: string;
  added: number;
  removed: number;
  lines: PatchLine[];
}

export interface DiffFileView extends PatchFile {}

const FILE_HEADER = /^diff --git a\/(.+?) b\/(.+)$/;
const NEW_HEADER = /^\+\+\+ (?:b\/)?(.+)$/;
const META_PREFIXES = [
  'diff --git',
  'index ',
  'new file mode',
  'deleted file mode',
  'old mode',
  'new mode',
  'similarity index',
  'rename from ',
  'rename to ',
  '\\ No newline',
];

export function classifyPatchLine(line: string): PatchLineKind {
  if (line.startsWith('@@')) return 'hunk';
  if (line.startsWith('+++') || line.startsWith('---')) return 'meta';
  if (line.startsWith('+')) return 'add';
  if (line.startsWith('-')) return 'del';
  if (META_PREFIXES.some((prefix) => line.startsWith(prefix))) return 'meta';
  return 'ctx';
}

export function parsePatch(patch: string): PatchFile[] {
  const files: PatchFile[] = [];
  let current: PatchFile | undefined;

  const ensureFile = (path: string): PatchFile => {
    const file: PatchFile = { path, added: 0, removed: 0, lines: [] };
    files.push(file);
    return file;
  };

  for (const line of patch.split('\n')) {
    // A trailing newline yields one empty item; unified diffs represent blank context as " ".
    if (line.length === 0) continue;

    const header = FILE_HEADER.exec(line);
    if (header) {
      current = ensureFile(header[2] ?? header[1] ?? '(patch)');
      current.lines.push({ kind: 'meta', text: line });
      continue;
    }

    const newHeader = NEW_HEADER.exec(line);
    if (newHeader?.[1] && newHeader[1] !== '/dev/null') {
      if (!current) current = ensureFile(newHeader[1]);
      else if (current.path === '(patch)') current.path = newHeader[1];
    }

    if (!current) current = ensureFile('(patch)');
    const kind = classifyPatchLine(line);
    current.lines.push({ kind, text: line });
    if (kind === 'add') current.added++;
    if (kind === 'del') current.removed++;
  }

  return files.filter((file) => file.lines.length > 0);
}

/**
 * Join `DiffSummary.files` (the authoritative counts) with the parsed patch (the displayable lines).
 * Files that appear in only one of the two still show up, so a truncated patch never hides a change.
 */
export function diffFiles(diff: DiffSummary | undefined): DiffFileView[] {
  if (!diff) return [];
  const parsed = parsePatch(diff.patch);
  const byPath = new Map(parsed.map((file) => [file.path, file]));

  const result: DiffFileView[] = diff.files.map((file) => ({
    path: file.path,
    added: file.added,
    removed: file.removed,
    lines: byPath.get(file.path)?.lines ?? [],
  }));

  for (const file of parsed) {
    if (!diff.files.some((entry) => entry.path === file.path)) result.push(file);
  }
  return result;
}
