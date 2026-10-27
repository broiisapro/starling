import { StarlingError } from '@starling/core';
import { type Git, outputTail } from './git.ts';
import { assertBranch, assertGitRepo, isAncestor } from './refs.ts';
import type { PreflightResult } from './types.ts';

/**
 * The `git merge-tree --write-tree --name-only` output is:
 *
 * ```
 * <result tree oid>
 * <conflicted path>
 * …
 * <blank line>
 * <informational messages>
 * ```
 *
 * A clean merge prints only the tree oid. `--name-only` is what makes the conflicted-path block
 * parseable; the messages after the blank line are for humans.
 */
export function parseMergeTree(stdout: string): {
  tree?: string;
  conflictedFiles: string[];
  messages: string;
} {
  const lines = stdout.split('\n');
  const tree = lines[0]?.trim();
  const conflictedFiles: string[] = [];
  let index = 1;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (line.trim().length === 0) {
      index += 1;
      break;
    }
    conflictedFiles.push(line.trim());
    index += 1;
  }
  return {
    tree: tree !== undefined && tree.length > 0 ? tree : undefined,
    conflictedFiles,
    messages: lines.slice(index).join('\n').trim(),
  };
}

/**
 * Predict a merge without touching a worktree, a ref or the index.
 *
 * Exit status is 0 for a clean merge, 1 for conflicts and >1 for an error (including git older than
 * 2.38, which lacks `--write-tree`). A conflict prediction writes one dangling tree object into the
 * repo's object database — git's normal garbage collection removes it and no ref moves.
 */
export async function runPreflight(
  git: Git,
  repo: string,
  integrationBranch: string,
  branch: string,
): Promise<PreflightResult> {
  await assertGitRepo(git, repo);
  await assertBranch(git, repo, integrationBranch, 'integration');
  await assertBranch(git, repo, branch, 'task');

  const base = { repo, integrationBranch, branch };

  if (await isAncestor(git, repo, branch, integrationBranch)) {
    return {
      ...base,
      clean: true,
      conflictedFiles: [],
      alreadyMerged: true,
      detail: `"${branch}" is already an ancestor of "${integrationBranch}"; the merge would be skipped`,
    };
  }

  const result = await git.run(repo, [
    'merge-tree',
    '--write-tree',
    '--name-only',
    integrationBranch,
    branch,
  ]);
  const parsed = parseMergeTree(result.stdout);

  if (result.code === 0) {
    return {
      ...base,
      clean: true,
      conflictedFiles: [],
      alreadyMerged: false,
      detail: `no conflicts predicted merging "${branch}" into "${integrationBranch}"`,
    };
  }

  if (result.code === 1) {
    const summary = parsed.messages.split('\n')[0] ?? '';
    return {
      ...base,
      clean: false,
      conflictedFiles: parsed.conflictedFiles,
      alreadyMerged: false,
      detail: `${parsed.conflictedFiles.length} conflicted file(s) predicted${summary.length > 0 ? `: ${summary}` : ''}`,
    };
  }

  throw new StarlingError(
    'MERGE_ERROR',
    `git merge-tree could not predict merging "${branch}" into "${integrationBranch}" (needs git >= 2.38)`,
    { details: { ...base, tail: outputTail(result) } },
  );
}
