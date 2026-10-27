import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createEventBus, FakeClock, type StarlingEvent } from '@starling/core';
import { makeRun, makeTaskRun } from '@starling/core/testing';
import { deriveRun } from './derive';
import { importJsonl } from './jsonl';
import { attachRecorder } from './recorder';
import { createReplayer } from './replayer';
import { createSqliteStore, type SqliteStore } from './sqlite-store';
import { FIXTURE_RECORDING, makeTempDir, removeTempDir } from './test-utils';

const fixture = importJsonl(FIXTURE_RECORDING);
const RUN_ID = '01jd2k7m3p4q5r6s7t8v9w0x1y';
const FLOCK_EVENTS = fixture.filter((event) => event.runId === '*').length;

const stores: SqliteStore[] = [];
const dirs: string[] = [];

function scratchStore(): SqliteStore {
  const store = createSqliteStore(':memory:');
  stores.push(store);
  return store;
}

function scratchFile(name: string): string {
  const dir = makeTempDir();
  dirs.push(dir);
  return join(dir, name);
}

/** Compare recordings as data (key order is the zod schema's, not the file's). */
function normalised(lines: string): unknown[] {
  return lines
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line));
}

afterEach(() => {
  for (const store of stores.splice(0)) {
    try {
      store.close();
    } catch {
      // Already closed by the test.
    }
  }
  for (const dir of dirs.splice(0)) removeTempDir(dir);
});

describe('attachRecorder', () => {
  test('persists every event and the run snapshot as the run progresses', () => {
    const bus = createEventBus();
    const store = scratchStore();
    const detach = attachRecorder(bus, store);

    const run = makeRun({ id: 'live-recording' });
    const created: StarlingEvent = { type: 'run.created', runId: run.id, ts: 1_000, payload: { run } };
    const running: StarlingEvent = {
      type: 'task.status',
      runId: run.id,
      ts: 1_100,
      payload: {
        taskKey: 'theme',
        from: 'pending',
        to: 'running',
        run: makeTaskRun({ runId: run.id, taskKey: 'theme', status: 'running' }),
      },
    };

    bus.publish(created);
    expect(store.getRun(run.id)?.status).toBe('running');
    bus.publish(running);
    expect(store.getRun(run.id)?.tasks.theme?.status).toBe('running');
    expect(store.getRun(run.id)?.status).toBe('running');
    expect(store.events(run.id)).toHaveLength(2);

    bus.publish({
      type: 'run.finished',
      runId: run.id,
      ts: 2_000,
      payload: { run: { ...run, status: 'finished' }, summary: 'done' },
    });
    expect(store.getRun(run.id)?.status).toBe('finished');
    expect(store.events(run.id)).toHaveLength(3);
    detach();
  });

  test('unsubscribing stops recording', () => {
    const bus = createEventBus();
    const store = scratchStore();
    const detach = attachRecorder(bus, store);

    const run = makeRun({ id: 'detached' });
    bus.publish({ type: 'run.created', runId: run.id, ts: 1, payload: { run } });
    detach();
    bus.publish({ type: 'log', runId: run.id, ts: 2, payload: { level: 'info', msg: 'after detach' } });

    expect(store.events(run.id)).toHaveLength(1);
  });

  test('recorder + replayer reconstruct the fixture recording exactly', async () => {
    const bus = createEventBus();
    const store = scratchStore();
    const detach = attachRecorder(bus, store);

    const replayer = createReplayer({
      events: fixture,
      bus,
      clock: new FakeClock(0),
      speed: Number.POSITIVE_INFINITY,
    });
    await replayer.start();
    detach();

    const run = store.getRun(RUN_ID);
    expect(run?.status).toBe('finished');
    expect(Object.keys(run?.tasks ?? {})).toHaveLength(7);
    expect(Object.values(run?.tasks ?? {}).every((task) => task.status === 'merged')).toBe(true);

    // Flock events are stored under '*'; the run's own stream holds the other 239.
    expect(store.events(RUN_ID)).toHaveLength(fixture.length - FLOCK_EVENTS);
    expect(store.events('*')).toHaveLength(FLOCK_EVENTS);

    const out = scratchFile('replayed.jsonl');
    store.exportJsonl(RUN_ID, out);
    expect(normalised(readFileSync(out, 'utf8'))).toEqual(
      normalised(readFileSync(FIXTURE_RECORDING, 'utf8')),
    );

    // The run's own stream folds to the same run as the recording's final snapshot.
    expect(deriveRun(store.events(RUN_ID))).toEqual(run);
  });

  test('replaying under a new run id records a fresh, complete run', async () => {
    const bus = createEventBus();
    const store = scratchStore();
    const detach = attachRecorder(bus, store);

    const newRunId = '01jd2k7m3p4q5r6s7t8v9w0new';
    const replayer = createReplayer({
      events: fixture,
      bus,
      clock: new FakeClock(0),
      speed: Number.POSITIVE_INFINITY,
      newRunId,
    });
    await replayer.start();
    detach();

    const run = store.getRun(newRunId);
    expect(run?.id).toBe(newRunId);
    expect(run?.status).toBe('finished');
    expect(store.getRun(RUN_ID)).toBeUndefined();
    expect(store.events(newRunId)).toHaveLength(fixture.length - FLOCK_EVENTS);
    expect(store.listRuns()).toHaveLength(1);

    const out = scratchFile('new-run.jsonl');
    store.exportJsonl(newRunId, out);
    const exported = importJsonl(out);
    expect(exported).toHaveLength(fixture.length);
    expect(exported.filter((event) => event.runId === '*' && event.type === 'node.left')).toHaveLength(1);
  });
});
