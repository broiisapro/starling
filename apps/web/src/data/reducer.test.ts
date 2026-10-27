import { describe, expect, test } from 'bun:test';
import type { StarlingEvent } from '@starling/core';
import { emptyMetrics } from '@starling/core';
import { demoEvents } from './demo';
import {
  AGENT_LOG_CAP,
  applyEvent,
  applyEvents,
  createInitialState,
  EVENT_CAP,
  MERGE_CAP,
  METRICS_CAP,
  type SkyState,
} from './reducer';

const events = demoEvents();
const RUN_ID = events[0]?.runId ?? 'run';
const finalState: SkyState = applyEvents(createInitialState(), events);

function agentEvent(taskKey: string, ts: number): StarlingEvent {
  return {
    type: 'agent.event',
    runId: RUN_ID,
    ts,
    payload: { runId: RUN_ID, taskKey, sessionId: 'ses_test', ts, kind: 'text', data: { text: 'tweet' } },
  };
}

function metricsEvent(ts: number): StarlingEvent {
  return { type: 'metrics', runId: RUN_ID, ts, payload: emptyMetrics() };
}

describe('reducer over the recorded launch-day run', () => {
  test('reaches seven merged tasks in one finished run', () => {
    expect(Object.keys(finalState.runs)).toHaveLength(1);
    expect(finalState.activeRunId).toBe(RUN_ID);

    const run = finalState.runs[RUN_ID];
    expect(run).toBeDefined();
    expect(run?.status).toBe('finished');
    expect(run?.integrationBranch).toBe('starling/9w0x1y/integration');
    const tasks = Object.values(run?.tasks ?? {});
    expect(tasks).toHaveLength(7);
    expect(tasks.every((task) => task.status === 'merged')).toBe(true);
  });

  test('keeps both roosts after the Air drops and rejoins', () => {
    expect(Object.keys(finalState.nodes).sort()).toEqual(['air', 'hub']);
    expect(finalState.nodes.hub?.status).toBe('online');
    expect(finalState.nodes.air?.status).toBe('online');
    expect(finalState.nodes.hub?.kind).toBe('local');
    expect(finalState.nodes.air?.kind).toBe('remote');
  });

  test('records the one migration and shows it in the timeline', () => {
    const migrated = finalState.events.find((event) => event.type === 'task.migrated');
    expect(migrated).toBeDefined();
    if (migrated?.type !== 'task.migrated') throw new Error('expected task.migrated');
    expect(migrated.payload).toMatchObject({ taskKey: 'search', fromNode: 'air', toNode: 'hub' });
    expect(finalState.runs[RUN_ID]?.tasks.search?.nodeId).toBe('hub');
  });

  test('keeps the full verdict history, including the failed theme attempt', () => {
    expect(finalState.verdicts.theme).toHaveLength(2);
    expect(finalState.verdicts.theme?.map((verdict) => verdict.pass)).toEqual([false, true]);
    expect(finalState.verdicts.theme?.[0]?.attempt).toBe(1);
    expect(finalState.verdicts.theme?.[1]?.attempt).toBe(2);
    expect(finalState.runs[RUN_ID]?.tasks.theme?.lastVerdict?.pass).toBe(true);
    expect(finalState.verdicts.search).toHaveLength(1);
    expect(finalState.verdicts.search?.[0]?.attempt).toBe(2);
  });

  test('collects all seven merge results', () => {
    expect(finalState.merges).toHaveLength(7);
    expect(finalState.merges.every((merge) => merge.status === 'merged')).toBe(true);
    expect(finalState.merges.map((merge) => merge.taskKey)).toContain('help-overlay');
  });

  test('collects the agent transcript per task', () => {
    const log = finalState.agentLog.theme ?? [];
    expect(log).toHaveLength(25);
    expect(log[0]?.kind).toBe('session.started');
    expect(log.at(-1)?.kind).toBe('session.idle');
    expect(finalState.agentLog['help-overlay']).toHaveLength(12);
  });

  test('collects the metrics history and the final numbers', () => {
    expect(finalState.metricsHistory).toHaveLength(72);
    const latest = finalState.metricsHistory.at(-1)?.metrics;
    expect(latest?.tasksMerged).toBe(7);
    expect(latest?.apiCostUsd).toBeGreaterThan(0);
    expect(finalState.runs[RUN_ID]?.metrics.tasksMerged).toBe(7);
  });

  test('keeps all 252 events (active run plus flock-global)', () => {
    expect(finalState.events).toHaveLength(events.length);
    expect(finalState.events.some((event) => event.runId === '*')).toBe(true);
    expect(finalState.events.at(-1)?.type).toBe('run.finished');
  });

  test('attaches the plan to the run', () => {
    const plan = finalState.runs[RUN_ID]?.plan;
    expect(plan?.tasks).toHaveLength(7);
    expect(plan?.summary).toContain('Seven lane-disjoint tasks');
  });
});

