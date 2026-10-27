import { afterEach, describe, expect, test } from 'bun:test';
import { defaultConfig } from '@starling/core';
import { costOf, isLocalBaseUrl, pricingKeys } from './cost.ts';
import { createLLMFromEnv } from './env.ts';
import { LOCAL_DEFAULT_MODEL } from './profiles.ts';
import { providerKind, splitOpencodeModel } from './router.ts';
import { chatReply, type FakeChatServer, startFakeChatServer, testConfig } from './test-support.ts';

const servers: FakeChatServer[] = [];

function serve(handler: Parameters<typeof startFakeChatServer>[0]): FakeChatServer {
  const server = startFakeChatServer(handler);
  servers.push(server);
  return server;
}

afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

describe('role routing', () => {
  test('each role reaches its own provider and model', async () => {
    const a = serve(() => chatReply('from a'));
    const b = serve(() => chatReply('from b'));
    const config = testConfig(
      { a: { baseUrl: a.baseURL }, b: { baseUrl: b.baseURL } },
      {
        planner: { provider: 'a', model: 'model-a' },
        auditor: { provider: 'b', model: 'model-b' },
      },
    );
    const llm = createLLMFromEnv({ config, env: {} });

    const planned = await llm.complete({
      role: 'planner',
      system: 's',
      messages: [{ role: 'user', content: 'plan' }],
    });
    const audited = await llm.complete({
      role: 'auditor',
      system: 's',
      messages: [{ role: 'user', content: 'audit' }],
    });

    expect(planned.text).toBe('from a');
    expect(audited.text).toBe('from b');
    expect(a.requests[0]?.body.model).toBe('model-a');
    expect(b.requests[0]?.body.model).toBe('model-b');
    expect(planned.local).toBe(true);
  });

  test('provider names pick the family; only non-opencode names are OpenAI-compatible', () => {
    expect(providerKind('opencode')).toBe('opencode');
    expect(providerKind('deepseek')).toBe('openai-compatible');
    expect(providerKind('ollama')).toBe('openai-compatible');
  });

  test('opencode model refs must be providerID/modelID', () => {
    expect(splitOpencodeModel('opencode-go/deepseek-v4.1-flash')).toEqual({
      providerID: 'opencode-go',
      modelID: 'deepseek-v4.1-flash',
    });
    expect(() => splitOpencodeModel('deepseek-v4.1-flash')).toThrow(/providerID\/modelID/);
    expect(() => splitOpencodeModel('/x')).toThrow(/providerID\/modelID/);
  });
});

describe('cost helpers', () => {
  test('detects loopback URLs only', () => {
    expect(isLocalBaseUrl('http://127.0.0.1:11434/v1')).toBe(true);
    expect(isLocalBaseUrl('http://localhost:8080/v1')).toBe(true);
    expect(isLocalBaseUrl('http://[::1]:8080/v1')).toBe(true);
    expect(isLocalBaseUrl('https://api.deepseek.com/v1')).toBe(false);
    expect(isLocalBaseUrl('not a url')).toBe(false);
  });

  test('pricing falls back to the model after the providerID slash', () => {
    const model = { provider: 'opencode', model: 'opencode-go/deepseek-v4.1-flash' };
    expect(pricingKeys(model)).toContain('deepseek-v4.1-flash');
    expect(costOf(model, { input: 1_000_000, output: 0, cached: 0 }, false)).toBeCloseTo(0.3, 8);
    expect(costOf(model, { input: 1_000_000, output: 0, cached: 0 }, true)).toBe(0);
  });

  test('an unknown model costs zero rather than guessing', () => {
    expect(costOf({ provider: 'p', model: 'mystery' }, { input: 100, output: 100, cached: 0 }, false)).toBe(
      0,
    );
  });
});

describe('createLLMFromEnv profiles', () => {
  test('STARLING_LLM_PROFILE=local routes every role to Ollama', async () => {
    const urls: string[] = [];
    const bodies: Record<string, unknown>[] = [];
    const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      urls.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
      return new Response(JSON.stringify(chatReply('local bird').body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const llm = createLLMFromEnv({
      config: defaultConfig,
      env: { STARLING_LLM_PROFILE: 'local' },
      skipRecommendation: true,
      fetch: fakeFetch,
    });
    const res = await llm.complete({
      role: 'planner',
      system: 's',
      messages: [{ role: 'user', content: 'plan' }],
    });

    expect(res.text).toBe('local bird');
    expect(urls[0]).toContain('11434');
    expect(bodies[0]?.model).toBe(LOCAL_DEFAULT_MODEL);
    expect(res.local).toBe(true);
    expect(res.costUsd).toBe(0);
  });

  test('the default profile talks to DeepSeek with the env key', async () => {
    const urls: string[] = [];
    const fakeFetch = (async (input: string | URL | Request) => {
      urls.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      return new Response(JSON.stringify(chatReply('api bird').body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const llm = createLLMFromEnv({ env: { DEEPSEEK_API_KEY: 'sk-test' }, fetch: fakeFetch });
    const res = await llm.complete({
      role: 'planner',
      system: 's',
      messages: [{ role: 'user', content: 'plan' }],
    });

    expect(res.text).toBe('api bird');
    expect(urls[0]).toContain('api.deepseek.com');
    expect(res.local).toBe(false);
  });

  test('an unknown profile is a config error', () => {
    expect(() => createLLMFromEnv({ config: defaultConfig, env: { STARLING_LLM_PROFILE: 'nope' } })).toThrow(
      /Unknown STARLING_LLM_PROFILE/,
    );
  });
});
