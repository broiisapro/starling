import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { StarlingConfig, StarlingEvent } from '@starling/core';
import { createEventBus, defaultConfig } from '@starling/core';
import { z } from 'zod';
import { createLLMFromEnv, MIXED_PROBE_TTL_MS, opencodeFallbackConfig, resolveLLMProfile } from './env.ts';
import type { ProfileWarning } from './profiles.ts';
import { LOCAL_DEFAULT_MODEL, OPENCODE_DEFAULT_MODEL } from './profiles.ts';

/**
 * Three fakes, all `Bun.serve` on loopback:
 * - Ollama's native `/api/tags` plus its OpenAI-compatible `/v1/chat/completions`;
 * - the opencode V2 session routes a completion needs.
 *
 * Nothing here touches the network or a model.
 */
interface Fake {
  url: string;
  requests: string[];
  bodies: Record<string, unknown>[];
  close(): void;
}

const fakes: Fake[] = [];

function track(url: string, requests: string[], bodies: Record<string, unknown>[], close: () => void): Fake {
  const fake = { url, requests, bodies, close };
  fakes.push(fake);
  return fake;
}

afterEach(() => {
  for (const fake of fakes.splice(0)) fake.close();
});

interface FakeOllama {
  fake: Fake;
  /** Flip to simulate the daemon going away or the model being pulled mid-run. */
  state: { up: boolean; models: string[] };
}

function startOllama(models: string[] = [LOCAL_DEFAULT_MODEL]): FakeOllama {
  const state = { up: true, models };
  const requests: string[] = [];
  const bodies: Record<string, unknown>[] = [];
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(request) {
      const url = new URL(request.url);
      requests.push(`${request.method} ${url.pathname}`);
      if (url.pathname === '/api/tags') {
        if (!state.up) return new Response('down', { status: 503 });
        return Response.json({ models: state.models.map((name) => ({ name, model: name })) });
      }
      if (url.pathname === '/v1/chat/completions') {
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        bodies.push(body);
        return Response.json({
          id: 'chatcmpl-local',
          object: 'chat.completion',
          created: 1,
          model: body.model,
          choices: [{ index: 0, message: { role: 'assistant', content: 'local bird' } }],
          usage: { prompt_tokens: 40, completion_tokens: 10, total_tokens: 50 },
        });
      }
      return new Response('not found', { status: 404 });
    },
  });
  const fake = track(`http://127.0.0.1:${server.port}`, requests, bodies, () => server.stop(true));
  return { fake, state };
}

function startOpencode(): Fake {
  const requests: string[] = [];
  const bodies: Record<string, unknown>[] = [];
  let sessions = 0;
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(request) {
      const url = new URL(request.url);
      requests.push(`${request.method} ${url.pathname}`);
      if (request.method === 'POST' && url.pathname === '/api/session') {
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        bodies.push(body);
        sessions += 1;
        return Response.json({ data: { id: `ses_${sessions}` } });
      }
      if (request.method === 'POST' && url.pathname.endsWith('/generate')) {
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        bodies.push(body);
        return Response.json({ data: { text: 'cloud bird' } });
      }
      if (request.method === 'GET' && url.pathname.startsWith('/api/session/')) {
        return Response.json({
          data: { tokens: { input: 30, output: 7, cache: { read: 0, write: 0 } } },
        });
      }
      if (request.method === 'DELETE') return new Response(null, { status: 204 });
      return new Response('not found', { status: 404 });
    },
  });
  return track(`http://127.0.0.1:${server.port}`, requests, bodies, () => server.stop(true));
}

function configFor(ollama: Fake, opencode: Fake): StarlingConfig {
  return {
    ...defaultConfig,
    opencode: { mode: 'attach', url: opencode.url, port: 4096 },
    providers: { ollama: { baseUrl: `${ollama.url}/v1` } },
  };
}

const AUDIT_REQUEST = {
  role: 'auditor' as const,
  system: 'judge the diff',
  messages: [{ role: 'user' as const, content: 'diff' }],
};

