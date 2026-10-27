import type { AgentEvent, NodeInfo, StartTaskOptions } from '@starling/core';
import { makeNodeInfo } from '@starling/core/testing';

/** The join code every test hub and perch shares. */
export const TEST_CODE = 'TEST-CODE';

export function authHeaders(token = TEST_CODE): Record<string, string> {
  return { 'x-flock-token': token, 'content-type': 'application/json' };
}

export function makeStartTaskOptions(overrides: Partial<StartTaskOptions> = {}): StartTaskOptions {
  return {
    runId: 'run-1',
    taskKey: 'theme',
    title: 'Dark mode with a toggle',
    repo: { kind: 'bundle', url: 'http://hub.test/api/flock/bundle?ref=abc', token: TEST_CODE },
    fromRef: 'main',
    branch: 'starling/run1/theme',
    prompt: 'Add the theme and a toggle.',
    model: { provider: 'deepseek', model: 'deepseek-v4.1-flash' },
    ...overrides,
  };
}

/** A static `NodeInfo` provider for tests that are not exercising `perchInfo`. */
export function staticInfo(overrides: Partial<NodeInfo> = {}): () => Promise<NodeInfo> {
  return async () =>
    makeNodeInfo({
      id: 'perch-1',
      name: 'Perch One',
      kind: 'remote',
      maxSessions: 5,
      lastSeen: 1000,
      ...overrides,
    });
}

/** Wait until `fn` returns a truthy value, polling every 5 ms. */
export async function waitFor<T>(
  fn: () => T | undefined | false | null,
  label = 'condition',
  timeoutMs = 3000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = fn();
    if (value) return value;
    await Bun.sleep(5);
  }
  throw new Error(`timed out after ${timeoutMs}ms waiting for ${label}`);
}

export interface SseConnection {
  response: Response;
  close(): void;
}

/**
 * Open an SSE stream and resolve once headers arrive.
 *
 * `streamSSE` subscribes to the node before returning the response, so awaiting this promise is
 * enough to guarantee a subsequent `POST /perch/tasks` cannot race ahead of the subscription.
 */
export async function openSse(url: string, token = TEST_CODE): Promise<SseConnection> {
  const controller = new AbortController();
  const response = await fetch(url, {
    headers: { 'x-flock-token': token, accept: 'text/event-stream' },
    signal: controller.signal,
  });
  if (!response.ok || response.body === null) {
    throw new Error(`SSE connect failed: ${response.status}`);
  }
  return { response, close: () => controller.abort() };
}

/** Read `count` SSE events from an already-open response. */
export async function readSseEvents(
  response: Response,
  count: number,
  timeoutMs = 3000,
): Promise<AgentEvent[]> {
  if (response.body === null) throw new Error('SSE response has no body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events: AgentEvent[] = [];
  let buffer = '';
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`SSE timed out after ${events.length} events`)), timeoutMs);
    timer.unref?.();
  });

  try {
    while (events.length < count) {
      const chunk = await Promise.race([reader.read(), timeout]);
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });

      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        const data = frame
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n');
        if (data.length > 0) events.push(JSON.parse(data) as AgentEvent);
      }
    }
    return events;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Read raw SSE text until `predicate` is satisfied (used for keep-alive comments). */
export async function readSseText(
  response: Response,
  predicate: (text: string) => boolean,
  timeoutMs = 3000,
): Promise<string> {
  if (response.body === null) throw new Error('SSE response has no body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  const deadline = Date.now() + timeoutMs;

  while (!predicate(text)) {
    if (Date.now() > deadline) throw new Error(`SSE text timed out; saw: ${JSON.stringify(text)}`);
    const chunk = await reader.read();
    if (chunk.done) break;
    text += decoder.decode(chunk.value, { stream: true });
  }
  return text;
}

export interface HubRegistration {
  nodeId: string;
  url: string;
  info: NodeInfo;
  token: string | undefined;
}

export interface HubHeartbeat {
  nodeId: string;
  info: NodeInfo;
  token: string | undefined;
  accepted: boolean;
}

export interface FakeHub {
  url: string;
  registrations: HubRegistration[];
  heartbeats: HubHeartbeat[];
  forget(nodeId: string): void;
  stop(): void;
}

/** An in-process fake of the two hub routes a perch calls (ARCHITECTURE §6). */
export function startFakeHub(code = TEST_CODE): FakeHub {
  let counter = 0;
  const known = new Set<string>();
  const registrations: HubRegistration[] = [];
  const heartbeats: HubHeartbeat[] = [];

  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(req) {
      const token = req.headers.get('x-flock-token') ?? undefined;
      if (token !== code) {
        return Response.json({ error: { code: 'unauthorized', message: 'bad token' } }, { status: 401 });
      }
      const path = new URL(req.url).pathname;

      if (req.method === 'POST' && path === '/api/flock/register') {
        const body = (await req.json()) as { url: string; info: NodeInfo };
        const nodeId = `node-${++counter}`;
        known.add(nodeId);
        registrations.push({ nodeId, url: body.url, info: body.info, token });
        return Response.json({ nodeId });
      }

      if (req.method === 'POST' && path === '/api/flock/heartbeat') {
        const body = (await req.json()) as { nodeId: string; info: NodeInfo };
        const accepted = known.has(body.nodeId);
        heartbeats.push({ nodeId: body.nodeId, info: body.info, token, accepted });
        if (!accepted) {
          return Response.json({ error: { code: 'unknown-node', message: 're-register' } }, { status: 404 });
        }
        return Response.json({ ok: true });
      }

      return Response.json({ error: { code: 'not-found', message: path } }, { status: 404 });
    },
  });

  return {
    url: `http://127.0.0.1:${server.port}`,
    registrations,
    heartbeats,
    forget: (nodeId) => {
      known.delete(nodeId);
    },
    stop: () => server.stop(true),
  };
}

export type HubVerdict = 'ok' | 'throw' | '404' | '500' | 'bad-json';

export interface HubCall {
  path: string;
  token: string | undefined;
  body: { url?: string; nodeId?: string; info?: NodeInfo };
}

/**
 * A scriptable `fetch` for the daemon loop. It never opens a socket, so backoff and 404-recovery
 * tests are deterministic and fast.
 */
export function createHubFetch(responder: (call: HubCall, index: number) => HubVerdict = () => 'ok'): {
  fetch: typeof fetch;
  calls: HubCall[];
} {
  const calls: HubCall[] = [];
  let nodeCounter = 0;

  const impl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const call: HubCall = {
      path: new URL(raw).pathname,
      token: new Headers(init?.headers).get('x-flock-token') ?? undefined,
      body: JSON.parse(String(init?.body ?? '{}')) as HubCall['body'],
    };
    calls.push(call);

    const verdict = responder(call, calls.length - 1);
    if (verdict === 'throw') throw new TypeError('fetch failed: connect ECONNREFUSED');
    if (verdict === '404') {
      return Response.json({ error: { code: 'unknown-node', message: 're-register' } }, { status: 404 });
    }
    if (verdict === '500') {
      return Response.json({ error: { code: 'boom', message: 'hub exploded' } }, { status: 500 });
    }
    if (verdict === 'bad-json') return new Response('not json', { status: 200 });

    if (call.path === '/api/flock/register') {
      nodeCounter += 1;
      return Response.json({ nodeId: `scripted-${nodeCounter}` });
    }
    return Response.json({ ok: true });
  };

  return { fetch: impl as unknown as typeof fetch, calls };
}
