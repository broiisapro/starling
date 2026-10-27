/**
 * AIMD (additive-increase / multiplicative-decrease) effective parallelism.
 *
 * A provider that rate-limits us should not be hit by the same number of sessions a second later.
 * On a rate-limit signal the cap halves (floor 1); after `recoverAfterMs` without another signal,
 * each landed task nudges it back up by one. The engine dispatches against `min(maxParallel, limit)`.
 */
export interface AimdOptions {
  /** The run's configured parallelism. */
  max: number;
  /** Never go below this. Default 1. */
  min?: number;
  /** Quiet period after a rate limit before the cap may grow again. Default 60 s. */
  recoverAfterMs?: number;
  now: () => number;
}

export interface AimdChange {
  from: number;
  to: number;
  reason: string;
}

export class AimdLimit {
  readonly #max: number;
  readonly #min: number;
  readonly #recoverAfterMs: number;
  readonly #now: () => number;
  #limit: number;
  #lastDecreaseAt: number | undefined;

  constructor(options: AimdOptions) {
    this.#max = Math.max(1, options.max);
    this.#min = Math.max(1, Math.min(options.min ?? 1, this.#max));
    this.#recoverAfterMs = Math.max(0, options.recoverAfterMs ?? 60_000);
    this.#now = options.now;
    this.#limit = this.#max;
  }

  get limit(): number {
    return this.#limit;
  }

  get max(): number {
    return this.#max;
  }

  get recovering(): boolean {
    if (this.#lastDecreaseAt === undefined) return true;
    return this.#now() - this.#lastDecreaseAt >= this.#recoverAfterMs;
  }

  /** A provider rate-limited us: halve the cap. Returns `undefined` when it is already at the floor. */
  onRateLimit(): AimdChange | undefined {
    const from = this.#limit;
    const to = Math.max(this.#min, Math.floor(from / 2));
    this.#lastDecreaseAt = this.#now();
    if (to === from) return undefined;
    this.#limit = to;
    return { from, to, reason: 'provider rate limit' };
  }

  /** Work landed and the provider has been quiet: grow by one, up to `max`. */
  onProgress(): AimdChange | undefined {
    if (!this.recovering) return undefined;
    const from = this.#limit;
    if (from >= this.#max) return undefined;
    this.#limit = from + 1;
    return { from, to: this.#limit, reason: 'provider recovered' };
  }
}
