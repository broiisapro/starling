/**
 * Hard budget cap with an early warning.
 *
 * `observe()` is idempotent per threshold: the caller may call it on every transition and still get
 * each action exactly once. A warning fires at `warnRatio` (80% by default); the stop fires at 100%.
 * The engine drains running tasks after a stop and cancels only what never got dispatched.
 */
export interface BudgetGuardOptions {
  maxUsd: number;
  /** Fraction of the cap that triggers the early warning. Default 0.8. */
  warnRatio?: number;
}

export interface BudgetAction {
  warn: boolean;
  stop: boolean;
}

export class BudgetGuard {
  readonly maxUsd: number;
  readonly warnUsd: number;
  #warned = false;
  #stopped = false;
  #spentUsd = 0;

  constructor(options: BudgetGuardOptions) {
    this.maxUsd = Math.max(0, options.maxUsd);
    const ratio = Math.min(1, Math.max(0, options.warnRatio ?? 0.8));
    this.warnUsd = this.maxUsd * ratio;
  }

  get stopped(): boolean {
    return this.#stopped;
  }

  get warned(): boolean {
    return this.#warned;
  }

  get spentUsd(): number {
    return this.#spentUsd;
  }

  observe(costUsd: number): BudgetAction {
    this.#spentUsd = Math.max(this.#spentUsd, costUsd);
    const action: BudgetAction = { warn: false, stop: false };
    if (!this.#warned && this.maxUsd > 0 && this.#spentUsd >= this.warnUsd) {
      this.#warned = true;
      action.warn = true;
    }
    if (!this.#stopped && this.#spentUsd >= this.maxUsd) {
      this.#stopped = true;
      action.stop = true;
    }
    return action;
  }
}
