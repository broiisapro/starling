import { afterEach, describe, expect, test } from 'bun:test';
import { lstatSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NodeInfo, StarlingEvent, Workspace } from '@starling/core';
import { createEventBus, FakeClock } from '@starling/core';
import { MockNode, makeRun } from '@starling/core/testing';
import { createSqliteStore } from '@starling/store';
import { tmpDir } from '../testing/tmp';
import { startDashboard } from './dashboard';
import { createDisposalStack } from './dispose';
import { startHubHeartbeat } from './hub-heartbeat';
import { storePathFor, worktreeRootFor } from './paths';
import { createReadOnlyEngine } from './readonly-engine';
import { compactEvent, createCompactEventRecorder, MAX_AGENT_STRING } from './recording';
import { withDependencies } from './workspace-deps';

const baseEvent = (overrides: Partial<StarlingEvent> = {}): StarlingEvent =>
  ({
    type: 'log',
    runId: 'run-1',
    ts: 1,
    payload: { level: 'info', msg: 'hello' },
    ...overrides,
  }) as StarlingEvent;

describe('disposal stack', () => {
  test('runs newest first, once, and collects failures instead of stopping', async () => {
    const order: string[] = [];
    const stack = createDisposalStack();
    stack.push('first', () => {
      order.push('first');
    });
    stack.push('second', () => {
      order.push('second');
      throw new Error('boom');
    });
    stack.push('third', async () => {
      order.push('third');
    });

    const failures = await stack.run();
    expect(order).toEqual(['third', 'second', 'first']);
    expect(failures[0]).toContain('second: boom');

    await stack.run();
    expect(order).toEqual(['third', 'second', 'first']);
    expect(stack.disposed).toBe(true);
  });
});

describe('hub heartbeat', () => {
  test('touches the hub node so a long run does not sweep it offline', async () => {
    const clock = new FakeClock(1_000);
    const node = new MockNode({ id: 'hub', clock });
    const touched: Array<{ id: string; info: NodeInfo }> = [];
    const heartbeat = startHubHeartbeat({
      node,
      registry: { touch: (id, info) => touched.push({ id, info }) },
      clock,
      everyMs: 60_000,
    });

    // The first refresh is immediate and asynchronous.
    await heartbeat.refresh();
    expect(touched[0]?.id).toBe('hub');
    expect(touched.at(-1)?.info.lastSeen).toBe(clock.now());
    heartbeat.stop();
    heartbeat.stop();
  });
});

describe('recording', () => {
  test('clips long agent strings and leaves other events untouched', () => {
    const long = 'x'.repeat(MAX_AGENT_STRING + 50);
    const event = baseEvent({
      type: 'agent.event',
      payload: {
        runId: 'run-1',
        taskKey: 't1',
        sessionId: 's1',
        ts: 1,
        kind: 'text',
        data: { text: long, nested: { delta: long } },
      },
    }) as StarlingEvent;

    const compact = compactEvent(event);
    if (compact.type !== 'agent.event') throw new Error('expected agent.event');
    expect(String(compact.payload.data.text)).toContain('[truncated 50 chars]');
    expect(String(compact.payload.data.text).length).toBeLessThan(long.length);

    const log = baseEvent();
    expect(compactEvent(log)).toBe(log);
  });

  test('stops recording agent chatter past the byte budget but keeps lifecycle events', () => {
    const dir = tmpDir();
    const path = join(dir, 'run.jsonl');
    // A 400-byte budget: the first event fits, the second tips it over.
    const recorder = createCompactEventRecorder(path, '/', { maxBytes: 400 });
    const chatter = baseEvent({
      type: 'agent.event',
      payload: {
        runId: 'run-1',
        taskKey: 't1',
        sessionId: 's1',
        ts: 1,
        kind: 'tool.result',
        data: { output: 'y'.repeat(300) },
      },
    }) as StarlingEvent;
    recorder.record(chatter);
    recorder.record(chatter);
    recorder.record(
      baseEvent({
        type: 'run.finished',
        payload: { run: makeRun({ id: 'run-1' }), summary: 'done' },
      }) as StarlingEvent,
    );

    expect(recorder.capped).toBe(true);
    expect(recorder.dropped).toBe(2);
    const lines = readFileSync(path, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '{}').type).toBe('run.finished');
    // The clip means no uncut tool output reaches the file at all.
    expect(readFileSync(path, 'utf8')).not.toContain('yyyy');
  });
});

describe('paths and dependency links', () => {
  test('resolves worktree roots and the store relative to the repo', () => {
    expect(storePathFor('/tmp/demo')).toBe('/tmp/demo/.starling/starling.db');
    expect(worktreeRootFor('/tmp/demo', '../.starling-worktrees')).toBe('/tmp/.starling-worktrees');
    expect(worktreeRootFor('/tmp/demo', '/var/wt')).toBe('/var/wt');
  });

  test('links node_modules into a new worktree, once', async () => {
    const repo = tmpDir();
    mkdirSync(join(repo, 'node_modules'));
    const worktree = join(repo, 'wt');
    mkdirSync(worktree);
    const created: Array<{ path: string }> = [];
    const workspace = {
      async create(_repo: string, _branch: string, _fromRef: string) {
        created.push({ path: worktree });
        return { path: worktree, branch: 'b' };
      },
    };
    const wrapped = withDependencies(workspace as unknown as Workspace);
    await wrapped.create(repo, 'b', 'main');
    expect(created).toHaveLength(1);
    // A second call is a no-op because the link already exists.
    expect(lstatSync(join(worktree, 'node_modules')).isSymbolicLink()).toBe(true);
  });
});

describe('read-only engine and dashboard', () => {
  let stop: (() => void) | undefined;

  afterEach(() => {
    stop?.();
    stop = undefined;
  });

  test('serves the store over the §6 API', async () => {
    const dir = tmpDir();
    const store = createSqliteStore(join(dir, 'starling.db'));
    const engine = createReadOnlyEngine(store);
    await expect(engine.start({ goal: 'x', repoPath: dir })).rejects.toThrow(/starling run/);

    const bus = createEventBus();
    const dashboard = startDashboard({ engine, store, bus, port: 0 });
    stop = dashboard.stop;
    const health = await fetch(`${dashboard.url}/api/health`);
    expect(health.status).toBe(200);
    const runs = await fetch(`${dashboard.url}/api/runs`);
    expect(runs.status).toBe(200);
    expect(await runs.json()).toEqual([]);
    // Flock routes are honest about no hub in a dash process.
    const join_ = await fetch(`${dashboard.url}/api/flock/join`);
    expect(join_.status).toBe(503);
    store.close();
  });

  test('a busy port is reported with the port in the message', () => {
    const dir = tmpDir();
    const store = createSqliteStore(join(dir, 'starling.db'));
    const bus = createEventBus();
    const first = startDashboard({ engine: createReadOnlyEngine(store), store, bus, port: 0 });
    try {
      expect(() =>
        startDashboard({ engine: createReadOnlyEngine(store), store, bus, port: first.port }),
      ).toThrow(/dashboard/);
    } finally {
      first.stop();
      store.close();
    }
  });
});
