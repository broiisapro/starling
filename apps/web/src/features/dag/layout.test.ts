import { describe, expect, test } from 'bun:test';
import { makePlan, makeTaskRun, makeTaskSpec } from '@starling/core/testing';
import { elapsedFor, formatElapsed, nodeLabel, shortTitle } from './format';
import { clearLayoutCache, firstKey, layoutFor, layoutPlan, pickNeighbour } from './layout';
import { edgeAnimates, isLive, isWaiting, statusMeta } from './status';

const plan = makePlan({
  id: 'plan-layout',
  tasks: [
    makeTaskSpec({
      key: 'dates-fix',
      title: 'Fix dates',
      dependsOn: [],
      lane: { owns: ['src/lib/dates.ts'], reads: [] },
    }),
    makeTaskSpec({ key: 'due-badges', title: 'Badges', dependsOn: ['dates-fix'] }),
    makeTaskSpec({ key: 'help', title: 'Help', dependsOn: ['shortcuts'] }),
    makeTaskSpec({ key: 'shortcuts', title: 'Shortcuts', dependsOn: [] }),
  ],
});

describe('layoutPlan', () => {
  test('positions every task that dagre knows about', () => {
    const layout = layoutPlan(plan);
    expect(Object.keys(layout.positions).sort()).toEqual(['dates-fix', 'due-badges', 'help', 'shortcuts']);
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
  });

  test('flows left to right: dependencies sit to the left of dependants', () => {
    const { positions } = layoutPlan(plan);
    const parent = positions['dates-fix'];
    const child = positions['due-badges'];
    expect(parent).toBeDefined();
    expect(child).toBeDefined();
    if (!parent || !child) throw new Error('unreachable');
    expect(child.x).toBeGreaterThan(parent.x);
  });

  test('ignores a dependency on a task that is not in the plan', () => {
    const broken = makePlan({
      id: 'plan-broken',
      tasks: [makeTaskSpec({ key: 'orphan', dependsOn: ['ghost'] })],
    });
    const layout = layoutPlan(broken);
    expect(Object.keys(layout.positions)).toEqual(['orphan']);
  });

  test('returns an empty layout for a missing or empty plan', () => {
    expect(layoutPlan(undefined)).toEqual({ positions: {}, width: 0, height: 0 });
    expect(layoutPlan(makePlan({ tasks: [] }))).toEqual({ positions: {}, width: 0, height: 0 });
  });
});

describe('layoutFor', () => {
  test('memoises by plan id', () => {
    clearLayoutCache();
    const first = layoutFor(plan);
    const second = layoutFor(plan);
    expect(second).toBe(first);
  });

  test('recomputes after the cache is cleared', () => {
    const first = layoutFor(plan);
    clearLayoutCache();
    const second = layoutFor(plan);
    expect(second).not.toBe(first);
    expect(second.positions).toEqual(first.positions);
  });
});

describe('pickNeighbour', () => {
  const positions = {
    a: { x: 0, y: 0 },
    b: { x: 300, y: 0 },
    c: { x: 300, y: 140 },
    d: { x: 600, y: 0 },
  };

  test('moves right to the nearest downstream rank', () => {
    expect(pickNeighbour(positions, 'a', 'right')).toBe('b');
  });

  test('moves left back to the parent', () => {
    expect(pickNeighbour(positions, 'b', 'left')).toBe('a');
  });

  test('moves down within a rank', () => {
    expect(pickNeighbour(positions, 'b', 'down')).toBe('c');
  });

  test('returns undefined when nothing lies in that direction', () => {
    expect(pickNeighbour(positions, 'a', 'up')).toBeUndefined();
    expect(pickNeighbour(positions, 'a', 'left')).toBeUndefined();
  });

  test('falls back to the first key when there is no current selection', () => {
    expect(pickNeighbour(positions, undefined, 'right')).toBe('a');
  });

  test('firstKey is the top-left node', () => {
    expect(firstKey(positions)).toBe('a');
    expect(firstKey({})).toBeUndefined();
  });
});

describe('status rules', () => {
  test('an edge animates only while upstream is live and downstream waits', () => {
    expect(edgeAnimates('running', 'pending')).toBe(true);
    expect(edgeAnimates('auditing', 'ready')).toBe(true);
    expect(edgeAnimates('running', 'running')).toBe(false);
    expect(edgeAnimates('merged', 'ready')).toBe(false);
    expect(edgeAnimates(undefined, 'pending')).toBe(false);
  });

  test('live and waiting sets are disjoint', () => {
    expect(isLive('running')).toBe(true);
    expect(isLive('merged')).toBe(false);
    expect(isWaiting('pending')).toBe(true);
    expect(isWaiting('running')).toBe(false);
  });

  test('unknown statuses fall back to the pending palette', () => {
    expect(statusMeta(undefined).label).toBe('pending');
  });
});

describe('task card formatting', () => {
  test('elapsed freezes at finishedAt and ticks with now otherwise', () => {
    const run = makeTaskRun({ startedAt: 1_000, status: 'running' });
    expect(elapsedFor(run, 6_000)).toBe(5_000);
    expect(elapsedFor({ ...run, finishedAt: 4_000 }, 9_000)).toBe(3_000);
    expect(elapsedFor(makeTaskRun(), 9_000)).toBeUndefined();
  });

  test('formats seconds, minutes and hours', () => {
    expect(formatElapsed(undefined)).toBe('—');
    expect(formatElapsed(950)).toBe('0s');
    expect(formatElapsed(9_000)).toBe('9s');
    expect(formatElapsed(125_000)).toBe('2m 05s');
    expect(formatElapsed(3_725_000)).toBe('1h 02m');
  });

  test('node badge falls back to unassigned', () => {
    expect(nodeLabel(makeTaskRun({ nodeId: 'M2-Air' }))).toBe('M2-Air');
    expect(nodeLabel(makeTaskRun())).toBe('unassigned');
  });

  test('short titles are truncated with an ellipsis', () => {
    expect(shortTitle('Short')).toBe('Short');
    expect(shortTitle('x'.repeat(60), 10)).toHaveLength(10);
    expect(shortTitle('x'.repeat(60), 10).endsWith('…')).toBe(true);
  });
});
