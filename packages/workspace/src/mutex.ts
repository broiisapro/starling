/**
 * A tiny per-key async mutex.
 *
 * Everything that writes to a repository's shared `.git` directory (worktree add/remove, branch
 * creation, fetch, bundle import) has to be serialised: git's own lock files protect the index and
 * individual refs, but they do not protect the sequence "is this branch there? then create it".
 * Up to ~20 agents run at once, so a wrong answer here costs a whole run.
 *
 * Operations inside one worktree never take a key, so agent work stays parallel.
 */
export class KeyedMutex {
  readonly #tails = new Map<string, Promise<void>>();
  readonly #depth = new Map<string, number>();

  /** Keys currently held or awaited. Exposed for tests and diagnostics. */
  keys(): string[] {
    return [...this.#tails.keys()];
  }

  /** Number of callers holding or waiting for `key`. */
  pending(key: string): number {
    return this.#depth.get(key) ?? 0;
  }

  /**
   * Run `fn` exclusively for `key`. Calls with the same key run in submission order; different keys
   * run concurrently. A rejected `fn` releases the key and propagates its error.
   */
  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    this.#depth.set(key, (this.#depth.get(key) ?? 0) + 1);
    const previous = this.#tails.get(key) ?? Promise.resolve();

    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.#tails.set(key, tail);

    try {
      await previous;
      return await fn();
    } finally {
      release();
      const remaining = (this.#depth.get(key) ?? 1) - 1;
      if (remaining <= 0) this.#depth.delete(key);
      else this.#depth.set(key, remaining);
      if (this.#tails.get(key) === tail) this.#tails.delete(key);
    }
  }
}

/** Promise-based sleep. Bundled here so the mutex has no dependency on a timer shim. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
