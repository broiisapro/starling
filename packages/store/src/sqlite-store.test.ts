import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { isStarlingError, type Run, type StarlingEvent } from '@starling/core';
import { makePlan, makeRun } from '@starling/core/testing';
import { createSqliteStore, type SqliteStore, STORE_SCHEMA_VERSION } from './sqlite-store';
import { makeLogEvent, makeTempDir, removeTempDir } from './test-utils';

const open: SqliteStore[] = [];
const dirs: string[] = [];

function track(store: SqliteStore): SqliteStore {
  open.push(store);
  return store;
}

function scratch(): string {
  const dir = makeTempDir();
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const store of open.splice(0)) {
    try {
      store.close();
    } catch {
      // A test may already have closed it.
    }
  }
  for (const dir of dirs.splice(0)) removeTempDir(dir);
});

function makeRunCreated(run: Run, ts = run.startedAt): StarlingEvent {
  return { type: 'run.created', runId: run.id, ts, payload: { run } };
}

describe('createSqliteStore', () => {
  test('creates the documented schema, WAL mode and user_version', () => {
    const path = join(scratch(), 'starling.db');
    const store = createSqliteStore(path);
    store.close();

    const db = new Database(path, { readonly: true });
    try {
      const tables = db.query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as {
        name: string;
      }[];
      expect(tables.map((table) => table.name)).toEqual(['events', 'runs']);

      const runColumns = db.query('PRAGMA table_info(runs)').all() as { name: string; pk: number }[];
      expect(runColumns.map((column) => column.name)).toEqual(['id', 'status', 'started_at', 'json']);
      expect(runColumns.find((column) => column.pk === 1)?.name).toBe('id');

      const eventColumns = db.query('PRAGMA table_info(events)').all() as { name: string }[];
      expect(eventColumns.map((column) => column.name)).toEqual(['run_id', 'seq', 'ts', 'type', 'json']);

      const indexes = db
        .query("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'events'")
        .all() as { name: string }[];
      expect(indexes.map((index) => index.name)).toContain('events_run_seq');

      const version = db.query('PRAGMA user_version').get() as { user_version: number };
      expect(version.user_version).toBe(STORE_SCHEMA_VERSION);
      const mode = db.query('PRAGMA journal_mode').get() as { journal_mode: string };
      expect(mode.journal_mode).toBe('wal');
    } finally {
      db.close();
    }
  });

  test('saveRun upserts and getRun returns an isolated copy', () => {
    const store = track(createSqliteStore(':memory:'));
    const run = makeRun({ id: 'run-upsert', status: 'running' });

    store.saveRun(run);
    const read = store.getRun(run.id);
    expect(read).toEqual(run);
    if (read === undefined) throw new Error('expected the saved run');
    read.status = 'finished';
    expect(store.getRun(run.id)?.status).toBe('running');

    store.saveRun({ ...run, status: 'finished', finishedAt: run.startedAt + 1000 });
    const updated = store.getRun(run.id);
    expect(updated?.status).toBe('finished');
    expect(updated?.finishedAt).toBe(run.startedAt + 1000);
    expect(store.listRuns()).toHaveLength(1);
  });

  test('getRun returns undefined for an unknown id', () => {
    const store = track(createSqliteStore(':memory:'));
    expect(store.getRun('nope')).toBeUndefined();
  });

  test('listRuns is newest first', () => {
    const store = track(createSqliteStore(':memory:'));
    const old = makeRun({ id: 'old', startedAt: 1_000 });
    const newest = makeRun({ id: 'newest', startedAt: 3_000 });
    const middle = makeRun({ id: 'middle', startedAt: 2_000 });
    store.saveRun(old);
    store.saveRun(newest);
    store.saveRun(middle);

    expect(store.listRuns().map((run) => run.id)).toEqual(['newest', 'middle', 'old']);
  });

  test('events() returns the run in seq (append) order even when timestamps go backwards', () => {
    const store = track(createSqliteStore(':memory:'));
    const events = [
      makeLogEvent('run-a', 30, 'third-second'),
      makeLogEvent('run-a', 10, 'first-ts'),
      makeLogEvent('run-a', 20, 'middle'),
    ];
    for (const event of events) store.appendEvent(event);

    const read = store.events('run-a');
    expect(read.map((event) => (event.type === 'log' ? event.payload.msg : event.type))).toEqual([
      'third-second',
      'first-ts',
      'middle',
    ]);
    expect(store.events('other')).toEqual([]);
  });

  test('events(runId, sinceTs) filters inclusively by timestamp', () => {
    const store = track(createSqliteStore(':memory:'));
    for (const ts of [100, 200, 300]) store.appendEvent(makeLogEvent('run-b', ts, `at-${ts}`));

    expect(store.events('run-b', 200)).toHaveLength(2);
    expect(store.events('run-b', 301)).toHaveLength(0);
    expect(store.events('run-b', 200)[0]?.ts).toBe(200);
  });

  test('buffers writes and flushes them on read, flush() or close()', async () => {
    const path = join(scratch(), 'buffered.db');
    const store = track(createSqliteStore(path));
    for (let index = 0; index < 5; index += 1) store.appendEvent(makeLogEvent('run-buf', index));

    // Below the batch threshold nothing has hit the database yet; a reader that does not go through
    // the Store proves the writes are queued rather than committed one by one.
    const raw = new Database(path, { readonly: true });
    try {
      expect((raw.query('SELECT COUNT(*) AS n FROM events').get() as { n: number }).n).toBe(0);
    } finally {
      raw.close();
    }

    // The Store API flushes pending writes before answering.
    expect(store.events('run-buf')).toHaveLength(5);

    const afterRead = new Database(path, { readonly: true });
    try {
      expect((afterRead.query('SELECT COUNT(*) AS n FROM events').get() as { n: number }).n).toBe(5);
    } finally {
      afterRead.close();
    }

    store.appendEvent(makeLogEvent('run-buf', 99));
    store.flush();
    await Promise.resolve();
    expect(store.events('run-buf')).toHaveLength(6);
  });

  test('data survives close and reopen', () => {
    const path = join(scratch(), 'persistent.db');
    const run = makeRun({ id: 'run-persist' });
    const first = createSqliteStore(path);
    first.saveRun(run);
    first.appendEvent(makeRunCreated(run));
    first.appendEvent(makeLogEvent(run.id, run.startedAt + 1, 'persisted'));
    first.close();

    const second = track(createSqliteStore(path));
    expect(second.getRun(run.id)).toEqual(run);
    expect(second.events(run.id)).toHaveLength(2);
    expect(second.events(run.id)[1]?.type).toBe('log');
  });

  test('appendEvents writes a whole batch', () => {
    const store = track(createSqliteStore(':memory:'));
    const events = Array.from({ length: 1000 }, (_, index) => makeLogEvent('run-batch', index));
    store.appendEvents(events);
    expect(store.events('run-batch')).toHaveLength(1000);
    expect(store.events('run-batch')[999]?.ts).toBe(999);
  });

  test('sustains at least 2,000 events/s for 10,000 appends', () => {
    const path = join(scratch(), 'throughput.db');
    const store = track(createSqliteStore(path));
    const count = 10_000;
    const events = Array.from({ length: count }, (_, index) => makeLogEvent('run-throughput', index));

    const started = performance.now();
    for (const event of events) store.appendEvent(event);
    store.flush();
    const elapsedMs = performance.now() - started;
    const rate = count / (elapsedMs / 1000);

    expect(store.events('run-throughput')).toHaveLength(count);
    expect(elapsedMs).toBeLessThan(5000);
    expect(rate).toBeGreaterThanOrEqual(2000);
  });

  test('rejects an invalid Run instead of persisting it', () => {
    const store = track(createSqliteStore(':memory:'));
    const broken = { ...makeRun(), status: 'not-a-status' } as unknown as Run;
    expect(() => store.saveRun(broken)).toThrow(/invalid Run/);
    expect(store.listRuns()).toHaveLength(0);
  });

  test('throws STORE_ERROR after close', () => {
    const store = createSqliteStore(':memory:');
    const run = makeRun({ plan: makePlan() });
    store.saveRun(run);
    store.close();

    expect(() => store.getRun(run.id)).toThrow();
    try {
      store.appendEvent(makeLogEvent(run.id, 1));
      throw new Error('expected appendEvent to throw');
    } catch (err) {
      expect(isStarlingError(err, 'STORE_ERROR')).toBe(true);
    }
    expect(() => store.events(run.id)).toThrow();
    expect(() => store.listRuns()).toThrow();
  });
});
