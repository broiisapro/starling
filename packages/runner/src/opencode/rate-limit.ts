/**
 * Provider rate-limit detection and the shared token bucket behind it.
 *
 * A run fans out several opencode sessions that all talk to the same provider. When that provider
 * answers 429/503 (or opencode reports an overload inside a `session.error`), retrying immediately
 * from every session makes the outage worse. One `ProviderRateLimiter` per runner shares a token
 * bucket **per provider**, so a single session's failure slows the whole flock down instead of just
 * that task. The engine then shrinks effective parallelism (AIMD) while the bucket drains.
 *
 * Everything here is clock- and sleep-injectable: the unit tests never wait on wall-clock time.
 */
import { isStarlingError } from '@starling/core';
import { sleep } from '../schedule';

export interface RateLimitSignal {
  /** The provider key the bucket is shared by (opencode provider id, or `unknown`). */
  provider?: string;
  /** Server-supplied `Retry-After`, already in ms. */
  retryAfterMs?: number;
  /** Short human detail for the log event. */
  detail: string;
}

const RATE_LIMIT_TEXT =
  /\b(429|503)\b|rate[ _-]?limit|too many requests|overload|over capacity|quota|temporarily unavailable|try again later/i;

/** True when a message reads like a provider asking for a pause rather than a broken request. */
export function looksRateLimited(text: string): boolean {
  return RATE_LIMIT_TEXT.test(text);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function providerOf(data: Record<string, unknown>): string | undefined {
  const direct = data.provider;
  if (typeof direct === 'string' && direct !== '') return direct;
  const model = asRecord(data.model);
  const nested = model?.provider;
  return typeof nested === 'string' && nested !== '' ? nested : undefined;
}

/**
 * Inspect a normalised `session.error` payload (`{name, message}` plus whatever the server sent).
 *
 * Returns `undefined` when the error is not a rate limit, so the caller can keep the ordinary
 * "agent error" path untouched.
 */
export function detectRateLimit(data: Record<string, unknown>): RateLimitSignal | undefined {
  const provider = providerOf(data);
  const details = asRecord(data.details);
  const retryAfterMs = asNumber(data.retryAfterMs) ?? asNumber(details?.retryAfterMs);

  if (data.rateLimited === true) {
    return {
      ...(provider === undefined ? {} : { provider }),
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
      detail: typeof data.message === 'string' ? data.message : 'provider asked for a backoff',
    };
  }

  const status = asNumber(data.status) ?? asNumber(details?.status);
  const text = [data.name, data.message, data.reason, data.detail]
    .filter((part): part is string => typeof part === 'string')
    .join(' ');

  const statusLimited = status === 429 || status === 503;
  if (!statusLimited && !looksRateLimited(text)) return undefined;

  return {
    ...(provider === undefined ? {} : { provider }),
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    detail: text.trim() === '' ? `provider returned ${status ?? 'a rate limit'}` : text.slice(0, 300),
  };
}

/** The same detection for a thrown error (a prompt POST that answered 429). */
export function rateLimitFromError(err: unknown): RateLimitSignal | undefined {
  if (isStarlingError(err) && err.details !== undefined) {
    const detected = detectRateLimit(err.details);
    if (detected !== undefined) return { ...detected, detail: err.message };
    if (err.details.rateLimited === true) return { detail: err.message };
  }
  const message = err instanceof Error ? err.message : String(err);
  return looksRateLimited(message) ? { detail: message.slice(0, 300) } : undefined;
}

export interface RateLimitAnnotation {
  /** The event data to emit (enriched when a limit was detected). */
  data: Record<string, unknown>;
  /** Present only when the payload was a provider rate limit. */
  signal?: RateLimitSignal;
}

/**
 * Detect a rate limit in one `session.error` payload, penalise the provider bucket, and return the
 * payload an engine can act on. Pure apart from the injected `penalize`, so it is unit-testable
 * without an SSE server.
 */
export function annotateRateLimit(
  data: Record<string, unknown>,
  fallbackProvider: string,
  penalize: (provider: string, retryAfterMs?: number) => number,
): RateLimitAnnotation {
  const detected = detectRateLimit(data);
  if (detected === undefined) return { data };
  const provider = detected.provider ?? fallbackProvider;
  const backoffMs = penalize(provider, detected.retryAfterMs);
  return {
    data: { ...data, rateLimited: true, provider, retryAfterMs: backoffMs },
    signal: { provider, retryAfterMs: backoffMs, detail: detected.detail },
  };
}

export interface ProviderRateLimiterOptions {
  /** Burst of prompts allowed before pacing starts. Default 4. */
  capacity?: number;
  /** One token refills every this many ms. Default 750. */
  refillMs?: number;
  /** First penalty after a 429. Doubles per consecutive failure. Default 1000. */
  baseBackoffMs?: number;
  /** Ceiling for a computed penalty. Default 60_000. */
  maxBackoffMs?: number;
  /** ± fraction applied to every penalty. Default 0.25 (jitter, so sessions do not retry in lockstep). */
  jitterRatio?: number;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
  blockedUntil: number;
  streak: number;
  /** Serialises takers for one provider so two sessions cannot consume the same last token. */
  chain: Promise<unknown>;
}

export interface BucketSnapshot {
  tokens: number;
  blockedUntil: number;
  streak: number;
}

/** Token bucket per provider, shared by every session of one runner. */
export class ProviderRateLimiter {
  readonly #capacity: number;
  readonly #refillMs: number;
  readonly #baseBackoffMs: number;
  readonly #maxBackoffMs: number;
  readonly #jitterRatio: number;
  readonly #now: () => number;
  readonly #sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  readonly #random: () => number;
  readonly #buckets = new Map<string, Bucket>();

  constructor(options: ProviderRateLimiterOptions = {}) {
    this.#capacity = Math.max(1, options.capacity ?? 4);
    this.#refillMs = Math.max(1, options.refillMs ?? 750);
    this.#baseBackoffMs = Math.max(0, options.baseBackoffMs ?? 1_000);
    this.#maxBackoffMs = Math.max(this.#baseBackoffMs, options.maxBackoffMs ?? 60_000);
    this.#jitterRatio = Math.min(1, Math.max(0, options.jitterRatio ?? 0.25));
    this.#now = options.now ?? (() => Date.now());
    this.#sleep = options.sleep ?? sleep;
    this.#random = options.random ?? Math.random;
  }

  /** Available tokens right now (fractional fractions are not kept; whole tokens only). */
  tokens(provider: string, now = this.#now()): number {
    const bucket = this.#bucket(provider);
    this.#refill(bucket, now);
    return bucket.tokens;
  }

  /** How long `acquire()` would wait for this provider right now. */
  waitMs(provider: string, now = this.#now()): number {
    const bucket = this.#bucket(provider);
    if (now < bucket.blockedUntil) return bucket.blockedUntil - now;
    this.#refill(bucket, now);
    return bucket.tokens >= 1 ? 0 : this.#refillMs;
  }

  /** The penalty currently in force, or 0. */
  blockedFor(provider: string, now = this.#now()): number {
    const bucket = this.#bucket(provider);
    return Math.max(0, bucket.blockedUntil - now);
  }

  snapshot(provider: string, now = this.#now()): BucketSnapshot {
    const bucket = this.#bucket(provider);
    this.#refill(bucket, now);
    return { tokens: bucket.tokens, blockedUntil: bucket.blockedUntil, streak: bucket.streak };
  }

  /** Wait for a token (or the penalty to expire). Aborting resolves without consuming anything. */
  acquire(provider: string, signal?: AbortSignal): Promise<void> {
    const bucket = this.#bucket(provider);
    const next = bucket.chain.then(() => this.#take(provider, signal));
    bucket.chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  /**
   * Record a rate limit. Returns the applied backoff so the caller can log it.
   * `retryAfterMs` from the server wins over the exponential guess; jitter is always applied.
   */
  penalize(provider: string, retryAfterMs?: number): number {
    const bucket = this.#bucket(provider);
    const now = this.#now();
    const base = retryAfterMs ?? Math.min(this.#maxBackoffMs, this.#baseBackoffMs * 2 ** bucket.streak);
    const jitter = 1 + this.#jitterRatio * (this.#random() * 2 - 1);
    const backoff = Math.max(0, Math.min(this.#maxBackoffMs, Math.round(base * jitter)));
    bucket.streak += 1;
    bucket.tokens = 0;
    bucket.updatedAt = now;
    bucket.blockedUntil = Math.max(bucket.blockedUntil, now + backoff);
    return backoff;
  }

  /** A prompt got through: the provider is healthy again, so reset the exponential streak. */
  reward(provider: string): void {
    this.#bucket(provider).streak = 0;
  }

  async #take(provider: string, signal?: AbortSignal): Promise<void> {
    const bucket = this.#bucket(provider);
    while (signal?.aborted !== true) {
      const now = this.#now();
      const wait = this.waitMs(provider, now);
      if (wait <= 0) {
        bucket.tokens = Math.max(0, bucket.tokens - 1);
        return;
      }
      await this.#sleep(wait, signal);
    }
  }

  #refill(bucket: Bucket, now: number): void {
    if (now <= bucket.updatedAt) return;
    const gained = Math.floor((now - bucket.updatedAt) / this.#refillMs);
    if (gained <= 0) return;
    bucket.tokens = Math.min(this.#capacity, bucket.tokens + gained);
    bucket.updatedAt += gained * this.#refillMs;
  }

  #bucket(provider: string): Bucket {
    const key = provider === '' ? 'unknown' : provider;
    const existing = this.#buckets.get(key);
    if (existing !== undefined) return existing;
    const created: Bucket = {
      tokens: this.#capacity,
      updatedAt: this.#now(),
      blockedUntil: 0,
      streak: 0,
      chain: Promise.resolve(),
    };
    this.#buckets.set(key, created);
    return created;
  }
}
