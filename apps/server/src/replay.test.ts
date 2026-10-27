import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { StarlingEvent } from '@starling/core';
import { createEventBus, StarlingError } from '@starling/core';
import { MemoryStore, makeAgentEvent, makeRun } from '@starling/core/testing';
import { DEFAULT_REPLAY_SPEED, loadReplayFile, startJsonlReplay, startReplay } from './replay';

const FIXTURE = resolve(import.meta.dir, '../../../fixtures/runs/sky-todo-launch-day.jsonl');

const tempDirs: string[] = [];
function writeJsonl(lines: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'starling-replay-'));
  tempDirs.push(dir);
  const path = join(dir, 'run.jsonl');
  writeFileSync(path, `${lines.join('\n')}\n`);
  return path;
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function threeEventRun(): { events: StarlingEvent[]; runId: string } {
  const run = makeRun();
  const events: StarlingEvent[] = [
    { type: 'run.created', runId: run.id, ts: 1_000, payload: { run } },
    { type: 'agent.event', runId: run.id, ts: 1_100, payload: makeAgentEvent({ runId: run.id }) },
    {
      type: 'run.finished',
      runId: run.id,
      ts: 1_200,
      payload: { run: { ...run, status: 'finished' }, summary: 'all merged' },
    },
  ];
  return { events, runId: run.id };
}

function writeRunFile(events: StarlingEvent[]): string {
  return writeJsonl(events.map((event) => JSON.stringify(event)));
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000, what = 'condition'): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((done) => setTimeout(done, 5));
  }
}

describe('loadReplayFile', () => {
  test('parses the recorded launch-day run and validates every event', () => {
    const file = loadReplayFile(FIXTURE);
    expect(file.events).toHaveLength(252);
    expect(file.runId).toBe('01jd2k7m3p4q5r6s7t8v9w0x1y');
    expect(file.spanMs).toBe(356_000);
  });

  test('rejects invalid JSON with the line number', () => {
    const path = writeJsonl([
      JSON.stringify({ type: 'log', runId: '*', ts: 1, payload: { level: 'info', msg: 'hi' } }),
      '{oops',
    ]);
    expect(() => loadReplayFile(path)).toThrow(StarlingError);
    try {
      loadReplayFile(path);
    } catch (err) {
      expect((err as StarlingError).code).toBe('INVALID_ARGUMENT');
      expect((err as StarlingError).message).toContain('line 2');
    }
  });

  test('rejects an event that fails the contract schema', () => {
    const path = writeJsonl(['{"type":"metrics","runId":"r1","ts":1,"payload":{}}']);
    expect(() => loadReplayFile(path)).toThrow(StarlingError);
  });

  test('rejects an empty file', () => {
    const path = writeJsonl([]);
    expect(() => loadReplayFile(path)).toThrow(/empty/);
  });

  test('rejects a file with no run-scoped events', () => {
    const path = writeJsonl([
      JSON.stringify({
        type: 'log',
        runId: '*',
        ts: 1,
        payload: { level: 'info', msg: 'hub only' },
      }),
    ]);
    expect(() => loadReplayFile(path)).toThrow(/no run-scoped events/);
  });

  test('rejects a missing file', () => {
    expect(() => loadReplayFile('/tmp/starling-no-such-replay.jsonl')).toThrow(StarlingError);
  });
});

describe('startReplay', () => {
  test('publishes run.created synchronously and persists the run', () => {
    const { events, runId } = threeEventRun();
    const store = new MemoryStore();
    const bus = createEventBus();
    const seen: StarlingEvent[] = [];
    bus.subscribe((event) => seen.push(event));

    const replay = startReplay({ file: { events, runId, spanMs: 200 }, store, bus, speed: 1_000 });
    expect(seen).toHaveLength(1);
    expect(store.getRun(runId)?.status).toBe('running');

    // Other events are still scheduled; stop before they fire to keep the test deterministic.
    replay.stop();
  });

  test('delivers every event in recorded order at the end of a pass', async () => {
    const { events, runId } = threeEventRun();
    const store = new MemoryStore();
    const bus = createEventBus();
    const seen: StarlingEvent[] = [];
    bus.subscribe((event) => seen.push(event));

    const replay = startReplay({ file: { events, runId, spanMs: 200 }, store, bus, speed: 1_000 });
    await replay.done;

    expect(seen.map((event) => event.type)).toEqual(['run.created', 'agent.event', 'run.finished']);
    expect(store.events(runId).map((event) => event.ts)).toEqual([1_000, 1_100, 1_200]);
    expect(store.getRun(runId)?.status).toBe('finished');
  });

  test('loops with monotonically increasing timestamps', async () => {
    const { events, runId } = threeEventRun();
    const store = new MemoryStore();
    const bus = createEventBus();
    const created: number[] = [];
    bus.subscribe((event) => {
      if (event.type === 'run.created') created.push(event.ts);
    });

    const replay = startReplay({
      file: { events, runId, spanMs: 200 },
      store,
      bus,
      speed: 1_000,
      loop: true,
      gapMs: 10,
    });
    try {
      await waitFor(() => created.length >= 3, 2_000, 'three loop passes');
      expect(created[0]).toBe(1_000);
      expect(created[1]).toBe(1_210);
      expect(created[2]).toBe(1_420);
    } finally {
      replay.stop();
    }
  });

  test('stop() halts publication', async () => {
    const { events, runId } = threeEventRun();
    const store = new MemoryStore();
    const bus = createEventBus();
    const seen: StarlingEvent[] = [];
    bus.subscribe((event) => seen.push(event));

    const replay = startReplay({
      file: { events, runId, spanMs: 200 },
      store,
      bus,
      speed: 1,
      loop: true,
    });
    replay.stop();
    const captured = seen.length;
    await new Promise((done) => setTimeout(done, 120));
    expect(seen.length).toBe(captured);
  });

  test('startJsonlReplay loads a file and reports its run id', async () => {
    const { events, runId } = threeEventRun();
    const path = writeRunFile(events);
    const store = new MemoryStore();
    const bus = createEventBus();

    const replay = startJsonlReplay(path, { store, bus, speed: 1_000 });
    expect(replay.runId).toBe(runId);
    await replay.done;
    expect(store.events(runId)).toHaveLength(3);
  });

  test('clamps an absurd speed instead of dividing by zero', () => {
    const { events, runId } = threeEventRun();
    const store = new MemoryStore();
    const bus = createEventBus();
    const replay = startReplay({ file: { events, runId, spanMs: 200 }, store, bus, speed: 0 });
    replay.stop();
    expect(DEFAULT_REPLAY_SPEED).toBe(4);
  });
});
