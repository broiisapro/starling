// `tools/` is not a Bun workspace (root `workspaces` is `packages/*` + `apps/*`), so there is no
// `@starling/core` symlink here. Import the package's public entry directly instead of duplicating
// its exec helper; a FIX REQUEST asks for `tools/*` to join the workspace.
import { exec } from '../../packages/core/src/index.ts';

/**
 * A tiny command runner the collector can have replaced in tests.
 *
 * Git calls always hit the real `git`; only `gh` is faked in unit tests (a fixture JSON body), so
 * neither the collector nor its tests need a network. `stdout` is already newline-normalised.
 */
export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type RunCommand = (
  cmd: string[],
  opts: { cwd: string; env?: Record<string, string> },
) => Promise<CommandResult>;

/** The default runner: `@starling/core`'s argv-only `exec` (ARCHITECTURE L13/L14). */
export const runCommand: RunCommand = async (cmd, opts) => {
  const result = await exec(cmd, { cwd: opts.cwd, env: opts.env, timeoutMs: 60_000 });
  return { code: result.code, stdout: result.stdout, stderr: result.stderr };
};

/** Run a command and return stdout, throwing a readable error on a non-zero exit. */
export async function mustRun(run: RunCommand, cmd: string[], cwd: string): Promise<string> {
  const result = await run(cmd, { cwd });
  if (result.code !== 0) {
    throw new Error(`${cmd.slice(0, 3).join(' ')} failed (exit ${result.code}): ${result.stderr.trim()}`);
  }
  return result.stdout;
}

/** Split command output into non-empty, right-trimmed lines. */
export function outputLines(stdout: string): string[] {
  return stdout
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
}
