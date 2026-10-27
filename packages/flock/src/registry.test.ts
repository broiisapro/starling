import { describe, expect, test } from 'bun:test';
import { FakeClock } from '@starling/core';
import { MockNode, makeNodeInfo } from '@starling/core/testing';
import { createRegistry, type FlockRegistryEvent } from './registry.ts';

function fixture(offlineAfterMs = 15_000) {
  const clock = new FakeClock(1_000);
  const registry = createRegistry({ clock, offlineAfterMs, autoSweep: false });
  const events: FlockRegistryEvent[] = [];
  registry.onChange((event) => events.push(event));
  const node = new MockNode({ id: 'air', info: { kind: 'remote', name: 'M2 Air' } });
  const info = makeNodeInfo({ id: 'air', kind: 'remote', name: 'M2 Air', lastSeen: clock.now() });
  return { clock, registry, events, node, info };
}

describe('node registry', () => {
  test('adds a node, exposes it by id and announces it as joined', () => {
    const { registry, events, node, info } = fixture();
    const stored = registry.add(node, info);

    expect(stored.id).toBe('air');
    expect(registry.get('air')).toBe(node);
    expect(registry.list()).toHaveLength(1);
    expect(events).toEqual([{ type: 'joined', node: expect.objectContaining({ id: 'air' }) }]);
  });

  test('touch refreshes stats and stamps lastSeen from the clock', () => {
    const { registry, events, node, info, clock } = fixture();
    registry.add(node, info);
    clock.advance(1_000);
    const touched = registry.touch('air', { ...info, activeSessions: 3, status: 'busy', lastSeen: 0 });

    expect(touched?.activeSessions).toBe(3);
    expect(touched?.lastSeen).toBe(clock.now());
    expect(registry.list()[0]?.status).toBe('busy');
    expect(events.at(-1)?.type).toBe('stats');
    expect(registry.touch('nobody', info)).toBeUndefined();
  });

  test('remove forgets the node and emits left with a reason', () => {
    const { registry, events, node, info } = fixture();
    registry.add(node, info);
    registry.remove('air', 'shutdown');
    registry.remove('air');

    expect(registry.get('air')).toBeUndefined();
    expect(registry.list()).toEqual([]);
    const left = events.filter((event) => event.type === 'left');
    expect(left).toHaveLength(1);
    expect(left[0]?.reason).toBe('shutdown');
    expect(left[0]?.node.status).toBe('offline');
  });

  test('sweep marks a silent node offline and announces heartbeat-timeout', () => {
    const { registry, events, node, info, clock } = fixture(15_000);
    registry.add(node, info);

    clock.advance(14_000);
    expect(registry.sweep()).toEqual([]);

    clock.advance(2_000);
    expect(registry.sweep()).toEqual(['air']);
    expect(registry.list()[0]?.status).toBe('offline');
    expect(events.at(-1)).toMatchObject({
      type: 'left',
      reason: 'heartbeat-timeout',
      node: { id: 'air', status: 'offline', activeSessions: 0 },
    });

    // Idempotent: a second sweep does not re-announce the same timeout.
    expect(registry.sweep()).toEqual([]);
    expect(events.filter((event) => event.type === 'left')).toHaveLength(1);
  });

  test('a heartbeat revives a timed-out node instead of giving it a new id', () => {
    const { registry, events, node, info, clock } = fixture(1_000);
    registry.add(node, info);
    clock.advance(2_000);
    registry.sweep();

    clock.advance(100);
    const revived = registry.touch('air', { ...info, status: 'online', activeSessions: 1 });

    expect(revived?.status).toBe('online');
    expect(registry.list()).toHaveLength(1);
    expect(events.at(-1)?.type).toBe('joined');
    expect(events.at(-1)?.node.id).toBe('air');
  });

  test('the background timer sweeps on its own and close stops it', async () => {
    const clock = new FakeClock(0);
    const registry = createRegistry({ clock, offlineAfterMs: 10, tickMs: 5 });
    const events: FlockRegistryEvent[] = [];
    registry.onChange((event) => events.push(event));
    registry.add(new MockNode({ id: 'mini' }), makeNodeInfo({ id: 'mini', kind: 'remote', lastSeen: 0 }));

    clock.advance(50);
    await Bun.sleep(30);

    expect(events.some((event) => event.type === 'left' && event.reason === 'heartbeat-timeout')).toBe(true);
    registry.close();
    expect(registry.list()).toHaveLength(1);
  });
});
