import { describe, expect, test } from 'bun:test';
import { makeNodeInfo } from '@starling/core/testing';
import { availableSlots, dispatchableNodes } from './nodes';

const hub = makeNodeInfo({ id: 'hub', kind: 'local', maxSessions: 8, activeSessions: 5 });
const air = makeNodeInfo({ id: 'air', kind: 'remote', maxSessions: 5, activeSessions: 0, status: 'online' });
const gone = makeNodeInfo({ id: 'gone', kind: 'remote', maxSessions: 5, status: 'offline' });

describe('dispatchableNodes', () => {
  test('drops offline and excluded nodes', () => {
    const nodes = dispatchableNodes([hub, air, gone], {}, new Set(['air']));
    expect(nodes.map((node) => node.id)).toEqual(['hub']);
  });

  test('treats the engine own assignments as authoritative', () => {
    const nodes = dispatchableNodes([hub], { hub: 3 });
    expect(nodes[0]?.activeSessions).toBe(3);
  });

  test('does not mutate the registry snapshot', () => {
    dispatchableNodes([hub], { hub: 7 });
    expect(hub.activeSessions).toBe(5);
  });

  test('offline nodes contribute no slots', () => {
    expect(availableSlots([hub, air, gone], { hub: 2 })).toBe(6 + 5);
  });

  test('a full node contributes zero slots', () => {
    expect(availableSlots([hub], { hub: 8 })).toBe(0);
    expect(availableSlots([hub], { hub: 12 })).toBe(0);
  });
});
