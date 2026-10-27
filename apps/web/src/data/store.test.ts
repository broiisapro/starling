import { beforeEach, describe, expect, test } from 'bun:test';
import type { Run, StarlingEvent } from '@starling/core';
import { demoEvents } from './demo';
import { useSky } from './store';

const events = demoEvents();
const created = events[0];
if (created?.type !== 'run.created') throw new Error('fixture must start with run.created');
const createdRun = created.payload.run;

function runCreated(id: string, startedAt: number): StarlingEvent {
  const run: Run = {
    ...createdRun,
    id,
    goal: { ...createdRun.goal, id: `goal-${id}` },
    tasks: {},
    startedAt,
  };
  return { type: 'run.created', runId: id, ts: startedAt, payload: { run } };
}

beforeEach(() => {
  useSky.getState().reset();
  useSky.getState().setConnection('offline');
});

describe('zustand store', () => {
  test('ingest applies one event', () => {
    useSky.getState().ingest(created);
    const state = useSky.getState();
    expect(state.activeRunId).toBe(created.runId);
    expect(state.events).toHaveLength(1);
  });

  test('ingestMany applies a backlog in order', () => {
    useSky.getState().ingestMany(events);
    const state = useSky.getState();
    expect(state.events).toHaveLength(events.length);
    expect(state.runs[created.runId]?.status).toBe('finished');
  });

  test('selectTask opens and closes the drawer', () => {
    useSky.getState().selectTask('theme');
    expect(useSky.getState().selectedTask).toBe('theme');
    useSky.getState().selectTask();
    expect(useSky.getState().selectedTask).toBeUndefined();
  });

  test('setActiveRun re-filters the timeline but keeps flock-global events', () => {
    const a = runCreated('run-a', 1);
    const b = runCreated('run-b', 2);
    useSky.getState().ingestMany([a, b]);
    useSky.getState().ingest({
      type: 'node.left',
      runId: '*',
      ts: 3,
      payload: { nodeId: 'air', reason: 'test' },
    });

    expect(useSky.getState().activeRunId).toBe('run-b');
    useSky.getState().setActiveRun('run-a');
    const state = useSky.getState();
    expect(state.activeRunId).toBe('run-a');
    expect(state.events.map((event) => event.runId)).toEqual(['run-a', '*']);
  });

  test('reset clears the run but keeps the mode so a demo loop stays in demo', () => {
    useSky.getState().setConnection('demo');
    useSky.getState().setJoin({ code: 'BIRD', hubUrl: 'http://hub:7777', command: 'starling perch' });
    useSky.getState().ingestMany(events);
    useSky.getState().reset();

    const state = useSky.getState();
    expect(state.runs).toEqual({});
    expect(state.events).toEqual([]);
    expect(state.join).toBeUndefined();
    expect(state.connection).toBe('demo');
  });

  test('setJoin stores and clears the join info', () => {
    const join = { code: 'BIRD', hubUrl: 'http://hub:7777', command: 'starling perch' };
    useSky.getState().setJoin(join);
    expect(useSky.getState().join).toEqual(join);
    useSky.getState().setJoin(undefined);
    expect(useSky.getState().join).toBeUndefined();
  });
});
