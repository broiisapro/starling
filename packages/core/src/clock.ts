import type { Clock } from './ports';

/** Real time, injected everywhere so tests can be deterministic. */
export const systemClock: Clock = {
  now: () => Date.now(),
};

/**
 * A manually driven clock.
 *
 * ```ts
 * const clock = new FakeClock(1000);
 * clock.advance(500); // now() === 1500
 * ```
 */
export class FakeClock implements Clock {
  #now: number;

  constructor(start = 0) {
    this.#now = start;
  }

  now(): number {
    return this.#now;
  }

  /** Move time forward by `ms` and return the new time. */
  advance(ms: number): number {
    if (ms < 0) throw new RangeError('FakeClock cannot move backwards');
    this.#now += ms;
    return this.#now;
  }

  /** Jump to an absolute time. */
  set(ts: number): number {
    this.#now = ts;
    return this.#now;
  }
}