describe('mixed profile fallback (lazy probe)', () => {
  test('local roles use Ollama when it is up and the model is present', async () => {
    const ollama = startOllama();
    const opencode = startOpencode();
    const warnings: ProfileWarning[] = [];
    const llm = createLLMFromEnv({
      config: configFor(ollama.fake, opencode),
      env: { STARLING_LLM_PROFILE: 'mixed' },
      skipRecommendation: true,
      localModel: LOCAL_DEFAULT_MODEL,
      onWarning: (warning) => warnings.push(warning),
    });

    const res = await llm.complete(AUDIT_REQUEST);
    expect(res.text).toBe('local bird');
    expect(res.local).toBe(true);
    expect(res.costUsd).toBe(0);
    expect(res.model).toEqual({ provider: 'ollama', model: LOCAL_DEFAULT_MODEL });
    expect(ollama.fake.bodies[0]?.model).toBe(LOCAL_DEFAULT_MODEL);
    expect(opencode.requests).toEqual([]);
    expect(warnings).toEqual([]);
  });

  test('the probe is cached, so a second audit does not ask twice', async () => {
    const ollama = startOllama();
    const opencode = startOpencode();
    const llm = createLLMFromEnv({
      config: configFor(ollama.fake, opencode),
      env: { STARLING_LLM_PROFILE: 'mixed' },
      skipRecommendation: true,
      localModel: LOCAL_DEFAULT_MODEL,
    });
    await llm.complete(AUDIT_REQUEST);
    await llm.complete(AUDIT_REQUEST);
    expect(ollama.fake.requests.filter((r) => r === 'GET /api/tags')).toHaveLength(1);
  });

  test('a missing model falls back to opencode with a warning, and says which model', async () => {
    const ollama = startOllama(['llama3:8b']);
    const opencode = startOpencode();
    const warnings: ProfileWarning[] = [];
    const events: StarlingEvent[] = [];
    const bus = createEventBus();
    bus.subscribe((event) => events.push(event));

    const llm = createLLMFromEnv({
      config: configFor(ollama.fake, opencode),
      env: { STARLING_LLM_PROFILE: 'mixed' },
      skipRecommendation: true,
      localModel: LOCAL_DEFAULT_MODEL,
      bus,
      onWarning: (warning) => warnings.push(warning),
    });

    const res = await llm.complete(AUDIT_REQUEST);
    expect(res.text).toBe('cloud bird');
    expect(res.local).toBe(false);
    expect(res.model).toEqual({ provider: 'opencode', model: OPENCODE_DEFAULT_MODEL });
    expect(opencode.requests[0]).toBe('POST /api/session');

    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.code).toBe('local-model-missing');
    expect(warnings[0]?.message).toContain(LOCAL_DEFAULT_MODEL);
    const warn = events.find((event) => event.type === 'log' && event.payload.level === 'warn');
    expect(warn).toBeDefined();
  });

  test('a dead daemon falls back to opencode and logs once', async () => {
    const ollama = startOllama();
    ollama.state.up = false;
    const opencode = startOpencode();
    const warnings: ProfileWarning[] = [];
    const llm = createLLMFromEnv({
      config: configFor(ollama.fake, opencode),
      env: { STARLING_LLM_PROFILE: 'mixed' },
      skipRecommendation: true,
      onWarning: (warning) => warnings.push(warning),
    });

    expect((await llm.complete(AUDIT_REQUEST)).text).toBe('cloud bird');
    expect((await llm.complete(AUDIT_REQUEST)).text).toBe('cloud bird');
    // One probe result is reused inside the TTL, so exactly one warning.
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.code).toBe('local-unavailable');
  });

  test('the fallback is re-probed after the TTL, so a pulled model is picked up', async () => {
    const ollama = startOllama([]);
    const opencode = startOpencode();
    let now = 1_000;
    const clock = { now: () => now };
    const warnings: ProfileWarning[] = [];
    const llm = createLLMFromEnv({
      config: configFor(ollama.fake, opencode),
      env: { STARLING_LLM_PROFILE: 'mixed' },
      skipRecommendation: true,
      localModel: LOCAL_DEFAULT_MODEL,
      clock,
      onWarning: (warning) => warnings.push(warning),
    });

    expect((await llm.complete(AUDIT_REQUEST)).text).toBe('cloud bird');
    ollama.state.models = [LOCAL_DEFAULT_MODEL];
    now += MIXED_PROBE_TTL_MS + 1;
    expect((await llm.complete(AUDIT_REQUEST)).text).toBe('local bird');
  });

  test('planner and worker never probe Ollama: they are opencode roles', async () => {
    const ollama = startOllama();
    const opencode = startOpencode();
    const llm = createLLMFromEnv({
      config: configFor(ollama.fake, opencode),
      env: { STARLING_LLM_PROFILE: 'mixed' },
      skipRecommendation: true,
    });
    const res = await llm.complete({ ...AUDIT_REQUEST, role: 'planner' });
    expect(res.text).toBe('cloud bird');
    expect(ollama.fake.requests).toEqual([]);
  });

  test('a preflight verdict of unavailable skips the probe entirely', async () => {
    const ollama = startOllama();
    const opencode = startOpencode();
    const warnings: ProfileWarning[] = [];
    const llm = createLLMFromEnv({
      config: configFor(ollama.fake, opencode),
      env: { STARLING_LLM_PROFILE: 'mixed' },
      skipRecommendation: true,
      localAvailable: false,
      onWarning: (warning) => warnings.push(warning),
    });
    expect((await llm.complete(AUDIT_REQUEST)).text).toBe('cloud bird');
    expect(ollama.fake.requests).toEqual([]);
    expect(warnings[0]?.code).toBe('local-unavailable');
  });

  test('skipLocalProbe keeps the local-first promise without a probe', async () => {
    const ollama = startOllama();
    const opencode = startOpencode();
    const llm = createLLMFromEnv({
      config: configFor(ollama.fake, opencode),
      env: { STARLING_LLM_PROFILE: 'mixed' },
      skipRecommendation: true,
      skipLocalProbe: true,
    });
    expect((await llm.complete(AUDIT_REQUEST)).text).toBe('local bird');
    expect(ollama.fake.requests).toEqual(['POST /v1/chat/completions']);
    expect(opencode.requests).toEqual([]);
  });

  test('completeJson also falls back (structured output is not a special case)', async () => {
    const ollama = startOllama([]);
    const opencode = startOpencode();
    const llm = createLLMFromEnv({
      config: configFor(ollama.fake, opencode),
      env: { STARLING_LLM_PROFILE: 'mixed' },
      skipRecommendation: true,
      localModel: LOCAL_DEFAULT_MODEL,
    });
    // The fake opencode returns plain prose, so the schema call must fail with LLM_BAD_JSON after
    // its repairs — proving it went to opencode rather than to the (never-probed) local path.
    const schema = z.object({ pass: z.boolean() });
    await expect(llm.completeJson(AUDIT_REQUEST, schema)).rejects.toThrow();
    expect(opencode.requests.filter((r) => r === 'POST /api/session')).toHaveLength(3);
    expect(ollama.fake.bodies).toEqual([]);
  });
});

