import { describe, expect, test } from 'bun:test';
import { defaultConfig } from '@starling/core';
import { applyProfile } from './profiles.ts';
import { createLLM } from './router.ts';

/**
 * Real network calls, opt-in only: `STARLING_LIVE=1 bun test packages/llm/src/llm.live.test.ts`.
 * Never part of the default suite (AGENTS.md §4, L23).
 */
const live = process.env.STARLING_LIVE === '1';

describe.skipIf(!live)('live LLM providers', () => {
  const request = {
    role: 'writer' as const,
    system: 'You are terse.',
    messages: [{ role: 'user' as const, content: 'Say "tweet" and nothing else.' }],
    maxTokens: 16,
    temperature: 0,
  };

  test('DeepSeek API answers', async () => {
    const config = applyProfile(defaultConfig, 'deepseek');
    config.models.writer = { provider: 'deepseek', model: 'deepseek-v4.1-flash' };
    const res = await createLLM(config).complete(request);
    expect(res.text.toLowerCase()).toContain('tweet');
    expect(res.local).toBe(false);
  }, 60_000);

  test('Ollama answers', async () => {
    const config = applyProfile(defaultConfig, 'local');
    const res = await createLLM(config).complete(request);
    expect(res.text.length).toBeGreaterThan(0);
    expect(res.local).toBe(true);
    expect(res.costUsd).toBe(0);
  }, 120_000);

  test('the user opencode server answers', async () => {
    const config = applyProfile(defaultConfig, 'opencode');
    const res = await createLLM(config, { env: process.env }).complete(request);
    expect(res.text.length).toBeGreaterThan(0);
  }, 120_000);
});
