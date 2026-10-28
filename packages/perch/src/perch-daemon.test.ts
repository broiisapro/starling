import { afterEach, describe, expect, test } from 'bun:test';
import { FakeClock, isStarlingError } from '@starling/core';
import { MockNode } from '@starling/core/testing';
import type { MdnsAdvertiseOptions, MdnsAdvertiser } from './handshake';
import { type PerchHandle, startPerch } from './perch-daemon';
import type { OsFacts } from './perch-info';
import {
  authHeaders,
  createHubFetch,
  type HubCall,
  makeStartTaskOptions,
  TEST_CODE,
  waitFor,
} from './test-helpers';

const FACTS: OsFacts = {
  hostname: 'air.local',
  computerName: "Moksh's MacBook Air",
  platform: 'darwin',
  arch: 'arm64',
  cpuCores: 8,
  memGb: 16,
};

const perches: PerchHandle[] = [];

afterEach(async () => {
  for (const perch of perches.splice(0)) await perch.stop();
});

function baseOptions(overrides: Partial<Parameters<typeof startPerch>[0]> = {}) {
  return {
    node: new MockNode({ id: 'perch-local' }),
    port: 0,
    publicHost: '127.0.0.1',
    name: 'Test Perch',
    maxSessions: 5,
    lendModels: false,
    os: async () => FACTS,
    clock: new FakeClock(5000),
    heartbeatMs: 10,
    backoffMs: 5,
    maxBackoffMs: 20,
    ...overrides,
  };
}

async function launch(options: Parameters<typeof startPerch>[0]): Promise<PerchHandle> {
  const perch = await startPerch(options);
  perches.push(perch);
  return perch;
}

const heartbeats = (calls: HubCall[]): HubCall[] =>
  calls.filter((call) => call.path === '/api/flock/heartbeat');
const registrations = (calls: HubCall[]): HubCall[] =>
  calls.filter((call) => call.path === '/api/flock/register');

