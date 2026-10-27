import { afterEach, beforeEach, expect, test } from 'bun:test';
import type { Run, TaskRun } from '@starling/core';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { demoEvents } from '../../data/demo';
import { applyEvents, createInitialState, type SkyState } from '../../data/reducer';
import { ensureDom } from '../../lib/test-dom';
import { ReportPage } from './ReportPage';

ensureDom();
beforeEach(ensureDom);
afterEach(() => {
  if (typeof document !== 'undefined') cleanup();
  if (globalThis.localStorage !== undefined) globalThis.localStorage.clear();
});

const FINISHED_AT = 1_731_000_356_000;
const FIXTURE: SkyState = applyEvents(createInitialState(), demoEvents());
const RUN_ID = '01jd2k7m3p4q5r6s7t8v9w0x1y';

function fixtureRun(): Run {
  const run = FIXTURE.runs[RUN_ID];
  if (run === undefined) throw new Error('fixture run missing');
  return run;
}

function withSecondRun(): SkyState {
  const first = fixtureRun();
  const merged: TaskRun = {
    runId: 'run-second',
    taskKey: 'solo',
    status: 'merged',
    attempts: 0,
    usage: { input: 1, output: 1, cached: 0 },
    costUsd: 0.01,
    startedAt: first.startedAt + 10_000,
    finishedAt: first.startedAt + 20_000,
    nodeId: 'hub',
  };
  const second: Run = {
    ...first,
    id: 'run-second',
    goal: { ...first.goal, text: 'Second goal: ship the thing' },
    tasks: { solo: merged },
    plan: undefined,
    status: 'finished',
    startedAt: first.startedAt + 10_000,
    finishedAt: first.startedAt + 20_000,
  };
  return {
    ...FIXTURE,
    runs: { ...FIXTURE.runs, 'run-second': second },
    activeRunId: 'run-second',
  };
}

function runningState(): SkyState {
  const run = fixtureRun();
  const task: TaskRun = {
    runId: 'run-live',
    taskKey: 'theme',
    status: 'running',
    attempts: 0,
    usage: { input: 10, output: 5, cached: 0 },
    costUsd: 0.01,
    startedAt: run.startedAt,
    nodeId: 'hub',
  };
  const live: Run = {
    ...run,
    id: 'run-live',
    tasks: { theme: task },
    plan: undefined,
    status: 'running',
    finishedAt: undefined,
    integrationBranch: undefined,
    metrics: { ...run.metrics, apiCostUsd: 0.01, localCallCount: 2, estSavedUsd: 0.004 },
  };
  return {
    ...createInitialState(),
    runs: { 'run-live': live },
    activeRunId: 'run-live',
    connection: 'offline',
  };
}

function text(container: HTMLElement, testId: string): string {
  return container.querySelector(`[data-testid="${testId}"]`)?.textContent?.trim() ?? '';
}

test('the hero lands the fixture: 7/7, the wall time and the money', () => {
  const view = render(<ReportPage state={FIXTURE} now={FINISHED_AT} />);
  expect(text(view.container, 'report-outcome')).toBe('Landed.');
  expect(text(view.container, 'report-hero-tasks')).toContain('7/7 tasks landed');
  expect(text(view.container, 'report-stat-wall')).toContain('5m 56s');
  expect(text(view.container, 'report-stat-cost')).toContain('$0.042');
  expect(text(view.container, 'report-stat-local')).toContain('$0.019');
  expect(text(view.container, 'report-goal')).toContain('Add dark mode with a toggle');
});

test('every estimate is labelled and the footnote explains it', () => {
  const view = render(<ReportPage state={FIXTURE} now={FINISHED_AT} />);
  const saved = text(view.container, 'report-stat-saved');
  expect(saved.toLowerCase()).toContain('estimate');
  const comparison = text(view.container, 'report-comparison');
  expect(comparison.toLowerCase()).toContain('estimate');
  expect(text(view.container, 'report-estimate').toLowerCase()).toContain('estimate');
  expect(comparison).toContain('8m 31s');
});

test('the one-agent-vs-flock bars show the speed-up', () => {
  const view = render(<ReportPage state={FIXTURE} now={FINISHED_AT} />);
  expect(text(view.container, 'report-speedup')).toContain('1.44× faster than one agent');
  const bars = view.container.querySelectorAll('[data-testid="report-comparison"] [role="img"]');
  expect(bars).toHaveLength(2);
  expect(bars[0]?.getAttribute('aria-label')).toContain('One agent (estimate)');
  expect(bars[1]?.getAttribute('aria-label')).toContain('The flock');
});

test('node cards name the roosts and the migration', () => {
  const view = render(<ReportPage state={FIXTURE} now={FINISHED_AT} />);
  expect(text(view.container, 'report-node-hub')).toContain('MacBook Pro');
  expect(text(view.container, 'report-node-hub')).toContain('5/5 landed');
  expect(text(view.container, 'report-node-hub')).toContain('1 migrated in');
  expect(text(view.container, 'report-node-air')).toContain('MacBook Air');
  expect(text(view.container, 'report-node-air')).toContain('2/2 landed');
  expect(text(view.container, 'report-node-air')).toContain('1 migrated out');
});

