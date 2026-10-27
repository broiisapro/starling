import { describe, expect, mock, test } from 'bun:test';
import type { StarlingEvent } from '@starling/core';
import type { SkySink } from './bootstrap';
import { probeHealth, startSkyData } from './bootstrap';
import { demoEvents } from './demo';
import type { EventSourceLike } from './sse';

const events = demoEvents();
const first = events[0];
if (first === undefined) throw new Error('fixture is empty');

function sink(): SkySink & {
  ingested: StarlingEvent[];
  connections: string[];
  resets: number;
} {
  const result = {
    ingested: [] as StarlingEvent[],
    connections: [] as string[],
    resets: 0,
    ingest: mock((event: StarlingEvent) => {
      result.ingested.push(event);
    }),
    setConnection: mock((connection: 'live' | 'demo' | 'offline') => {
      result.connections.push(connection);
    }),
    reset: mock(() => {
      result.resets += 1;
    }),
  };
  return result;
}

function fakeFetch(ok: boolean): typeof fetch {
  return (async () => ({
    ok,
    json: async () => (ok ? { ok: true } : { ok: false }),
  })) as unknown as typeof fetch;
}

class StubEventSource implements EventSourceLike {
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  closed = false;
  constructor(readonly url: string) {}
  close(): void {
    this.closed = true;
  }
}

describe('data bootstrap', () => {
  test('probeHealth accepts a well-formed health response', async () => {
    await expect(probeHealth({ fetchImpl: fakeFetch(true) })).resolves.toBe(true);
  });

  test('probeHealth treats a 404 as no server', async () => {
    await expect(probeHealth({ fetchImpl: fakeFetch(false) })).resolves.toBe(false);
  });

  test('probeHealth treats a network error as no server', async () => {
    const broken = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    await expect(probeHealth({ fetchImpl: broken })).resolves.toBe(false);
  });

  test('?demo=1 starts the player without probing health', async () => {
    const target = sink();
    let probed = false;
    const result = await startSkyData({
      demo: true,
      speed: 16,
      sink: target,
      fetchImpl: (async () => {
        probed = true;
        throw new Error('should not probe');
      }) as unknown as typeof fetch,
    });

    expect(result.mode).toBe('demo');
    expect(probed).toBe(false);
    expect(target.connections).toContain('demo');
    expect(target.ingested[0]).toEqual(first);
    result.stop();
  });

  test('auto mode falls back to demo when /api/health fails', async () => {
    const target = sink();
    const result = await startSkyData({ sink: target, fetchImpl: fakeFetch(false) });
    expect(result.mode).toBe('demo');
    expect(target.connections).toContain('demo');
    expect(target.ingested).toHaveLength(1);
    result.stop();
  });

  test('auto mode goes live when /api/health answers', async () => {
    const target = sink();
    const sources: StubEventSource[] = [];
    const result = await startSkyData({
      sink: target,
      fetchImpl: fakeFetch(true),
      factory: (url) => {
        const source = new StubEventSource(url);
        sources.push(source);
        return source;
      },
    });

    expect(result.mode).toBe('live');
    expect(target.connections).toContain('live');
    expect(sources[0]?.url).toBe('/api/events');

    sources[0]?.onmessage?.({ data: JSON.stringify(first) } as MessageEvent);
    expect(target.ingested).toEqual([first]);
    result.stop();
    expect(sources[0]?.closed).toBe(true);
  });

  test('demo mode can be stopped without leaving timers behind', async () => {
    const target = sink();
    const result = await startSkyData({ demo: true, sink: target, speed: 16 });
    expect(target.ingested[0]).toEqual(first);
    result.stop();
  });
});
