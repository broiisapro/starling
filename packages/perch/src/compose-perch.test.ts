import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockRunner, MockWorkspace } from '@starling/core/testing';
import { composePerch, expandHome, perchNodeId, perchStatusLine } from './compose-perch';
import { createHubFetch } from './test-helpers';

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function tempHome(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'starling-perch-compose-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

const osFacts = async () => ({
  hostname: 'm2-air.local',
  computerName: 'M2 Air',
  platform: 'darwin',
  arch: 'arm64',
  cpuCores: 8,
  memGb: 16,
});

describe('composePerch', () => {
  test('builds the daemon, registers with the hub and stops gracefully', async () => {
    const home = await tempHome();
    const hub = createHubFetch();
    const perch = await composePerch({
      hub: 'http://192.168.1.20:7777',
      code: 'TEST-CODE',
      name: 'M2 Air',
      maxSessions: 3,
      home,
      workspace: new MockWorkspace({ 'README.md': '# sky-todo\n' }),
      runner: new MockRunner(),
      mdns: false,
      fetch: hub.fetch as typeof fetch,
      os: osFacts,
      port: 0,
      publicHost: '127.0.0.1',
      lendModels: false,
    });
    cleanups.push(() => perch.stop());

    // One state root per perch name, under the configured cache dir.
    expect(perch.root).toBe(join(home, '.starling', 'perch', 'perch-m2-air'));
    expect((await stat(join(perch.root, 'worktrees'))).isDirectory()).toBe(true);
    expect(perch.node.id).toBe('perch-m2-air');
    expect(perch.name).toBe('M2 Air');
    expect(perch.statusLine()).toBe('🪺 roosting on M2 Air · 0/3 sessions');

    const register = hub.calls[0];
    expect(register?.path).toBe('/api/flock/register');
    expect(register?.token).toBe('TEST-CODE');
    expect(register?.body.info?.name).toBe('M2 Air');
    expect(register?.body.info?.maxSessions).toBe(3);
    expect(register?.body.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(perch.handle.nodeId).toBe('scripted-1');

    await perch.stop();
    const last = hub.calls.at(-1);
    expect(last?.path).toBe('/api/flock/heartbeat');
    expect(last?.body.info?.status).toBe('offline');
    // Idempotent: a second Ctrl-C does nothing.
    await perch.stop();
    expect(hub.calls.at(-1)?.path).toBe('/api/flock/heartbeat');
  });

  test('two perches on one laptop get separate roots, ids and ports', async () => {
    const home = await tempHome();
    const hub = createHubFetch();
    const make = (name: string, port: number) =>
      composePerch({
        hub: 'http://192.168.1.20:7777',
        code: 'TEST-CODE',
        name,
        home,
        maxSessions: 1,
        workspace: new MockWorkspace(),
        runner: new MockRunner(),
        mdns: false,
        fetch: hub.fetch as typeof fetch,
        os: osFacts,
        port,
        publicHost: '127.0.0.1',
        lendModels: false,
      });

    const first = await make('Loop One', 0);
    const second = await make('Loop Two', 0);
    cleanups.push(() => first.stop(), () => second.stop());

    expect(first.root).not.toBe(second.root);
    expect(first.node.id).not.toBe(second.node.id);
    expect(first.statusLine()).toContain('Loop One');
    expect(second.statusLine()).toContain('Loop Two');
    expect(hub.calls.filter((call) => call.path === '/api/flock/register')).toHaveLength(2);
  });
});

describe('helpers', () => {
  test('perchNodeId is a stable filesystem-safe id', () => {
    expect(perchNodeId('MacBook Pro')).toBe('perch-macbook-pro');
    expect(perchNodeId("  Moksh's M2 Air  ")).toBe('perch-moksh-s-m2-air');
    expect(perchNodeId('***')).toBe('perch-local');
  });

  test('expandHome only expands a leading tilde', () => {
    expect(expandHome('~/.starling/perch', '/home/x')).toBe('/home/x/.starling/perch');
    expect(expandHome('~', '/home/x')).toBe('/home/x');
    expect(expandHome('/var/starling', '/home/x')).toBe('/var/starling');
  });

  test('the status line says where it is roosting and how many slots are busy', () => {
    expect(perchStatusLine({ name: 'MacBook Pro', activeSessions: 2, maxSessions: 5 })).toBe(
      '🪺 roosting on MacBook Pro · 2/5 sessions · waiting for a hub',
    );
    expect(
      perchStatusLine({
        name: 'MacBook Pro',
        activeSessions: 0,
        maxSessions: 5,
        hub: 'http://192.168.1.20:7777',
      }),
    ).toBe('🪺 roosting on MacBook Pro · 0/5 sessions');
  });
});
