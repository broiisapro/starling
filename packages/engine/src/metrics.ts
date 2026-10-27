/**
 * Run metrics and their publish throttle (ARCHITECTURE §4: recompute on every change, publish at
 * most once a second, plus a 5 s heartbeat).
 */

import type { Clock, Run, RunMetrics, TokenUsage } from '@starling/core';
import { addUsage, emptyUsage, estimateSavedUsd, usageCostUsd } from '@starling/core';
import { activeCount, countStatus } from './state';

/** Token accounting split by where the tokens were spent. `usage` on a TaskRun is the total. */
export interface UsageLedger {
  api: TokenUsage;
  local: TokenUsage;
  localCalls: number;
  apiCostUsd: number;
}

export function emptyLedger(): UsageLedger {
  return { api: emptyUsage(), local: emptyUsage(), localCalls: 0, apiCostUsd: 0 };
}

export interface RecordedCall {
  usage: TokenUsage;
  /** Model id used for pricing (`provider/model` and bare ids both resolve). */
  model: string;
  local: boolean;
  /** Override when the caller already knows the price (e.g. an LLM response carries `costUsd`). */
  costUsd?: number;
}

/** Fold one model call into the ledger. Mutates and returns the same ledger for cheap loops. */
export function recordCall(ledger: UsageLedger, call: RecordedCall): UsageLedger {
  if (call.local) {
    ledger.local = addUsage(ledger.local, call.usage);
    ledger.localCalls += 1;
    return ledger;
  }
  ledger.api = addUsage(ledger.api, call.usage);
  ledger.apiCostUsd += call.costUsd ?? usageCostUsd(call.model, call.usage);
  return ledger;
}

/** Pure projection of run + ledger + clock into the contract shape. */
export function computeRunMetrics(run: Run, ledger: UsageLedger, now: number): RunMetrics {
  return {
    agentsActive: activeCount(run),
    tasksMerged: countStatus(run, 'merged'),
    tasksFailed: countStatus(run, 'failed'),
    apiUsage: { ...ledger.api },
    localUsage: { ...ledger.local },
    apiCostUsd: ledger.apiCostUsd,
    localCallCount: ledger.localCalls,
    estSavedUsd: estimateSavedUsd(ledger.local),
    elapsedMs: Math.max(0, (run.finishedAt ?? now) - run.startedAt),
  };
}

/** Injectable timers so tests never wait on wall-clock seconds. */
export interface Timers {
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
  /** Optional: the stall watchdog uses timeouts. Implementations without them fall back to global. */
  setTimeout?(fn: () => void, ms: number): unknown;
  clearTimeout?(handle: unknown): void;
}

export const systemTimers: Timers = {
  setInterval(fn, ms) {
    const handle = setInterval(fn, ms);
    // Never keep a CLI process alive just to publish a heartbeat.
    (handle as { unref?: () => void }).unref?.();
    return handle;
  },
  clearInterval(handle) {
    clearInterval(handle as ReturnType<typeof setInterval>);
  },
  setTimeout(fn, ms) {
    const handle = setTimeout(fn, ms);
    (handle as { unref?: () => void }).unref?.();
    return handle;
  },
  clearTimeout(handle) {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

export interface MetricsPublisherOptions {
  clock: Clock;
  /** Recompute against current state; called on every touch, not just when publishing. */
  compute: () => RunMetrics;
  publish: (metrics: RunMetrics) => void;
  minIntervalMs?: number;
  heartbeatMs?: number;
  timers?: Timers;
}

/**
 * Throttled metrics emitter.
 *
 * `touch()` is cheap enough to call after every transition: it always recomputes, but only emits
 * when at least `minIntervalMs` passed since the last emission. A skipped emission sets a dirty
 * flag that the next heartbeat flushes, so the last state is never lost.
 */
export class MetricsPublisher {
  readonly #clock: Clock;
  readonly #compute: () => RunMetrics;
  readonly #publish: (metrics: RunMetrics) => void;
  readonly #minIntervalMs: number;
  readonly #heartbeatMs: number;
  readonly #timers: Timers;
  #lastPublishedAt: number | undefined;
  #dirty = false;
  #heartbeat: unknown;
  #stopped = false;
  published = 0;

  constructor(options: MetricsPublisherOptions) {
    this.#clock = options.clock;
    this.#compute = options.compute;
    this.#publish = options.publish;
    this.#minIntervalMs = options.minIntervalMs ?? 1000;
    this.#heartbeatMs = options.heartbeatMs ?? 5000;
    this.#timers = options.timers ?? systemTimers;
  }

  start(): void {
    if (this.#stopped || this.#heartbeat !== undefined) return;
    this.#heartbeat = this.#timers.setInterval(() => {
      this.publishNow();
    }, this.#heartbeatMs);
  }

  /** Recompute, emit if the throttle allows, otherwise remember that we owe an update. */
  touch(): void {
    if (this.#stopped) return;
    const now = this.#clock.now();
    if (this.#lastPublishedAt !== undefined && now - this.#lastPublishedAt < this.#minIntervalMs) {
      this.#dirty = true;
      return;
    }
    this.#emit(now);
  }

  /** Emit regardless of the throttle (heartbeat, end-of-run). */
  publishNow(): void {
    if (this.#stopped) return;
    this.#emit(this.#clock.now());
  }

  /** Stop the heartbeat. Metrics after the run finished are the store's job. */
  stop(): void {
    this.#stopped = true;
    if (this.#heartbeat !== undefined) {
      this.#timers.clearInterval(this.#heartbeat);
      this.#heartbeat = undefined;
    }
  }

  get dirty(): boolean {
    return this.#dirty;
  }

  #emit(now: number): void {
    this.#publish(this.#compute());
    this.#lastPublishedAt = now;
    this.#dirty = false;
    this.published += 1;
  }
}
