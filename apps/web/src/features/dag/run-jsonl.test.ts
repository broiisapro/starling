import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { parseRunJsonl } from './run-jsonl';

const FIXTURE = new URL('../../../../../fixtures/runs/sky-todo-launch-day.jsonl', import.meta.url);

describe('parseRunJsonl', () => {
  test('reconstructs the launch-day fixture', () => {
    const slice = parseRunJsonl(readFileSync(FIXTURE, 'utf8'));

    expect(slice.plan?.tasks).toHaveLength(7);
    expect(Object.keys(slice.tasks)).toHaveLength(7);
    expect(Object.values(slice.tasks).every((task) => task.status === 'merged')).toBe(true);
    expect(slice.events.length).toBeGreaterThan(90);
    expect(slice.verdicts).toHaveLength(8);
    expect(slice.merges).toHaveLength(7);
    expect(slice.goalText).toContain('dark mode');
  });

  test('skips malformed and schema-invalid lines instead of throwing', () => {
    const text = [
      'not json',
      '{"type":"nonsense"}',
      '{"type":"log","runId":"r1","ts":1,"payload":{"level":"info","msg":"hello"}}',
    ].join('\n');
    const slice = parseRunJsonl(text);
    expect(slice.events).toEqual([]);
    expect(slice.verdicts).toEqual([]);
  });

  test('keeps the latest task status', () => {
    const slice = parseRunJsonl(
      [
        '{"type":"run.created","runId":"r1","ts":1,"payload":{"run":{"id":"r1","goal":{"id":"g1","text":"x","repoPath":"/tmp","baseBranch":"main","createdAt":1,"constraints":[]},"tasks":{},"status":"running","startedAt":1,"metrics":{"agentsActive":0,"tasksMerged":0,"tasksFailed":0,"apiUsage":{"input":0,"output":0,"cached":0},"localUsage":{"input":0,"output":0,"cached":0},"apiCostUsd":0,"localCallCount":0,"estSavedUsd":0,"elapsedMs":0}}}}',
        '{"type":"task.status","runId":"r1","ts":2,"payload":{"taskKey":"a","from":"pending","to":"running","run":{"runId":"r1","taskKey":"a","status":"running","attempts":1,"usage":{"input":0,"output":0,"cached":0},"costUsd":0}}}',
      ].join('\n'),
    );
    expect(slice.tasks.a?.status).toBe('running');
  });
});
