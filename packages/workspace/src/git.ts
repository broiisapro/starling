/**
 * The one place that shells out to `git` (ARCHITECTURE L13: argv arrays only, never a shell string).
 *
 * Wraps core's `exec` with the three things a parallel workspace needs:
 * - an optional per-repository mutex (passed in, so work on one repo serialises and work on another
 *   does not);
 * - a single retry when git reports lock contention, after a short backoff;
 * - loud, typed failures (`WORKSPACE_ERROR`) carrying the command and stderr.
 */
import type { ExecResult } from '@starling/core';
import { exec as coreExec, StarlingError } from '@starling/core';
import { KeyedMutex, sleep } from './mutex';
import { assertGitVersion, type GitVersion, parseGitVersion } from './version';

/** Injectable exec, so tests can drive retry and failure paths without a real git. */
export type ExecLike = typeof coreExec;

export interface GitCallOptions {
  cwd: string;
  /** Mutex key for calls that mutate shared `.git` state. Omit for read-only work. */
  lock?: string;
  timeoutMs?: number;
}

export interface GitOptions {
  /** Backoff before the single lock-contention retry. Default 50 ms. */
  retryDelayMs?: number;
  /** Default timeout for ordinary calls. Default 120 s: git can be slow on a cold, large repo. */
  timeoutMs?: number;
}

/** Env every git call gets: never stop for a credential prompt. */
const GIT_ENV = { GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', GIT_PAGER: 'cat' } as const;

/** Patterns git prints when another process holds a lock we care about. */
const LOCK_CONTENTION = [
  'index.lock',
  'cannot lock ref',
  'another git process',
  'Unable to create',
  'could not lock config file',
];

export function isLockContention(stderr: string): boolean {
  const text = stderr.toLowerCase();
  return LOCK_CONTENTION.some((needle) => text.includes(needle.toLowerCase()));
}

/** Turn a failed git run into a `WORKSPACE_ERROR` carrying the argv and stderr. */
export function gitFailure(args: string[], result: ExecResult): StarlingError {
  const rendered = ['git', ...args].join(' ');
  const stderr = result.stderr.trim();
  const stdout = result.stdout.trim();
  const detail = (stderr || stdout || 'no output').slice(0, 2000);
  return new StarlingError('WORKSPACE_ERROR', `${rendered} failed (exit ${result.code}): ${detail}`, {
    details: { cmd: ['git', ...args], code: result.code, stderr: stderr.slice(0, 4000) },
  });
}

export class Git {
  readonly #exec: ExecLike;
  readonly #mutex: KeyedMutex;
  readonly #retryDelayMs: number;
  readonly #timeoutMs: number;
  #versionCall: Promise<GitVersion> | undefined;

  constructor(execFn: ExecLike = coreExec, mutex: KeyedMutex = new KeyedMutex(), opts: GitOptions = {}) {
    this.#exec = execFn;
    this.#mutex = mutex;
    this.#retryDelayMs = opts.retryDelayMs ?? 50;
    this.#timeoutMs = opts.timeoutMs ?? 120_000;
  }

  /**
   * Run git once, retrying a single time when the failure is lock contention.
   * Never takes the mutex: only call this when the caller already holds it.
   */
  async attempt(args: string[], opts: GitCallOptions): Promise<ExecResult> {
    const runOnce = () =>
      this.#exec(['git', ...args], {
        cwd: opts.cwd,
        env: { ...GIT_ENV },
        timeoutMs: opts.timeoutMs ?? this.#timeoutMs,
      });

    const first = await runOnce();
    if (first.code === 0 || !isLockContention(first.stderr)) return first;
    await sleep(this.#retryDelayMs);
    return runOnce();
  }

  /** Run git, taking the repo mutex first when `lock` is set. */
  async run(args: string[], opts: GitCallOptions): Promise<ExecResult> {
    if (opts.lock === undefined) return this.attempt(args, opts);
    const key = opts.lock;
    return this.#mutex.run(key, () => this.attempt(args, { ...opts, lock: undefined }));
  }

  /**
   * Hold the mutex for `key` across several git calls. Commands issued inside must use `attempt`,
   * otherwise the same key would deadlock.
   */
  lock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    return this.#mutex.run(key, fn);
  }

  /** Run git and throw `WORKSPACE_ERROR` on any non-zero exit. */
  async ok(args: string[], opts: GitCallOptions): Promise<ExecResult> {
    const result = await this.run(args, opts);
    if (result.code !== 0) throw gitFailure(args, result);
    return result;
  }

  /** Run git and return stdout exactly as git printed it (patches need their trailing newline). */
  async stdout(args: string[], opts: GitCallOptions): Promise<string> {
    return (await this.ok(args, opts)).stdout;
  }

  /** Run git and return trimmed stdout. */
  async text(args: string[], opts: GitCallOptions): Promise<string> {
    return (await this.ok(args, opts)).stdout.trim();
  }

  /** `git version`, parsed once per instance. */
  version(cwd: string = process.cwd()): Promise<GitVersion> {
    this.#versionCall ??= this.#exec(['git', 'version'], {
      cwd,
      env: { ...GIT_ENV },
      timeoutMs: 10_000,
    }).then((result) => {
      if (result.code !== 0) throw gitFailure(['version'], result);
      const parsed = parseGitVersion(result.stdout);
      if (parsed === undefined) {
        throw new StarlingError('WORKSPACE_ERROR', `cannot parse git version from "${result.stdout.trim()}"`);
      }
      return parsed;
    });
    return this.#versionCall;
  }

  /** Throw `StarlingError('GIT_TOO_OLD')` when the local git is older than `min`. */
  async requireVersion(min?: GitVersion, cwd?: string): Promise<void> {
    assertGitVersion(await this.version(cwd), min);
  }
}
