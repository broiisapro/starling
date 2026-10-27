/**
 * Conflict plumbing for the resolver: commit a conflicted merge *with* the markers, read those
 * markers back for the prompt, and prove afterwards that they are gone.
 *
 * The merge queue aborts a conflicted merge and never moves the integration branch. The resolver
 * needs the opposite starting point — a branch whose tip is the conflict itself — so the agent has
 * a real worktree to repair instead of a description of one.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { StarlingError } from '@starling/core';
import { type Git, outputTail } from './git.ts';

/** How many lines of each side of a hunk the prompt gets. Enough to recognise both intents. */
export const DEFAULT_HUNK_LINES = 8;

/** Cap on one file's rendered hunks. */
export const DEFAULT_HUNK_CHARS = 2_000;

/** Cap on how many separate conflicts per file are shown. */
export const DEFAULT_HUNKS_PER_FILE = 3;

export interface ConflictMergeInput {
  git: Git;
  /** A worktree checked out on the (fresh) resolve branch. */
  worktreePath: string;
  /** The task branch whose merge conflicts. */
  taskBranch: string;
  /** Commit message for the marker commit (also used if the merge happens to be clean). */
  message: string;
  /** Trimming for the hunks captured in the prompt. */
  hunkOptions?: HunkOptions;
}

export interface ConflictMergeOutcome {
  /** True when git merged without conflicts: there is nothing for an agent to resolve. */
  clean: boolean;
  /** The resolve branch's new tip (a merge commit with two parents, even when conflicted). */
  commit: string;
  conflictedFiles: string[];
  /** Trimmed hunks, formatted with a `--- <path>` header per file. Empty when the merge was clean. */
  hunks: string[];
  detail: string;
}

export interface HunkOptions {
  /** Lines kept from each side of one conflict. Default 8. */
  maxHunkLines?: number;
  /** Conflicts shown per file. Default 3. */
  maxHunksPerFile?: number;
  /** Character cap per file. Default 2000. */
  maxChars?: number;
}

export interface ConflictMarker {
  path: string;
  line: number;
  text: string;
}

