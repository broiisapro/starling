import { type ExecResult, StarlingError } from '@starling/core';
import type { ExecFn } from './types.ts';

const DEFAULT_TAIL_CHARS = 4000;

/** Keep the end of long output: test runners put the failing summary last. */
export function tailText(text: string, maxChars = DEFAULT_TAIL_CHARS): string {
  const trimmed = text.trimEnd();
  if (trimmed.length <= maxChars) return trimmed;
  return `…${trimmed.slice(trimmed.length - maxChars)}`;
}

/** A human-readable tail of a command's output for `MergeResult.detail`. */
export function outputTail(result: ExecResult, maxChars = DEFAULT_TAIL_CHARS): string {
  const parts: string[] = [];
  const stdout = tailText(result.stdout, maxChars);
  const stderr = tailText(result.stderr, maxChars);
  if (stdout.length > 0) parts.push(stdout);
  if (stderr.length > 0) parts.push(stderr);
  return parts.join('\n');
}

export interface Git {
  /** Run git; non-zero exits are returned, not thrown. */
  run(
    cwd: string,
    args: string[],
    opts?: { env?: Record<string, string | undefined>; timeoutMs?: number },
  ): Promise<ExecResult>;
  /** Run git and throw `MERGE_ERROR` on a non-zero exit. Returns trimmed stdout. */
  must(cwd: string, args: string[], opts?: { env?: Record<string, string | undefined> }): Promise<string>;
}

/** Thin argv wrapper around the injected `exec`, so every git call is fakeable. */
export function createGit(execFn: ExecFn): Git {
  const run: Git['run'] = (cwd, args, opts = {}) =>
    execFn(['git', ...args], { cwd, env: opts.env, timeoutMs: opts.timeoutMs });

  const must: Git['must'] = async (cwd, args, opts = {}) => {
    const result = await run(cwd, args, opts);
    if (result.code !== 0) {
      throw new StarlingError('MERGE_ERROR', `git ${args[0] ?? ''} failed (exit ${result.code})`, {
        details: { args, cwd, tail: outputTail(result) },
      });
    }
    return result.stdout.trim();
  };

  return { run, must };
}

/** Exit code checks that make the merge code read like the flow in the assignment. */
export function succeeded(result: ExecResult): boolean {
  return result.code === 0;
}
