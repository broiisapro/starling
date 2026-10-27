import { describe, expect, test } from 'bun:test';
import { isStarlingEvent, parseEventLines } from './events';

const logEvent = {
  type: 'log',
  runId: 'r1',
  ts: 1,
  payload: { level: 'info', msg: 'hello' },
};

describe('isStarlingEvent', () => {
  test('accepts every documented event type with a minimal envelope', () => {
    const types = [
      'run.created',
      'repomap.ready',
      'plan.created',
      'task.status',
      'agent.event',
      'audit.verdict',
      'merge.result',
      'metrics',
      'log',
      'node.joined',
      'node.left',
      'node.stats',
      'task.migrated',
      'run.finished',
    ];
    for (const type of types) {
      expect(isStarlingEvent({ ...logEvent, type })).toBe(true);
    }
  });

  test('rejects unknown types, missing fields and non-objects', () => {
    expect(isStarlingEvent({ ...logEvent, type: 'nonsense' })).toBe(false);
    expect(isStarlingEvent({ ...logEvent, runId: 7 })).toBe(false);
    expect(isStarlingEvent({ ...logEvent, ts: 'now' })).toBe(false);
    expect(isStarlingEvent({ ...logEvent, payload: null })).toBe(false);
    expect(isStarlingEvent(null)).toBe(false);
    expect(isStarlingEvent('{"type":"log"}')).toBe(false);
  });
});

describe('parseEventLines', () => {
  test('keeps valid lines, counts the rest, ignores blank lines', () => {
    const text = [
      'not json',
      '',
      JSON.stringify(logEvent),
      '{"type":"nonsense"}',
      '   ',
      JSON.stringify({ ...logEvent, ts: 2 }),
    ].join('\n');
    const { events, skipped } = parseEventLines(text);
    expect(events.map((event) => event.ts)).toEqual([1, 2]);
    expect(skipped).toBe(2);
  });

  test('returns nothing for an empty file', () => {
    expect(parseEventLines('')).toEqual({ events: [], skipped: 0 });
  });
});
