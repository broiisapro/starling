import { afterEach, describe, expect, test } from 'bun:test';
import { nativeOllamaUrl, probeOllama } from './profiles-probe.ts';

interface FakeOllama {
  url: string;
  requests: string[];
  close(): void;
}

const servers: FakeOllama[] = [];

function fakeOllama(
  handler: (req: Request) => Response | Promise<Response> = () =>
    Response.json({ models: [{ name: 'qwen3.8:27b-mlx', model: 'qwen3.8:27b-mlx' }] }),
): FakeOllama {
  const requests: string[] = [];
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch(request) {
      const url = new URL(request.url);
      requests.push(`${request.method} ${url.pathname}`);
      return handler(request);
    },
  });
  const fake: FakeOllama = {
    url: `http://127.0.0.1:${server.port}`,
    requests,
    close: () => server.stop(true),
  };
  servers.push(fake);
  return fake;
}

afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

describe('probeOllama', () => {
  test('normalises the OpenAI-compatible URL to the native API', () => {
    expect(nativeOllamaUrl('http://127.0.0.1:11434/v1')).toBe('http://127.0.0.1:11434');
    expect(nativeOllamaUrl('http://127.0.0.1:11434/v1/')).toBe('http://127.0.0.1:11434');
    expect(nativeOllamaUrl('http://127.0.0.1:11434/')).toBe('http://127.0.0.1:11434');
    expect(nativeOllamaUrl('http://box.local:8080')).toBe('http://box.local:8080');
  });

  test('reports ok when the daemon answers and the model is pulled', async () => {
    const fake = fakeOllama();
    const probe = await probeOllama({ baseUrl: `${fake.url}/v1`, model: 'qwen3.8:27b-mlx' });
    expect(probe).toMatchObject({ ok: true, reachable: true, hasModel: true });
    expect(probe.models).toEqual(['qwen3.8:27b-mlx']);
    expect(fake.requests).toEqual(['GET /api/tags']);
    expect(probe.detail).toContain('qwen3.8:27b-mlx is present');
  });

  test('a reachable daemon without the model is a model-missing fallback, not an outage', async () => {
    const fake = fakeOllama(() => Response.json({ models: [{ name: 'llama3:8b' }] }));
    const probe = await probeOllama({ baseUrl: fake.url, model: 'qwen3.8:27b-mlx' });
    expect(probe).toMatchObject({ ok: false, reachable: true, hasModel: false });
    expect(probe.code).toBe('local-model-missing');
    expect(probe.detail).toContain('llama3:8b');
  });

  test('a dead daemon is an unavailable fallback and never throws', async () => {
    // Port 1 on loopback refuses fast on macOS; this stays offline.
    const probe = await probeOllama({
      baseUrl: 'http://127.0.0.1:1/v1',
      model: 'qwen3.8:27b-mlx',
      timeoutMs: 300,
    });
    expect(probe).toMatchObject({ ok: false, reachable: false, hasModel: false });
    expect(probe.code).toBe('local-unavailable');
    expect(probe.detail).toContain('not reachable');
  });

  test('a hanging daemon times out inside the budget', async () => {
    const fake = fakeOllama(async () => {
      await Bun.sleep(5_000);
      return Response.json({ models: [] });
    });
    const started = Date.now();
    const probe = await probeOllama({ baseUrl: fake.url, model: 'qwen3.8:27b-mlx', timeoutMs: 120 });
    expect(probe.ok).toBe(false);
    expect(probe.code).toBe('local-unavailable');
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  test('an HTTP error and a garbage body are both handled', async () => {
    const down = fakeOllama(() => new Response('nope', { status: 503 }));
    const http = await probeOllama({ baseUrl: down.url, model: 'm' });
    expect(http.code).toBe('local-unavailable');
    expect(http.detail).toContain('503');

    const garbage = fakeOllama(() => new Response('not json', { status: 200 }));
    const body = await probeOllama({ baseUrl: garbage.url, model: 'm' });
    expect(body).toMatchObject({ ok: false, reachable: true });
    expect(body.detail).toContain('unreadable body');
  });

  test('without a model it only checks reachability', async () => {
    const fake = fakeOllama(() => Response.json({ models: [] }));
    const probe = await probeOllama({ baseUrl: fake.url });
    expect(probe).toMatchObject({ ok: true, reachable: true, hasModel: false });
    expect(probe.code).toBeUndefined();
  });

  test('an empty tag list is still reachable', async () => {
    const fake = fakeOllama(() => Response.json({}));
    const probe = await probeOllama({ baseUrl: fake.url, model: 'qwen3.8:27b-mlx' });
    expect(probe.code).toBe('local-model-missing');
    expect(probe.detail).toContain('have: none');
  });
});
