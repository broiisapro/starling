import { describe, expect, test } from 'bun:test';
import type { Run, RunMetrics } from '@starling/core';
import { FakeClock } from '@starling/core';
import { makeRun, makeTaskRun } from '@starling/core/testing';
import { computeRunMetrics, emptyLedger, MetricsPublisher, recordCall } from './metrics';
import { FakeTimers } from './testing/harness';

function runWith(overrides: Partial<Run> = {}): Run {
  return makeRun({
    id: 'run-1',
    startedAt: 1000,
    tasks: {
      a: makeTaskRun({ runId: 'run-1', taskKey: 'a', status: 'merged', nodeId: 'hub' }),
      b: makeTaskRun({ runId: 'run-1', taskKey: 'b', status: 'running', nodeId: 'hub' }),
      c: makeTaskRun({ runId: 'run-1', taskKey: 'c', status: 'failed' }),
      d: makeTaskRun({ runId: 'run-1', taskKey: 'd', status: 'pending' }),
    },
    ...overrides,
  });
}

describe('computeRunMetrics', () => {
  test('counts active, merged and failed tasks', () => {
    const metrics = computeRunMetrics(runWith(), emptyLedger(), 5000);
    expect(metrics.agentsActive).toBe(1);
    expect(metrics.tasksMerged).toBe(1);
    expect(metrics.tasksFailed).toBe(1);
    expect(metrics.elapsedMs).toBe(4000);
  });

  test('freezes elapsed time once the run finished', () => {
    const metrics = computeRunMetrics(runWith({ finishedAt: 3000 }), emptyLedger(), 9000);
    expect(metrics.elapsedMs).toBe(2000);
  });

  test('projects the ledger and the local-vs-API savings', () => {
    const ledger = emptyLedger();
    recordCall(ledger, {
      usage: { input: 1_000_000, output: 1_000_000, cached: 0 },
      model: 'deepseek-v4.1-flash',
      local: false,
    });
    recordCall(ledger, {
      usage: { input: 1_000_000, output: 1_000_000, cached: 0 },
      model: 'qwen3.6:35b-a3b',
      local: true,
    });
    const metrics = computeRunMetrics(runWith(), ledger, 2000);
    expect(metrics.apiCostUsd).toBeCloseTo(0.88, 6);
    expect(metrics.localCallCount).toBe(1);
    expect(metrics.localUsage).toEqual({ input: 1_000_000, output: 1_000_000, cached: 0 });
    expect(metrics.estSavedUsd).toBeCloseTo(0.88, 6);
  });

  test('recordCall uses an explicit cost when the caller has one', () => {
    const ledger = emptyLedger();
    recordCall(ledger, {
      usage: { input: 10, output: 10, cached: 0 },
      model: 'deepseek-v4.1-flash',
      local: false,
      costUsd: 0.5,
    });
    expect(ledger.apiCostUsd).toBe(0.5);
  });
});

describe('MetricsPublisher', () => {
  function publisher(clock: FakeClock, timers = new FakeTimers()) {
    const published: RunMetrics[] = [];
    const metrics = computeRunMetrics(runWith(), emptyLedger(), clock.now());
    const subject = new MetricsPublisher({
      clock,
      compute: () => metrics,
      publish: (value) => published.push(value),
      timers,
    });
    return { subject, published, timers };
  }

  test('publishes immediately, then at most once per second', () => {
    const clock = new FakeClock(10_000);
    const { subject, published } = publisher(clock);
    subject.touch();
    expect(published).toHaveLength(1);

    clock.advance(400);
    subject.touch();
    subject.touch();
    expect(published).toHaveLength(1);
    expect(subject.dirty).toBe(true);

    clock.advance(600); // t = 11_000
    subject.touch();
    expect(published).toHaveLength(2);
    expect(subject.dirty).toBe(false);
  });

  test('a heartbeat publishes regardless of the throttle', () => {
    const clock = new FakeClock(0);
    const { subject, published, timers } = publisher(clock);
    subject.start();
    subject.touch();
    clock.advance(200);
    subject.touch();
    expect(published).toHaveLength(1);

    timers.fireHeartbeat();
    expect(published).toHaveLength(2);
    expect(timers.intervalMs).toBe(5000);
  });

  test('start registers one heartbeat and stop clears it', () => {
    const clock = new FakeClock(0);
    const { subject, timers } = publisher(clock);
    subject.start();
    subject.start();
    expect(timers.active).toBe(1);
    subject.stop();
    expect(timers.active).toBe(0);
    expect(timers.intervalMs).toBe(5000);
  });

  test('publishNow ignores the throttle and touch is inert after stop', () => {
    const clock = new FakeClock(0);
    const { subject, published } = publisher(clock);
    subject.touch();
    subject.publishNow();
    expect(published).toHaveLength(2);
    subject.stop();
    subject.touch();
    subject.publishNow();
    expect(published).toHaveLength(2);
  });
});