describe('startPerch registration and heartbeat', () => {
  test('registers with the join code and keeps heartbeating with fresh info', async () => {
    const hub = createHubFetch();
    const perch = await launch(baseOptions({ hub: 'http://hub.test/', code: TEST_CODE, fetch: hub.fetch }));

    expect(perch.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(registrations(hub.calls)).toHaveLength(1);
    expect(hub.calls[0]?.token).toBe(TEST_CODE);
    expect(hub.calls[0]?.body.url).toBe(perch.url);
    expect(hub.calls[0]?.body.info?.name).toBe('Test Perch');
    expect(hub.calls[0]?.body.info?.kind).toBe('remote');
    expect(hub.calls[0]?.body.info?.url).toBe(perch.url);
    expect(hub.calls[0]?.body.info?.localModels).toEqual([]);
    expect(hub.calls[0]?.body.info?.lastSeen).toBe(5000);
    expect(perch.nodeId).toBe('scripted-1');

    await waitFor(() => heartbeats(hub.calls).length >= 2, 'two heartbeats');
    for (const call of heartbeats(hub.calls)) {
      expect(call.token).toBe(TEST_CODE);
      expect(call.body.nodeId).toBe('scripted-1');
    }
  });

  test('re-registers when the hub answers 404 (hub restarted)', async () => {
    const hub = createHubFetch((call, index) =>
      call.path === '/api/flock/heartbeat' && index === 1 ? '404' : 'ok',
    );
    const perch = await launch(baseOptions({ hub: 'http://hub.test', code: TEST_CODE, fetch: hub.fetch }));

    await waitFor(() => registrations(hub.calls).length >= 2, 'a second registration');
    await waitFor(() => perch.nodeId === 'scripted-2', 'the new node id');
    expect(registrations(hub.calls)).toHaveLength(2);
  });

  test('backs off while the hub is unreachable, then recovers', async () => {
    const hub = createHubFetch((_call, index) => (index < 3 ? 'throw' : 'ok'));
    const started = performance.now();
    const perch = await launch(baseOptions({ hub: 'http://hub.test', code: TEST_CODE, fetch: hub.fetch }));

    // The first attempt failed inside startPerch; the loop keeps retrying in the background.
    expect(perch.nodeId).toBeUndefined();
    await waitFor(() => perch.nodeId !== undefined, 'registration after backoff', 2000);
    expect(perch.nodeId).toBe('scripted-1');
    expect(hub.calls.length).toBeGreaterThanOrEqual(4);
    expect(hub.calls.every((call) => call.token === TEST_CODE)).toBe(true);
    // 5 + 10 + 20 ms of backoff is the minimum before the fourth call.
    expect(performance.now() - started).toBeGreaterThanOrEqual(30);
  });

  test('a hub 500 is retried without losing the node id', async () => {
    const hub = createHubFetch((call, index) =>
      call.path === '/api/flock/heartbeat' && index === 1 ? '500' : 'ok',
    );
    const perch = await launch(baseOptions({ hub: 'http://hub.test', code: TEST_CODE, fetch: hub.fetch }));

    await waitFor(() => heartbeats(hub.calls).length >= 3, 'a heartbeat after the 500');
    expect(perch.nodeId).toBe('scripted-1');
    expect(registrations(hub.calls)).toHaveLength(1);
  });

  test('refuses to join without a code, and rejects a bad hub URL', async () => {
    let missing: unknown;
    try {
      await startPerch(baseOptions({ hub: 'http://hub.test', fetch: createHubFetch().fetch }));
    } catch (err) {
      missing = err;
    }
    expect(isStarlingError(missing, 'INVALID_ARGUMENT')).toBe(true);

    let badUrl: unknown;
    try {
      await startPerch(baseOptions({ hub: 'hub.test:7777', code: TEST_CODE }));
    } catch (err) {
      badUrl = err;
    }
    expect(isStarlingError(badUrl, 'INVALID_ARGUMENT')).toBe(true);
  });
});

describe('startPerch lifecycle', () => {
  test('stop sends an offline farewell, aborts sessions and closes the port', async () => {
    const hub = createHubFetch();
    const node = new MockNode({ id: 'perch-local' });
    const perch = await launch(
      baseOptions({
        hub: 'http://hub.test',
        code: TEST_CODE,
        fetch: hub.fetch,
        node,
        heartbeatMs: 1000,
      }),
    );

    const events: string[] = [];
    node.onEvent((event) => events.push(event.kind));
    const started = await fetch(`${perch.url}/perch/tasks`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(makeStartTaskOptions()),
    });
    expect(started.status).toBe(200);

    const beforeStop = hub.calls.length;
    await perch.stop();
    perches.splice(perches.indexOf(perch), 1);

    expect(events).toContain('session.error');
    const farewell = hub.calls.at(-1);
    expect(farewell?.path).toBe('/api/flock/heartbeat');
    expect(farewell?.body.info?.status).toBe('offline');

    // No further heartbeats after stop.
    await Bun.sleep(40);
    expect(hub.calls.length).toBeGreaterThanOrEqual(beforeStop);
    expect(hub.calls.length).toBe(beforeStop + 1);

    // The Perch API port is closed.
    let refused = false;
    try {
      await fetch(`${perch.url}/perch/info`, { headers: authHeaders() });
    } catch {
      refused = true;
    }
    expect(refused).toBe(true);
  });

  test('advertises _starling._tcp with the port and node name, and unpublishes on stop', async () => {
    const advertised: MdnsAdvertiseOptions[] = [];
    let stopped = 0;
    const mdns: MdnsAdvertiser = {
      advertise: (opts) => {
        advertised.push(opts);
      },
      stop: () => {
        stopped += 1;
      },
    };

    const hub = createHubFetch();
    const perch = await launch(
      baseOptions({ hub: 'http://hub.test', code: TEST_CODE, fetch: hub.fetch, mdns }),
    );

    expect(advertised).toHaveLength(1);
    const opts = advertised[0];
    expect(opts?.name).toBe('Test Perch');
    expect(opts?.type).toBe('_starling._tcp');
    expect(opts?.port).toBe(Number(new URL(perch.url).port));
    expect(opts?.txt?.node).toBe('Test Perch');
    // SEC-07: the join code is opt-in, so it is absent by default.
    expect(opts?.txt?.code).toBeUndefined();

    await perch.stop();
    perches.splice(perches.indexOf(perch), 1);
    expect(stopped).toBe(1);
  });

  test('publishes the join code only when advertiseCode is set', async () => {
    const advertised: MdnsAdvertiseOptions[] = [];
    const mdns: MdnsAdvertiser = {
      advertise: (opts) => {
        advertised.push(opts);
      },
      stop: () => undefined,
    };

    await launch(
      baseOptions({
        hub: 'http://hub.test',
        code: TEST_CODE,
        fetch: createHubFetch().fetch,
        mdns,
        advertiseCode: true,
      }),
    );

    expect(advertised).toHaveLength(1);
    expect(advertised[0]?.txt).toEqual({ code: TEST_CODE, node: 'Test Perch' });
  });

  test('a failing mDNS advertiser does not stop the perch', async () => {
    const mdns: MdnsAdvertiser = {
      advertise: () => {
        throw new Error('multicast is blocked');
      },
      stop: () => undefined,
    };
    const perch = await launch(
      baseOptions({ fetch: createHubFetch().fetch, mdns, hub: 'http://hub.test', code: TEST_CODE }),
    );
    expect(perch.url).toMatch(/^http:\/\//);
  });

  test('without a hub it still serves the API under a generated code', async () => {
    const hub = createHubFetch();
    const perch = await launch(baseOptions({ fetch: hub.fetch }));

    expect(hub.calls).toHaveLength(0);
    expect(perch.nodeId).toBeUndefined();

    const unauthorized = await fetch(`${perch.url}/perch/info`);
    expect(unauthorized.status).toBe(401);
    const guess = await fetch(`${perch.url}/perch/info`, { headers: { 'x-flock-token': TEST_CODE } });
    expect(guess.status).toBe(401);
  });

  test('stop is idempotent', async () => {
    const perch = await launch(baseOptions({ fetch: createHubFetch().fetch }));
    await perch.stop();
    await perch.stop();
    perches.splice(perches.indexOf(perch), 1);
    expect(true).toBe(true);
  });
});