describe('resolveLLMProfile', () => {
  test('local picks the recommendation and explains itself', () => {
    const dir = mkdtempSync(join(tmpdir(), 'starling-env-'));
    try {
      const path = join(dir, 'recommendation.json');
      writeFileSync(
        path,
        JSON.stringify({
          mbp: { auditor: 'qwen3.8:27b-mlx', summarizer: 'qwen3.8:4b-mlx' },
          air: { auditor: 'qwen3.8:4b-mlx', summarizer: 'qwen3.8:2b-mlx' },
        }),
        'utf8',
      );
      const resolution = resolveLLMProfile({
        config: defaultConfig,
        env: { STARLING_LLM_PROFILE: 'local' },
        recommendationPath: path,
        localProfile: 'air',
      });
      expect(resolution.profile).toBe('local');
      expect(resolution.config.models.auditor.model).toBe('qwen3.8:4b-mlx');
      expect(resolution.config.models.writer.model).toBe('qwen3.8:2b-mlx');
      expect(resolution.notes[0]).toContain('qwen3.8:4b-mlx (recommendation, host air)');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('deepseek and opencode do not read the recommendation at all', () => {
    for (const profile of ['deepseek', 'opencode']) {
      const resolution = resolveLLMProfile({
        config: defaultConfig,
        env: { STARLING_LLM_PROFILE: profile },
        recommendationPath: '/definitely/not/here.json',
      });
      expect(resolution.notes).toEqual([]);
      expect(resolution.warnings).toEqual([]);
    }
  });

  test('the default profile is unchanged by this epic', () => {
    const resolution = resolveLLMProfile({ config: defaultConfig, env: {} });
    expect(resolution.profile).toBe('deepseek');
    expect(resolution.config).toBe(defaultConfig);
  });

  test('opencodeFallbackConfig only moves the roles it is given', () => {
    const config = opencodeFallbackConfig(defaultConfig);
    expect(config.models.auditor.provider).toBe('opencode');
    expect(config.models.writer.provider).toBe('opencode');
    expect(config.models.worker).toEqual(defaultConfig.models.worker);
  });
});
