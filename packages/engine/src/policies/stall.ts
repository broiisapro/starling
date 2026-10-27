/**
 * Stall detection: "no agent event for `stallAfterMs`" means the session is wedged, not thinking.
 *
 * The watchdog is a per-task debounce: every agent event re-arms it, and expiry calls back once.
 * A timed-out task gets **one** recovery (abort the turn, resend the same prompt, counting as an
 * attempt); a second stall fails it with a reason instead of looping forever.
 *
 * Timers are injected so the tests drive expiry with a fake clock and never sleep.
 */

import type { StarlingConfig } from '@starling/core';
import type { Timers } from '../metrics';

/** Default when neither the engine policies nor the config file names a value. Four minutes. */
export const DEFAULT_STALL_AFTER_MS = 4 * 60_000;

export interface StallWatchdogOptions {
  stallAfterMs: number;
  timers: Timers;
  onStall: (taskKey: string) => void;
}

interface Watched {
  handle: unknown;
  token: number;
}

/**
 * Per-task inactivity watchdog.
 *
 * `timers` is the engine's injectable `Timers`; when an implementation only has intervals (an older
 * test double) the watchdog falls back to the global timers rather than failing.
 */
export class StallWatchdog {
  readonly #stallAfterMs: number;
  readonly #timers: Timers;
  readonly #onStall: (taskKey: string) => void;
  readonly #watched = new Map<string, Watched>();
  #token = 0;
  #stopped = false;

  constructor(options: StallWatchdogOptions) {
    this.#stallAfterMs = Math.max(1, options.stallAfterMs);
    this.#timers = options.timers;
    this.#onStall = options.onStall;
  }

  get size(): number {
    return this.#watched.size;
  }

  get stallAfterMs(): number {
    return this.#stallAfterMs;
  }

  /** Start or restart the deadline for a task. */
  track(taskKey: string): void {
    if (this.#stopped) return;
    this.untrack(taskKey);
    this.#token += 1;
    const token = this.#token;
    const handle = this.#setTimeout(() => {
      const watched = this.#watched.get(taskKey);
      if (watched === undefined || watched.token !== token) return;
      this.#watched.delete(taskKey);
      this.#onStall(taskKey);
    }, this.#stallAfterMs);
    this.#watched.set(taskKey, { handle, token });
  }

  /** An agent event arrived: push the deadline out. */
  touch(taskKey: string): void {
    if (!this.#watched.has(taskKey)) return;
    this.track(taskKey);
  }

  untrack(taskKey: string): void {
    const watched = this.#watched.get(taskKey);
    if (watched === undefined) return;
    this.#watched.delete(taskKey);
    this.#clearTimeout(watched.handle);
  }

  stop(): void {
    this.#stopped = true;
    for (const key of [...this.#watched.keys()]) this.untrack(key);
  }

  #setTimeout(fn: () => void, ms: number): unknown {
    const setTimeoutFn = this.#timers.setTimeout;
    if (setTimeoutFn !== undefined) return setTimeoutFn.call(this.#timers, fn, ms);
    const handle = setTimeout(fn, ms);
    (handle as { unref?: () => void }).unref?.();
    return handle;
  }

  #clearTimeout(handle: unknown): void {
    const clearTimeoutFn = this.#timers.clearTimeout;
    if (clearTimeoutFn !== undefined) {
      clearTimeoutFn.call(this.#timers, handle);
      return;
    }
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  }
}

export interface StallDecisionInput {
  /** How many times this dispatch has already been recovered from a stall. */
  stallRetries: number;
  /** Audit attempts spent so far — a stall recovery counts as one. */
  attempts: number;
  maxAttempts: number;
  /** `stallRetries` ceiling. Default 1 (the spec's "resend the prompt once"). */
  maxStallRetries?: number;
}

export type StallDecision = 'retry' | 'fail';

/**
 * Retry only while both budgets allow: one stall recovery, and at least one audit attempt left
 * after the recovery's own attempt is spent.
 */
export function stallDecision(input: StallDecisionInput): StallDecision {
  const maxStallRetries = input.maxStallRetries ?? 1;
  if (input.stallRetries >= maxStallRetries) return 'fail';
  // A stall recovery consumes an attempt; with none left, resending would only delay the failure.
  if (input.attempts + 1 > input.maxAttempts) return 'fail';
  return 'retry';
}

/**
 * Read `stallAfterMs` from config, feature-detected.
 *
 * Core's `StarlingConfig` is owned by Epic 40 and gains this field additively; until it lands an
 * engine test or the CLI can pass `policies.stallAfterMs` instead. `0` disables the watchdog.
 */
export function stallAfterMsFrom(config: StarlingConfig): number {
  const value = (config as unknown as Record<string, unknown>).stallAfterMs;
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  return DEFAULT_STALL_AFTER_MS;
}
