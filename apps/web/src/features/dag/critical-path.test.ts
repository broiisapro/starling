import { expect, test } from 'bun:test';
import { makePlan, makeTaskSpec } from '@starling/core/testing';
import { criticalEdges, criticalKeys, criticalPath } from './critical-path';

function planWith(estimates: Record<string, number>, deps: Record<string, string[]>) {
  return makePlan({
    id: 'plan-critical',
    tasks: Object.keys(estimates).map((key) =>
      makeTaskSpec({ key, title: key, estimateMin: estimates[key] ?? 0, dependsOn: deps[key] ?? [] }),
    ),
  });
}

test('picks the longest chain by estimate, not the widest branch', () => {
  // a(10) → b(5) → d(40) totals 55; a(10) → c(50) totals 60, so c is the better path.
  const plan = planWith({ a: 10, b: 5, c: 50, d: 40 }, { a: [], b: ['a'], c: ['a'], d: ['b'] });

  expect(criticalPath(plan)).toEqual({ keys: ['a', 'c'], estimateMin: 60 });
});

test('a chain may skip tasks that are not on the heaviest path', () => {
  const plan = planWith(
    { root: 4, heavy: 90, light: 2, tail: 8 },
    { root: [], heavy: ['root'], light: ['root'], tail: ['light'] },
  );

  expect(criticalPath(plan).keys).toEqual(['root', 'heavy']);
  expect(criticalPath(plan).estimateMin).toBe(94);
});

test('disconnected roots are compared independently', () => {
  const plan = planWith({ lonely: 12, short: 3, long: 30 }, { lonely: [], short: [], long: ['short'] });

  expect(criticalPath(plan).keys).toEqual(['short', 'long']);
});

test('ties break deterministically on the lexicographically smaller chain', () => {
  const plan = planWith({ b: 20, a: 20 }, { a: [], b: [] });

  expect(criticalPath(plan).keys).toEqual(['a']);
});

test('missing dependencies are ignored rather than treated as a chain', () => {
  const plan = planWith({ a: 10 }, { a: ['ghost'] });

  expect(criticalPath(plan).keys).toEqual(['a']);
  expect(criticalPath(plan).estimateMin).toBe(10);
});

test('a cycle cannot hang the walk', () => {
  const plan = planWith({ a: 5, b: 5 }, { a: ['b'], b: ['a'] });

  const path = criticalPath(plan);
  expect(path.keys.length).toBeGreaterThan(0);
  expect(path.estimateMin).toBeGreaterThanOrEqual(5);
});

test('no plan, no tasks and zero estimates are all safe', () => {
  expect(criticalPath(undefined)).toEqual({ keys: [], estimateMin: 0 });
  expect(criticalPath(makePlan({ tasks: [] }))).toEqual({ keys: [], estimateMin: 0 });
  const plan = planWith({ a: 0, b: 0 }, { a: [], b: ['a'] });
  expect(criticalPath(plan).keys).toEqual(['a', 'b']);
});

test('critical edges are only the adjacent links on the chain', () => {
  // a → b → c is critical; a → d is a real edge but not on the chain.
  const plan = planWith({ a: 10, b: 10, c: 10, d: 1 }, { a: [], b: ['a'], c: ['b'], d: ['a'] });

  expect([...criticalEdges(plan)].sort()).toEqual(['a->b', 'b->c']);
  expect([...criticalKeys(plan)].sort()).toEqual(['a', 'b', 'c']);
});

test('a single task is its own critical path', () => {
  const plan = planWith({ solo: 25 }, { solo: [] });

  expect(criticalPath(plan)).toEqual({ keys: ['solo'], estimateMin: 25 });
  expect(criticalEdges(plan).size).toBe(0);
});
