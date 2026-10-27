/**
 * The server's error envelope and request-body validation.
 *
 * Every non-2xx JSON response is `{ error: { code, message } }` (ARCHITECTURE §6's shape, extended with
 * a machine code). `StarlingError` codes pass straight through, so an `INVALID_ARGUMENT` thrown by the
 * engine surfaces as a 400 and everything else as a 500 without the server inventing a new vocabulary.
 */
import type { StarlingErrorCode } from '@starling/core';
import { isStarlingError } from '@starling/core';
import type { Context } from 'hono';
import type { z } from 'zod';

export type ApiErrorCode =
  | 'INVALID_BODY'
  | 'INVALID_QUERY'
  | 'RUN_NOT_FOUND'
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'FLOCK_DISABLED'
  | 'REPLAY_DISABLED'
  | 'INTERNAL'
  | StarlingErrorCode;

export type ApiErrorStatus = 400 | 401 | 403 | 404 | 500 | 501 | 503;

export interface ApiErrorPayload {
  error: { code: ApiErrorCode; message: string };
}

export function errorPayload(code: ApiErrorCode, message: string): ApiErrorPayload {
  return { error: { code, message } };
}

/** Build a JSON error response. Used by every route so the shape can't drift. */
export function fail(c: Context, status: ApiErrorStatus, code: ApiErrorCode, message: string): Response {
  return c.json(errorPayload(code, message), status);
}

/** Flatten zod issues into one readable line: `goal: too small; maxParallel: expected int`. */
export function describeZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.map(String).join('.') : 'body';
      return `${path}: ${issue.message}`;
    })
    .join('; ');
}

export type ParsedBody<T> = { ok: true; value: T } | { ok: false; response: Response };

/** Parse and validate a JSON body, returning a ready-made 400 instead of throwing. */
export async function parseJsonBody<T>(c: Context, schema: z.ZodType<T>): Promise<ParsedBody<T>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return { ok: false, response: fail(c, 400, 'INVALID_BODY', 'Body must be valid JSON') };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, response: fail(c, 400, 'INVALID_BODY', describeZodError(parsed.error)) };
  }
  return { ok: true, value: parsed.data };
}

export type ParsedSince = { ok: true; since?: number } | { ok: false; response: Response };

/** `?since=<epoch ms>` — absent means "everything", not a 400. */
export function parseSince(c: Context): ParsedSince {
  const raw = c.req.query('since');
  if (raw === undefined || raw === '') return { ok: true };
  if (!/^\d+$/.test(raw)) {
    return { ok: false, response: fail(c, 400, 'INVALID_QUERY', 'since must be epoch milliseconds') };
  }
  const since = Number(raw);
  if (!Number.isSafeInteger(since)) {
    return { ok: false, response: fail(c, 400, 'INVALID_QUERY', 'since is out of range') };
  }
  return { ok: true, since };
}

/** Map a thrown value to the error envelope and status. Never leaks a stack trace. */
export function errorResponse(c: Context, err: unknown): Response {
  if (isStarlingError(err)) {
    const status: ApiErrorStatus =
      err.code === 'INVALID_ARGUMENT' ? 400 : err.code === 'NOT_IMPLEMENTED' ? 501 : 500;
    return fail(c, status, err.code, err.message);
  }
  const message = err instanceof Error ? err.message : String(err);
  return fail(c, 500, 'INTERNAL', message);
}
