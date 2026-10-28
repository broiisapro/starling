import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NodeInfo } from '@starling/core';
import { FakeClock } from '@starling/core';
import { MockNode } from '@starling/core/testing';
import {
  buildPerchHealth,
  createPerchHealthProbes,
  formatBytes,
  PERCH_MIN_FREE_BYTES,
  type PerchHealthProbes,
  probeHub,
} from './health';
import { authHeaders, type PerchHarness, startPerchApp, staticInfo } from './test-helpers';

const GIB = 1024 ** 3;

/** Fully green probes; a test overrides exactly the one probe it is about. */
function probes(overrides: Partial<PerchHealthProbes> = {}): PerchHealthProbes {
  return {
    draining: () => false,
    now: () => 10_000,
    git: () => ({ ok: true, detail: 'git version 2.45.0' }),
    runner: () => ({ ok: true, detail: 'perch-1 · online · 0/5 sessions' }),
    worktreeRoot: () => ({ ok: true, detail: '/tmp/worktrees is writable' }),
    freeBytes: () => 100 * GIB,
    sessions: () => ({ active: 1, max: 5 }),
    hub: () => ({ configured: true, heartbeatMs: 3000, lastOkAt: 9000 }),
    ...overrides,
  };
}

const running: PerchHarness[] = [];
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const harness of running.splice(0)) await harness.close();
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

describe('buildPerchHealth', () => {
  test('reports every check green as ok', async () => {
    const health = await buildPerchHealth(probes());
    expect(health.ok).toBe(true);
    expect(health.status).toBe('ok');
    expect(health.checks.map((check) => check.name)).toEqual([
      'git',
      'runner',
      'worktreeRoot',
      'disk',
      'sessions',
      'hub',
    ]);
    expect(health.checks.every((check) => check.ok)).toBe(true);
    expect(health.checks.find((check) => check.name === 'disk')?.detail).toContain('GiB free');
  });

  test('a disk under 2 GiB is degraded', async () => {
    const health = await buildPerchHealth(probes({ freeBytes: () => PERCH_MIN_FREE_BYTES - 1 }));
    expect(health.ok).toBe(false);
    expect(health.status).toBe('degraded');
    const disk = health.checks.find((check) => check.name === 'disk');
    expect(disk?.ok).toBe(false);
    expect(disk?.detail).toContain('free (minimum 2.0 GiB)');
  });

  test('exactly the minimum free space is still healthy', async () => {
    const health = await buildPerchHealth(probes({ freeBytes: () => PERCH_MIN_FREE_BYTES }));
    expect(health.checks.find((check) => check.name === 'disk')?.ok).toBe(true);
  });

  test('a heartbeat older than three intervals is degraded', async () => {
    const stale = await buildPerchHealth(
      probes({ now: () => 40_000, hub: () => ({ configured: true, heartbeatMs: 3000, lastOkAt: 1000 }) }),
    );
    expect(stale.status).toBe('degraded');
    expect(stale.checks.find((check) => check.name === 'hub')?.detail).toContain('stale after 9000 ms');

    const fresh = await buildPerchHealth(
      probes({ now: () => 10_000, hub: () => ({ configured: true, heartbeatMs: 3000, lastOkAt: 1000 }) }),
    );
    expect(fresh.checks.find((check) => check.name === 'hub')?.ok).toBe(true);
  });

  test('a perch that never reached its hub is degraded, not silent', async () => {
    const health = await buildPerchHealth(probes({ hub: () => ({ configured: true, heartbeatMs: 3000 }) }));
    expect(health.status).toBe('degraded');
    expect(health.checks.find((check) => check.name === 'hub')?.detail).toBe('no successful heartbeat yet');
  });

  test('an mDNS-only perch has no hub check to fail', async () => {
    const health = await buildPerchHealth(probes({ hub: () => ({ configured: false, heartbeatMs: 3000 }) }));
    expect(health.ok).toBe(true);
    expect(health.checks.find((check) => check.name === 'hub')?.detail).toContain('mDNS only');
  });

  test('a throwing probe is a failed check, never a failed report', async () => {
    const health = await buildPerchHealth(
      probes({
        git: () => {
          throw new Error('git is not installed');
        },
      }),
    );
    expect(health.status).toBe('degraded');
    const git = health.checks.find((check) => check.name === 'git');
    expect(git?.ok).toBe(false);
    expect(git?.detail).toBe('probe failed: git is not installed');
    expect(health.checks.filter((check) => check.name !== 'git').every((check) => check.ok)).toBe(true);
  });

  test('a dead runner is degraded', async () => {
    const health = await buildPerchHealth(
      probes({
        runner: async () => {
          throw new Error('opencode serve refused the connection');
        },
      }),
    );
    expect(health.checks.find((check) => check.name === 'runner')?.ok).toBe(false);
  });

  test('a full perch is not unhealthy: every slot in use is fine', async () => {
    const health = await buildPerchHealth(probes({ sessions: () => ({ active: 5, max: 5 }) }));
    expect(health.ok).toBe(true);
    expect(health.checks.find((check) => check.name === 'sessions')?.detail).toBe('5/5 sessions');
  });

  test('a draining perch is never "ok" even when every check passes', async () => {
    const health = await buildPerchHealth(probes({ draining: () => true }));
    expect(health.ok).toBe(false);
    expect(health.status).toBe('draining');
    expect(health.checks.every((check) => check.ok)).toBe(true);
  });
});

