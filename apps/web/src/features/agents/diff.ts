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

// ── word-level highlights for small hunks ────────────────────────────────────────────────────────

/** A run of text inside one changed line; `changed` marks the tokens a reviewer should look at. */
export interface DiffSegment {
  text: string;
  changed: boolean;
}

/** Above this many tokens per line, fall back to a whole-line highlight (keeps the diff instant). */
const WORD_DIFF_TOKEN_LIMIT = 240;

const TOKEN = /(\s+|[A-Za-z0-9_]+|[^\sA-Za-z0-9_])/g;

function tokenize(text: string): string[] {
  return text.match(TOKEN) ?? [];
}

function mergeSegments(tokens: readonly string[], changed: readonly boolean[]): DiffSegment[] {
  const segments: DiffSegment[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === undefined) continue;
    const isChanged = changed[index] === true;
    const last = segments[segments.length - 1];
    if (last !== undefined && last.changed === isChanged) last.text += token;
    else segments.push({ text: token, changed: isChanged });
  }
  return segments;
}

/**
 * Longest-common-subsequence diff of two lines, tokenised into words, whitespace and punctuation.
 * Only tokens outside the LCS are marked changed, which is what makes
 * `"light" → "dark"` highlight just the two words instead of the whole line.
 */
export function wordDiff(before: string, after: string): { before: DiffSegment[]; after: DiffSegment[] } {
  const a = tokenize(before);
  const b = tokenize(after);
  if (a.length > WORD_DIFF_TOKEN_LIMIT || b.length > WORD_DIFF_TOKEN_LIMIT) {
    return {
      before: [{ text: before, changed: before.length > 0 }],
      after: [{ text: after, changed: after.length > 0 }],
    };
  }

  // lcs[i][j] = length of the LCS of a[i..] and b[j..]. Rows are (n+1) × (m+1) numbers.
  const rows = a.length + 1;
  const cols = b.length + 1;
  const lcs: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      const row = lcs[i];
      const nextRow = lcs[i + 1];
      if (row === undefined || nextRow === undefined) continue;
      row[j] = a[i] === b[j] ? (nextRow[j + 1] ?? 0) + 1 : Math.max(nextRow[j] ?? 0, row[j + 1] ?? 0);
    }
  }

  const beforeFlags = new Array<boolean>(a.length).fill(true);
  const afterFlags = new Array<boolean>(b.length).fill(true);
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      beforeFlags[i] = false;
      afterFlags[j] = false;
      i += 1;
      j += 1;
      continue;
    }
    const skipA = lcs[i + 1]?.[j] ?? 0;
    const skipB = lcs[i]?.[j + 1] ?? 0;
    if (skipA >= skipB) i += 1;
    else j += 1;
  }

  return { before: mergeSegments(a, beforeFlags), after: mergeSegments(b, afterFlags) };
}

/** A patch line plus optional word-level segments for its body (the leading `-`/`+` is stripped). */
export interface PatchLineView extends PatchLine {
  segments?: DiffSegment[];
}

/**
 * Pair deletions with additions inside small hunks and compute word-level segments for each pair.
 *
 * "Small" means at most `maxRun` deleted *and* `maxRun` added lines in one run: on a 500-line file
 * rewrite a word diff is noise (and work), so those hunks keep the plain line colouring. The pairing
 * is by position, which is how `git diff` presents a replaced line.
 */
export function annotateWordDiffs(lines: readonly PatchLine[], maxRun = 6): PatchLineView[] {
  const view: PatchLineView[] = lines.map((line) => ({ ...line }));
  let index = 0;
  while (index < view.length) {
    const current = view[index];
    if (current?.kind !== 'del') {
      index += 1;
      continue;
    }

    let deleteEnd = index;
    while (deleteEnd < view.length && view[deleteEnd]?.kind === 'del') deleteEnd += 1;
    let addEnd = deleteEnd;
    while (addEnd < view.length && view[addEnd]?.kind === 'add') addEnd += 1;

    const deletes = view.slice(index, deleteEnd);
    const adds = view.slice(deleteEnd, addEnd);
    const small = deletes.length <= maxRun && adds.length <= maxRun;
    if (small && deletes.length > 0 && adds.length > 0) {
      for (let pair = 0; pair < Math.min(deletes.length, adds.length); pair += 1) {
        const deleted = deletes[pair];
        const added = adds[pair];
        if (deleted === undefined || added === undefined) continue;
        const diff = wordDiff(deleted.text.slice(1), added.text.slice(1));
        deleted.segments = diff.before;
        added.segments = diff.after;
      }
    }
    index = Math.max(addEnd, deleteEnd);
  }
  return view;
}
