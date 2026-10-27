/**
 * Bounded process pool for git spawns.
 *
 * Every workspace operation fans out into `git` child processes. With ~20 agents per laptop (and 50+
 * worktrees in the stress harness) an unbounded fan-out turns one audit burst into a spawn storm:
 * hundreds of simultaneous `git` processes, all competing for the same CPU, page cache and disk
 * queue, so *every* call gets slower and the machine stops answering.
 *
 * The pool caps in-flight `git` processes at a small multiple of the core count and queues the rest
 * in FIFO order. Queueing is per `Git` instance (one workspace = one pool), so a second repository
 * never waits behind the first one.
 */
import { cpus } from 'node:os';
import { exec as coreExec, StarlingError } from '@starling/core';

/** The shape of core's `exec` (argv array in, captured output out). */
export type ExecFn = typeof coreExec;

/**
 * Default in-flight cap: one `git` per core, clamped to a sane band.
 *
 * git itself is mostly I/O bound but each process still burns CPU parsing trees, so oversubscribing
 * the cores mostly adds context switches. 4 is the floor for machines that report a single core;
 * 12 is the ceiling because beyond that the bottleneck is the disk queue, not the executor.
 */
export function defaultGitConcurrency(): number {
  const cores = cpus().length;
  if (!Number.isFinite(cores) || cores < 1) return 4;
  return Math.max(4, Math.min(cores, 12));
}

/** A counting semaphore: `run` waits for a slot, then always releases it, even on throw. */
export class Semaphore {
  readonly #limit: number;
  readonly #waiters: (() => void)[] = [];
  #active = 0;

  constructor(limit: number) {
    if (!Number.isFinite(limit) || limit < 1) {
      throw new StarlingError('INVALID_ARGUMENT', `Semaphore needs a positive limit, got ${limit}`);
    }
    this.#limit = Math.floor(limit);
  }

  /** Maximum number of concurrent holders. */
  get limit(): number {
    return this.#limit;
  }

  /** Callers holding a slot right now. */
  get active(): number {
    return this.#active;
  }

  /** Callers waiting for a slot right now. */
  get queued(): number {
    return this.#waiters.length;
  }

  /** Run `fn` with a slot held; FIFO between waiters. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.#acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }

  #acquire(): Promise<() => void> {
    if (this.#active < this.#limit) {
      this.#active += 1;
      return Promise.resolve(this.#releaser());
    }
    return new Promise<() => void>((resolve) => {
      this.#waiters.push(() => {
        this.#active += 1;
        resolve(this.#releaser());
      });
    });
  }

  /** A release function that is safe to call twice (a double release would corrupt `active`). */
  #releaser(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#active -= 1;
      const next = this.#waiters.shift();
      if (next !== undefined) next();
    };
  }
}

/**
 * Wrap an `exec` so at most `limit` calls are in flight. `limit <= 0` (or a non-finite value) means
 * "no cap" and returns `execFn` untouched, which is what tests that drive a fake exec want.
 */
export function boundedExec(execFn: ExecFn, limit: number): ExecFn {
  if (!Number.isFinite(limit) || limit <= 0) return execFn;
  const semaphore = new Semaphore(limit);
  const wrapped = ((cmd: string[], opts: Parameters<ExecFn>[1]) =>
    semaphore.run(() => execFn(cmd, opts))) as ExecFn;
  return wrapped;
}
