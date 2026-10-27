import { describe, expect, test } from 'bun:test';
import {
  constantTimeEqual,
  formatJoinCode,
  generateJoinCode,
  isValidJoinCode,
  JOIN_CODE_ALPHABET,
  normalizeJoinCode,
  verifyJoinCode,
} from './join-code.ts';

describe('join codes', () => {
  test('are 8 unambiguous characters in XXXX-XXXX form', () => {
    for (let i = 0; i < 200; i += 1) {
      const code = generateJoinCode();
      expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
      expect(code).not.toMatch(/[0O1I]/);
      expect(isValidJoinCode(code)).toBe(true);
    }
  });

  test('map random bytes to the alphabet deterministically', () => {
    const bytes = Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7]);
    const expected = `${JOIN_CODE_ALPHABET.slice(0, 4)}-${JOIN_CODE_ALPHABET.slice(4, 8)}`;
    expect(generateJoinCode(() => bytes)).toBe(expected);
  });

  test('reject a short random source rather than emitting a short code', () => {
    expect(() => generateJoinCode(() => Uint8Array.from([1, 2, 3]))).toThrow('random source');
  });

  test('normalise what a human types: case, spaces and dashes', () => {
    expect(normalizeJoinCode(' k7qm 3xph ')).toBe('K7QM3XPH');
    expect(normalizeJoinCode(undefined)).toBe('');
    expect(formatJoinCode('k7qm3xph')).toBe('K7QM-3XPH');
    expect(formatJoinCode('odd')).toBe('ODD');
  });

  test('verify a token after normalisation, and reject the wrong or empty one', () => {
    const code = 'K7QM-3XPH';
    expect(verifyJoinCode(code, 'K7QM-3XPH')).toBe(true);
    expect(verifyJoinCode(code, 'k7qm3xph')).toBe(true);
    expect(verifyJoinCode(code, ' K7QM 3XPH ')).toBe(true);
    expect(verifyJoinCode(code, 'K7QM-3XPJ')).toBe(false);
    expect(verifyJoinCode(code, 'K7QM-3XP')).toBe(false);
    expect(verifyJoinCode(code, '')).toBe(false);
    expect(verifyJoinCode(code, undefined)).toBe(false);
  });

  test('constant-time equality has no early exit and still compares correctly', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
    expect(constantTimeEqual('', '')).toBe(true);
  });

  test('recognise malformed codes', () => {
    expect(isValidJoinCode('K7QM3XPH')).toBe(true);
    expect(isValidJoinCode('k7qm-3xph')).toBe(true);
    expect(isValidJoinCode('K7QM-3XP')).toBe(false);
    expect(isValidJoinCode('K7QM-3XP0')).toBe(false);
  });
});
