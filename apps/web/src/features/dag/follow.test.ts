import { expect, test } from 'bun:test';
import { makeTaskRun } from '@starling/core/testing';
import { activeKeys, followTarget } from './follow';

const tasks = {
  a: makeTaskRun({ taskKey: 'a', status: 'running', startedAt: 1_000 }),
  b: makeTaskRun({ taskKey: 'b', status: 'auditing', startedAt: 2_000 }),
  c: makeTaskRun({ taskKey: 'c', status: 'merged', startedAt: 500 }),
  d: makeTaskRun({ taskKey: 'd', status: 'fixing', startedAt: 3_000 }),
};

test('activeKeys only counts work in flight, oldest first', () => {
  expect(activeKeys(tasks)).toEqual(['a', 'b', 'd']);
});

test('the newest live task is the follow target', () => {
  expect(followTarget(tasks, [])).toBe('a');
  expect(followTarget(tasks, ['a'])).toBe('b');
  expect(followTarget(tasks, ['a', 'b', 'd'])).toBe('a');
});

test('nothing live means no target, so the viewport stays put', () => {
  expect(activeKeys({})).toEqual([]);
  expect(followTarget({ c: tasks.c }, [])).toBeUndefined();
});

test('tasks without a start time still sort deterministically', () => {
  const quiet = {
    z: makeTaskRun({ taskKey: 'z', status: 'running' }),
    y: makeTaskRun({ taskKey: 'y', status: 'running' }),
  };
  expect(activeKeys(quiet)).toEqual(['y', 'z']);
});
