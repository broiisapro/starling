/**
 * The one seam between the release tooling and the outside world: running a command.
 *
 * Everything that shells out (`bun build`, `bun run`, `tar`, `git`, the built binary) goes through
 * an injected `ExecFn`. Unit tests pass a fake, so `bun test tools/release` never compiles a binary
 * and never touches the network. The default is `@starling/core`'s argv-only `exec` (ARCHITECTURE
 * L13): `tools/` is not a Bun workspace, so the package is imported by path, like `tools/stats` does.
 */
import { exec, StarlingError } from '../../packages/core/src/index.ts';

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type ExecFn = (
  cmd: string[],
  opts: { cwd: string; env?: Record<string, string> },
) => Promise<CommandResult>;

/** Compiles are slow on a loaded laptop (Wave 3 runs ~100 agents at once); ten minutes is generous. */
const DEFAULT_TIMEOUT_MS = 600_000;

/** The production runner. Bare `tar`/`git`/`bun` from PATH, argv form only. */
export const runCommand: ExecFn = async (cmd, opts) => {
  const result = await exec(cmd, { cwd: opts.cwd, env: opts.env, timeoutMs: DEFAULT_TIMEOUT_MS });
  return { code: result.code, stdout: result.stdout, stderr: result.stderr };
};

/** Run something that must succeed; on a non-zero exit throw with the first line of stderr. */
export async function mustExec(
  exec: ExecFn,
  cmd: string[],
  cwd: string,
  env?: Record<string, string>,
): Promise<CommandResult> {
  const result = await exec(cmd, env === undefined ? { cwd } : { cwd, env });
  if (result.code !== 0) {
    const detail = result.stderr.trim().split('\n')[0] ?? '';
    throw new StarlingError(
      'EXEC_FAILED',
      `\`${cmd.join(' ')}\` failed (exit ${result.code})${detail === '' ? '' : `: ${detail}`}`,
      { details: { code: result.code } },
    );
  }
  return result;
}
