import { describe, expect, test } from 'bun:test';
import { type ExecResult, FakeClock } from '@starling/core';
import { MockNode } from '@starling/core/testing';
import {
  createLocalModelsProbe,
  type ExecFn,
  listLocalModels,
  type OsFacts,
  perchInfo,
  probeOs,
} from './perch-info';
import { makeStartTaskOptions } from './test-helpers';

const FACTS: OsFacts = {
  hostname: 'mokshs-air.local',
  computerName: "Moksh's MacBook Air",
  platform: 'darwin',
  arch: 'arm64',
  cpuCores: 8,
  memGb: 16,
};

function okResult(stdout: string): ExecResult {
  return { code: 0, stdout, stderr: '', durationMs: 1 };
}

function fakeFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): {
  fetch: typeof fetch;
  calls: Array<{ url: string; init?: RequestInit }>;
} {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const impl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init });
    return handler(url, init);
  };
  return { fetch: impl as unknown as typeof fetch, calls };
}

describe('perchInfo', () => {
  test('composes the OS facts, node capacity and a hub-assigned id', async () => {
    const node = new MockNode({ id: 'local-perch', info: { maxSessions: 5 } });
    const clock = new FakeClock(1234);

    const info = await perchInfo({
      node,
      name: 'M2 Air',
      maxSessions: 4,
      url: 'http://10.0.0.5:7778',
      id: 'node-7',
      clock,
      os: async () => FACTS,
      localModels: async () => ['qwen3.8:27b-mlx'],
    });

    expect(info).toEqual({
      id: 'node-7',
      name: 'M2 Air',
      kind: 'remote',
      url: 'http://10.0.0.5:7778',
      platform: 'darwin',
      arch: 'arm64',
      cpuCores: 8,
      memGb: 16,
      maxSessions: 4,
      activeSessions: 0,
      localModels: ['qwen3.8:27b-mlx'],
      status: 'online',
      lastSeen: 1234,
    });
  });

  test('falls back from ComputerName to hostname, and treats "auto" as unset', async () => {
    const node = new MockNode({ id: 'local-perch' });
    const base = { node, os: async () => FACTS, localModels: async () => [] };

    expect((await perchInfo({ ...base, name: 'auto' })).name).toBe("Moksh's MacBook Air");
    expect((await perchInfo({ ...base, name: '   ' })).name).toBe("Moksh's MacBook Air");

    const headless = await perchInfo({
      ...base,
      name: 'auto',
      os: async () => ({ ...FACTS, computerName: undefined }),
    });
    expect(headless.name).toBe('mokshs-air.local');
  });

  test('reports busy while a session is running', async () => {
    const node = new MockNode({ id: 'local-perch' });
    await node.startTask(makeStartTaskOptions());

    const info = await perchInfo({
      node,
      name: 'Air',
      clock: new FakeClock(99),
      os: async () => FACTS,
      localModels: async () => [],
    });
    expect(info.activeSessions).toBe(1);
    expect(info.status).toBe('busy');
    expect(info.lastSeen).toBe(99);
  });

  test('lendModels: false never probes Ollama', async () => {
    let probes = 0;
    const node = new MockNode({ id: 'local-perch' });

    const info = await perchInfo({
      node,
      lendModels: false,
      os: async () => FACTS,
      localModels: async () => {
        probes += 1;
        return ['qwen3.8:27b-mlx'];
      },
    });

    expect(info.localModels).toEqual([]);
    expect(probes).toBe(0);
  });
});

