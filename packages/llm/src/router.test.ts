import { afterEach, describe, expect, test } from 'bun:test';
import type { LLMRequest, StarlingEvent } from '@starling/core';
import { createEventBus, StarlingError, usageCostUsd } from '@starling/core';
import { z } from 'zod';
import { isBadJsonError } from './errors.ts';
import { createLLM } from './router.ts';
import {
  chatReply,
  errorReply,
  type FakeChatServer,
  startFakeChatServer,
  testConfig,
} from './test-support.ts';
import type {
  OpencodeCompletionClient,
  OpencodeCompletionRequest,
  OpencodeCompletionResult,
} from './types.ts';

const servers: FakeChatServer[] = [];

function serve(handler: Parameters<typeof startFakeChatServer>[0]): FakeChatServer {
  const server = startFakeChatServer(handler);
  servers.push(server);
  return server;
}

function plannerRequest(content = 'Goal: add CSV export'): LLMRequest {
  return { role: 'planner', system: 'You plan.', messages: [{ role: 'user', content }] };
}

function fakeConfig(server: FakeChatServer) {
  return testConfig(
    { fake: { baseUrl: server.baseURL } },
    { planner: { provider: 'fake', model: 'deepseek-v4.1-flash' } },
  );
}

afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

describe('createLLM — plain completions', () => {
  test('returns text, usage, model and cost', async () => {
    const server = serve(() => chatReply('hello there', { input: 1000, output: 500, cached: 400 }));
    const llm = createLLM(fakeConfig(server));
    const res = await llm.complete(plannerRequest());

    expect(res.text).toBe('hello there');
    expect(res.model).toEqual({ provider: 'fake', model: 'deepseek-v4.1-flash' });
    // 127.0.0.1 is a local provider: free, and the meter celebrates it.
    expect(res.local).toBe(true);
    expect(res.usage).toEqual({ input: 1000, output: 500, cached: 400 });
    expect(res.costUsd).toBe(0);
  });

  test('sends a chat request with system, user, temperature and max tokens', async () => {
    const server = serve(() => chatReply('ok'));
    const llm = createLLM(fakeConfig(server));
    await llm.complete({ ...plannerRequest('do it'), temperature: 0.2, maxTokens: 512 });

    const request = server.requests[0];
    expect(request?.path).toBe('/v1/chat/completions');
    expect(request?.body.model).toBe('deepseek-v4.1-flash');
    expect(request?.body.temperature).toBe(0.2);
    expect(request?.body.max_tokens).toBe(512);
    expect(request?.body.messages).toEqual([
      { role: 'system', content: 'You plan.' },
      { role: 'user', content: 'do it' },
    ]);
    expect(request?.body.response_format).toBeUndefined();
  });

  test('a loopback provider is local and free', async () => {
    const server = serve(() => chatReply('free', { input: 1_000_000, output: 1_000_000 }));
    const llm = createLLM(fakeConfig(server));
    const res = await llm.complete(plannerRequest());
    expect(res.local).toBe(true);
    expect(res.costUsd).toBe(0);
  });

  test('publishes a debug log event per call', async () => {
    const server = serve(() => chatReply('ok'));
    const bus = createEventBus();
    const events: StarlingEvent[] = [];
    bus.subscribe((event) => events.push(event));
    const llm = createLLM(fakeConfig(server), { bus });
    await llm.complete(plannerRequest());

    const logs = events.filter((e) => e.type === 'log');
    expect(logs.length).toBeGreaterThan(0);
    const payload = logs[0]?.type === 'log' ? logs[0].payload : undefined;
    expect(payload?.level).toBe('debug');
    expect(payload?.msg).toContain('llm planner');
    expect(payload?.msg).toContain('local=true');
  });

  test('rejects a missing provider and a missing API key', async () => {
    const noProvider = testConfig(
      { fake: { baseUrl: 'http://127.0.0.1:1/v1' } },
      {
        planner: { provider: 'nope', model: 'x' },
      },
    );
    expect(() => createLLM(noProvider).complete(plannerRequest())).toThrow(StarlingError);

    const noKey = testConfig(
      { deepseek: { baseUrl: 'https://api.deepseek.com/v1', apiKeyEnv: 'NO_SUCH_KEY' } },
      {
        planner: { provider: 'deepseek', model: 'deepseek-v4.1-flash' },
      },
    );
    await expect(createLLM(noKey, { env: {} }).complete(plannerRequest())).rejects.toThrow('Missing API key');
  });
});

