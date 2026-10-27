import type { ExecResult } from '@starling/core';
import { outputTail } from './git.ts';
import type { ExecFn } from './types.ts';

/** A regression suite that takes longer than this is treated as failed (and rolled back). */
export const DEFAULT_TEST_TIMEOUT_MS = 10 * 60 * 1000;

export interface SuiteOptions {
  /** Kill the suite and report it as failed after this long. */
  timeoutMs: number;
  /** The task the suite is vouching for; exported as `STARLING_TASK` for suites that branch on it. */
  taskKey: string;
}

export interface SuiteOutcome {
  ok: boolean;
  detail: string;
}

/**
 * Run a project's regression suite with `bash -c` and report the end of its output.
 *
 * The command is a shell line by design (`bun test`, `npm test -- --ci`, `test ! -f BROKEN`); core's
 * `exec` is argv-only (ARCHITECTURE L13), so the shell is explicit at this boundary. A timeout or a
 * spawn failure is **not** green: the caller must treat both as failed.
 *
 * Shared by the merge queue (which runs the suite in the integration worktree) and the conflict
 * resolver (which runs it in a scratch worktree before it asks the merger to land the branch).
 */
export async function runSuite(
  exec: ExecFn,
  cwd: string,
  command: string,
  options: SuiteOptions,
): Promise<SuiteOutcome> {
  let result: ExecResult;
  try {
    result = await exec(['bash', '-c', command], {
      cwd,
      timeoutMs: options.timeoutMs,
      // CI=1 makes most runners non-interactive; STARLING_TASK lets suites branch on the task.
      env: { CI: '1', STARLING_TASK: options.taskKey },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, detail: `the test command could not complete: ${message}` };
  }

  const tail = outputTail(result);
  if (result.code === 0) {
    return { ok: true, detail: `tests passed in ${result.durationMs}ms` };
  }
  return {
    ok: false,
    detail: `tests failed (exit ${result.code}) after ${result.durationMs}ms${tail.length > 0 ? `\n${tail}` : ''}`,
  };
}
