import { describe, expect, test } from 'bun:test';
import { makeNodeInfo } from './factories';
import { MockNode } from './mock-node';
import { MockRegistry, type MockRegistryEvent } from './mock-registry';

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
