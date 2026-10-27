import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import type { StarlingEvent } from '@starling/core';
import { StarlingEventSchema } from '@starling/core';

import { replayQueue } from './replay';

const FIXTURE_URL = new URL('../../../../../fixtures/runs/sky-todo-launch-day.jsonl', import.meta.url);

const EVENTS: StarlingEvent[] = readFileSync(FIXTURE_URL, 'utf8')
  .trim()
  .split('\n')
  .map((line) => StarlingEventSchema.parse(JSON.parse(line)));

test('the playground replays the whole fixture into a finished board', () => {
  const state = replayQueue(EVENTS, EVENTS.length - 1);
  expect(state.plan?.tasks).toHaveLength(7);
  expect(Object.keys(state.tasks)).toHaveLength(7);
  expect(Object.values(state.tasks).every((run) => run.status === 'merged')).toBe(true);
  expect(state.merges).toHaveLength(7);
  expect(state.merges.map((merge) => merge.taskKey)).toEqual([
    'dates-fix',
    'csv-export',
    'shortcuts',
    'theme',
    'due-badges',
    'help-overlay',
    'search',
  ]);
});

test('scrubbing back to the start shows a pending plan', () => {
  const state = replayQueue(EVENTS, 0);
  expect(state.plan).toBeDefined();
  expect(state.merges).toEqual([]);
  expect(Object.values(state.tasks).every((run) => run.status === 'pending')).toBe(true);
});

test('the first task.status event moves a task out of pending', () => {
  const firstStatus = EVENTS.findIndex((event) => event.type === 'task.status');
  const state = replayQueue(EVENTS, firstStatus);
  expect(state.tasks.theme?.status).toBe('ready');
  expect(state.tasks.search?.status).toBe('pending');
});

test('out-of-range and negative indexes are harmless', () => {
  expect(replayQueue([], 5)).toEqual({ tasks: {}, merges: [] });
  expect(Object.keys(replayQueue(EVENTS, -1).tasks)).toHaveLength(0);
});
