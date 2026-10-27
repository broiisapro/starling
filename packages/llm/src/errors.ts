import { StarlingError } from '@starling/core';

/**
 * The router's "the model would not produce valid JSON" code.
 *
 * `LLM_BAD_JSON` is a first-class `StarlingErrorCode` since checkpoint C1, so the error carries it
 * directly instead of smuggling a reason through `details`. `isBadJsonError` stays as the supported
 * check (and still recognises verdicts recorded before C1, which were `LLM_ERROR` + `details.reason`).
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
  return new StarlingError('LLM_BAD_JSON', message, {
    details: { reason: LLM_BAD_JSON, ...details },
  });
}

/** True when `err` is the router's bad-JSON error (works across package boundaries). */
export function isBadJsonError(err: unknown): err is StarlingError {
  if (!(err instanceof StarlingError)) return false;
  if (err.code === 'LLM_BAD_JSON') return true;
  // C1 compatibility: recorded runs and older packages built this as LLM_ERROR + a reason detail.
  return err.code === 'LLM_ERROR' && err.details?.reason === LLM_BAD_JSON;
}

/** A plain LLM failure (timeout, abort, config, provider rejection) with a machine reason. */
export function llmError(reason: string, message: string, details?: Record<string, unknown>): StarlingError {
  return new StarlingError('LLM_ERROR', message, {
    details: { reason, ...details },
  });
}
