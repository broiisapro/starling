import { StarlingError } from './errors';

export interface ExecOptions {
  /** Working directory. Required: Starling never inherits an ambient cwd by accident. */
  cwd: string;
  /** Extra env vars merged over the current process env. */
  env?: Record<string, string | undefined>;
  /** Kill the process and throw `EXEC_TIMEOUT` after this many milliseconds. 0/undefined = no timeout. */
  timeoutMs?: number;
  /** Written to the child's stdin, which is then closed. */
  input?: string;
}

export interface ExecResult {
  /** Exit code. Non-zero is a normal result; `exec` only throws on timeouts and spawn failures. */
  code: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

/**
 * Run a command (argv form, never a shell string) and capture its output.
 *
 * Used by workspace/merger/github to shell out to `git` and `gh` (ARCHITECTURE L13/L14).
 * `exec` never throws on a non-zero exit; callers decide what to do with `code`. It does throw
 * `StarlingError('EXEC_TIMEOUT')` when the timeout fires, and `EXEC_FAILED` if the binary is missing.
 */
export async function exec(cmd: string[], opts: ExecOptions): Promise<ExecResult> {
  if (cmd.length === 0) {
    throw new StarlingError('INVALID_ARGUMENT', 'exec() needs at least one argv element');
  }

  const started = performance.now();
  const env = opts.env === undefined ? undefined : { ...process.env, ...opts.env };
  let proc: Bun.Subprocess<'pipe', 'pipe', 'pipe'>;

  try {
    proc = Bun.spawn(cmd, {
      cwd: opts.cwd,
      env,
      stdin: opts.input === undefined ? 'ignore' : 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    });
  } catch (err) {
    throw new StarlingError('EXEC_FAILED', `Failed to spawn ${cmd[0]}`, { cause: err, details: { cmd } });
  }

  if (opts.input !== undefined && proc.stdin) {
    proc.stdin.write(opts.input);
    proc.stdin.end();
  }

  const collect = async (): Promise<ExecResult> => {
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return {
      code,
      stdout: stdout.replace(/\r\n/g, '\n'),
      stderr: stderr.replace(/\r\n/g, '\n'),
      durationMs: Math.round(performance.now() - started),
    };
  };

  const timeoutMs = opts.timeoutMs ?? 0;
  if (timeoutMs <= 0) return collect();

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      proc.kill();
      reject(
        new StarlingError('EXEC_TIMEOUT', `${cmd[0]} timed out after ${timeoutMs}ms`, {
          details: { cmd, timeoutMs },
        }),
      );
    }, timeoutMs);
  });

  try {
    return await Promise.race([collect(), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
