/**
 * Where a real run keeps its state, relative to the repo it targets.
 *
 * Decisions:
 * - `<repo>/.starling/starling.db` (ARCHITECTURE L9 says "the target repo's parent, or ~/.starling",
 *   and the epic prompt pins the repo itself). Keeping it inside the repo means `starling status`
 *   run from that repo finds the run, and deleting the demo repo deletes its history.
 * - Worktrees go where `worktreeRoot` says, resolved **relative to the repo** when it is relative,
 *   so `../.starling-worktrees` from `/tmp/sky-e2e-1` means `/tmp/.starling-worktrees` — next to the
 *   demo repo rather than inside it (a worktree inside a worktree's parent repo confuses git).
 */
import { isAbsolute, resolve } from 'node:path';

/** `<repo>/.starling` — Starling's runtime state for one target repo. */
export function starlingDir(repoPath: string): string {
  return resolve(repoPath, '.starling');
}

/** `<repo>/.starling/starling.db`. Never committed: `.starling/` and `*.db` are gitignored. */
export function storePathFor(repoPath: string): string {
  return resolve(starlingDir(repoPath), 'starling.db');
}

/** Resolve a config `worktreeRoot` against the repo it belongs to. */
export function worktreeRootFor(repoPath: string, configured: string): string {
  return isAbsolute(configured) ? configured : resolve(repoPath, configured);
}

/** JSONL recordings land here unless `--record` names a path. */
export function recordingsDir(repoPath: string): string {
  return resolve(starlingDir(repoPath), 'recordings');
}
