import { afterEach, describe, expect, test } from 'bun:test';
import type { EventBus, StarlingEvent } from '@starling/core';
import { createEventBus } from '@starling/core';
import { BASE_TS, makeAgentEvent, makeNodeInfo, makeRun } from '@starling/core/testing';
import type { Hono } from 'hono';
import type { SseClient } from '../test-support';
import { connectSse, makeHarness, serveOnEphemeralPort } from '../test-support';

const servers: Array<{ stop: () => void }> = [];
const clients: SseClient[] = [];

function serve(app: Hono): string {
  const server = serveOnEphemeralPort(app);
  servers.push(server);
  return server.url;
}

afterEach(() => {
  for (const client of clients.splice(0)) client.close();
  for (const server of servers.splice(0)) server.stop();
});

function agentEvent(runId: string, ts: number, text: string): StarlingEvent {
  return { type: 'agent.event', runId, ts, payload: makeAgentEvent({ runId, ts, data: { text } }) };
}

async function connect(url: string): Promise<SseClient> {
  const client = await connectSse(url);
  clients.push(client);
  return client;
}

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

describe('GET /api/runs/:id/events', () => {
  test('404s for an unknown run before opening a stream', async () => {
    const { app } = makeHarness();
    const res = await app.request('/api/runs/01missing/events');
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('RUN_NOT_FOUND');
  });

  test('400s on a malformed since', async () => {
    const run = makeRun();
    const { app, store } = makeHarness();
    store.saveRun(run);
    const res = await app.request(`/api/runs/${run.id}/events?since=yesterday`);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('INVALID_QUERY');
  });

  test('opens a text/event-stream', async () => {
    const run = makeRun();
    const { app, store } = makeHarness({ serverOptions: { keepAliveMs: 60_000 } });
    store.saveRun(run);
    const response = await fetch(`${serve(app)}/api/runs/${run.id}/events`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    await response.body?.cancel();
  });

  test('delivers the backlog first, then live events in order', async () => {
    const run = makeRun();
    const { app, store, bus } = makeHarness({ serverOptions: { keepAliveMs: 60_000 } });
    store.saveRun(run);
    store.appendEvent(agentEvent(run.id, BASE_TS + 1, 'backlog one'));
    store.appendEvent(agentEvent(run.id, BASE_TS + 2, 'backlog two'));

    const client = await connect(`${serve(app)}/api/runs/${run.id}/events`);
    const backlog = await client.waitForEvents(2);
    expect(backlog.map((event) => event.ts)).toEqual([BASE_TS + 1, BASE_TS + 2]);

    bus.publish(agentEvent(run.id, BASE_TS + 3, 'live three'));
    const three = await client.waitForEvents(3);
    expect(three.map((event) => event.ts)).toEqual([BASE_TS + 1, BASE_TS + 2, BASE_TS + 3]);
    const third = three[2];
    expect(third?.type).toBe('agent.event');
    if (third?.type === 'agent.event') expect(third.payload.data.text).toBe('live three');
  });

  test('since filters the backlog and the live tail', async () => {
    const run = makeRun();
    const { app, store, bus } = makeHarness({ serverOptions: { keepAliveMs: 60_000 } });
    store.saveRun(run);
    store.appendEvent(agentEvent(run.id, BASE_TS + 100, 'too old'));
    store.appendEvent(agentEvent(run.id, BASE_TS + 200, 'kept'));
    store.appendEvent(agentEvent(run.id, BASE_TS + 300, 'also kept'));

    const client = await connect(`${serve(app)}/api/runs/${run.id}/events?since=${BASE_TS + 200}`);
    const backlog = await client.waitForEvents(2);
    expect(backlog.map((event) => event.ts)).toEqual([BASE_TS + 200, BASE_TS + 300]);

    bus.publish(agentEvent(run.id, BASE_TS + 150, 'live but older than since'));
    bus.publish(agentEvent(run.id, BASE_TS + 400, 'live and fresh'));
    const all = await client.waitForEvents(3);
    expect(all.map((event) => event.ts)).toEqual([BASE_TS + 200, BASE_TS + 300, BASE_TS + 400]);
  });

  test('only forwards events belonging to the requested run', async () => {
    const run = makeRun();
    const other = makeRun();
    const { app, store, bus } = makeHarness({ serverOptions: { keepAliveMs: 60_000 } });
    store.saveRun(run);
    store.saveRun(other);

    const client = await connect(`${serve(app)}/api/runs/${run.id}/events`);
    bus.publish(agentEvent(other.id, BASE_TS + 10, 'someone else'));
    bus.publish(agentEvent(run.id, BASE_TS + 11, 'mine'));
    await client.waitForEvents(1);
    await sleep(50);
    expect(client.events).toHaveLength(1);
    expect(client.events[0]?.runId).toBe(run.id);
  });

  test('sends a keep-alive comment on the configured interval', async () => {
    const run = makeRun();
    const { app, store } = makeHarness({ serverOptions: { keepAliveMs: 40 } });
    store.saveRun(run);
    const client = await connect(`${serve(app)}/api/runs/${run.id}/events`);
    const comments = await client.waitForComments(2, 2_000);
    expect(comments[0]).toBe('connected');
    expect(comments[1]).toBe('keep-alive');
  });

  test('unsubscribes from the bus when the client disconnects', async () => {
    const inner = createEventBus();
    let subscribers = 0;
    const counting: EventBus = {
      publish: (event) => inner.publish(event),
      subscribe: (fn) => {
        subscribers += 1;
        const off = inner.subscribe(fn);
        let released = false;
        return () => {
          if (released) return;
          released = true;
          subscribers -= 1;
          off();
        };
      },
    };
    const run = makeRun();
    const { app, store } = makeHarness({ bus: counting, serverOptions: { keepAliveMs: 60_000 } });
    store.saveRun(run);
    // The harness itself holds one subscription (to record published events); the stream adds one.
    const baseline = subscribers;

    const client = await connect(`${serve(app)}/api/runs/${run.id}/events`);
    await sleep(50);
    expect(subscribers).toBe(baseline + 1);
    client.close();
    const deadline = Date.now() + 2_000;
    while (subscribers > baseline && Date.now() < deadline) await sleep(10);
    expect(subscribers).toBe(baseline);
    clients.splice(clients.indexOf(client), 1);
  });
});

describe('GET /api/events', () => {
  test('streams run events and flock node events together, oldest first', async () => {
    const run = makeRun();
    const { app, store } = makeHarness({ serverOptions: { keepAliveMs: 60_000 } });
    store.saveRun(run);
    store.appendEvent(agentEvent(run.id, BASE_TS + 5, 'run event'));
    store.appendEvent({
      type: 'node.joined',
      runId: '*',
      ts: BASE_TS + 2,
      payload: { node: makeNodeInfo({ id: 'air', kind: 'remote', name: 'M2 Air' }) },
    });

    const client = await connect(`${serve(app)}/api/events`);
    const events = await client.waitFor(
      (frames) => frames.filter((frame) => frame.type !== 'log').length >= 2,
    );
    const recorded = events.filter((event) => event.type !== 'log');
    expect(recorded.map((event) => event.runId)).toEqual(['*', run.id]);
    expect(recorded[0]?.type).toBe('node.joined');
    expect(recorded[1]?.type).toBe('agent.event');
  });

  test('also carries the request log frames the dashboard shows in its log feed', async () => {
    const { app } = makeHarness({ serverOptions: { keepAliveMs: 60_000 } });
    const client = await connect(`${serve(app)}/api/events`);
    const events = await client.waitFor((frames) => frames.some((frame) => frame.type === 'log'));
    const logs = events.filter((event) => event.type === 'log');
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs[0]?.runId).toBe('*');
  });

  test('forwards live node events and honours since', async () => {
    const { app, bus } = makeHarness({ serverOptions: { keepAliveMs: 60_000 } });
    const client = await connect(`${serve(app)}/api/events?since=${BASE_TS + 1000}`);

    bus.publish({
      type: 'node.stats',
      runId: '*',
      ts: BASE_TS + 900,
      payload: { node: makeNodeInfo({ id: 'hub', activeSessions: 3 }) },
    });
    bus.publish({
      type: 'node.stats',
      runId: '*',
      ts: BASE_TS + 1001,
      payload: { node: makeNodeInfo({ id: 'hub', activeSessions: 4 }) },
    });

    const frames = await client.waitFor((all) =>
      all.some((frame) => frame.type === 'node.stats' && frame.payload.node.activeSessions === 4),
    );
    await sleep(50);
    const stats = frames.filter((frame) => frame.type === 'node.stats');
    expect(stats).toHaveLength(1);
    const only = stats[0];
    if (only?.type !== 'node.stats') throw new Error('expected node.stats');
    expect(only.payload.node.activeSessions).toBe(4);
  });

  test('400s on a malformed since', async () => {
    const { app } = makeHarness();
    const res = await app.request('/api/events?since=-5');
    expect(res.status).toBe(400);
  });
});
