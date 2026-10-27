import { describe, expect, test } from 'bun:test';
import {
  AGENT_LOG_CAP,
  createInitialState,
  EVENT_CAP,
  METRICS_CAP,
} from '../../apps/web/src/data/reducer.ts';
import { applyAll, buildReducerEvents, countMix, maxPerTask, runWebReducerTest } from './web-reducer.ts';

describe('reducer event stream', () => {
  test('starts with run.created, ends with run.finished and covers every reducer branch', () => {
    const events = buildReducerEvents(2_000);
    expect(events).toHaveLength(2_000);
    expect(events[0]?.type).toBe('run.created');
    expect(events.at(-1)?.type).toBe('run.finished');
    const mix = countMix(events);
    for (const type of [
      'run.created',
      'plan.created',
      'task.status',
      'agent.event',
      'audit.verdict',
      'merge.result',
      'metrics',
      'node.joined',
      'log',
      'run.finished',
    ]) {
      expect(mix[type]).toBeGreaterThan(0);
    }
  });

  test('the pure reducer keeps task and agent state for the active run', () => {
    const { state } = applyAll(buildReducerEvents(1_000));
    const run = state.activeRunId === undefined ? undefined : state.runs[state.activeRunId];
    expect(run).toBeDefined();
    expect(Object.keys(run?.tasks ?? {}).length).toBe(30);
    expect(Object.keys(state.agentLog).length).toBeGreaterThan(0);
  });

  test('maxPerTask is the busiest list, not the sum', () => {
    expect(maxPerTask({ a: [1, 2], b: [1], c: [] })).toBe(2);
    expect(maxPerTask({})).toBe(0);
  });
});

describe('caps under 6k events', () => {
  test('every retention cap holds and the state stays bounded', () => {
    const report = runWebReducerTest(6_000);
    expect(report.totalEvents).toBe(6_000);
    expect(report.caps.allOk).toBe(true);
    expect(report.caps.events.actual).toBeLessThanOrEqual(EVENT_CAP);
    expect(report.caps.agentLog.actual).toBeLessThanOrEqual(AGENT_LOG_CAP);
    expect(report.caps.metricsHistory.actual).toBeLessThanOrEqual(METRICS_CAP);
    expect(report.state.jsonBytes).toBeGreaterThan(0);
    expect(report.perEvent.p50Ms).toBeGreaterThan(0);
  });

  test('an empty state applies nothing and stays a valid state', () => {
    const state = createInitialState();
    expect(state.events).toEqual([]);
    expect(state.connection).toBe('offline');
  });
});
