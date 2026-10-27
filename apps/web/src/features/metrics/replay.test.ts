import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import type { StarlingEvent } from '@starling/core';
import { StarlingEventSchema } from '@starling/core';

import { replayMetrics } from './replay';

const FIXTURE_URL = new URL('../../../../../fixtures/runs/sky-todo-launch-day.jsonl', import.meta.url);

const EVENTS: StarlingEvent[] = readFileSync(FIXTURE_URL, 'utf8')
  .trim()
  .split('\n')
  .map((line) => StarlingEventSchema.parse(JSON.parse(line)));

test('the playground collects every metrics sample in order', () => {
  const samples = replayMetrics(EVENTS, EVENTS.length - 1);
  expect(samples).toHaveLength(72);
  expect(samples[0]?.metrics.elapsedMs).toBe(0);
  expect(samples[samples.length - 1]?.metrics.tasksMerged).toBe(7);
  for (let index = 1; index < samples.length; index += 1) {
    expect(samples[index]?.ts).toBeGreaterThan(samples[index - 1]?.ts ?? 0);
  }
});

test('an early index has no metrics yet', () => {
  expect(replayMetrics(EVENTS, 0)).toEqual([]);
  expect(replayMetrics(EVENTS, -1)).toEqual([]);
});

test('samples grow monotonically as the scrub advances', () => {
  const half = replayMetrics(EVENTS, Math.floor(EVENTS.length / 2));
  expect(half.length).toBeGreaterThan(0);
  expect(half.length).toBeLessThan(72);
});