describe('reducer invariants', () => {
  test('is pure: applying an event never mutates the previous state', () => {
    const before = structuredClone(finalState);
    const next = applyEvent(finalState, metricsEvent(1_731_000_400_000));
    expect(finalState).toStrictEqual(before);
    expect(next).not.toBe(finalState);
  });

  test('drops events from a run that is not active, but keeps global flock events', () => {
    let state = createInitialState();
    const created = events[0];
    if (created === undefined) throw new Error('fixture is empty');
    state = applyEvent(state, created);
    const before = state.events.length;

    const foreign: StarlingEvent = {
      type: 'log',
      runId: 'another-run',
      ts: 1,
      payload: { level: 'info', msg: 'not ours' },
    };
    state = applyEvent(state, foreign);
    expect(state.events).toHaveLength(before);

    state = applyEvent(state, { ...foreign, runId: '*' });
    expect(state.events).toHaveLength(before + 1);
  });

  test('caps the event log at 5,000', () => {
    let state = createInitialState();
    for (let index = 0; index < EVENT_CAP + 100; index += 1) {
      state = applyEvent(state, agentEvent('theme', index));
    }
    expect(state.events).toHaveLength(EVENT_CAP);
    expect(state.events[0]?.ts).toBe(100);
    expect(state.events.at(-1)?.ts).toBe(EVENT_CAP + 99);
  });

  test('caps each agent log at 500 events', () => {
    let state = createInitialState();
    for (let index = 0; index < AGENT_LOG_CAP + 20; index += 1) {
      state = applyEvent(state, agentEvent('theme', index));
    }
    expect(state.agentLog.theme).toHaveLength(AGENT_LOG_CAP);
    expect(state.agentLog.theme?.[0]?.ts).toBe(20);
  });

  test('caps metrics history at 2,000 samples', () => {
    let state = createInitialState();
    for (let index = 0; index < METRICS_CAP + 25; index += 1) {
      state = applyEvent(state, metricsEvent(index));
    }
    expect(state.metricsHistory).toHaveLength(METRICS_CAP);
    expect(state.metricsHistory.at(-1)?.ts).toBe(METRICS_CAP + 24);
  });

  test('caps merge history at 500', () => {
    let state = createInitialState();
    for (let index = 0; index < MERGE_CAP + 5; index += 1) {
      state = applyEvent(state, {
        type: 'merge.result',
        runId: RUN_ID,
        ts: index,
        payload: {
          taskKey: `t${index}`,
          status: 'merged',
          conflictedFiles: [],
          detail: 'landed',
          ts: index,
        },
      });
    }
    expect(state.merges).toHaveLength(MERGE_CAP);
  });

  test('marks a node offline on node.left and online again on node.joined', () => {
    const offline = applyEvent(finalState, {
      type: 'node.left',
      runId: '*',
      ts: 5,
      payload: { nodeId: 'air', reason: 'test' },
    });
    expect(offline.nodes.air?.status).toBe('offline');

    const air = finalState.nodes.air;
    if (air === undefined) throw new Error('air missing');
    const online = applyEvent(offline, {
      type: 'node.joined',
      runId: '*',
      ts: 6,
      payload: { node: { ...air, status: 'online' } },
    });
    expect(online.nodes.air?.status).toBe('online');
  });

  test('a task.migrated event updates the task node without touching its status', () => {
    const before = finalState.runs[RUN_ID]?.tasks.search;
    const migrated = applyEvent(finalState, {
      type: 'task.migrated',
      runId: RUN_ID,
      ts: 7,
      payload: { taskKey: 'search', fromNode: 'hub', toNode: 'air', reason: 'test' },
    });
    expect(migrated.runs[RUN_ID]?.tasks.search?.nodeId).toBe('air');
    expect(migrated.runs[RUN_ID]?.tasks.search?.status).toBe(before?.status);
  });

  test('selection survives unrelated events', () => {
    const selected: SkyState = { ...finalState, selectedTask: 'theme' };
    const next = applyEvent(selected, metricsEvent(1));
    expect(next.selectedTask).toBe('theme');
  });

  test('a repomap event is timeline-only', () => {
    const next = applyEvent(finalState, {
      type: 'repomap.ready',
      runId: RUN_ID,
      ts: 8,
      payload: { files: 17, tokenEstimate: 2480 },
    });
    expect(next.events).toHaveLength(finalState.events.length + 1);
    expect(next.runs).toBe(finalState.runs);
  });
});
