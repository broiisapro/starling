import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exec, FakeClock, type StarlingError } from '@starling/core';
import { makeNodeInfo } from '@starling/core/testing';
import { createFlockHub } from './hub.ts';
import type { DiscoveredPerch, MdnsBrowser } from './mdns.ts';
import { createRegistry, type FlockRegistryEvent } from './registry.ts';

const temps: string[] = [];
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'starling-flock-hub-'));
  temps.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function fixture(code = 'K7QM-3XPH') {
  const clock = new FakeClock(10_000);
  const registry = createRegistry({ clock, offlineAfterMs: 15_000, autoSweep: false });
  const events: FlockRegistryEvent[] = [];
  registry.onChange((event) => events.push(event));
  return { clock, registry, events, code };
}

describe('FlockHub', () => {
  test('prints a join command and verifies the code in any reasonable spelling', async () => {
    const { clock, registry, code } = fixture();
    const hub = createFlockHub({
      registry,
      hubUrl: 'http://192.168.1.10:7777',
      code,
      bundleDir: await tempDir(),
      clock,
    });

    expect(hub.code).toBe('K7QM3XPH');
    expect(hub.joinInfo()).toEqual({
      code: 'K7QM-3XPH',
      hubUrl: 'http://192.168.1.10:7777',
      command: 'starling perch --hub http://192.168.1.10:7777 --code K7QM-3XPH',
    });
    expect(hub.verifyToken('K7QM-3XPH')).toBe(true);
    expect(hub.verifyToken('k7qm3xph')).toBe(true);
    expect(hub.verifyToken('K7QM-3XPJ')).toBe(false);
    expect(hub.verifyToken(undefined)).toBe(false);
    await hub.close();
  });

  test('generates a random code when none is supplied', async () => {
    const { clock, registry } = fixture();
    const hub = createFlockHub({ registry, hubUrl: 'http://hub:7777', bundleDir: await tempDir(), clock });
    expect(hub.joinInfo().code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(hub.verifyToken(hub.joinInfo().code)).toBe(true);
    await hub.close();
  });

  test('register adds a RemoteNode once and heartbeat refreshes its stats', async () => {
    const { clock, registry, events, code } = fixture();
    const hub = createFlockHub({
      registry,
      hubUrl: 'http://hub:7777',
      code,
      bundleDir: await tempDir(),
      clock,
    });
    const info = makeNodeInfo({ id: 'air', kind: 'remote', name: 'M2 Air', maxSessions: 5, lastSeen: 0 });

    const first = await hub.register({ url: 'http://10.0.0.5:7778', info });
    const again = await hub.register({ url: 'http://10.0.0.5:7778', info });
    expect(first).toEqual({ nodeId: 'air' });
    expect(again).toEqual({ nodeId: 'air' });
    expect(registry.list()).toHaveLength(1);
    expect(registry.list()[0]).toMatchObject({ id: 'air', kind: 'remote', url: 'http://10.0.0.5:7778' });
    expect(registry.get('air')).toBeDefined();
    expect(events.filter((event) => event.type === 'joined')).toHaveLength(1);

    clock.advance(3_000);
    hub.heartbeat({ nodeId: 'air', info: { ...info, activeSessions: 2, status: 'busy' } });
    expect(registry.list()[0]).toMatchObject({ activeSessions: 2, status: 'busy', lastSeen: 13_000 });
    expect(events.at(-1)?.type).toBe('stats');
    await hub.close();
  });

  test('a heartbeat with status offline is an immediate leave, not a 15 s timeout', async () => {
    const { clock, registry, events, code } = fixture();
    const hub = createFlockHub({
      registry,
      hubUrl: 'http://hub:7777',
      code,
      bundleDir: await tempDir(),
      clock,
    });
    const info = makeNodeInfo({ id: 'air', kind: 'remote', name: 'M2 Air', lastSeen: 0 });
    await hub.register({ url: 'http://10.0.0.5:7778', info });
    expect(registry.get('air')).toBeDefined();

    // This is exactly what `startPerch.stop()` sends: one last heartbeat with status offline.
    hub.heartbeat({ nodeId: 'air', info: { ...info, status: 'offline' } });

    expect(registry.list()).toHaveLength(0);
    expect(events.at(-1)).toMatchObject({ type: 'left', reason: 'perch-stopped' });
    expect(events.at(-1)?.node).toMatchObject({ id: 'air', status: 'offline', activeSessions: 0 });

    // A late offline heartbeat for an id we already forgot must not invent a node or throw.
    hub.heartbeat({ nodeId: 'ghost', info: { ...info, id: 'ghost', status: 'offline' } });
    expect(registry.list()).toHaveLength(0);
    await hub.close();
  });

  test('re-registering a perch at a new URL replaces the stale RemoteNode', async () => {
    const { clock, registry, events, code } = fixture();
    const hub = createFlockHub({
      registry,
      hubUrl: 'http://hub:7777',
      code,
      bundleDir: await tempDir(),
      clock,
    });
    const info = makeNodeInfo({ id: 'air', kind: 'remote', name: 'M2 Air', lastSeen: 0 });

    await hub.register({ url: 'http://10.0.0.5:7778', info });
    const firstNode = registry.get('air');
    await hub.register({ url: 'http://10.0.0.6:7778', info });

    expect(registry.list()).toHaveLength(1);
    expect(registry.list()[0]?.url).toBe('http://10.0.0.6:7778');
    expect(registry.get('air')).not.toBe(firstNode);
    expect(events.filter((event) => event.type === 'left')[0]?.reason).toBe('re-registered at a new url');
    await hub.close();
  });

  test('a heartbeat for an unknown node re-registers it when it says where it lives', async () => {
    const { clock, registry, code } = fixture();
    const hub = createFlockHub({
      registry,
      hubUrl: 'http://hub:7777',
      code,
      bundleDir: await tempDir(),
      clock,
    });
    const info = makeNodeInfo({ id: 'mini', kind: 'remote', url: 'http://10.0.0.9:7778' });

    hub.heartbeat({ nodeId: 'mini', info });
    await Bun.sleep(20);

    expect(registry.list().map((node) => node.id)).toEqual(['mini']);
    await hub.close();
  });

  test('discover only registers perches that answer /perch/info with our code', async () => {
    const { clock, registry, code } = fixture();
    const seenTokens: Array<string | null> = [];
    const fetchFake = (async (input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      seenTokens.push(headers.get('x-flock-token'));
      const url = String(input);
      if (url.includes('10.0.0.5')) {
        return new Response(
          JSON.stringify(makeNodeInfo({ id: 'air', kind: 'remote', name: 'M2 Air', lastSeen: 0 })),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('{}', { status: 401 });
    }) as typeof fetch;
    const hub = createFlockHub({
      registry,
      hubUrl: 'http://hub:7777',
      code,
      bundleDir: await tempDir(),
      clock,
      fetch: fetchFake,
    });
    const perch: DiscoveredPerch = { name: 'M2 Air', host: '10.0.0.5', port: 7778, txt: {} };
    const stranger: DiscoveredPerch = { name: 'other hub', host: '10.0.0.7', port: 7778, txt: {} };

    expect(await hub.discover(stranger)).toBeUndefined();
    expect(await hub.discover(perch)).toBe('air');
    expect(registry.list()[0]).toMatchObject({ id: 'air', url: 'http://10.0.0.5:7778' });
    expect(seenTokens.every((token) => token === 'K7QM3XPH')).toBe(true);
    await hub.close();
  });

  test('mDNS discovery is wired in and torn down on close', async () => {
    const { clock, registry, code } = fixture();
    let onFound: ((perch: DiscoveredPerch) => void) | undefined;
    let browseStopped = false;
    let closed = false;
    const browser: MdnsBrowser = {
      browse(fn) {
        onFound = fn;
        return () => {
          browseStopped = true;
        };
      },
      close() {
        closed = true;
      },
    };
    const fetchFake = (async () =>
      new Response(JSON.stringify(makeNodeInfo({ id: 'air2', kind: 'remote', lastSeen: 0 })), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch;
    const hub = createFlockHub({
      registry,
      hubUrl: 'http://hub:7777',
      code,
      bundleDir: await tempDir(),
      clock,
      mdns: browser,
      fetch: fetchFake,
    });

    expect(onFound).toBeDefined();
    onFound?.({ name: 'Air', host: '127.0.0.1', port: 7778, txt: {} });
    for (let i = 0; i < 50 && registry.list().length === 0; i += 1) await Bun.sleep(5);
    expect(registry.list().map((node) => node.id)).toEqual(['air2']);

    await hub.close();
    expect(browseStopped).toBe(true);
    expect(closed).toBe(true);
  });

  test('bundle(ref) creates one git bundle per sha and rejects unknown refs or no repo', async () => {
    const { clock, registry, code } = fixture();
    const repo = await tempDir();
    const bundleDir = await tempDir();
    await exec(['git', 'init', '-b', 'main'], { cwd: repo });
    await writeFile(join(repo, 'README.md'), '# sky-todo\n');
    await exec(['git', 'add', '-A'], { cwd: repo });
    await exec(
      ['git', '-c', 'user.name=Starling Test', '-c', 'user.email=test@localhost', 'commit', '-m', 'init'],
      {
        cwd: repo,
      },
    );
    const hub = createFlockHub({ registry, hubUrl: 'http://hub:7777', code, bundleDir, clock });

    const noRepo = await hub.bundle('main').catch((err: unknown) => err);
    expect((noRepo as StarlingError).code).toBe('INVALID_ARGUMENT');

    hub.setActiveRepo(repo);
    const first = await hub.bundle('main');
    const second = await hub.bundle('main');
    expect(first.path).toBe(second.path);
    expect(first.path.startsWith(bundleDir)).toBe(true);
    expect(await Bun.file(first.path).exists()).toBe(true);
    expect((await Bun.file(first.path).size) ?? 0).toBeGreaterThan(0);

    const missing = await hub.bundle('does-not-exist').catch((err: unknown) => err);
    expect((missing as StarlingError).code).toBe('EXEC_FAILED');
    await hub.close();
  });
});
