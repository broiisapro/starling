import { isStarlingError, StarlingError } from '@starling/core';
import type { ExecFn } from './types';

/** How much command output the reviewer and the verdict keep (assignment: "last 4 KB"). */
export const COMMAND_OUTPUT_TAIL_CHARS = 4_096;

export interface CommandResult {
  /** False when no command was configured; every other field is then empty. */
  ran: boolean;
  command: string;
  /** Exit code when the process completed. */
  code?: number;
  timedOut: boolean;
  /** Spawn/timeout failure message, when there is one. */
  error?: string;
  /** Combined stdout + stderr (may be long; the tail is what matters). */
  output: string;
  /** Last `COMMAND_OUTPUT_TAIL_CHARS` characters, cut at a line boundary when possible. */
  tail: string;
  durationMs: number;
}

const SKIPPED: Omit<CommandResult, 'command'> = {
  ran: false,
  timedOut: false,
  output: '',
  tail: '',
  durationMs: 0,
};

/** Keep the last `limit` characters, starting at a line boundary when one is close to the cut. */
export function tailText(text: string, limit = COMMAND_OUTPUT_TAIL_CHARS): string {
  if (text.length <= limit) return text;
  const cut = text.slice(text.length - limit);
  const newline = cut.indexOf('\n');
  // Only snap forward when that drops a small prefix, so the tail stays close to `limit` chars.
  return newline !== -1 && newline < 200 ? cut.slice(newline + 1) : cut;
}

/**
 * Run the task's test/lint command through `sh -c` in the worktree, never throwing for a failing
 * command, a timeout or a missing shell. The worktree must be the cwd: a test run in the repo root
 * would grade the integration branch, not the task.
 */
export async function runShellCommand(
  execFn: ExecFn,
  command: string | undefined,
  cwd: string,
  timeoutMs: number,
): Promise<CommandResult> {
  if (command === undefined || command.trim() === '') {
    return { ...SKIPPED, command: command ?? '' };
  }

  const started = performance.now();
  try {
    const result = await execFn(['sh', '-c', command], { cwd, timeoutMs });
    const output = [result.stdout, result.stderr]
      .filter((part) => part.trim() !== '')
      .join('\n')
      .trimEnd();
    return {
      ran: true,
      command,
      code: result.code,
      timedOut: false,
      output,
      tail: tailText(output),
      durationMs: Math.round(performance.now() - started),
    };
  } catch (err) {
    const durationMs = Math.round(performance.now() - started);
    const timedOut = isStarlingError(err, 'EXEC_TIMEOUT');
    const message =
      err instanceof StarlingError ? err.message : err instanceof Error ? err.message : String(err);
    const tail = tailText(message);
    return {
      ran: true,
      command,
      timedOut,
      error: message,
      output: message,
      tail,
      durationMs,
    };
  }
}

/** Human-readable result for an `AuditCheck.detail`: exit status, last line, then a failure tail. */
export function describeCommand(result: CommandResult): string {
  if (!result.ran) return `skipped: no command configured`;
  if (result.timedOut) return `timed out after ${result.durationMs} ms: ${result.error ?? ''}`.trim();
  if (result.error !== undefined) return `could not run: ${result.error}`;
  const status = `exit ${result.code ?? 'unknown'}`;
  if (result.code === 0) {
    const lastLine = result.output
      .split('\n')
      .filter((line) => line.trim() !== '')
      .at(-1);
    return lastLine === undefined ? status : `${status}; ${lastLine.trim().slice(0, 240)}`;
  }
  return `${status}; output tail:\n${tailText(result.output, 1_200)}`;
}