describe('probeHub', () => {
  test('treats the age boundary as inclusive and clamps a future timestamp', () => {
    expect(probeHub({ configured: true, heartbeatMs: 1000, lastOkAt: 6000 }, 9000).ok).toBe(true);
    expect(probeHub({ configured: true, heartbeatMs: 1000, lastOkAt: 5999 }, 9000).ok).toBe(false);
    expect(probeHub({ configured: true, heartbeatMs: 1000, lastOkAt: 12_000 }, 10_000).ok).toBe(true);
  });
});

describe('formatBytes', () => {
  test('prints a human-scale figure', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KiB');
    expect(formatBytes(5 * 1024 ** 2)).toBe('5.0 MiB');
    expect(formatBytes(2 * GIB)).toBe('2.0 GiB');
    expect(formatBytes(Number.NaN)).toBe('0 B');
  });
});

describe('createPerchHealthProbes', () => {
  const node = new MockNode({ id: 'perch-1', info: { maxSessions: 5 } });
  const clock = new FakeClock(20_000);

  test('reads the git version through the injected exec', async () => {
    const calls: string[][] = [];
    const healthProbes = createPerchHealthProbes({
      node,
      heartbeatMs: 1000,
      hubConfigured: true,
      lastHeartbeatOkAt: () => 19_000,
      draining: () => false,
      now: () => clock.now(),
      freeBytes: async () => 50 * GIB,
      exec: async (cmd) => {
        calls.push(cmd);
        return { code: 0, stdout: 'git version 2.45.0\n', stderr: '', durationMs: 1 };
      },
    });

    const health = await buildPerchHealth(healthProbes);
    expect(calls[0]).toEqual(['git', '--version']);
    expect(health.checks.find((check) => check.name === 'git')?.detail).toBe('git version 2.45.0');
    expect(health.checks.find((check) => check.name === 'disk')?.detail).toContain('GiB free');
    expect(health.checks.find((check) => check.name === 'sessions')?.detail).toBe('0/5 sessions');
    expect(health.ok).toBe(true);
  });

  test('reports a failing git command with its stderr', async () => {
    const healthProbes = createPerchHealthProbes({
      node,
      heartbeatMs: 1000,
      hubConfigured: false,
      lastHeartbeatOkAt: () => undefined,
      draining: () => false,
      now: () => clock.now(),
      freeBytes: async () => 50 * GIB,
      exec: async () => ({ code: 127, stdout: '', stderr: 'git: command not found', durationMs: 1 }),
    });
    const health = await buildPerchHealth(healthProbes);
    const git = health.checks.find((check) => check.name === 'git');
    expect(git?.ok).toBe(false);
    expect(git?.detail).toBe('git: command not found');
  });

  test('probes the worktree root when one is configured', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'starling-perch-health-'));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    const base = {
      node,
      heartbeatMs: 1000,
      hubConfigured: false,
      lastHeartbeatOkAt: () => undefined,
      draining: () => false,
      now: () => clock.now(),
      freeBytes: async () => 50 * GIB,
      exec: async () => ({ code: 0, stdout: 'git version 2.45.0\n', stderr: '', durationMs: 1 }),
    };

    const writable = await buildPerchHealth(createPerchHealthProbes({ ...base, worktreeRoot: dir }));
    expect(writable.checks.find((check) => check.name === 'worktreeRoot')?.detail).toBe(`${dir} is writable`);

    const missing = await buildPerchHealth(
      createPerchHealthProbes({ ...base, worktreeRoot: join(dir, 'nope') }),
    );
    expect(missing.checks.find((check) => check.name === 'worktreeRoot')?.ok).toBe(false);

    const unconfigured = await buildPerchHealth(createPerchHealthProbes(base));
    const check = unconfigured.checks.find((entry) => entry.name === 'worktreeRoot');
    expect(check?.ok).toBe(true);
    expect(check?.detail).toContain('nothing to check');
  });
});

describe('GET /perch/health', () => {
  function app(overrides: Partial<PerchHealthProbes> = {}): PerchHarness {
    const started = startPerchApp({
      info: staticInfo({ activeSessions: 1 }),
      health: probes(overrides),
    });
    running.push(started);
    return started;
  }

  test('answers 200 with every check when healthy', async () => {
    const { url } = app();
    const res = await fetch(`${url}/perch/health`, { headers: authHeaders() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; status: string; checks: { name: string }[] };
    expect(body.ok).toBe(true);
    expect(body.status).toBe('ok');
    expect(body.checks.map((check) => check.name)).toContain('hub');
  });

  test('answers 503 when a check fails', async () => {
    const { url } = app({ freeBytes: () => 1024 });
    const res = await fetch(`${url}/perch/health`, { headers: authHeaders() });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { ok: boolean; status: string };
    expect(body.ok).toBe(false);
    expect(body.status).toBe('degraded');
  });

  test('answers 503 while draining', async () => {
    const { url, app: perchApp } = app();
    perchApp.setDraining(true);
    const res = await fetch(`${url}/perch/health`, { headers: authHeaders() });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { status: string }).status).toBe('draining');
  });

  test('is token-guarded', async () => {
    const { url } = app();
    const res = await fetch(`${url}/perch/health`);
    expect(res.status).toBe(401);
  });

  test('an app started without probes says so instead of lying', async () => {
    // `startPerchApp` without `health` is the bare embedding case.
    const started = startPerchApp({ info: staticInfo() as () => Promise<NodeInfo> });
    running.push(started);
    const res = await fetch(`${started.url}/perch/health`, { headers: authHeaders() });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('health-unavailable');
  });
});
