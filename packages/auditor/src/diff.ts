import type { DiffSummary } from '@starling/core';
import { matchesAny, normalizeGlobPath } from '@starling/core';

/** Paths that count as tests, across the languages Starling is likely to meet. */
export const TEST_PATH_GLOBS = [
  '**/*.test.ts',
  '**/*.test.tsx',
  '**/*.test.js',
  '**/*.test.jsx',
  '**/*.test.mjs',
  '**/*.test.cjs',
  '**/*.spec.ts',
  '**/*.spec.tsx',
  '**/*.spec.js',
  '**/*.spec.jsx',
  '**/*.spec.mjs',
  '**/*_test.go',
  '**/test_*.py',
  '**/*_test.py',
  '**/tests/**',
  '**/__tests__/**',
] as const;

const CODE_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.go',
  '.rs',
  '.rb',
  '.java',
  '.kt',
  '.swift',
  '.c',
  '.cc',
  '.cpp',
  '.h',
  '.hpp',
  '.cs',
  '.php',
  '.sh',
] as const;

export function isTestPath(path: string): boolean {
  return matchesAny(normalizeGlobPath(path), [...TEST_PATH_GLOBS]);
}

/** Executable source that can introduce behaviour (tests and build config excluded). */
export function isBehaviourPath(path: string): boolean {
  const normalized = normalizeGlobPath(path);
  if (isTestPath(normalized)) return false;
  if (normalized.endsWith('.d.ts')) return false;
  if (/(^|\/)[^/]*\.config\.[^/]+$/.test(normalized)) return false;
  return CODE_EXTENSIONS.some((ext) => normalized.endsWith(ext));
}

export interface DiffSignals {
  /** The diff adds or updates at least one test file. */
  testsChanged: boolean;
  /** The diff touches executable source outside tests/config. */
  behaviourChanged: boolean;
  /** Executable work with no accompanying test change — the miss the demo is built around. */
  newBehaviourWithoutTests: boolean;
}

export function diffSignals(changedFiles: readonly string[]): DiffSignals {
  const testsChanged = changedFiles.some(isTestPath);
  const behaviourChanged = changedFiles.some(isBehaviourPath);
  return { testsChanged, behaviourChanged, newBehaviourWithoutTests: behaviourChanged && !testsChanged };
}

export interface DiffBlock {
  path: string;
  /** The complete block, starting at `diff --git` (or `---`). */
  text: string;
}

export interface PrioritisedDiff {
  patch: string;
  /** True when the budget forced something out. */
  truncated: boolean;
  omittedFiles: string[];
}

function cleanDiffPath(raw: string): string {
  let path = raw.trim();
  if (path.startsWith('"') && path.endsWith('"')) path = path.slice(1, -1);
  if (path.startsWith('b/')) path = path.slice(2);
  if (path.startsWith('a/')) path = path.slice(2);
  if (path === '/dev/null') return '';
  return normalizeGlobPath(path);
}

function pathFromBlock(lines: readonly string[]): string {
  for (const line of lines) {
    if (line.startsWith('+++ ')) {
      const path = cleanDiffPath(line.slice(4).split('\t')[0] ?? '');
      if (path !== '') return path;
    }
  }
  for (const line of lines) {
    if (line.startsWith('--- ')) {
      const path = cleanDiffPath(line.slice(4).split('\t')[0] ?? '');
      if (path !== '') return path;
    }
  }
  return '';
}

/** Split a unified diff into per-file blocks without losing a byte of the original. */
export function splitDiff(patch: string): DiffBlock[] {
  if (patch.trim() === '') return [];
  const lines = patch.split('\n');

  if (lines.some((line) => line.startsWith('diff --git '))) {
    const blocks: string[][] = [];
    for (const line of lines) {
      if (line.startsWith('diff --git ') || blocks.length === 0) blocks.push([]);
      (blocks.at(-1) as string[]).push(line);
    }
    return blocks
      .filter((block) => block.join('\n').trim() !== '')
      .map((block) => ({
        path:
          pathFromBlock(block) || cleanDiffPath(/^diff --git a\/(.+?) b\//.exec(block[0] ?? '')?.[1] ?? ''),
        text: block.join('\n'),
      }));
  }

  // Hand-written or mock patches often lack `diff --git`; split on the `---` header instead.
  const blocks: string[][] = [];
  for (const line of lines) {
    if (line.startsWith('--- ') || blocks.length === 0) blocks.push([]);
    (blocks.at(-1) as string[]).push(line);
  }
  return blocks
    .filter((block) => block.join('\n').trim() !== '')
    .map((block) => ({ path: pathFromBlock(block), text: block.join('\n') }));
}

/**
 * Keep the diff within `maxChars`, lane files first and every kept block's header intact.
 *
 * A short diff is returned byte-for-byte: prioritisation must never reorder evidence that already
 * fits. When it does not fit, owned files are emitted before out-of-lane files (the reviewer needs
 * the in-lane evidence more than the violation it will be told to revert), and a block that is cut
 * keeps its `diff --git` / `---` / `+++` header plus the earliest hunks.
 */
export function prioritiseDiff(
  patch: string,
  opts: { owns: readonly string[]; maxChars: number },
): PrioritisedDiff {
  if (patch.length <= opts.maxChars) return { patch, truncated: false, omittedFiles: [] };

  const blocks = splitDiff(patch);
  const owned: DiffBlock[] = [];
  const rest: DiffBlock[] = [];
  for (const block of blocks) {
    if (block.path !== '' && matchesAny(block.path, [...opts.owns])) owned.push(block);
    else rest.push(block);
  }

  const ordered = [...owned, ...rest];
  if (ordered.length <= 1) {
    const marker = '\n… [diff truncated]';
    return {
      patch: patch.slice(0, Math.max(0, opts.maxChars - marker.length)) + marker,
      truncated: true,
      omittedFiles: [],
    };
  }

  const included: string[] = [];
  const omittedFiles: string[] = [];
  let budget = opts.maxChars;
  for (let i = 0; i < ordered.length; i += 1) {
    const block = ordered[i] as DiffBlock;
    const separator = included.length === 0 ? '' : '\n';
    const cost = separator.length + block.text.length;
    if (cost <= budget) {
      included.push(separator + block.text);
      budget -= cost;
      continue;
    }

    // Cut this block mid-way when there is room for its header and a useful hunk slice.
    const marker = `\n… [truncated: ${block.path || 'diff'}]`;
    const room = budget - separator.length - marker.length;
    let consumed = i;
    if (room >= 200) {
      included.push(separator + block.text.slice(0, room) + marker);
      consumed = i + 1;
      budget = 0;
    }
    for (const skipped of ordered.slice(consumed)) {
      if (skipped.path !== '' && !omittedFiles.includes(skipped.path)) omittedFiles.push(skipped.path);
    }
    break;
  }

  if (included.length === 0) {
    included.push(`${patch.slice(0, Math.max(0, opts.maxChars - 40))}\n… [diff truncated]`);
    // The head slice contains at least part of the first block; it is not fully omitted.
    const firstPath = ordered[0]?.path;
    const index = firstPath === undefined ? -1 : omittedFiles.indexOf(firstPath);
    if (index !== -1) omittedFiles.splice(index, 1);
  }

  return { patch: included.join(''), truncated: true, omittedFiles };
}

/** Signals derived from a workspace `DiffSummary` plus the engine's changed-file list. */
export function signalsFor(diff: DiffSummary, changedFiles: readonly string[]): DiffSignals {
  const files = changedFiles.length > 0 ? changedFiles : diff.files.map((file) => file.path);
  return diffSignals(files);
}
