/**
 * Spawning `opencode serve` and reading its startup line.
 *
 * opencode 2.1.2 prints `server listening on http://127.0.0.1:<port>` on stdout. The password
 * is taken from `OPENCODE_SERVER_PASSWORD` (verified by reading the shipped serve command), so
 * we never have to scrape it and it never lands in logs.
 */
import { StarlingError } from '@starling/core';

export interface SpawnedProcess {
  stdout: ReadableStream<Uint8Array> | undefined;
  stderr: ReadableStream<Uint8Array> | undefined;
  exited: Promise<number>;
  kill(signal?: number | string): void;
}

export interface SpawnServerOptions {
  /** Executable name or absolute path. Defaults to `opencode`. */
  command?: string;
  port: number;
  password: string;
  hostname?: string;
  spawn: typeof Bun.spawn;
  onLine?: (line: string, stream: 'stdout' | 'stderr') => void;
}

export interface SpawnedServer {
  process: SpawnedProcess;
  /** Resolves with the URL from the `server listening on …` line. */
  listening: Promise<string>;
  /** Last 50 lines of stdout+stderr, for diagnostics only (never contains the password). */
  logs(): string[];
}

const MAX_LOG_LINES = 50;
const LISTENING_PATTERN = /server listening on\s+(http\S+)/;

async function pumpLines(
  stream: ReadableStream<Uint8Array> | undefined,
  onLine: (line: string) => void,
): Promise<void> {
  if (stream === undefined) return;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
        if (line !== '') onLine(line);
        newline = buffer.indexOf('\n');
      }
    }
    if (buffer !== '') onLine(buffer.replace(/\r$/, ''));
  } catch {
    // A killed process closes its pipes mid-read. The caller observes `exited` for the reason.
  }
}

export function spawnOpencodeServer(options: SpawnServerOptions): SpawnedServer {
  const command = options.command ?? 'opencode';
  const hostname = options.hostname ?? '127.0.0.1';
  const args = ['serve', '--port', String(options.port), '--hostname', hostname];

  let child: ReturnType<typeof Bun.spawn>;
  try {
    child = options.spawn([command, ...args], {
      env: { ...process.env, OPENCODE_SERVER_PASSWORD: options.password },
      stdout: 'pipe',
      stderr: 'pipe',
      stdin: 'ignore',
    });
  } catch (err) {
    throw new StarlingError('RUNNER_ERROR', `could not start "${command} serve"`, { cause: err });
  }

  const proc = child as unknown as SpawnedProcess;
  const lines: string[] = [];
  let resolveListening: (url: string) => void = () => {};
  let rejectListening: (err: unknown) => void = () => {};
  const listening = new Promise<string>((resolve, reject) => {
    resolveListening = resolve;
    rejectListening = reject;
  });
  // The rejection is observed by the runner's startup race; this guard keeps a late failure
  // from becoming an unhandled rejection when the runner already closed.
  listening.catch(() => {});

  const record = (line: string, stream: 'stdout' | 'stderr') => {
    lines.push(`${stream}: ${line}`);
    if (lines.length > MAX_LOG_LINES) lines.shift();
    options.onLine?.(line, stream);
    const match = LISTENING_PATTERN.exec(line);
    if (match?.[1] !== undefined) resolveListening(match[1]);
  };

  void pumpLines(proc.stdout, (line) => record(line, 'stdout'));
  void pumpLines(proc.stderr, (line) => record(line, 'stderr'));

  void proc.exited.then(
    (code) => rejectListening(new StarlingError('RUNNER_ERROR', `opencode serve exited with code ${code}`)),
    (err) => rejectListening(err),
  );

  return { process: proc, listening, logs: () => [...lines] };
}
