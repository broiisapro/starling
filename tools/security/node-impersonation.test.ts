/**
 * Probes: node identity in the flock roster.
 *
 * `NodeRegistry` keys on `NodeInfo.id` and the hub's own `LocalNode` is registered under the literal
 * id `'hub'` (ARCHITECTURE §6). `FlockHub.register` replaces any node whose id matches but whose URL
 * differs — a rule written for "the same perch restarted on a new port". Nothing reserves `'hub'`, so
 * a token holder can register *as the hub*:
 *
 *   POST /api/flock/register  { url: "http://attacker:1", info: { id: "hub", … } }
 *
 * The registry drops the real hub `LocalNode` and adds a `RemoteNode` under the same id. The
 * scheduler's tie-break "prefer the hub" now prefers the attacker, and every task the hub would have
 * run locally is dispatched there. `heartbeat` with `nodeId: "hub"` does not replace the node but does
 * rewrite its stats (`maxSessions`, `status`, `name`), which is enough to make the scheduler
 * oversubscribe the machine.
 *
 * The fixes are one line each in `packages/flock/src/hub.ts`: reject the reserved id `'hub'` (and any
 * id already owned by a local node) in `register`, and ignore a heartbeat for a node whose stored
 * `kind` is not `'remote'` unless it comes from that node's own registration.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { makeHubHarness, nodeInfo, PROBE_CODE, startProbeServer } from './support.ts';

const harness = await makeHubHarness();
const server = startProbeServer({ flock: harness.hub });

afterAll(async () => {
  server.stop();
  await harness.close();
});

function register(body: unknown): Promise<Response> {
  return fetch(`${server.url}/api/flock/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-flock-token': PROBE_CODE },
    body: JSON.stringify(body),
  });
}

function heartbeat(body: unknown): Promise<Response> {
  return fetch(`${server.url}/api/flock/heartbeat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-flock-token': PROBE_CODE },
    body: JSON.stringify(body),
  });
}

function hubEntry(): { kind: string; url?: string; maxSessions: number } | undefined {
  const entry = harness.registry.list().find((node) => node.id === 'hub');
  if (entry === undefined) return undefined;
  return {
    kind: entry.kind,
    ...(entry.url === undefined ? {} : { url: entry.url }),
    maxSessions: entry.maxSessions,
  };
}

describe('node identity', () => {
  test('a normal perch registers as a remote node', async () => {
    const response = await register({
      url: 'http://127.0.0.1:1',
      info: nodeInfo({ id: 'perch-normal', name: 'Normal Perch' }),
    });
    expect(response.status).toBe(201);
    expect(harness.registry.list().find((node) => node.id === 'perch-normal')?.kind).toBe('remote');
  });

  test.failing('refuses a registration that claims the reserved hub id', async () => {
    const response = await register({
      url: 'http://127.0.0.1:1',
      info: nodeInfo({ id: 'hub', name: 'Totally The Hub', kind: 'local', maxSessions: 99 }),
    });
    expect(response.status).toBe(409);
  });

  test.failing('keeps the real hub node after such a registration', () => {
    // Runs after the probe above: today the registry's `hub` is a RemoteNode pointing at the attacker.
    expect(hubEntry()).toEqual({ kind: 'local', maxSessions: 8 });
  });

  test.failing('refuses a heartbeat that rewrites the hub stats', async () => {
    const response = await heartbeat({
      nodeId: 'hub',
      info: nodeInfo({ id: 'hub', kind: 'local', name: 'Hijacked', maxSessions: 1000 }),
    });
    expect(response.status).toBe(400);
    expect(hubEntry()?.maxSessions).toBe(8);
  });

  test('does not allow the flock token to be bypassed by a forged node id', async () => {
    // The identity bugs above all require the join code. Without it, nothing registers.
    const response = await fetch(`${server.url}/api/flock/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'http://127.0.0.1:1', info: nodeInfo({ id: 'hub' }) }),
    });
    expect(response.status).toBe(401);
  });
});
