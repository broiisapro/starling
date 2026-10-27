/**
 * The web half of SEC-01 (Epic 69): where the flock token lives and how requests should carry it.
 *
 * The token is persisted inside `starling.settings.v1` (see `storage.ts`) — never in a separate,
 * easier-to-log key, and never rendered unless the viewer explicitly reveals it. `authHeaders` is the
 * one place that knows the header name, so Epic 204 can attach it to `fetch`/SSE and C3 can hand it
 * to the shell without duplicating the string.
 *
 * Attaching the header to `apps/web/src/data`'s clients is deliberately **not** done here: that
 * directory is Wave 3b (Epic 204), and the settings drawer must not fork the transport.
 */
import type { StarlingSettings } from './schema';

/** The hub's shared join code header (ARCHITECTURE §6, `/api/flock/*` and SEC-01). */
export const AUTH_HEADER = 'x-flock-token';

/** Long enough for any join code, short enough to keep a hostile paste out of a header. */
export const TOKEN_MAX_LENGTH = 512;

/** Printable, non-space ASCII only: no CR/LF (header injection), no control characters, no tabs. */
const PRINTABLE_ASCII = /^[\x21-\x7e]+$/;

/**
 * Reduce any candidate to a token that is safe to put in an HTTP header.
 *
 * A wrong type, a blank string, a newline or an over-long paste all collapse to `''` (no token)
 * rather than throwing or being smuggled through. Surrounding whitespace is trimmed because a copy
 * from a terminal usually carries some.
 */
export function normalizeToken(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed.length > TOKEN_MAX_LENGTH) return '';
  return PRINTABLE_ASCII.test(trimmed) ? trimmed : '';
}

/**
 * Headers for an authenticated hub request: `{ 'x-flock-token': token }` when a token is set, `{}`
 * otherwise (a same-origin, loopback hub needs none). Never mutates and never logs.
 */
export function authHeaders(settings: Pick<StarlingSettings, 'token'>): Record<string, string> {
  const token = normalizeToken(settings.token);
  return token === '' ? {} : { [AUTH_HEADER]: token };
}

export function hasToken(settings: Pick<StarlingSettings, 'token'>): boolean {
  return normalizeToken(settings.token) !== '';
}

/** A masked form safe for diagnostics ("••••abcd"), or `''` when unset. Never the full token. */
export function tokenHint(settings: Pick<StarlingSettings, 'token'>): string {
  const token = normalizeToken(settings.token);
  if (token === '') return '';
  const tail = token.slice(-4);
  return `••••${tail}`;
}
