import { describe, expect, test } from 'bun:test';
import { makeNodeInfo, makeTaskSpec } from './factories';
import { MockScheduler } from './mock-scheduler';

const task = makeTaskSpec();

describe('MockScheduler', () => {
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
