import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isStarlingError, StarlingEventSchema } from '@starling/core';
import { importJsonl, parseJsonl, serialiseJsonl, writeJsonl } from './jsonl';
import { createSqliteStore } from './sqlite-store';
import { FIXTURE_RECORDING, makeTempDir, removeTempDir } from './test-utils';

const dirs: string[] = [];

function scratch(): string {
  const dir = makeTempDir();
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) removeTempDir(dir);
});

/** Compare recordings as data, so key order and pretty printing cannot mask a real difference. */
function normalised(lines: string): unknown[] {
  return lines
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line));
}

describe('JSONL recordings', () => {
  test('imports the 252-event launch-day fixture and every event validates', () => {
    const events = importJsonl(FIXTURE_RECORDING);
    expect(events).toHaveLength(252);
    for (const event of events) expect(StarlingEventSchema.safeParse(event).success).toBe(true);
  });

  test('import → store → export round-trips the fixture (normalised JSON)', () => {
    const events = importJsonl(FIXTURE_RECORDING);
    const store = createSqliteStore(':memory:');
    try {
      store.appendEvents(events);
      const runId = events[0]?.runId;
      expect(runId).toBe('01jd2k7m3p4q5r6s7t8v9w0x1y');

      const out = join(scratch(), 'roundtrip.jsonl');
      store.exportJsonl(runId as string, out);
      const exported = readFileSync(out, 'utf8');
      const expected = readFileSync(FIXTURE_RECORDING, 'utf8');

      // Same events, same order, same data. Byte order inside an object follows the zod schema on
      // import (key order is not part of the contract), so compare normalised JSON.
      expect(exported.split('\n').filter(Boolean)).toHaveLength(252);
      expect(normalised(exported)).toEqual(normalised(expected));
    } finally {
      store.close();
    }
  });

  test('exports only the flock stream for the wildcard run id', () => {
    const events = importJsonl(FIXTURE_RECORDING);
    const store = createSqliteStore(':memory:');
    try {
      store.appendEvents(events);
      const out = join(scratch(), 'flock.jsonl');
      store.exportJsonl('*', out);
      const flock = importJsonl(out);
      expect(flock.length).toBeGreaterThan(0);
      expect(flock.every((event) => event.runId === '*')).toBe(true);
      expect(flock.map((event) => event.type)).toContain('node.left');
    } finally {
      store.close();
    }
  });

  test('a bad JSON line fails with its 1-based file line number', () => {
    const dir = scratch();
    const path = join(dir, 'broken.jsonl');
    const good = JSON.stringify({
      type: 'log',
      runId: 'r1',
      ts: 1,
      payload: { level: 'info', msg: 'fine' },
    });
    writeFileSync(path, `${good}\n${good}\n{"type":"log",\n`);

    try {
      importJsonl(path);
      throw new Error('expected importJsonl to throw');
    } catch (err) {
      expect(isStarlingError(err, 'STORE_ERROR')).toBe(true);
      expect((err as Error).message).toContain('line 3');
      expect((err as Error).message).toContain('invalid JSON');
    }
  });

  test('an invalid event fails with its line number and the zod path', () => {
    const path = join(scratch(), 'invalid.jsonl');
    writeFileSync(path, `${JSON.stringify({ type: 'task.status', runId: 'r1', ts: 1, payload: {} })}\n`);

    try {
      importJsonl(path);
      throw new Error('expected importJsonl to throw');
    } catch (err) {
      expect(isStarlingError(err, 'STORE_ERROR')).toBe(true);
      expect((err as Error).message).toContain('line 1');
      expect((err as Error).message).toContain('invalid StarlingEvent');
      expect((err as Error).message).toContain('payload');
    }
  });

  test('skips blank lines but keeps counting them for error positions', () => {
    const first = JSON.stringify({ type: 'log', runId: 'r1', ts: 1, payload: { level: 'info', msg: 'a' } });
    const second = JSON.stringify({ type: 'log', runId: 'r1', ts: 2, payload: { level: 'info', msg: 'b' } });

    expect(parseJsonl(`\n${first}\n\n${second}\n\n`)).toHaveLength(2);

    try {
      parseJsonl(`${first}\n\n\nnot-json\n`);
      throw new Error('expected parseJsonl to throw');
    } catch (err) {
      expect((err as Error).message).toContain('line 4');
    }
  });

  test('writes and reads an empty recording', () => {
    const path = join(scratch(), 'empty.jsonl');
    writeJsonl(path, []);
    expect(readFileSync(path, 'utf8')).toBe('');
    expect(importJsonl(path)).toEqual([]);
    expect(serialiseJsonl([])).toBe('');
  });

  test('an empty recording exported from a run with no events is empty', () => {
    const store = createSqliteStore(':memory:');
    try {
      const path = join(scratch(), 'none.jsonl');
      store.exportJsonl('no-such-run', path);
      expect(readFileSync(path, 'utf8')).toBe('');
    } finally {
      store.close();
    }
  });

  test('missing files surface as STORE_ERROR', () => {
    try {
      importJsonl(join(scratch(), 'absent.jsonl'));
      throw new Error('expected importJsonl to throw');
    } catch (err) {
      expect(isStarlingError(err, 'STORE_ERROR')).toBe(true);
      expect((err as Error).message).toContain('could not read recording');
    }
  });
});
