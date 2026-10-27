/**
 * What the engine needs to know about a provider rate limit.
 *
 * The runner (which owns the token bucket) tags a `session.error` with `rateLimited: true`,
 * `provider` and the applied `retryAfterMs`. This detector also accepts an untagged 429/503 or the
 * usual provider phrases, so an older runner or a different node double still triggers AIMD.
 *
 * Deliberately small and duplicated from the runner's detector: the engine depends on ports only
 * (ARCHITECTURE §4/§10), and a regex is not worth a package dependency.
 */
import type { AgentEvent } from '@starling/core';

export interface RateLimitSignal {
  provider?: string;
  retryAfterMs?: number;
  detail: string;
}

const RATE_LIMIT_TEXT =
  /\b(429|503)\b|rate[ _-]?limit|too many requests|overload|over capacity|quota|temporarily unavailable|try again later/i;

function numberField(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function detailsRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** `undefined` for anything that is not a provider rate limit. */
export function rateLimitSignal(event: AgentEvent): RateLimitSignal | undefined {
  if (event.kind !== 'session.error') return undefined;
  const data = event.data;
  const details = detailsRecord(data.details);
  const status = numberField(data.status) ?? numberField(details?.status);
  const provider = typeof data.provider === 'string' && data.provider !== '' ? data.provider : undefined;
  const retryAfterMs = numberField(data.retryAfterMs) ?? numberField(details?.retryAfterMs) ?? undefined;

  if (data.rateLimited !== true) {
    const text = [data.name, data.message, data.reason, data.detail]
      .filter((part): part is string => typeof part === 'string')
      .join(' ');
    if (status !== 429 && status !== 503 && !RATE_LIMIT_TEXT.test(text)) return undefined;
  }

  const detailParts = [data.name, data.message, data.reason, data.detail].filter(
    (part): part is string => typeof part === 'string' && part !== '',
  );
  const detail =
    detailParts.length > 0
      ? detailParts.join(' ').slice(0, 300)
      : status === undefined
        ? 'provider rate limit'
        : `provider returned ${status}`;
  return {
    ...(provider === undefined ? {} : { provider }),
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    detail,
  };
}
