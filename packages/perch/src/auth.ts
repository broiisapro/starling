import { createHash, timingSafeEqual } from 'node:crypto';

/** The header every hub↔perch call carries (ARCHITECTURE §6). */
export const FLOCK_TOKEN_HEADER = 'x-flock-token';

/**
 * Constant-time join-code comparison.
 *
 * Both sides are SHA-256 hashed first: the compared buffers are always 32 bytes, so neither the
 * length of the supplied token nor its first differing byte leaks through timing (the raw
 * `timingSafeEqual` would also throw on different lengths). Missing/empty tokens never match.
 */
export function tokensMatch(provided: string | undefined, expected: string): boolean {
  if (typeof provided !== 'string' || provided.length === 0 || expected.length === 0) return false;
  const a = createHash('sha256').update(provided, 'utf8').digest();
  const b = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(a, b);
}
