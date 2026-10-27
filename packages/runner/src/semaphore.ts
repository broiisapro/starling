/**
 * Counting semaphore used to cap concurrent agent turns on one opencode server.
 *
 * `acquire()` resolves with an idempotent release function. Waiting is FIFO so a queue of
 * tasks does not starve.
 */
export class Semaphore {
  readonly #max: number;
  #active = 0;
  readonly #waiters: Array<() => void> = [];

  constructor(max: number) {
    if (!Number.isInteger(max) || max < 1) {
      throw new RangeError(`Semaphore max must be a positive integer, got ${max}`);
    }
    this.#max = max;
  }

  get active(): number {
    return this.#active;
  }

  get pending(): number {
    return this.#waiters.length;
  }

  get max(): number {
    return this.#max;
  }

  async acquire(): Promise<() => void> {
    if (this.#active < this.#max) {
      this.#active += 1;
    } else {
      await new Promise<void>((resolve) => this.#waiters.push(resolve));
      this.#active += 1;
    }

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