function splitUnmerged(stdout: string): string[] {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function clampChars(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  if (maxChars <= 1) return '…';
  return `${text.slice(0, maxChars - 1).trimEnd()}…`;
}

function trimSide(lines: string[], maxLines: number): string[] {
  if (lines.length <= maxLines) return lines;
  return [...lines.slice(0, maxLines), `… (${lines.length - maxLines} more lines)`];
}

interface RawHunk {
  ours: string[];
  theirs: string[];
  open: string;
  close: string;
}

/**
 * Find `<<<<<<< … ======= … >>>>>>>` blocks in one file.
 *
 * `|||||||` (diff3 style) is tolerated: its base section is dropped, because a resolver needs the
 * two sides, not git's common ancestor. A block that never closes is still returned, so a
 * half-gutted file cannot make the marker check falsely pass.
 */
export function findHunks(text: string): RawHunk[] {
  const lines = text.split('\n');
  const hunks: RawHunk[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (!line.startsWith('<<<<<<< ')) {
      index += 1;
      continue;
    }
    const open = line;
    const ours: string[] = [];
    let close = '';
    index += 1;

    while (index < lines.length) {
      const current = lines[index] ?? '';
      if (current.startsWith('=======') || current.startsWith('||||||| ')) break;
      if (current.startsWith('>>>>>>> ')) break;
      ours.push(current);
      index += 1;
    }

    if ((lines[index] ?? '').startsWith('||||||| ')) {
      index += 1;
      while (index < lines.length && !(lines[index] ?? '').startsWith('=======')) index += 1;
    }

    const theirs: string[] = [];
    if ((lines[index] ?? '').startsWith('=======')) {
      index += 1;
      while (index < lines.length && !(lines[index] ?? '').startsWith('>>>>>>> ')) {
        theirs.push(lines[index] ?? '');
        index += 1;
      }
    }

    if ((lines[index] ?? '').startsWith('>>>>>>> ')) {
      close = lines[index] ?? '';
      index += 1;
    }

    hunks.push({ ours, theirs, open, close });
  }

  return hunks;
}

/**
 * Render one file's conflicts as a trimmed `--- <path>` block.
 *
 * Deliberately lossy: the agent has the full file in its worktree, and a prompt that repeats a
 * 2,000-line conflict verbatim costs context without adding information.
 */
export function renderHunks(path: string, text: string, options: HunkOptions = {}): string {
  const maxHunkLines = Math.max(1, options.maxHunkLines ?? DEFAULT_HUNK_LINES);
  const maxHunksPerFile = Math.max(1, options.maxHunksPerFile ?? DEFAULT_HUNKS_PER_FILE);
  const maxChars = Math.max(1, options.maxChars ?? DEFAULT_HUNK_CHARS);

  const hunks = findHunks(text);
  if (hunks.length === 0) return '';

  const shown = hunks.slice(0, maxHunksPerFile);
  const blocks = shown.map((hunk) =>
    [
      hunk.open,
      ...trimSide(hunk.ours, maxHunkLines),
      '=======',
      ...trimSide(hunk.theirs, maxHunkLines),
      hunk.close.length > 0 ? hunk.close : '>>>>>>>',
    ].join('\n'),
  );
  const hidden = hunks.length - shown.length;
  if (hidden > 0) blocks.push(`… (${hidden} more conflict${hidden === 1 ? '' : 's'} in this file)`);

  return clampChars([`--- ${path}`, ...blocks].join('\n'), maxChars);
}

/**
 * Read the conflicted files from the worktree and render their trimmed hunks.
 *
 * A file that cannot be read is skipped rather than failing the whole attempt: the prompt is
 * orientation, and the agent's worktree is still the source of truth.
 */
export async function readHunks(
  worktreePath: string,
  conflictedFiles: string[],
  options: HunkOptions = {},
): Promise<string[]> {
  const rendered: string[] = [];
  for (const path of conflictedFiles) {
    let text: string;
    try {
      text = await readFile(join(worktreePath, path), 'utf8');
    } catch {
      // Binary file, deleted path, or no read permission: no hunk to show, and not worth failing.
      continue;
    }
    const block = renderHunks(path, text, options);
    if (block.length > 0) rendered.push(block);
  }
  return rendered;
}

/**
 * Merge `taskBranch` into the checked-out resolve branch and commit the conflict **with markers**.
 *
 * Returns `clean: true` when git merged without conflicts (the reported conflict no longer
 * reproduces, e.g. because a sibling landed in between); the caller can then skip the agent and go
 * straight to verification. Any non-zero merge exit without unmerged paths is a hard `MERGE_ERROR`,
 * mirroring the merge queue: only unmerged paths are a content conflict.
 */
export async function commitConflictedMerge(input: ConflictMergeInput): Promise<ConflictMergeOutcome> {
  const { git, worktreePath, taskBranch, message } = input;
  const merge = await git.run(worktreePath, [
    '-c',
    'commit.gpgsign=false',
    'merge',
    '--no-ff',
    '--no-edit',
    '-m',
    message,
    taskBranch,
  ]);

  if (merge.code === 0) {
    const commit = (await git.must(worktreePath, ['rev-parse', 'HEAD'])).trim();
    return {
      clean: true,
      commit,
      conflictedFiles: [],
      hunks: [],
      detail: `"${taskBranch}" merged cleanly; there is no conflict to resolve`,
    };
  }

  const unmerged = await git.run(worktreePath, ['diff', '--name-only', '--diff-filter=U']);
  const conflictedFiles = splitUnmerged(unmerged.stdout);
  if (conflictedFiles.length === 0) {
    throw new StarlingError('MERGE_ERROR', `git merge of "${taskBranch}" failed without a content conflict`, {
      details: { worktreePath, taskBranch, tail: outputTail(merge) },
    });
  }

  // Stage the marker files as they are and commit: the resolve branch now starts from the conflict.
  const add = await git.run(worktreePath, ['add', '-A']);
  if (add.code !== 0) {
    throw new StarlingError('MERGE_ERROR', 'Could not stage the conflicted merge', {
      details: { worktreePath, tail: outputTail(add) },
    });
  }
  const commit = await git.run(worktreePath, [
    '-c',
    'commit.gpgsign=false',
    'commit',
    '--no-edit',
    '-m',
    message,
  ]);
  if (commit.code !== 0) {
    throw new StarlingError('MERGE_ERROR', 'Could not commit the conflicted merge with its markers', {
      details: { worktreePath, tail: outputTail(commit) },
    });
  }

  const sha = (await git.must(worktreePath, ['rev-parse', 'HEAD'])).trim();
  const hunks = await readHunks(worktreePath, conflictedFiles, input.hunkOptions);

  return {
    clean: false,
    commit: sha,
    conflictedFiles,
    hunks,
    detail: `Committed the conflicted merge with markers in ${conflictedFiles.length} file(s) at ${sha}`,
  };
}

/**
 * Every `<<<<<<< ` line reachable from `ref`, via `git grep` (no checkout required).
 *
 * Exit 1 means "no matches" and is the success case. Anything else is a real git failure and is
 * thrown: a resolver that cannot prove the markers are gone must not claim it resolved anything.
 */
export async function findConflictMarkers(git: Git, repo: string, ref: string): Promise<ConflictMarker[]> {
  const result = await git.run(repo, ['grep', '-n', '--no-color', '-e', '^<<<<<<< ', ref]);
  if (result.code === 1) return [];
  if (result.code !== 0) {
    throw new StarlingError('MERGE_ERROR', `Could not search "${ref}" for conflict markers`, {
      details: { repo, ref, tail: outputTail(result) },
    });
  }

  const prefix = `${ref}:`;
  const markers: ConflictMarker[] = [];
  for (const raw of result.stdout.split('\n')) {
    if (raw.trim().length === 0) continue;
    const line = raw.startsWith(prefix) ? raw.slice(prefix.length) : raw;
    const first = line.indexOf(':');
    const second = first === -1 ? -1 : line.indexOf(':', first + 1);
    if (first === -1 || second === -1) continue;
    const path = line.slice(0, first);
    const lineNumber = Number.parseInt(line.slice(first + 1, second), 10);
    markers.push({
      path,
      line: Number.isFinite(lineNumber) ? lineNumber : 0,
      text: line.slice(second + 1),
    });
  }
  return markers;
}

/** Point a local branch at `commit`, refusing loudly when git will not move it (still checked out). */
export async function resetBranch(git: Git, repo: string, branch: string, commit: string): Promise<void> {
  const result = await git.run(repo, ['branch', '-f', branch, commit]);
  if (result.code !== 0) {
    throw new StarlingError('MERGE_ERROR', `Could not reset "${branch}" to ${commit}`, {
      details: { repo, branch, commit, tail: outputTail(result) },
    });
  }
}
