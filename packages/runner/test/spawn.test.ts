import { afterEach, describe, expect, test } from 'bun:test';
import { StarlingError } from '@starling/core';
import type { OpencodeRunner } from '../src';
import { createOpencodeRunner } from '../src';
import { textStream } from './helpers';

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    if (cleanup !== undefined) await cleanup();
  }
});

interface SpawnCall {
  cmd: string[];
  options: { env?: Record<string, string | undefined> };
}

function fakeSpawn(options: { stdout?: string; stderr?: string; exitCode?: number; neverExit?: boolean }) {
  const calls: SpawnCall[] = [];
  const killed: string[] = [];
  let resolveExit: (code: number) => void = () => {};
  const exited = new Promise<number>((resolve) => {
    resolveExit = resolve;
  });

  const spawn = ((cmd: string[], spawnOptions: SpawnCall['options']) => {
    calls.push({ cmd, options: spawnOptions });
    if (options.exitCode !== undefined) {
      setTimeout(() => resolveExit(options.exitCode ?? 0), 5);
    }
    return {
      stdout: textStream(options.stdout ?? ''),
      stderr: textStream(options.stderr ?? ''),
      exited,
      kill: (signal?: string | number) => {
        killed.push(String(signal));
        resolveExit(0);
      },
    };
  }) as unknown as typeof Bun.spawn;

  return { spawn, calls, killed, exited };
}

function infoFetch(override?: (url: string) => Response | undefined): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0]) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const custom = override?.(url);
    if (custom !== undefined) return custom;
    if (url.endsWith('/api/info')) {
      return new Response(JSON.stringify({ version: 'fake', pid: 1, urls: [], paths: { tmp: '/tmp' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('', { status: 404 });
  }) as typeof fetch;
}

function runnerWith(options: Parameters<typeof createOpencodeRunner>[0]): OpencodeRunner {
  const runner = createOpencodeRunner(options);
  cleanups.push(() => runner.close());
  return runner;
}

describe('spawn mode', () => {
  test('starts opencode serve with the password in its environment and shuts it down', async () => {
    const fake = fakeSpawn({ stdout: 'server listening on http://127.0.0.1:4567\n' });
    const runner = runnerWith({
      mode: 'spawn',
      port: 4567,
      password: 'secret',
      standalone: true,
      spawn: fake.spawn,
      fetch: infoFetch(),
      startupTimeoutMs: 1_000,
      healthPollMs: 5,
    });

    expect(runner.url()).toBe('http://127.0.0.1:4567');
    expect(await runner.health()).toBe(true);

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.cmd).toEqual(['opencode', 'serve', '--port', '4567', '--hostname', '127.0.0.1']);
    expect(fake.calls[0]?.options.env?.OPENCODE_SERVER_PASSWORD).toBe('secret');

    await runner.close();
    expect(fake.killed).toContain('SIGTERM');
  });

  test('generates a password when none is configured', async () => {
    const fake = fakeSpawn({ stdout: 'server listening on http://127.0.0.1:4568\n' });
    const runner = runnerWith({
      mode: 'spawn',
      port: 4568,
      spawn: fake.spawn,
      fetch: infoFetch(),
      startupTimeoutMs: 1_000,
      healthPollMs: 5,
    });
    expect(await runner.health()).toBe(true);
    const password = fake.calls[0]?.options.env?.OPENCODE_SERVER_PASSWORD;
    expect(typeof password).toBe('string');
    expect(password?.length).toBeGreaterThan(10);
    await runner.close();
  });

  test('surfaces a server that exits during startup', async () => {
    const fake = fakeSpawn({ stdout: 'boom\n', stderr: 'cannot bind\n', exitCode: 1 });
    const runner = runnerWith({
      mode: 'spawn',
      port: 4569,
      spawn: fake.spawn,
      fetch: infoFetch(),
      startupTimeoutMs: 1_000,
      healthPollMs: 5,
    });

    expect(await runner.health()).toBe(false);
    await expect(
      runner.start({
        runId: 'r',
        taskKey: 't',
        dir: '/tmp',
        prompt: 'hi',
        model: { provider: 'p', model: 'm' },
        title: 'T',
      }),
    ).rejects.toBeInstanceOf(StarlingError);
  });

  test('times out when the server never becomes healthy', async () => {
    const fake = fakeSpawn({ stdout: 'starting\n', neverExit: true });
    const runner = runnerWith({
      mode: 'spawn',
      port: 4570,
      spawn: fake.spawn,
      fetch: infoFetch(),
      startupTimeoutMs: 60,
      healthPollMs: 10,
    });

    expect(await runner.health()).toBe(false);
    await runner.close();
    expect(fake.killed.length).toBeGreaterThan(0);
  });
});

describe('attach mode', () => {
  test('never spawns a process and uses the given url', async () => {
    const spawn = (() => {
      throw new Error('attach mode must not spawn');
    }) as unknown as typeof Bun.spawn;

    const runner = runnerWith({
      mode: 'attach',
      url: 'http://127.0.0.1:9999/',
      password: 'pw',
      spawn,
      fetch: infoFetch(),
    });

    expect(runner.url()).toBe('http://127.0.0.1:9999');
    expect(await runner.health()).toBe(true);
  });
});
