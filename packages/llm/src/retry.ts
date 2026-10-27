import type { RetryOptions } from './types';

export const DEFAULT_RETRY: RetryOptions = {
  maxAttempts: 3,
  baseDelayMs: 250,
  maxDelayMs: 8_000,
  maxRetryAfterMs: 60_000,
};

/** The reason to reject with when a signal fires, never `undefined`. */
export function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('aborted');
}

/** Resolve after `ms`, or reject early when `signal` aborts (keeps a cancelled run from sleeping). */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cancel = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      cancel();
      reject(signal === undefined ? new Error('aborted') : abortReason(signal));
    };
    const timer = setTimeout(() => {
      cancel();
      resolve();
    }, ms);
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function headersOf(err: unknown): Headers | undefined {
  if (typeof err !== 'object' || err === null || !('headers' in err)) return undefined;
  const headers = (err as { headers?: unknown }).headers;
  return headers instanceof Headers ? headers : undefined;
}

/** Numeric HTTP status for SDK errors, plain errors and Starling errors that carry one in details. */
export function statusOf(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const status = (err as { status?: unknown }).status;
  if (typeof status === 'number') return status;
  const fromDetails = (err as { details?: { status?: unknown } }).details?.status;
  return typeof fromDetails === 'number' ? fromDetails : undefined;
}

/** `Retry-After` in milliseconds, accepting both delta-seconds and an HTTP date. */
export function retryAfterMs(headers: Headers | undefined, now = Date.now()): number | undefined {
  const raw = headers?.get('retry-after')?.trim();
  if (raw === undefined || raw === '') return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const at = Date.parse(raw);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}

const NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENOTFOUND',
  'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
]);

function hasNetworkCode(err: unknown, depth = 0): boolean {
  if (typeof err !== 'object' || err === null || depth > 4) return false;
  const candidate = err as { code?: unknown; cause?: unknown };
  if (typeof candidate.code === 'string' && NETWORK_CODES.has(candidate.code)) return true;
  return hasNetworkCode(candidate.cause, depth + 1);
}

/**
 * Transient failures only: rate limits, timeouts, 5xx and the network. A 400/401/403 means the
 * request is wrong, so retrying it would just burn tokens and time.
 */
export function isRetryableError(err: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return false;
  const status = statusOf(err);
  if (status !== undefined) return status === 408 || status === 409 || status === 429 || status >= 500;
  if (err instanceof TypeError) return true;
  if (hasNetworkCode(err)) return true;
  if (typeof err === 'object' && err !== null) {
    const name = (err as { name?: unknown }).name;
    if (name === 'APIConnectionError' || name === 'APIConnectionTimeoutError') return true;
  }
  return false;
}

/** Deterministic part of the backoff; `random` is injectable so tests can pin it. */
export function backoffMs(attempt: number, opts: RetryOptions, random = Math.random): number {
  const base = opts.baseDelayMs * 2 ** Math.max(0, attempt - 1);
  const jitter = random() * base * 0.5;
  return Math.min(opts.maxDelayMs, Math.round(base + jitter));
}

export interface RetryHooks {
  signal?: AbortSignal;
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
}

/** Run `fn(attempt)` with bounded exponential backoff, honouring `Retry-After` when present. */
export async function withRetries<T>(
  fn: (attempt: number) => Promise<T>,
  opts: RetryOptions,
  hooks: RetryHooks = {},
): Promise<T> {
  const maxAttempts = Math.max(1, opts.maxAttempts);
  let last: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (hooks.signal?.aborted) throw abortReason(hooks.signal);
    try {
      return await fn(attempt);
    } catch (err) {
      last = err;
      if (!isRetryableError(err, hooks.signal) || attempt === maxAttempts) throw err;
      const headerDelay = retryAfterMs(headersOf(err));
      const delayMs = Math.min(headerDelay ?? backoffMs(attempt, opts), opts.maxRetryAfterMs);
      hooks.onRetry?.({ attempt, delayMs, error: err });
      await sleep(delayMs, hooks.signal);
    }
  }
  throw last;
}

export interface TimeoutHandle {
  signal: AbortSignal;
  didTimeout(): boolean;
  dispose(): void;
}

/** Combine an optional parent signal with a per-attempt timeout. Dispose in a `finally`. */
export function withTimeout(parent: AbortSignal | undefined, timeoutMs: number): TimeoutHandle {
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort(parent?.reason);
  if (parent !== undefined) {
    if (parent.aborted) controller.abort(parent.reason);
    else parent.addEventListener('abort', onAbort, { once: true });
  }
  const timer =
    timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          controller.abort(new Error('llm call timed out'));
        }, timeoutMs)
      : undefined;
  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    dispose() {
      if (timer !== undefined) clearTimeout(timer);
      parent?.removeEventListener('abort', onAbort);
    },
  };
}
