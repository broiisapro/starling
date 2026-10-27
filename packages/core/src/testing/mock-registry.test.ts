import { describe, expect, test } from 'bun:test';
import { makeNodeInfo, makeTaskSpec } from './factories';
import { MockNode } from './mock-node';
import { MockRegistry, type MockRegistryEvent } from './mock-registry';
import { MockScheduler } from './mock-scheduler';

describe('MockRegistry', () => {
  test('add and remove emit joined/left changes', () => {
    const registry = new MockRegistry();
    const changes: MockRegistryEvent[] = [];
    registry.onChange((e) => changes.push(e));
    const node = new MockNode({ id: 'air' });
    const info = registry.addMockNode(node, { name: 'MacBook Air', maxSessions: 5 });
    expect(info.kind).toBe('remote');
    expect(registry.get('air')).toBe(node);
    expect(changes[0]?.type).toBe('joined');

    registry.remove('air');
    expect(registry.get('air')).toBeUndefined();
    expect(changes.at(-1)?.type).toBe('left');
    expect(changes.at(-1)?.node.status).toBe('offline');
  });

  test('update emits stats and replaces info', () => {
    const registry = new MockRegistry();
    const node = new MockNode({ id: 'hub' });
    registry.add(node, makeNodeInfo());
    const changes: MockRegistryEvent[] = [];
    registry.onChange((e) => changes.push(e));
    registry.update(makeNodeInfo({ activeSessions: 3 }));
    expect(changes).toEqual([{ type: 'stats', node: makeNodeInfo({ activeSessions: 3 }) }]);
    expect(registry.list()[0]?.activeSessions).toBe(3);
  });

  test('unsubscribe and unknown ids are harmless', () => {
    const registry = new MockRegistry();
    const changes: MockRegistryEvent[] = [];
    const unsub = registry.onChange((e) => changes.push(e));
    unsub();
    registry.add(new MockNode({ id: 'x' }));
    registry.remove('ghost');
    expect(changes).toHaveLength(0);
  });

  test('listing returns copies so callers cannot mutate registry state', () => {
    const registry = new MockRegistry();
    registry.add(new MockNode({ id: 'hub' }), makeNodeInfo());
    const list = registry.list();
    const first = list[0];
    if (first) first.name = 'hacked';
    expect(registry.list()[0]?.name).toBe('MacBook Pro');
  });
});

describe('MockScheduler', () => {
  const task = makeTaskSpec();

  test('picks the online node with the most free slots', () => {
    const scheduler = new MockScheduler();
    const hub = makeNodeInfo({ id: 'hub', maxSessions: 8, activeSessions: 2 });
    const air = makeNodeInfo({ id: 'air', maxSessions: 9, activeSessions: 0, latencyMs: 20 });
    expect(scheduler.pick([hub, air], task)).toBe('air');
  });

  test('tie-breaks on latency', () => {
    const scheduler = new MockScheduler();
    const hub = makeNodeInfo({ id: 'hub', maxSessions: 4, activeSessions: 0, latencyMs: 30 });
    const air = makeNodeInfo({ id: 'air', maxSessions: 4, activeSessions: 0, latencyMs: 5 });
    expect(scheduler.pick([hub, air], task)).toBe('air');
  });

  test('returns undefined when every node is full or offline', () => {
    const scheduler = new MockScheduler();
    expect(scheduler.pick([makeNodeInfo({ activeSessions: 8 })], task)).toBeUndefined();
    expect(scheduler.pick([makeNodeInfo({ status: 'offline', activeSessions: 0 })], task)).toBeUndefined();
    expect(scheduler.pick([], task)).toBeUndefined();
  });

  test('force pins a task to a node, and fails if the node is absent', () => {
    const scheduler = new MockScheduler({ force: { theme: 'air' } });
    const nodes = [makeNodeInfo({ id: 'hub' }), makeNodeInfo({ id: 'air' })];
    expect(scheduler.pick(nodes, task)).toBe('air');
    expect(scheduler.pick([makeNodeInfo({ id: 'hub' })], task)).toBeUndefined();
  });
});
