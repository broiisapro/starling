import { StarlingError } from '@starling/core';

/**
 * Join codes: 8 characters, printed `XXXX-XXXX`, from an alphabet with no look-alike glyphs
 * (no `0/O` and no `1/I`). Exactly 32 symbols means each random byte maps to one symbol without
 * modulo bias. Everything is upper-case, so the lowercase `l` is never produced.
 *
 * `normalizeJoinCode` makes the typed form forgiving: spaces, dashes and lowercase all work, so
 * "abcd efgh" and "ABCD-EFGH" verify against each other.
 */
export const JOIN_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const GROUP_SIZE = 4;
const CODE_LENGTH = GROUP_SIZE * 2;

export type RandomBytes = (length: number) => Uint8Array;

const cryptoRandomBytes: RandomBytes = (length) => crypto.getRandomValues(new Uint8Array(length));

/** Generate a fresh join code such as `K7QM-3XPH`. */
export function generateJoinCode(random: RandomBytes = cryptoRandomBytes): string {
  const bytes = random(CODE_LENGTH);
  if (bytes.length < CODE_LENGTH) {
    throw new StarlingError('INVALID_ARGUMENT', `random source returned ${bytes.length} bytes`);
  }
  let raw = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    // index is always in range because the alphabet has exactly 2**5 entries.
    raw += JOIN_CODE_ALPHABET[(bytes[i] ?? 0) % JOIN_CODE_ALPHABET.length];
  }
  return `${raw.slice(0, GROUP_SIZE)}-${raw.slice(GROUP_SIZE)}`;
}

/** Upper-case, dashes and whitespace removed. `undefined` normalises to the empty string. */
export function normalizeJoinCode(code: string | undefined): string {
  return (code ?? '').replace(/[\s-]/g, '').toUpperCase();
}

/**
 * Length-independent, early-exit-free string comparison.
 *
 * Join codes are short and LAN-only, so this is mitigation rather than a security boundary, but a
 * hub that compares tokens with `===` leaks timing for free. Comparing every character (with length
 * folded into the accumulator) keeps the shape honest even when lengths differ.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/** `candidate` matches `expected` after normalisation (both sides). Constant-time on the normalised strings. */
export function verifyJoinCode(expected: string, candidate: string | undefined): boolean {
  const normalisedCandidate = normalizeJoinCode(candidate);
  if (normalisedCandidate.length === 0) return false;
  return constantTimeEqual(normalizeJoinCode(expected), normalisedCandidate);
}

/** Group a normalised code for display: `K7QM3XPH` → `K7QM-3XPH`. Leaves other shapes alone. */
export function formatJoinCode(code: string): string {
  const normalised = normalizeJoinCode(code);
  if (normalised.length !== CODE_LENGTH) return normalised;
  return `${normalised.slice(0, GROUP_SIZE)}-${normalised.slice(GROUP_SIZE)}`;
}

/** True when `code` already looks like a well-formed join code. */
export function isValidJoinCode(code: string): boolean {
  const normalised = normalizeJoinCode(code);
  if (normalised.length !== CODE_LENGTH) return false;
  for (const char of normalised) {
    if (!JOIN_CODE_ALPHABET.includes(char)) return false;
  }
  return true;
}
