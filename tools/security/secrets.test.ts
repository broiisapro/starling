/**
 * Probes: does the join code (the flock's only secret) leak into logs, error bodies, recordings or
 * the LAN's service-discovery records?
 *
 * The happy path is clean: the code travels in `x-flock-token`, request logs record the path but not
 * the query or headers, and an error response never echoes the supplied value. What is *not* clean is
 * mDNS: the perch publishes the join code in its TXT record so a hub can do zero-config discovery
 * (`packages/perch/src/perch-daemon.ts`). That turns "know the code" into "be on the Wi-Fi", which is
 * exactly what the token was for. The `test.failing` at the end asks for the code to be advertised
 * only when explicitly opted in (`--mdns-code`), or replaced by a separate discovery secret.
 *
 * `GET /api/flock/join` returning the code without a token is *not* a bug: ARCHITECTURE §6 makes it
 * the open route a perch reads before it has a token, and the dashboard renders it as a QR code. It is
 * asserted here so the tradeoff stays visible.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import type { MdnsAdvertiseOptions, StarlingEvent } from '../../packages/core/src/index.ts';
import { createEventBus } from '../../packages/core/src/index.ts';
import { MockNode } from '../../packages/core/src/testing/index.ts';
import { startPerch } from '../../packages/perch/src/index.ts';
import { makeHubHarness, PROBE_CODE, probeTempDir, removeDir, startProbeServer, wait } from './support.ts';

const harness = await makeHubHarness();
const server = startProbeServer({ flock: harness.hub });
const perchBus = createEventBus();
const perchEvents: StarlingEvent[] = [];
perchBus.subscribe((event) => perchEvents.push(event));
const advertised: MdnsAdvertiseOptions[] = [];

const perch = await startPerch({
  node: new MockNode({ id: 'probe-perch' }),
  hub: server.url,
  code: PROBE_CODE,
  port: 0,
  name: 'Probe Perch',
  publicHost: '127.0.0.1',
  heartbeatMs: 60_000,
  bus: perchBus,
  os: async () => ({
    hostname: 'probe-host',
    computerName: 'Probe Host',
    platform: 'darwin',
    arch: 'arm64',
    cpuCores: 8,
    memGb: 16,
  }),
  mdns: {
    advertise: (options) => {
      advertised.push(options);
    },
    stop: () => {},
  },
});

/** Exercise the join flow the way a real perch does: join info, register, heartbeat, bundle. */
async function runJoinFlow(): Promise<void> {
  const join = await fetch(`${server.url}/api/flock/join`);
  expect(join.status).toBe(200);
  await fetch(`${server.url}/api/flock/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-flock-token': PROBE_CODE },
    body: JSON.stringify({
      url: 'http://127.0.0.1:1',
      info: {
        id: 'probe-flow',
        name: 'Probe Flow',
        kind: 'remote',
        platform: 'darwin',
        arch: 'arm64',
        cpuCores: 8,
        memGb: 16,
        maxSessions: 4,
        activeSessions: 0,
        localModels: [],
        status: 'online',
        lastSeen: Date.now(),
      },
    }),
  });
  await fetch(`${server.url}/api/flock/bundle?ref=main`, {
    headers: { 'x-flock-token': PROBE_CODE },
  });
  await wait(100);
}

const secretsDir = await probeTempDir('secrets-jsonl');
const tokenJsonl = join(secretsDir, 'events.jsonl');
await runJoinFlow();

afterAll(async () => {
  await perch.stop();
  server.stop();
  await harness.close();
  await removeDir(secretsDir);
});

function allRecordedText(): string {
  server.store.exportJsonl('*', tokenJsonl);
  const events = server.store
    .events('*')
    .map((event) => JSON.stringify(event))
    .join('\n');
  return events;
}

describe('secret leakage', () => {
  test('the join code never appears in the recorded event log', async () => {
    const text = allRecordedText();
    expect(text).not.toContain(PROBE_CODE);
    expect(text).not.toContain('x-flock-token');
  });

  test('perch lifecycle logs do not contain the join code', () => {
    expect(perchEvents.length).toBeGreaterThan(0);
    const text = perchEvents.map((event) => JSON.stringify(event)).join('\n');
    expect(text).not.toContain(PROBE_CODE);
  });

  test('an authentication failure does not echo the supplied token', async () => {
    const response = await fetch(`${server.url}/api/flock/bundle?ref=main`, {
      headers: { 'x-flock-token': `${PROBE_CODE}-WRONG-SUFFIX` },
    });
    const body = await response.text();
    expect(response.status).toBe(401);
    expect(body).not.toContain('WRONG-SUFFIX');
  });

  test('the recorded JSONL is parseable event-per-line, no headers smuggled in', async () => {
    server.store.exportJsonl('*', tokenJsonl);
    const text = await Bun.file(tokenJsonl).text();
    for (const line of text.split('\n').filter((value) => value.trim() !== '')) {
      const parsed = JSON.parse(line) as StarlingEvent;
      expect(parsed.type).toBeString();
      expect(JSON.stringify(parsed.payload)).not.toContain(PROBE_CODE);
    }
  });

  test('GET /api/flock/join is open by design (the pre-token route)', async () => {
    const response = await fetch(`${server.url}/api/flock/join`);
    const body = (await response.json()) as { code: string; hubUrl: string; command: string };
    expect(response.status).toBe(200);
    expect(body.code).toBe(PROBE_CODE);
    // Impact: anyone who can reach the hub over the LAN can read the code here, or read it from the
    // QR the dashboard renders. That is the documented LAN-trust decision, not a regression.
    expect(body.command).toContain('starling perch');
  });

  test('does not publish the join code in the mDNS TXT record by default', () => {
    expect(advertised.length).toBe(1);
    const txt = advertised[0]?.txt ?? {};
    expect(JSON.stringify(txt)).not.toContain(PROBE_CODE);
  });
});
