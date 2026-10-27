import { describe, expect, mock, test } from 'bun:test';
import { demoEvents } from './demo';
import type {
  AgentDrawerProps,
  DagViewProps,
  FlockPanelProps,
  MergeQueueProps,
  MetricsPanelProps,
  SkyViewProps,
} from './handshake';
import { applyEvents, createInitialState, RECENT_CAP, type SkyState } from './reducer';
import {
  activeRunOf,
  dagProps,
  drawerProps,
  flockProps,
  metricsProps,
  queueProps,
  recentEvents,
  skyProps,
  sortedNodes,
  sortedRuns,
} from './selectors';

const events = demoEvents();
const RUN_ID = events[0]?.runId ?? 'run';
const state: SkyState = applyEvents(createInitialState(), events);

const selectTask = mock((_key: string) => {});
const closeDrawer = mock(() => {});
const actions = { selectTask, closeDrawer };

describe('selectors produce the exact §8 prop shapes', () => {
  test('skyProps satisfies SkyViewProps', () => {
    const props = skyProps(state, actions) satisfies SkyViewProps;
    expect(props.run?.id).toBe(RUN_ID);
    expect(props.nodes.map((node) => node.id)).toEqual(['hub', 'air']);
    expect(props.recent.length).toBeGreaterThan(0);
    expect(props.recent.length).toBeLessThanOrEqual(RECENT_CAP);
    expect(props.onSelectTask).toBe(selectTask);

    props.onSelectTask('theme');
    expect(selectTask).toHaveBeenCalledWith('theme');
  });

  test('skyProps forwards the selection and filters the recent tail', () => {
    const props = skyProps({ ...state, selectedTask: 'search' }, actions);
    expect(props.selectedTask).toBe('search');
    const types = new Set(props.recent.map((event) => event.type));
    expect(types.has('agent.event')).toBe(true);
    expect(types.has('node.joined')).toBe(true);
    expect(types.has('log')).toBe(false);
    expect(types.has('metrics')).toBe(false);
  });

  test('dagProps satisfies DagViewProps', () => {
    const props = dagProps(state, actions) satisfies DagViewProps;
    expect(props.plan?.tasks).toHaveLength(7);
    expect(Object.keys(props.tasks)).toHaveLength(7);
    expect(props.tasks.theme?.status).toBe('merged');
    expect(props.selectedTask).toBeUndefined();
    expect(props.onSelectTask).toBe(selectTask);
  });

  test('drawerProps satisfies AgentDrawerProps with task, run, transcript and verdicts', () => {
    const props = drawerProps({ ...state, selectedTask: 'theme' }, actions) satisfies AgentDrawerProps;
    expect(props.task?.key).toBe('theme');
    expect(props.run?.status).toBe('merged');
    expect(props.events).toHaveLength(25);
    expect(props.verdicts.map((verdict) => verdict.pass)).toEqual([false, true]);
    expect(props.diff).toBeUndefined();
    expect(props.onClose).toBe(closeDrawer);

    props.onClose();
    expect(closeDrawer).toHaveBeenCalledTimes(1);
  });

  test('drawerProps is safe with no selection', () => {
    const props = drawerProps(state, actions) satisfies AgentDrawerProps;
    expect(props.task).toBeUndefined();
    expect(props.run).toBeUndefined();
    expect(props.events).toEqual([]);
    expect(props.verdicts).toEqual([]);
  });

  test('queueProps satisfies MergeQueueProps', () => {
    const props = queueProps(state, actions) satisfies MergeQueueProps;
    expect(props.merges).toHaveLength(7);
    expect(props.plan?.tasks).toHaveLength(7);
    expect(Object.keys(props.tasks)).toHaveLength(7);
    expect(props.onSelectTask).toBe(selectTask);
  });

  test('metricsProps satisfies MetricsPanelProps and prefers the newest sample', () => {
    const props = metricsProps(state) satisfies MetricsPanelProps;
    expect(props.metrics?.tasksMerged).toBe(7);
    expect(props.metrics?.apiCostUsd).toBeGreaterThan(0);
    expect(props.history).toHaveLength(72);
    expect(props.history.at(-1)?.metrics).toEqual(props.metrics);
  });

  test('flockProps satisfies FlockPanelProps, including the join code when known', () => {
    const join = {
      code: 'BIRD-42',
      hubUrl: 'http://192.168.1.10:7777',
      command: 'starling perch --code BIRD-42',
    };
    const props = flockProps({ ...state, join }) satisfies FlockPanelProps;
    expect(props.nodes.map((node) => node.id)).toEqual(['hub', 'air']);
    expect(Object.keys(props.tasks)).toHaveLength(7);
    expect(props.join).toEqual(join);
  });

  test('every selector degrades gracefully before the first run', () => {
    const empty: SkyState = createInitialState();
    expect(activeRunOf(empty)).toBeUndefined();
    expect(sortedRuns(empty)).toEqual([]);
    expect(sortedNodes(empty)).toEqual([]);
    expect(recentEvents(empty)).toEqual([]);

    const sky = skyProps(empty, actions) satisfies SkyViewProps;
    expect(sky.run).toBeUndefined();
    expect(sky.nodes).toEqual([]);

    const dag = dagProps(empty, actions) satisfies DagViewProps;
    expect(dag.plan).toBeUndefined();
    expect(dag.tasks).toEqual({});

    const drawer = drawerProps(empty, actions) satisfies AgentDrawerProps;
    expect(drawer.events).toEqual([]);

    const queue = queueProps(empty, actions) satisfies MergeQueueProps;
    expect(queue.merges).toEqual([]);

    const metrics = metricsProps(empty) satisfies MetricsPanelProps;
    expect(metrics.metrics).toBeUndefined();
    expect(metrics.history).toEqual([]);

    const flock = flockProps(empty) satisfies FlockPanelProps;
    expect(flock.nodes).toEqual([]);
    expect(flock.join).toBeUndefined();
  });

  test('sortedRuns is newest first and sortedNodes puts the hub first', () => {
    const run = state.runs[RUN_ID];
    if (run === undefined) throw new Error('fixture run missing');
    const older = { ...run, id: 'older', startedAt: run.startedAt - 1 };
    const twoRuns: SkyState = { ...state, runs: { ...state.runs, older } };
    expect(sortedRuns(twoRuns).map((candidate) => candidate.id)).toEqual([RUN_ID, 'older']);
    expect(sortedNodes(state)[0]?.id).toBe('hub');
  });
});
