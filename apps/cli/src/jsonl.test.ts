import { describe, expect, test } from 'bun:test';
import { readFileSync, unlinkSync } from 'node:fs';
import type { StarlingEvent } from '@starling/core';
import { makeAgentEvent } from '@starling/core/testing';
import { createEventRecorder, parseEventsJsonl, readEventsJsonl } from './jsonl';
import { tmpFile } from './testing/tmp';

const event: StarlingEvent = {
  type: 'agent.event',
  runId: 'run-1',
  ts: 1,
  payload: makeAgentEvent({ runId: 'run-1' }),
};

describe('JSONL recordings', () => {
  test('records events by appending and reads them back', () => {
    const path = tmpFile('cli-record');
    const recorder = createEventRecorder(path);
    recorder.record(event);
    recorder.record(event);
    expect(recorder.count).toBe(2);

    const events = readEventsJsonl(path);
    expect(events).toHaveLength(2);
    expect(events[0]?.type).toBe('agent.event');

    createEventRecorder(path).record(event);
    expect(readEventsJsonl(path)).toHaveLength(3);
    unlinkSync(path);
  });

  test('skips blank lines', () => {
    const text = `${JSON.stringify(event)}\n\n  \n${JSON.stringify(event)}\n`;
    expect(parseEventsJsonl(text)).toHaveLength(2);
  });

  test('reports the bad line for invalid JSON', () => {
    expect(() => parseEventsJsonl(`{oops}\n`, 'rec.jsonl')).toThrow(/rec\.jsonl:1: not valid JSON/);
  });

  test('reports the bad line for an invalid event shape', () => {
    expect(() => parseEventsJsonl(`${JSON.stringify({ type: 'nope' })}\n`, 'rec.jsonl')).toThrow(
      /rec\.jsonl:1: invalid Starling event/,
    );
  });

  test('reports a missing file with the resolved path', () => {
    expect(() => readEventsJsonl('does-not-exist.jsonl', '/tmp')).toThrow(/Could not read recording/);
  });

  test('creates parent directories for a nested recording path', () => {
    const path = tmpFile('cli-nested/dir/run.jsonl');
    createEventRecorder(path).record(event);
    expect(readFileSync(path, 'utf8')).toContain('"type":"agent.event"');
    unlinkSync(path);
  });
});
