import { describe, expect, test } from 'bun:test';
import { makeNodeInfo, makeTaskSpec } from '@starling/core/testing';
import { createScheduler, freeSlots, rankNodes } from './scheduler.ts';

const task = makeTaskSpec();

describe('capacity scheduler', () => {
  test('picks the online node with the most free session slots', () => {
    const nodes = [
      makeNodeInfo({ id: 'hub', kind: 'local', maxSessions: 8, activeSessions: 5 }),
      makeNodeInfo({ id: 'air', kind: 'remote', maxSessions: 5, activeSessions: 0 }),
      makeNodeInfo({ id: 'mini', kind: 'remote', maxSessions: 12, activeSessions: 10 }),
    ];
    expect(createScheduler().pick(nodes, task)).toBe('air');
    expect(freeSlots(nodes[1] as (typeof nodes)[number])).toBe(5);
  });

  test('ignores offline nodes even when they advertise free slots', () => {
    const nodes = [
      makeNodeInfo({ id: 'hub', kind: 'local', maxSessions: 2, activeSessions: 1 }),
      makeNodeInfo({ id: 'air', kind: 'remote', maxSessions: 99, activeSessions: 0, status: 'offline' }),
    ];
    expect(createScheduler().pick(nodes, task)).toBe('hub');
  });

  test('counts busy nodes as schedulable while they still have a slot', () => {
    const nodes = [
      makeNodeInfo({ id: 'busy-air', kind: 'remote', maxSessions: 5, activeSessions: 3, status: 'busy' }),
    ];
    expect(createScheduler().pick(nodes, task)).toBe('busy-air');
  });

  test('breaks capacity ties by lower latency', () => {
    const nodes = [
      makeNodeInfo({ id: 'slow', kind: 'remote', maxSessions: 4, activeSessions: 0, latencyMs: 42 }),
      makeNodeInfo({ id: 'fast', kind: 'remote', maxSessions: 4, activeSessions: 0, latencyMs: 3 }),
    ];
    expect(createScheduler().pick(nodes, task)).toBe('fast');
  });

  test('prefers the hub when capacity and latency tie', () => {
    const nodes = [
      makeNodeInfo({ id: 'air', kind: 'remote', maxSessions: 4, activeSessions: 0, latencyMs: 2 }),
      makeNodeInfo({ id: 'hub', kind: 'local', maxSessions: 4, activeSessions: 0, latencyMs: 2 }),
    ];
    expect(createScheduler().pick(nodes, task)).toBe('hub');
  });

  test('breaks every remaining tie by id', () => {
    const nodes = [
      makeNodeInfo({ id: 'zed', kind: 'remote', maxSessions: 4, activeSessions: 0, latencyMs: 2 }),
      makeNodeInfo({ id: 'amy', kind: 'remote', maxSessions: 4, activeSessions: 0, latencyMs: 2 }),
      makeNodeInfo({ id: 'bob', kind: 'remote', maxSessions: 4, activeSessions: 0, latencyMs: 2 }),
    ];
    expect(createScheduler().pick(nodes, task)).toBe('amy');
    expect(rankNodes(nodes).map((n) => n.id)).toEqual(['amy', 'bob', 'zed']);
  });

  test('orders nodes with no measured latency by id, not by heartbeat order', () => {
    // A perch does not report latency (only the hub's RemoteNode measures it), so the id tie-break
    // has to work when both latencies are unknown. Subtracting two infinities used to produce NaN and
    // leave the array in registry order.
    const nodes = [
      makeNodeInfo({ id: 'perch-2', kind: 'remote', maxSessions: 1, activeSessions: 0 }),
      makeNodeInfo({ id: 'perch-1', kind: 'remote', maxSessions: 1, activeSessions: 0 }),
    ];
    expect(rankNodes(nodes).map((node) => node.id)).toEqual(['perch-1', 'perch-2']);
    expect(createScheduler().pick(nodes, task)).toBe('perch-1');
  });

  test('returns undefined when no node has capacity', () => {
    const nodes = [
      makeNodeInfo({ id: 'hub', maxSessions: 2, activeSessions: 2 }),
      makeNodeInfo({ id: 'air', kind: 'remote', maxSessions: 3, activeSessions: 9 }),
    ];
    expect(createScheduler().pick(nodes, task)).toBeUndefined();
    expect(createScheduler().pick([], task)).toBeUndefined();
  });

  test('never reports negative free slots and never mutates the input', () => {
    const over = makeNodeInfo({ id: 'over', maxSessions: 1, activeSessions: 5 });
    expect(freeSlots(over)).toBe(0);

    const nodes = [
      makeNodeInfo({ id: 'b', kind: 'remote', maxSessions: 4, activeSessions: 0 }),
      makeNodeInfo({ id: 'a', kind: 'remote', maxSessions: 4, activeSessions: 0 }),
    ];
    rankNodes(nodes);
    expect(nodes.map((n) => n.id)).toEqual(['b', 'a']);
  });
});
