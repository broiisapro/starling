import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BASE_TS, makeGoal, makeRun } from './factories';
import { MemoryStore } from './memory-store';

describe('MemoryStore', () => {
  test('round-trips runs and isolates callers from stored state', () => {
    const store = new MemoryStore();
    const run = makeRun({ goal: makeGoal({ text: 'original' }) });
    store.saveRun(run);
    const loaded = store.getRun(run.id);
    expect(loaded?.goal.text).toBe('original');
    if (loaded) loaded.goal.text = 'mutated';
    expect(store.getRun(run.id)?.goal.text).toBe('original');
    expect(store.getRun('missing')).toBeUndefined();
  });

  test('listRuns returns most recent first', () => {
    const store = new MemoryStore();
    const older = makeRun({ startedAt: BASE_TS });
    const newer = makeRun({ startedAt: BASE_TS + 1000 });
    store.saveRun(older);
    store.saveRun(newer);
    expect(store.listRuns().map((r) => r.id)).toEqual([newer.id, older.id]);
  });

  test('events are appended per run and filtered by sinceTs', () => {
    const store = new MemoryStore();
    const run = makeRun();
    const makeEvent = (ts: number, msg: string) =>
      ({ type: 'log', runId: run.id, ts, payload: { level: 'info', msg } }) as const;
    store.appendEvent(makeEvent(1, 'a'));
    store.appendEvent(makeEvent(5, 'b'));
    store.appendEvent({ ...makeEvent(9, 'c'), runId: 'other' });
    expect(store.events(run.id)).toHaveLength(2);
    expect(store.events(run.id, 5).map((e) => e.ts)).toEqual([5]);
    expect(store.events('other')).toHaveLength(1);
  });

  test('exportJsonl writes one event per line', () => {
    const store = new MemoryStore();
    const run = makeRun();
    store.appendEvent({ type: 'log', runId: run.id, ts: 1, payload: { level: 'info', msg: 'one' } });
    store.appendEvent({ type: 'log', runId: run.id, ts: 2, payload: { level: 'warn', msg: 'two' } });
    const dir = mkdtempSync(join(tmpdir(), 'starling-store-'));
    const path = join(dir, 'run.jsonl');
    store.exportJsonl(run.id, path);
    const lines = readFileSync(path, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0] ?? '{}').payload.msg).toBe('one');
    rmSync(dir, { recursive: true, force: true });
  });
});
