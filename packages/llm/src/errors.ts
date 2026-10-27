import { StarlingError } from '@starling/core';

/**
 * Machine reason carried in `StarlingError.details.reason`.
 *
 * `@starling/core`'s locked `StarlingErrorCode` union has no `LLM_BAD_JSON`, so the router throws
 * `LLM_ERROR` with this reason (and files a CONTRACT REQUEST). `isBadJsonError` is the supported
 * check; do not string-match messages.
 */
export const LLM_BAD_JSON = 'LLM_BAD_JSON' as const;

export interface BadJsonDetails {
  raw: string;
  issues?: string;
  attempts?: number;
  [key: string]: unknown;
}

/** Build the "model would not produce valid JSON" error, carrying the last raw text. */
export function badJsonError(message: string, details: BadJsonDetails): StarlingError {
  return new StarlingError('LLM_ERROR', message, {
    details: { reason: LLM_BAD_JSON, ...details },
  });
}

/** True when `err` is the router's bad-JSON error (works across package boundaries). */
export function isBadJsonError(err: unknown): err is StarlingError {
  return err instanceof StarlingError && err.code === 'LLM_ERROR' && err.details?.reason === LLM_BAD_JSON;
}

/** A plain LLM failure (timeout, abort, config, provider rejection) with a machine reason. */
export function llmError(reason: string, message: string, details?: Record<string, unknown>): StarlingError {
  return new StarlingError('LLM_ERROR', message, {
    details: { reason, ...details },
  });
}
