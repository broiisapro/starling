import { describe, expect, test } from 'bun:test';
import { isLocalProvider, parseModel, parseUsage, pricingKey } from './agent-event';
import { makeConfig } from './testing/harness';

describe('parseUsage', () => {
  test('reads flat counts', () => {
    expect(parseUsage({ input: 100, output: 20, cached: 5 })).toEqual({ input: 100, output: 20, cached: 5 });
  });

  test('reads nested usage and OpenAI-style token names', () => {
    expect(parseUsage({ usage: { promptTokens: 10, completionTokens: 2, cachedTokens: 1 } })).toEqual({
      input: 10,
      output: 2,
      cached: 1,
    });
  });

  test('defaults a missing count to zero', () => {
    expect(parseUsage({ input: 4 })).toEqual({ input: 4, output: 0, cached: 0 });
  });

  test('returns undefined when there is no usage at all', () => {
    expect(parseUsage({ text: 'hello' })).toBeUndefined();
  });

  test('ignores negative and non-numeric counts', () => {
    expect(parseUsage({ input: -3, output: 'many' })).toBeUndefined();
  });
});

describe('parseModel', () => {
  test('accepts a ModelRef-shaped object', () => {
    expect(parseModel({ provider: 'ollama', model: 'qwen3.6:35b-a3b' })).toEqual({
      provider: 'ollama',
      model: 'qwen3.6:35b-a3b',
    });
  });

  test('rejects anything else', () => {
    expect(parseModel('deepseek')).toBeUndefined();
    expect(parseModel({ provider: 'ollama' })).toBeUndefined();
    expect(parseModel(null)).toBeUndefined();
  });
});

describe('isLocalProvider', () => {
  const config = makeConfig();

  test('ollama and local are local', () => {
    expect(isLocalProvider(config, 'ollama')).toBe(true);
    expect(isLocalProvider(config, 'local')).toBe(true);
  });

  test('a provider without an API key is local', () => {
    expect(isLocalProvider(config, 'ollama')).toBe(true);
    const custom = makeConfig({ providers: { llamacpp: { baseUrl: 'http://127.0.0.1:8080/v1' } } });
    expect(isLocalProvider(custom, 'llamacpp')).toBe(true);
  });

  test('deepseek needs a key, so it is not local', () => {
    expect(isLocalProvider(config, 'deepseek')).toBe(false);
    expect(isLocalProvider(config, 'nope')).toBe(false);
  });

  test('pricingKey is provider/model', () => {
    expect(pricingKey({ provider: 'deepseek', model: 'deepseek-v4.1-flash' })).toBe(
      'deepseek/deepseek-v4.1-flash',
    );
  });
});
