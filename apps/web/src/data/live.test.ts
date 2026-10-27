import { describe, expect, test } from 'bun:test';
import { createEventBus } from '@starling/core';
import type { Run, StarlingEvent } from '@starling/core/browser';
import { makeRun, makeTaskRun } from '@starling/core/testing';
import type { PublicConfig } from './api';
import {
  demoJoinInfo,
  fetchJoinInfo,
  fetchPublicConfig,
  fetchRuns,
  fetchTaskDiff,
  isPublicConfig,
} from './api';
import { type SkySink, startSkyData } from './bootstrap';
import type { JoinInfo } from './handshake';
import { applyEvent, createInitialState, diffKey } from './reducer';
import { drawerProps } from './selectors';
import type { EventSourceLike } from './sse';

const BASE_TS = 1_700_000_000_000;

interface SinkRecord extends SkySink {
  ingested: StarlingEvent[];
  connections: string[];
  runs: Run[];
  joins: Array<JoinInfo | undefined>;
  configs: Array<PublicConfig | undefined>;
  resets: number;
}

function makeSink(): SinkRecord {
  const record: SinkRecord = {
    ingested: [],
    connections: [],
    runs: [],
    joins: [],
    configs: [],
    resets: 0,
    ingest: (event) => {
      record.ingested.push(event);
    },
    setConnection: (connection) => {
      record.connections.push(connection);
    },
    reset: () => {
      record.resets += 1;
    },
    ingestRuns: (runs) => {
      record.runs.push(...runs);
    },
    setJoin: (join) => {
      record.joins.push(join);
    },
    setPublicConfig: (config) => {
      record.configs.push(config);
    },
  };
  return record;
}

interface Route {
  status?: number;
  body?: unknown;
}

