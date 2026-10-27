/**
 * The one place that shells out to `git` (ARCHITECTURE L13: argv arrays only, never a shell string).
 *
 * Wraps core's `exec` with the four things a parallel workspace needs:
 * - an optional per-repository mutex (passed in, so work on one repo serialises and work on another
 *   does not);
 * - a bounded process pool, so 50 concurrent audits cannot turn into a spawn storm;
 * - bounded retries with exponential backoff when git reports lock contention;
 * - loud, typed failures (`WORKSPACE_ERROR`) carrying the command and stderr.
 */
import type { ExecResult } from '@starling/core';
import { exec as coreExec, StarlingError } from '@starling/core';
import { KeyedMutex, sleep } from './mutex';
import { boundedExec, defaultGitConcurrency } from './pool';
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
  /**
   * Base backoff for the first lock-contention retry. Each further attempt doubles it, capped at
   * `maxRetryDelayMs`, with a little jitter so two callers do not wake up in lockstep. Default 25 ms.
   */
  retryDelayMs?: number;
  /** Total attempts (the first try included) when git keeps reporting contention. Default 6. */
  retryAttempts?: number;
  /** Ceiling for the exponential backoff. Default 1000 ms. */
  maxRetryDelayMs?: number;
  /** Default timeout for ordinary calls. Default 120 s: git can be slow on a cold, large repo. */
  timeoutMs?: number;
  /**
   * In-flight `git` process cap (see `pool.ts`). Defaults to `defaultGitConcurrency()`; `0` disables
   * the pool. Tests with a fake exec usually pass `0`.
   */
  maxConcurrency?: number;
}

/** Env every git call gets: never stop for a credential prompt, never download LFS objects. */
const GIT_ENV = {
  GIT_TERMINAL_PROMPT: '0',
  GIT_ASKPASS: '',
  GIT_PAGER: 'cat',
  // A worktree checkout of an LFS repo would otherwise pull every object over the network (and fail
  // outright with no LFS remote). Audits read pointer files; a task that genuinely needs content can
  // run `git lfs pull` itself.
  GIT_LFS_SKIP_SMUDGE: '1',
} as const;

/**
 * Pinned for every call: git's default (`core.quotePath=true`) prints non-ASCII paths as
 * `"src/na\303\257ve.ts"`, which would break lane globs, changed-file lists and audit patches on any
 * repository with unicode file names. NUL-delimited output ignores this, but patches and `--numstat`
 * do not.
 */
const GLOBAL_ARGS = ['-c', 'core.quotePath=false'] as const;

/** Patterns git prints when another process holds a lock we care about. */
const LOCK_CONTENTION = [
  'index.lock',
  'cannot lock ref',
  'cannot lock worktree',
  'another git process',
  'Unable to create',
  'could not lock config file',
  'failed to lock',
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
  readonly #retryAttempts: number;
  readonly #maxRetryDelayMs: number;
  readonly #timeoutMs: number;
  #versionCall: Promise<GitVersion> | undefined;

  constructor(execFn: ExecLike = coreExec, mutex: KeyedMutex = new KeyedMutex(), opts: GitOptions = {}) {
    this.#mutex = mutex;
    this.#retryDelayMs = Math.max(0, opts.retryDelayMs ?? 25);
    this.#retryAttempts = Math.max(1, opts.retryAttempts ?? 6);
    this.#maxRetryDelayMs = Math.max(this.#retryDelayMs, opts.maxRetryDelayMs ?? 1000);
    this.#timeoutMs = opts.timeoutMs ?? 120_000;
    const limit = opts.maxConcurrency ?? defaultGitConcurrency();
    this.#exec = boundedExec(execFn, limit);
  }

  /**
   * Run git, retrying with exponential backoff while the failure is lock contention.
   *
   * At 50 worktrees the common contention is *internal* (two worktrees of the same repo staging at
   * the same moment) rather than a human holding `index.lock`, so one 50 ms retry is not enough: the
   * loser of the race usually needs a few tens of milliseconds. Six attempts with jitter covers it
   * without hiding a genuinely stuck lock for more than ~2 s.
   *
   * Never takes the mutex: only call this when the caller already holds it.
   */
  async attempt(args: string[], opts: GitCallOptions): Promise<ExecResult> {
    const runOnce = () =>
      this.#exec(['git', ...GLOBAL_ARGS, ...args], {
        cwd: opts.cwd,
        env: { ...GIT_ENV },
        timeoutMs: opts.timeoutMs ?? this.#timeoutMs,
      });

    let result = await runOnce();
    for (let attempt = 1; attempt < this.#retryAttempts; attempt += 1) {
      if (result.code === 0 || !isLockContention(result.stderr)) return result;
      await sleep(this.#backoffMs(attempt));
      result = await runOnce();
    }
    return result;
  }

  /** Delay before retry number `attempt` (1-based), exponential, capped, lightly jittered. */
  #backoffMs(attempt: number): number {
    const base = Math.min(this.#maxRetryDelayMs, this.#retryDelayMs * 2 ** (attempt - 1));
    // Up to 25% jitter so a herd of waiters spreads out instead of waking together.
    return Math.round(base + Math.random() * base * 0.25);
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
