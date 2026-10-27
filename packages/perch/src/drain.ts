/**
 * Graceful drain.
 *
 * Demo day needs to restart a perch mid-run without killing a bird in flight: stop accepting new
 * tasks, tell the hub this perch has no free slots, wait for the hub to delete every task it still
 * owns, and only then shut the process down. If the hub never gets there (or is gone), a timeout
 * aborts what is left so `Ctrl-C` still returns.
 *
 * Everything time-related is injected (`now`, `sleep`) so the behaviour is provable with a fake
 * clock instead of a flaky wall-clock wait.
 */

/** How long `drain()` waits for the hub before aborting the rest. */
export const PERCH_DRAIN_TIMEOUT_MS = 30_000;
/** How often the drain loop looks for a cleaned-up task. */
export const PERCH_DRAIN_POLL_MS = 25;

export interface DrainReport {
  /** Task keys the hub deleted (cleaned up) during the drain window. */
  finished: string[];
  /** Task keys this perch aborted because the timeout expired. */
  aborted: string[];
  /** Wall (or injected-clock) time spent waiting, in ms. */
  waitedMs: number;
}

export interface DrainOptions {
  /** Give up and abort the remainder after this long. Default {@link PERCH_DRAIN_TIMEOUT_MS}. */
  timeoutMs?: number;
  /** Poll interval while waiting. Default {@link PERCH_DRAIN_POLL_MS}. */
  pollMs?: number;
  /** Injected clock (tests pass a `FakeClock`). */
  now?: () => number;
  /** Injected sleep (tests advance a fake clock instead of waiting). */
  sleep?: (ms: number) => Promise<void>;
}

/** The real `sleep`. `unref()` keeps a pending poll from holding the process open. */
export function defaultDrainSleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}