function routedFetch(routes: Record<string, Route>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const key = typeof input === 'string' ? input : String(input);
    const route = routes[key];
    if (route === undefined) {
      return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'nope' } }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify(route.body ?? {}), {
      status: route.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

class StubEventSource implements EventSourceLike {
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  closed = false;
  constructor(readonly url: string) {}
  close(): void {
    this.closed = true;
  }
}

const CONFIG: PublicConfig = {
  version: '1.2.3',
  profile: 'opencode',
  models: {
    planner: 'deepseek-v4.1-flash',
    worker: 'deepseek-v4.1-flash',
    resolver: 'deepseek-v4.1-flash',
    auditor: 'deepseek-v4.1-flash',
    summarizer: 'deepseek-v4.1-flash',
    writer: 'deepseek-v4.1-flash',
  },
  flockEnabled: true,
};

const JOIN: JoinInfo = {
  code: 'LIVE-1234',
  hubUrl: 'http://localhost:7777',
  command: 'starling perch --hub http://localhost:7777 --code LIVE-1234',
};

describe('live boot', () => {
  test('hydrates runs + join + config, then tails /api/events', async () => {
    const older = makeRun({ startedAt: BASE_TS - 10_000 });
    const newer = makeRun({ startedAt: BASE_TS });
    const sink = makeSink();
    const sources: StubEventSource[] = [];
    const result = await startSkyData({
      sink,
      fetchImpl: routedFetch({
        '/api/health': { body: { ok: true, version: '1.2.3' } },
        '/api/runs': { body: [newer, older] },
        '/api/flock/join': { body: JOIN },
        '/api/config/public': { body: CONFIG },
      }),
      factory: (url) => {
        const source = new StubEventSource(url);
        sources.push(source);
        return source;
      },
    });

    expect(result.mode).toBe('live');
    expect(sink.connections).toContain('live');
    expect(sink.runs.map((run) => run.id)).toEqual([newer.id, older.id]);
    expect(sink.joins.at(-1)).toEqual(JOIN);
    expect(sink.configs.at(-1)).toEqual(CONFIG);
    expect(sources[0]?.url).toBe('/api/events');

    sources[0]?.onmessage?.({
      data: JSON.stringify({
        type: 'run.created',
        runId: '01new',
        ts: Date.now(),
        payload: { run: { ...newer, id: '01new', startedAt: BASE_TS + 5_000 } },
      }),
    } as MessageEvent);
    expect(sink.ingested).toHaveLength(1);
    result.stop();
    expect(sources[0]?.closed).toBe(true);
  });

  test('resumes from a cursor and treats a 503 join as single-node mode', async () => {
    const sink = makeSink();
    const sources: StubEventSource[] = [];
    const result = await startSkyData({
      demo: false,
      since: 1_234,
      sink,
      fetchImpl: routedFetch({
        '/api/runs': { body: [] },
        '/api/flock/join': { status: 503, body: { error: { code: 'FLOCK_DISABLED' } } },
      }),
      factory: (url) => {
        sources.push(new StubEventSource(url));
        return sources[0] as StubEventSource;
      },
    });

    expect(sources[0]?.url).toBe('/api/events?since=1234');
    expect(sink.joins.at(-1)).toBeUndefined();
    expect(sink.configs.at(-1)).toBeUndefined();
    result.stop();
  });

  test('demo mode synthesises a join card and never calls the network', async () => {
    const sink = makeSink();
    let called = false;
    const result = await startSkyData({
      demo: true,
      speed: 16,
      sink,
      joinOrigin: 'http://localhost:9999',
      fetchImpl: (async () => {
        called = true;
        throw new Error('demo must not fetch');
      }) as unknown as typeof fetch,
    });

    expect(called).toBe(false);
    expect(result.mode).toBe('demo');
    expect(sink.connections).toContain('demo');
    expect(sink.joins.at(-1)).toEqual(demoJoinInfo('http://localhost:9999'));
    expect(sink.joins.at(-1)?.hubUrl).toBe('http://localhost:9999');
    result.stop();
  });
});

describe('run.status (additive core event)', () => {
  function runStatusEvent(run: Run, from: Run['status'], to: Run['status']): StarlingEvent {
    return {
      type: 'run.status',
      runId: run.id,
      ts: BASE_TS + 1,
      payload: { from, to, run },
    } as unknown as StarlingEvent;
  }

  test('updates the run snapshot and the picker', () => {
    const mapping = makeRun({ status: 'mapping' });
    const running: Run = { ...mapping, status: 'running' };
    let state = applyEvent(createInitialState(), runStatusEvent(running, 'mapping', 'running'));
    expect(state.activeRunId).toBe(mapping.id);
    expect(state.runs[mapping.id]?.status).toBe('running');

    const finished: Run = { ...running, status: 'finished', finishedAt: BASE_TS + 9_000 };
    state = applyEvent(state, runStatusEvent(finished, 'running', 'finished'));
    expect(state.runs[mapping.id]?.status).toBe('finished');
  });

  test('a future run.status event is ignored by the timeline cap but never corrupts state', () => {
    const state = applyEvent(createInitialState(), {
      type: 'run.status',
      runId: 'x',
      ts: 1,
      payload: { from: 'running', to: 'running' },
    } as unknown as StarlingEvent);
    expect(state.runs).toEqual({});
    expect(state.events).toHaveLength(1);
  });
});

describe('run following', () => {
  function created(run: Run): StarlingEvent {
    return { type: 'run.created', runId: run.id, ts: run.startedAt, payload: { run } } as StarlingEvent;
  }

  test('follows a newer run and does not bounce back to an older backlog snapshot', () => {
    const older = makeRun({ startedAt: BASE_TS });
    const newer = makeRun({ startedAt: BASE_TS + 20_000 });
    let state = createInitialState();
    state = applyEvent(state, created(older));
    expect(state.activeRunId).toBe(older.id);
    state = applyEvent(state, created(newer));
    expect(state.activeRunId).toBe(newer.id);
    state = applyEvent(state, created(older));
    expect(state.activeRunId).toBe(newer.id);
  });

  test('hydration is not downgraded by the older run.created backlog', () => {
    const run = makeRun({ startedAt: BASE_TS, status: 'running' });
    const hydrated: Run = { ...run, status: 'running', tasks: { ...run.tasks } };
    let state = { ...createInitialState(), runs: { [run.id]: hydrated } };
    state = applyEvent(state, created({ ...run, status: 'mapping' }));
    expect(state.runs[run.id]?.status).toBe('running');
    expect(state.activeRunId).toBe(run.id);
  });
});

describe('lazy diffs', () => {
  const diff = {
    files: [{ path: 'src/theme.ts', added: 4, removed: 1 }],
    patch: '+++ b/src/theme.ts',
    truncated: false,
  };

  test('fetchTaskDiff returns a DiffSummary, and 404 means no diff yet', async () => {
    const runId = 'r1';
    const withDiff = routedFetch({ '/api/runs/r1/diff/theme': { body: diff } });
    expect(await fetchTaskDiff(runId, 'theme', { fetchImpl: withDiff })).toEqual(diff);

    const notYet = routedFetch({ '/api/runs/r1/diff/theme': { status: 404 } });
    expect(await fetchTaskDiff(runId, 'theme', { fetchImpl: notYet })).toBeUndefined();

    const junk = routedFetch({ '/api/runs/r1/diff/theme': { body: { files: 'no' } } });
    expect(await fetchTaskDiff(runId, 'theme', { fetchImpl: junk })).toBeUndefined();
  });

  test('drawerProps reads the cached diff for the active run and task', () => {
    const run = makeRun({ id: 'r1' });
    let state = applyEvent(createInitialState(), {
      type: 'run.created',
      runId: run.id,
      ts: BASE_TS,
      payload: { run },
    } as StarlingEvent);
    expect(drawerProps({ ...state, selectedTask: 'theme' }).diff).toBeUndefined();
    state = {
      ...state,
      selectedTask: 'theme',
      diffs: { [diffKey(run.id, 'theme')]: diff },
    };
    expect(drawerProps(state).diff).toEqual(diff);
  });
});

describe('REST guards', () => {
  test('rejects junk runs/config bodies instead of rendering them', async () => {
    expect(
      await fetchRuns({ fetchImpl: routedFetch({ '/api/runs': { body: { nope: true } } }) }),
    ).toBeUndefined();
    expect(
      await fetchJoinInfo({ fetchImpl: routedFetch({ '/api/flock/join': { body: { code: 1 } } }) }),
    ).toBeUndefined();
    expect(
      await fetchPublicConfig({ fetchImpl: routedFetch({ '/api/config/public': { body: CONFIG } }) }),
    ).toEqual(CONFIG);
    expect(isPublicConfig({ ...CONFIG, models: {} })).toBe(false);
  });

  test('the demo join card points at the local hub and carries a copyable command', () => {
    const join = demoJoinInfo('http://localhost:7777');
    expect(join.code).toBeString();
    expect(join.command).toContain(`--code ${join.code}`);
  });

  test('a run.created event and a task run factory keep the shapes the UI expects', () => {
    const task = makeTaskRun({ taskKey: 'theme', status: 'running' });
    const bus = createEventBus();
    let seen = 0;
    bus.subscribe(() => {
      seen += 1;
    });
    bus.publish({ type: 'metrics', runId: 'r1', ts: 1, payload: makeRun().metrics });
    expect(task.status).toBe('running');
    expect(seen).toBe(1);
  });
});