describe('listLocalModels', () => {
  test('reads /api/tags only and dedupes names', async () => {
    const { fetch, calls } = fakeFetch(
      () =>
        new Response(
          JSON.stringify({
            models: [
              { name: 'qwen3.8:27b-mlx', size: 1 },
              { model: 'llama3:8b' },
              { name: 'qwen3.8:27b-mlx' },
              { nope: true },
            ],
          }),
          { status: 200 },
        ),
    );

    const models = await listLocalModels({ fetch, ollamaUrl: 'http://127.0.0.1:11434/' });
    expect(models).toEqual(['qwen3.8:27b-mlx', 'llama3:8b']);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('http://127.0.0.1:11434/api/tags');
    expect(calls[0]?.init?.method).toBeUndefined();
    expect(calls.some((call) => call.url.includes('/api/generate'))).toBe(false);
  });

  test('an absent or unhappy Ollama means no lent models, never an error', async () => {
    const down = fakeFetch(() => {
      throw new Error('connect ECONNREFUSED');
    });
    expect(await listLocalModels({ fetch: down.fetch })).toEqual([]);

    const unhappy = fakeFetch(() => new Response('nope', { status: 500 }));
    expect(await listLocalModels({ fetch: unhappy.fetch })).toEqual([]);

    const nonsense = fakeFetch(() => new Response('{"models": "soon"}', { status: 200 }));
    expect(await listLocalModels({ fetch: nonsense.fetch })).toEqual([]);
  });
});

describe('createLocalModelsProbe', () => {
  test('caches for the TTL and refreshes after it', async () => {
    const clock = new FakeClock(0);
    let calls = 0;
    const probe = createLocalModelsProbe({
      clock,
      ttlMs: 1000,
      fetch: fakeFetch(() => {
        calls += 1;
        return new Response(JSON.stringify({ models: [{ name: `model-${calls}` }] }), { status: 200 });
      }).fetch,
    });

    expect(await probe()).toEqual(['model-1']);
    expect(await probe()).toEqual(['model-1']);
    expect(calls).toBe(1);

    clock.advance(1000);
    expect(await probe()).toEqual(['model-2']);
    expect(calls).toBe(2);
  });

  test('shares one in-flight probe and caches failures', async () => {
    const clock = new FakeClock(0);
    let calls = 0;
    const probe = createLocalModelsProbe({
      clock,
      ttlMs: 5000,
      fetch: fakeFetch(() => {
        calls += 1;
        throw new Error('no ollama');
      }).fetch,
    });

    const [a, b] = await Promise.all([probe(), probe()]);
    expect(a).toEqual([]);
    expect(b).toEqual([]);
    expect(calls).toBe(1);

    // A failure is cached for the TTL too: no timeout tax on every heartbeat.
    expect(await probe()).toEqual([]);
    expect(calls).toBe(1);
  });
});

describe('probeOs', () => {
  test('asks scutil for the friendly macOS name', async () => {
    const calls: string[][] = [];
    const exec: ExecFn = async (cmd) => {
      calls.push(cmd);
      return okResult("Moksh's MacBook Air\n");
    };

    const facts = await probeOs({ exec, platform: 'darwin', hostname: 'air.local' });
    expect(calls).toEqual([['scutil', '--get', 'ComputerName']]);
    expect(facts.computerName).toBe("Moksh's MacBook Air");
    expect(facts.hostname).toBe('air.local');
    expect(facts.platform).toBe('darwin');
    expect(facts.cpuCores).toBeGreaterThan(0);
    expect(facts.memGb).toBeGreaterThan(0);
  });

  test('falls back to the hostname when scutil fails or is unavailable', async () => {
    const failing: ExecFn = async () => ({ code: 1, stdout: '', stderr: 'no scutil', durationMs: 1 });
    const fallback = await probeOs({ exec: failing, platform: 'darwin', hostname: 'air.local' });
    expect(fallback.computerName).toBeUndefined();
    expect(fallback.hostname).toBe('air.local');

    let called = false;
    const never: ExecFn = async () => {
      called = true;
      return okResult('');
    };
    const linux = await probeOs({ exec: never, platform: 'linux', hostname: 'box' });
    expect(called).toBe(false);
    expect(linux.computerName).toBeUndefined();
  });
});
