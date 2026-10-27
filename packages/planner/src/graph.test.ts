import { describe, expect, test } from 'bun:test';
import type { TaskSpec } from '@starling/core';
import { buildDepGraph, canonicalCycle, canRunConcurrently, findCycles, formatCycle } from './graph';
import { task } from './test-fixtures';

function graphOf(tasks: TaskSpec[]) {
  return buildDepGraph(tasks);
}

describe('buildDepGraph', () => {
  test('keeps only edges to tasks that exist and drops blanks and duplicates', () => {
    const graph = graphOf([
      task('a', { dependsOn: ['b', 'ghost', '  ', 'b'] }),
      task('b', { dependsOn: ['a', ''] }),
    ]);
    expect(graph.get('a')).toEqual(['b']);
    expect(graph.get('b')).toEqual(['a']);
  });

  test('keeps the first occurrence of a duplicate key', () => {
    const graph = graphOf([task('a', { dependsOn: ['b'] }), task('a', { dependsOn: [] }), task('b')]);
    expect(graph.get('a')).toEqual(['b']);
    expect(graph.size).toBe(2);
  });
});

describe('findCycles', () => {
  test('finds a two-node cycle once, rotation-independent', () => {
    const cycles = findCycles(graphOf([task('a', { dependsOn: ['b'] }), task('b', { dependsOn: ['a'] })]));
    expect(cycles).toHaveLength(1);
    expect(new Set(cycles[0])).toEqual(new Set(['a', 'b']));
    expect(formatCycle(cycles[0] as string[])).toMatch(/^[ab] -> [ab] -> [ab]$/);
  });

  test('finds a self-dependency', () => {
    const cycles = findCycles(graphOf([task('a', { dependsOn: ['a'] })]));
    expect(cycles).toEqual([['a']]);
    expect(formatCycle(cycles[0] as string[])).toBe('a -> a');
  });

  test('finds two independent cycles and no false positive on a diamond', () => {
    const cycles = findCycles(
      graphOf([
        task('a', { dependsOn: ['b'] }),
        task('b', { dependsOn: ['a'] }),
        task('c', { dependsOn: ['d'] }),
        task('d', { dependsOn: ['c'] }),
        task('e', { dependsOn: ['f', 'g'] }),
        task('f', { dependsOn: ['h'] }),
        task('g', { dependsOn: ['h'] }),
        task('h'),
      ]),
    );
    expect(cycles).toHaveLength(2);
    expect(canonicalCycle(cycles[0] as string[])).not.toBe(canonicalCycle(cycles[1] as string[]));
  });
});

describe('ancestry', () => {
  const graph = graphOf([
    task('a'),
    task('b', { dependsOn: ['a'] }),
    task('c', { dependsOn: ['b'] }),
    task('d'),
  ]);

  test('recognises direct and transitive ancestors', () => {
    expect(canRunConcurrently(graph, 'a', 'b')).toBe(false);
    expect(canRunConcurrently(graph, 'a', 'c')).toBe(false);
    expect(canRunConcurrently(graph, 'c', 'a')).toBe(false);
  });

  test('independent tasks can run concurrently', () => {
    expect(canRunConcurrently(graph, 'a', 'd')).toBe(true);
    expect(canRunConcurrently(graph, 'c', 'd')).toBe(true);
    expect(canRunConcurrently(graph, 'a', 'a')).toBe(false);
  });
});