describe('createLLM — structured output', () => {
  const summarySchema = z.object({ summary: z.string() });

  test('uses json_schema for providers that support it', async () => {
    const server = serve((req) =>
      chatReply(JSON.stringify({ summary: req.body.response_format === undefined ? 'none' : 'structured' })),
    );
    const llm = createLLM(fakeConfig(server));
    const res = await llm.completeJson(plannerRequest(), summarySchema);

    expect(res.parsed).toEqual({ summary: 'structured' });
    const format = server.requests[0]?.body.response_format as Record<string, unknown> | undefined;
    expect(format?.type).toBe('json_schema');
    const jsonSchema = format?.json_schema as Record<string, unknown> | undefined;
    expect(jsonSchema?.name).toBe('starling_planner');
    expect(jsonSchema?.strict).toBe(true);
    const schemaFields = (jsonSchema?.schema ?? {}) as Record<string, unknown>;
    expect(schemaFields.type).toBe('object');
  });

  test('falls back to json_object for DeepSeek, without a network call', async () => {
    const bodies: Record<string, unknown>[] = [];
    const urls: string[] = [];
    const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      urls.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
      return new Response(JSON.stringify(chatReply('{"summary":"deepseek"}').body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const config = testConfig(
      { deepseek: { baseUrl: 'https://api.deepseek.com/v1', apiKeyEnv: 'TEST_KEY' } },
      { planner: { provider: 'deepseek', model: 'deepseek-v4.1-flash' } },
    );
    const llm = createLLM(config, { fetch: fakeFetch, env: { TEST_KEY: 'sk-test' } });
    const res = await llm.completeJson(plannerRequest(), summarySchema);

    expect(res.parsed).toEqual({ summary: 'deepseek' });
    expect(res.local).toBe(false);
    expect(res.costUsd).toBeCloseTo(usageCostUsd('deepseek-v4.1-flash', res.usage), 12);
    expect(urls[0]).toBe('https://api.deepseek.com/v1/chat/completions');
    const responseFormat = (bodies[0]?.response_format ?? {}) as Record<string, unknown>;
    expect(responseFormat.type).toBe('json_object');
    const sentMessages = (bodies[0]?.messages ?? []) as { content: string }[];
    expect(String(sentMessages[0]?.content ?? '')).toContain('JSON Schema');
  });

  test('accepts fenced JSON and surrounding prose', async () => {
    const server = serve(() => chatReply('Sure!\n```json\n{"summary":"fenced"}\n```\nDone.'));
    const llm = createLLM(fakeConfig(server));
    const res = await llm.completeJson(plannerRequest(), summarySchema);
    expect(res.parsed).toEqual({ summary: 'fenced' });
  });

  test('repairs an invalid reply on the follow-up turn', async () => {
    const server = serve((_req, index) => chatReply(index === 0 ? 'not json at all' : '{"summary":"fixed"}'));
    const llm = createLLM(fakeConfig(server));
    const res = await llm.completeJson(plannerRequest(), summarySchema);

    expect(res.parsed).toEqual({ summary: 'fixed' });
    expect(server.requests).toHaveLength(2);
    const messages = (server.requests[1]?.body.messages ?? []) as { role: string; content: string }[];
    expect(messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(messages.at(-1)?.content).toContain('not JSON');
  });

  test('repairs a schema mismatch and reports the field', async () => {
    const server = serve((_req, index) => chatReply(index === 0 ? '{"summary":42}' : '{"summary":"typed"}'));
    const llm = createLLM(fakeConfig(server));
    const res = await llm.completeJson(plannerRequest(), summarySchema);
    expect(res.parsed).toEqual({ summary: 'typed' });
    const secondTurn = (server.requests[1]?.body.messages ?? []) as { content: string }[];
    expect(String(secondTurn.at(-1)?.content ?? '')).toContain('summary');
  });

  test('gives up after two repairs and carries the raw text', async () => {
    const server = serve(() => chatReply('still not json'));
    const llm = createLLM(fakeConfig(server));

    let error: unknown;
    try {
      await llm.completeJson(plannerRequest(), summarySchema);
    } catch (err) {
      error = err;
    }
    expect(isBadJsonError(error)).toBe(true);
    if (isBadJsonError(error)) {
      expect(error.code).toBe('LLM_BAD_JSON');
      expect(error.details?.raw).toBe('still not json');
      expect(error.details?.attempts).toBe(3);
    }
    expect(server.requests).toHaveLength(3);
  });

  test('accumulates usage across repair turns', async () => {
    const server = serve((_req, index) =>
      index === 0
        ? chatReply('nope', { input: 10, output: 2 })
        : chatReply('{"summary":"ok"}', { input: 20, output: 3 }),
    );
    const llm = createLLM(fakeConfig(server));
    const res = await llm.completeJson(plannerRequest(), summarySchema);
    expect(res.usage).toEqual({ input: 30, output: 5, cached: 0 });
  });
});

describe('createLLM — failures and retries', () => {
  test('retries 429 and then succeeds', async () => {
    const server = serve((_req, index) =>
      index === 0 ? errorReply(429, 'slow down', { 'retry-after': '0' }) : chatReply('finally'),
    );
    const llm = createLLM(fakeConfig(server), { retry: { baseDelayMs: 1 } });
    const res = await llm.complete(plannerRequest());
    expect(res.text).toBe('finally');
    expect(server.requests).toHaveLength(2);
  });

  test('gives up on persistent 5xx with an LLM_ERROR', async () => {
    const server = serve(() => errorReply(500));
    const llm = createLLM(fakeConfig(server), { retry: { maxAttempts: 2, baseDelayMs: 1 } });
    let error: unknown;
    try {
      await llm.complete(plannerRequest());
    } catch (err) {
      error = err;
    }
    expect(error instanceof StarlingError).toBe(true);
    if (error instanceof StarlingError) expect(error.code).toBe('LLM_ERROR');
    expect(server.requests).toHaveLength(2);
  });

  test('times out a slow provider', async () => {
    const server = serve(() => ({ ...chatReply('too late'), delayMs: 300 }));
    const llm = createLLM(fakeConfig(server), { timeoutMs: 25, retry: { maxAttempts: 1 } });
    let error: unknown;
    try {
      await llm.complete(plannerRequest());
    } catch (err) {
      error = err;
    }
    expect(error instanceof StarlingError).toBe(true);
    if (error instanceof StarlingError) expect(error.details?.reason).toBe('timeout');
    expect(server.requests).toHaveLength(1);
  });

  test('honours an AbortSignal', async () => {
    const server = serve(() => chatReply('never'));
    const controller = new AbortController();
    controller.abort(new Error('stop now'));
    const llm = createLLM(fakeConfig(server));

    let error: unknown;
    try {
      await llm.complete(plannerRequest(), { signal: controller.signal });
    } catch (err) {
      error = err;
    }
    expect(error instanceof StarlingError).toBe(true);
    if (error instanceof StarlingError) expect(error.details?.reason).toBe('aborted');
    expect(server.requests).toHaveLength(0);
  });
});

describe('createLLM — opencode provider', () => {
  class FakeOpencode implements OpencodeCompletionClient {
    calls: OpencodeCompletionRequest[] = [];
    constructor(private readonly replies: OpencodeCompletionResult[]) {}
    async complete(req: OpencodeCompletionRequest): Promise<OpencodeCompletionResult> {
      this.calls.push(req);
      const reply = this.replies.shift();
      if (reply === undefined) throw new Error('no scripted reply');
      return reply;
    }
  }

  function opencodeConfig() {
    return testConfig(
      { opencode: { baseUrl: 'http://127.0.0.1:4096' } },
      { planner: { provider: 'opencode', model: 'opencode-go/deepseek-v4.1-flash' } },
    );
  }

  test('delegates to the injected client with split model ids', async () => {
    const client = new FakeOpencode([
      { text: 'from opencode', usage: { input: 1_000_000, output: 0, cached: 0 } },
    ]);
    const llm = createLLM(opencodeConfig(), { opencode: client });
    const res = await llm.complete(plannerRequest('hello'));

    expect(res.text).toBe('from opencode');
    expect(res.local).toBe(false);
    expect(res.costUsd).toBeCloseTo(0.3, 6);
    expect(client.calls[0]?.providerID).toBe('opencode-go');
    expect(client.calls[0]?.modelID).toBe('deepseek-v4.1-flash');
    expect(client.calls[0]?.system).toBe('You plan.');
    expect(client.calls[0]?.prompt).toBe('hello');
  });

  test('adds the JSON instruction for opencode structured output', async () => {
    const client = new FakeOpencode([
      { text: '{"summary":"via opencode"}', usage: { input: 1, output: 1, cached: 0 } },
    ]);
    const llm = createLLM(opencodeConfig(), { opencode: client });
    const res = await llm.completeJson(plannerRequest(), z.object({ summary: z.string() }));
    expect(res.parsed).toEqual({ summary: 'via opencode' });
    expect(client.calls[0]?.system).toContain('JSON Schema');
  });

  test('renders multi-turn repair conversations for the single-prompt client', async () => {
    const client = new FakeOpencode([
      { text: 'bad', usage: { input: 1, output: 1, cached: 0 } },
      { text: '{"summary":"second time"}', usage: { input: 2, output: 2, cached: 0 } },
    ]);
    const llm = createLLM(opencodeConfig(), { opencode: client });
    const res = await llm.completeJson(plannerRequest(), z.object({ summary: z.string() }));
    expect(res.parsed).toEqual({ summary: 'second time' });
    expect(client.calls[1]?.prompt).toContain('Assistant: bad');
    expect(client.calls[1]?.prompt).toContain('User:');
  });
});
