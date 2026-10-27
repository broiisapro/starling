/** Small scheduling primitives shared by the normaliser, the runner and the replay runner. */

export interface ScheduledTask {
  cancel(): void;
}

/** Injected everywhere so tests can drive timers by hand. */
export type Scheduler = (fn: () => void, delayMs: number) => ScheduledTask;

export const timerScheduler: Scheduler = (fn, delayMs) => {
  const handle = setTimeout(fn, Math.max(0, delayMs));
  return { cancel: () => clearTimeout(handle) };
};

/** Sleep that can be interrupted by an abort signal. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    if (signal?.aborted === true) {
      resolve();
      return;
    }
    const handle = setTimeout(finish, ms);
    const onAbort = () => finish();
    function finish() {
      clearTimeout(handle);
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
