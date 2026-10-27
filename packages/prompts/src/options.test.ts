import { describe, expect, test } from 'bun:test';
import { isStarlingError } from '@starling/core';
import {
  createPromptCompiler,
  DEFAULT_MAX_CHARS,
  DEFAULT_MAX_REPO_MAP_CHARS,
  estimateTokens,
  type PromptStyle,
  resolveOptions,
} from './index.ts';
import { skyTodoContext } from './testing/context.ts';

describe('estimateTokens', () => {
  test('is zero for empty text', () => {
    expect(estimateTokens('')).toBe(0);
  });

  test('approximates four characters per token, rounding up', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
    expect(estimateTokens('x'.repeat(4000))).toBe(1000);
  });

  test('scales with a real prompt', () => {
    const prompt = createPromptCompiler().worker(skyTodoContext('csv-export'));
    expect(estimateTokens(prompt)).toBe(Math.ceil(prompt.length / 4));
    expect(estimateTokens(prompt)).toBeGreaterThan(500);
  });
});

describe('resolveOptions', () => {
  test('defaults to a full-style, 24k-character prompt with a 6k repo map', () => {
    expect(resolveOptions()).toEqual({
      maxChars: DEFAULT_MAX_CHARS,
      maxRepoMapChars: DEFAULT_MAX_REPO_MAP_CHARS,
      style: 'full',
      mapShare: 1,
    });
  });

  test('compact style uses 40% of the repo-map budget', () => {
    expect(resolveOptions({ style: 'compact' }).mapShare).toBe(0.4);
  });

  test('passes explicit values through untouched', () => {
    const resolved = resolveOptions({ maxChars: 9000, maxRepoMapChars: 1200, style: 'compact' });
    expect(resolved).toMatchObject({ maxChars: 9000, maxRepoMapChars: 1200, style: 'compact' });
  });

  test('rejects a non-positive maxChars', () => {
    for (const maxChars of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      try {
        resolveOptions({ maxChars });
        throw new Error(`expected maxChars=${maxChars} to be rejected`);
      } catch (error) {
        expect(isStarlingError(error, 'INVALID_ARGUMENT')).toBe(true);
      }
    }
  });

  test('rejects a non-positive maxRepoMapChars', () => {
    try {
      resolveOptions({ maxRepoMapChars: 0 });
      throw new Error('expected maxRepoMapChars=0 to be rejected');
    } catch (error) {
      expect(isStarlingError(error, 'INVALID_ARGUMENT')).toBe(true);
    }
  });

  test('rejects an unknown style', () => {
    try {
      resolveOptions({ style: 'haiku' as unknown as PromptStyle });
      throw new Error('expected an unknown style to be rejected');
    } catch (error) {
      expect(isStarlingError(error, 'INVALID_ARGUMENT')).toBe(true);
    }
  });

  test('createPromptCompiler validates its options eagerly', () => {
    expect(() => createPromptCompiler({ maxChars: -5 })).toThrow('maxChars');
  });
});