test('the auditor card shows the failed attempt, its checks and the reviewer', () => {
  const view = render(<ReportPage state={FIXTURE} now={FINISHED_AT} />);
  const card = view.getByTestId('report-verdict-theme-1');
  expect(card.textContent).toContain('failed attempt 1');
  expect(card.textContent).toContain('passed on attempt 2');
  expect(card.textContent).toContain('definition-of-done');
  expect(card.textContent).toContain('qwen3.6:35b-a3b');
  expect(card.textContent).toContain('Fix asked for');
  expect(text(view.container, 'report-summary')).toContain('Seven tasks merged');
});

test('clicking a task chip and a verdict opens the agent drawer callback', () => {
  const picked: string[] = [];
  const view = render(
    <ReportPage state={FIXTURE} now={FINISHED_AT} onSelectTask={(key) => picked.push(key)} />,
  );
  fireEvent.click(view.getByTestId('report-task-theme'));
  fireEvent.click(view.getAllByText('Inspect theme')[0] as HTMLElement);
  expect(picked).toEqual(['theme', 'theme']);
  expect(view.getByTestId('report-task-theme').getAttribute('aria-pressed')).toBe('false');
});

test('the run picker reports the selection and switches the page', () => {
  const selected: string[] = [];
  const view = render(
    <ReportPage state={withSecondRun()} now={FINISHED_AT} onSelectRun={(id) => selected.push(id)} />,
  );
  expect(text(view.container, 'report-goal')).toContain('Second goal');
  fireEvent.change(view.getByTestId('report-run-select'), { target: { value: RUN_ID } });
  expect(selected).toEqual([RUN_ID]);
  expect(text(view.container, 'report-goal')).toContain('Add dark mode');
  expect(text(view.container, 'report-hero-tasks')).toContain('7/7 tasks landed');
});

test('the print button calls the guarded window.print', () => {
  const calls: string[] = [];
  const original = window.print;
  window.print = () => calls.push('print');
  try {
    const view = render(<ReportPage state={FIXTURE} now={FINISHED_AT} />);
    fireEvent.click(view.getByTestId('report-print'));
    expect(calls).toEqual(['print']);
  } finally {
    window.print = original;
  }
});

test('an empty store renders the empty state', () => {
  const view = render(<ReportPage state={createInitialState()} />);
  expect(view.getByTestId('report-empty')).toBeTruthy();
  expect(view.container.textContent).toContain('No flight to report yet');
});

test('an in-flight run says it is still flying and keeps a live note', () => {
  const state = runningState();
  const view = render(<ReportPage state={state} now={fixtureRun().startedAt + 60_000} />);
  expect(text(view.container, 'report-outcome')).toBe('Still flying.');
  expect(text(view.container, 'report-live-note')).toContain('Still flying');
  expect(text(view.container, 'report-stat-wall')).toContain('1m 00s');
});

test('a live hub merges the optional server report over the local derivation', async () => {
  const state: SkyState = { ...FIXTURE, connection: 'live' };
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    calls.push(String(input));
    return new Response(
      JSON.stringify({
        runId: RUN_ID,
        summary: 'A server-owned summary',
        costUsd: 1.234,
        outcome: 'landed',
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;

  const view = render(<ReportPage state={state} now={FINISHED_AT} fetchImpl={fetchImpl} />);
  await waitFor(() => expect(text(view.container, 'report-summary')).toContain('A server-owned summary'));
  expect(calls).toEqual([`/api/runs/${RUN_ID}/report`]);
  expect(text(view.container, 'report-stat-cost')).toContain('$1.23');
  // Locally derived fields survive the merge.
  expect(text(view.container, 'report-hero-tasks')).toContain('7/7 tasks landed');
  expect(text(view.container, 'report-story')).toContain('MacBook Air');
});

test('a 501 from an older hub falls back silently to the local report', async () => {
  const state: SkyState = { ...FIXTURE, connection: 'live' };
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return new Response('not implemented', { status: 501 });
  }) as unknown as typeof fetch;

  const view = render(<ReportPage state={state} now={FINISHED_AT} fetchImpl={fetchImpl} />);
  await waitFor(() => expect(calls).toBe(1));
  expect(text(view.container, 'report-summary')).toContain('Seven tasks merged');
  expect(text(view.container, 'report-stat-cost')).toContain('$0.042');
});

test('a server report for another run is ignored', async () => {
  const state: SkyState = { ...FIXTURE, connection: 'live' };
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ runId: 'someone-else', costUsd: 99 }), {
      status: 200,
    })) as unknown as typeof fetch;

  const view = render(<ReportPage state={state} now={FINISHED_AT} fetchImpl={fetchImpl} />);
  await waitFor(() => expect(view.container.querySelector('[data-testid="report-hero"]')).toBeTruthy());
  expect(text(view.container, 'report-stat-cost')).toContain('$0.042');
});

test('demo mode never calls the report endpoint', () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return new Response('{}', { status: 200 });
  }) as unknown as typeof fetch;
  render(<ReportPage state={FIXTURE} now={FINISHED_AT} fetchImpl={fetchImpl} />);
  expect(calls).toBe(0);
});

test('story beats render with T+m:ss timestamps', () => {
  const view = render(<ReportPage state={FIXTURE} now={FINISHED_AT} />);
  const story = text(view.container, 'report-story');
  expect(story).toContain('T+0:01');
  expect(story).toContain('T+5:56');
  expect(view.container.querySelectorAll('[data-testid^="report-beat-"]').length).toBeGreaterThan(5);
});
