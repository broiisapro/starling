import { afterEach, describe, expect, test } from 'bun:test';
import { FakeClock } from '@starling/core';
import { MockNode } from '@starling/core/testing';
import { nextHeartbeatDelay, normalizeJitter, PERCH_HEARTBEAT_JITTER } from './heartbeat';
import { type PerchHandle, startPerch } from './perch-daemon';
import type { OsFacts } from './perch-info';
import { createHubFetch, type HubCall, TEST_CODE, waitFor } from './test-helpers';

/**
 * Heartbeat jitter: ten perches booting together must not hit the hub in lockstep. `random` is
 * injected, so every expectation here is exact rather than statistical.
 */

const FACTS: OsFacts = {
  hostname: 'air.local',
  computerName: 'Jitter Perch',
  platform: 'darwin',
  arch: 'arm64',
  cpuCores: 8,
  memGb: 16,
};

const running: PerchHandle[] = [];

afterEach(async () => {
  for (const perch of running.splice(0)) await perch.stop();
});

describe('nextHeartbeatDelay', () => {
  test('spreads symmetrically around the nominal period', () => {
    expect(nextHeartbeatDelay({ heartbeatMs: 3000, jitter: 0.1, random: () => 0 })).toBe(2700);
    expect(nextHeartbeatDelay({ heartbeatMs: 3000, jitter: 0.1, random: () => 0.5 })).toBe(3000);
    expect(nextHeartbeatDelay({ heartbeatMs: 3000, jitter: 0.1, random: () => 1 })).toBe(3300);
  });

  test('defaults to ±10%', () => {
    expect(PERCH_HEARTBEAT_JITTER).toBe(0.1);
    expect(nextHeartbeatDelay({ heartbeatMs: 1000, random: () => 0 })).toBe(900);
    expect(nextHeartbeatDelay({ heartbeatMs: 1000, random: () => 1 })).toBe(1100);
  });

  test('jitter 0 keeps the period exact whatever `random` says', () => {
    for (const random of [0, 0.25, 0.5, 0.99]) {
      expect(nextHeartbeatDelay({ heartbeatMs: 3000, jitter: 0, random: () => random })).toBe(3000);
    }
  });

  test('jitter 1 spans the whole period down to zero', () => {
    expect(nextHeartbeatDelay({ heartbeatMs: 3000, jitter: 1, random: () => 0 })).toBe(0);
    expect(nextHeartbeatDelay({ heartbeatMs: 3000, jitter: 1, random: () => 1 })).toBe(6000);
  });

  test('rounds to whole milliseconds and keeps a fractional period stable', () => {
    expect(nextHeartbeatDelay({ heartbeatMs: 333, jitter: 0.1, random: () => 0 })).toBe(300);
    expect(nextHeartbeatDelay({ heartbeatMs: 333, jitter: 0.1, random: () => 1 })).toBe(366);
  });

  test('a seeded sequence stays inside the jitter band', () => {
    // A tiny deterministic LCG: the point is that the same seed gives the same delays.
    let seed = 42;
    const random = (): number => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const delays = Array.from({ length: 50 }, () =>
      nextHeartbeatDelay({ heartbeatMs: 3000, jitter: 0.1, random }),
    );
    expect(new Set(delays).size).toBeGreaterThan(10);
    expect(Math.min(...delays)).toBeGreaterThanOrEqual(2700);
    expect(Math.max(...delays)).toBeLessThanOrEqual(3300);
  });

  test('guards against nonsense inputs', () => {
    expect(nextHeartbeatDelay({ heartbeatMs: 1000, jitter: Number.NaN, random: () => 0 })).toBe(1000);
    expect(nextHeartbeatDelay({ heartbeatMs: 1000, jitter: -1, random: () => 0 })).toBe(1000);
    expect(nextHeartbeatDelay({ heartbeatMs: -5, random: () => 0 })).toBe(0);
    // Clamped, not extrapolated: `random` outside [0, 1] cannot produce a negative delay.
    expect(nextHeartbeatDelay({ heartbeatMs: 1000, jitter: 0.1, random: () => -5 })).toBe(900);
    expect(nextHeartbeatDelay({ heartbeatMs: 1000, jitter: 0.1, random: () => 5 })).toBe(1100);
  });

  test('normalizeJitter clamps into [0, 1]', () => {
    expect(normalizeJitter(undefined)).toBe(0);
    expect(normalizeJitter(0)).toBe(0);
    expect(normalizeJitter(0.25)).toBe(0.25);
    expect(normalizeJitter(4)).toBe(1);
    expect(normalizeJitter(Number.NaN)).toBe(0);
    expect(normalizeJitter(-0.5)).toBe(0);
  });
});

const heartbeats = (calls: HubCall[]): HubCall[] =>
  calls.filter((call) => call.path === '/api/flock/heartbeat');

describe('the daemon uses a jittered period', () => {
  test('heartbeatMs 10 with jitter 0 still heartbeats on schedule', async () => {
    const hub = createHubFetch();
    const perch = await startPerch({
      node: new MockNode({ id: 'perch-local' }),
      hub: 'http://hub.test',
      code: TEST_CODE,
      fetch: hub.fetch,
      port: 0,
      publicHost: '127.0.0.1',
      name: 'Jitter Perch',
      lendModels: false,
      os: async () => FACTS,
      clock: new FakeClock(5000),
      heartbeatMs: 10,
      heartbeatJitter: 0,
    });
    running.push(perch);

    await waitFor(() => heartbeats(hub.calls).length >= 3, 'three heartbeats', 2000);
    expect(heartbeats(hub.calls).every((call) => call.body.nodeId === 'scripted-1')).toBe(true);
  });

  test('a seeded random source drives the actual schedule', async () => {
    const hub = createHubFetch();
    let calls = 0;
    const perch = await startPerch({
      node: new MockNode({ id: 'perch-local' }),
      hub: 'http://hub.test',
      code: TEST_CODE,
      fetch: hub.fetch,
      port: 0,
      publicHost: '127.0.0.1',
      name: 'Jitter Perch',
      lendModels: false,
      os: async () => FACTS,
      clock: new FakeClock(5000),
      heartbeatMs: 10,
      heartbeatJitter: 0.5,
      random: () => {
        calls += 1;
        return 0;
      },
    });
    running.push(perch);

    await waitFor(() => heartbeats(hub.calls).length >= 2, 'two heartbeats', 2000);
    // Register + the first heartbeat both drew from the injected source.
    expect(calls).toBeGreaterThanOrEqual(2);
  });
});
