import { describe, expect, test } from 'bun:test';
import { makeRun, makeTaskRun } from '@starling/core/testing';
import { formatDuration, renderRunSummary, writerPrompt } from './summary';

describe('formatDuration', () => {
  test('seconds, minutes and hours', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(9_400)).toBe('9s');
    expect(formatDuration(63_000)).toBe('1m 03s');
    expect(formatDuration(3_840_000)).toBe('1h 04m');
  });

  test('never goes negative', () => {
    expect(formatDuration(-500)).toBe('0s');
  });
});

describe('renderRunSummary', () => {
  const tasks = {
    a: makeTaskRun({ taskKey: 'a', status: 'merged' }),
    b: makeTaskRun({ taskKey: 'b', status: 'merged' }),
    c: makeTaskRun({ taskKey: 'c', status: 'failed' }),
    d: makeTaskRun({ taskKey: 'd', status: 'cancelled' }),
  };

  test('counts merges, failures and cancellations', () => {
    const run = makeRun({
      id: '01abc123xyz',
      tasks,
      status: 'finished',
      integrationBranch: 'starling/123xyz/integration',
    });
    const summary = renderRunSummary(run);
    expect(summary).toContain('2/4 tasks');
    expect(summary).toContain('1 failure');
    expect(summary).toContain('1 cancelled');
    expect(summary).toContain('starling/123xyz/integration');
  });

  test('says so when nothing failed', () => {
    const run = makeRun({
      tasks: { a: makeTaskRun({ taskKey: 'a', status: 'merged' }) },
      status: 'finished',
      integrationBranch: 'main',
    });
    expect(renderRunSummary(run)).toContain('no failures');
  });

  test('has a dedicated dry-run line', () => {
    const run = makeRun({ status: 'planned' });
    expect(renderRunSummary(run)).toStartWith('Dry run');
    expect(renderRunSummary(run)).toContain('nothing was dispatched');
  });

  test('has a dedicated cancelled line', () => {
    const run = makeRun({ status: 'cancelled', metrics: { ...makeRun().metrics, elapsedMs: 5000 } });
    expect(renderRunSummary(run)).toContain('cancelled after 5s');
  });

  test('uses the run stamps for the duration when they exist', () => {
    const run = makeRun({
      tasks: { a: makeTaskRun({ taskKey: 'a', status: 'merged' }) },
      startedAt: 1_000,
      finishedAt: 10_000,
      status: 'finished',
    });
    expect(renderRunSummary(run)).toContain('in 9s');
  });

  test('accepts a failure reason for a run that never planned', () => {
    const run = makeRun({ status: 'failed' });
    expect(renderRunSummary(run, { reason: 'planner exploded' })).toBe(
      `Starling run ${run.id.slice(-6)} ended: planner exploded.`,
    );
  });
});

describe('writerPrompt', () => {
  test('states the counts the writer must mention', () => {
    const prompt = writerPrompt(
      makeRun({
        tasks: {
          a: makeTaskRun({ taskKey: 'a', status: 'merged' }),
          b: makeTaskRun({ taskKey: 'b', status: 'conflict' }),
        },
        integrationBranch: 'starling/abc/integration',
      }),
    );
    expect(prompt).toContain('2 total, 1 merged, 0 failed, 1 conflicted, 0 cancelled');
    expect(prompt).toContain('starling/abc/integration');
    expect(prompt).toContain('Plain text only');
  });
});
