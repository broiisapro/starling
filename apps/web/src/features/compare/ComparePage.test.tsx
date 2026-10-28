import { afterEach, describe, expect, test } from 'bun:test';
import type { Run } from '@starling/core/browser';
import { createInitialState, type SkyState } from '../../data/reducer';
import { ensureDom } from '../../lib/test-dom';
import { ComparePage } from './ComparePage';
import { runLabel } from './selection';
import { fixtureRun, fixtureState, secondRun, twoRunState } from './test-fixtures';
import type { CompareHistory, CompareLocation } from './url';

ensureDom();
const { cleanup, fireEvent, render, waitFor } = await import('@testing-library/react');

afterEach(cleanup);

const a = fixtureRun();
const b = secondRun(a);

function stubHistory(): { calls: Array<{ url?: string | URL | null }>; history: CompareHistory } {
  const calls: Array<{ url?: string | URL | null }> = [];
  return {
    calls,
    history: {
      replaceState: (_data, _unused, url) => {
        calls.push({ url });
      },
    },
  };
}

function liveState(): SkyState {
  const base = twoRunState();
  return { ...base, connection: 'live' };
}

function runningState(): SkyState {
  const running: Run = {
    ...fixtureRun(),
    status: 'running',
    finishedAt: undefined,
    tasks: {},
  };
  return {
    ...createInitialState(),
    runs: { [running.id]: running },
    activeRunId: running.id,
    connection: 'demo',
  };
}

describe('ComparePage', () => {
  test('a lone fixture run is compared with its labelled serial baseline', () => {
    const view = render(<ComparePage state={fixtureState()} />);
    expect(view.getByTestId('compare-page').textContent).toContain('Two runs, side by side');
    expect(view.getByTestId('compare-baseline-note').textContent).toContain('one agent, one task at a time');
    expect(view.getByTestId('value-a-speedup').textContent).toBe('1.44×');
    expect(view.getByTestId('value-b-speedup').textContent).toBe('1.00×');
    expect((view.getByTestId('picker-b') as unknown as HTMLSelectElement).value).toBe('baseline');
  });

  test('two recorded runs render both pickers, both labels and the plan diff', () => {
    const view = render(<ComparePage state={twoRunState()} />);
    expect((view.getByTestId('picker-a') as unknown as HTMLSelectElement).value).toBe(a.id);
    expect((view.getByTestId('picker-b') as unknown as HTMLSelectElement).value).toBe(b.id);
    expect(view.getByTestId('run-name-b').textContent).toBe(runLabel(b));
    expect(view.getByTestId('plan-diff-removed').textContent).toContain('help-overlay');
    expect(view.getByTestId('plan-diff-changed').textContent).toContain('shortcuts');
    expect(view.getByTestId('plan-diff-changed').textContent).toContain('lane.owns');
  });

  test('the metric table shows formatted values and a text delta chip', () => {
    const view = render(<ComparePage state={twoRunState()} />);
    expect(view.getByTestId('value-a-wall').textContent).toBe('5m 56s');
    expect(view.getByTestId('value-b-wall').textContent).toBe('5m 56s');
    const delta = view.getByTestId('delta-wall');
    expect(delta.textContent).toContain('=');
    expect(delta.textContent).toContain('same');
    expect(delta.getAttribute('data-better')).toBe('same');
    const cost = view.getByTestId('delta-apiCost');
    expect(cost.getAttribute('data-better')).toBe('a');
    expect(cost.textContent).toContain('▲');
    expect(cost.textContent).toContain('A better');
  });

  test('choosing the baseline updates the URL through history.replaceState', () => {
    const stub = stubHistory();
    const location: CompareLocation = { search: '?demo=1', hash: '' };
    const view = render(
      <ComparePage state={twoRunState()} historyTarget={stub.history} locationTarget={location} />,
    );

    fireEvent.change(view.getByTestId('picker-b'), { target: { value: 'baseline' } });

    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0]?.url).toBe(`?demo=1&a=${a.id}&b=baseline`);
    expect(view.getByTestId('compare-baseline-note')).toBeDefined();
    expect(view.getByTestId('delta-wall').textContent).toContain('▲');
  });

  test('?a=&b= selects that pair on first render', () => {
    const view = render(<ComparePage state={twoRunState()} search={`?a=${b.id}&b=${a.id}`} />);
    expect((view.getByTestId('picker-a') as unknown as HTMLSelectElement).value).toBe(b.id);
    expect((view.getByTestId('picker-b') as unknown as HTMLSelectElement).value).toBe(a.id);
    expect(view.getByTestId('run-name-a').textContent).toBe(runLabel(b));
  });

  test('the same run on both sides shows a notice instead of nonsense', () => {
    const view = render(<ComparePage state={twoRunState()} search={`?a=${a.id}&b=${a.id}`} />);
    expect(view.getByTestId('compare-notice').textContent).toContain('same run');
    expect(view.getByTestId('delta-wall').textContent).toContain('same');
    expect(view.getByTestId('delta-wall').getAttribute('data-better')).toBe('same');
  });

  test('clicking a run name asks the shell to open that run', () => {
    const selected: string[] = [];
    const view = render(<ComparePage state={twoRunState()} onSelectRun={(id) => selected.push(id)} />);
    fireEvent.click(view.getByTestId('run-name-a'));
    fireEvent.click(view.getByTestId('run-name-b'));
    expect(selected).toEqual([a.id, b.id]);
  });

  test('no runs renders the empty state, not a broken table', () => {
    const view = render(<ComparePage state={createInitialState()} />);
    expect(view.getByTestId('compare-page').textContent).toContain('Nothing to compare yet');
    expect(view.queryByTestId('compare-table')).toBeNull();
  });

  test('a live run says its numbers will move', () => {
    const view = render(<ComparePage state={runningState()} now={a.startedAt + 100_000} />);
    expect(view.getByTestId('compare-live-note').textContent).toContain('numbers will move');
    expect(view.getByTestId('value-a-wall').textContent).toBe('1m 40s');
  });

  test('the optional hub rows replace local math when the hub is live', async () => {
    const requests: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      requests.push(String(input));
      return new Response(
        JSON.stringify({
          rows: [
            {
              metric: 'wall',
              label: 'Wall clock',
              format: 'duration',
              a: 1_000,
              b: 2_000,
              delta: -1_000,
              better: 'a',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;

    const view = render(<ComparePage state={liveState()} fetchImpl={fetchImpl} />);
    await waitFor(() => expect(view.getByTestId('value-a-wall').textContent).toBe('1s'));
    expect(requests[0]).toBe(`/api/compare?a=${a.id}&b=${b.id}`);
  });

  test('a failing hub request silently keeps the local table', async () => {
    const fetchImpl = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    const view = render(<ComparePage state={liveState()} fetchImpl={fetchImpl} />);
    await waitFor(() => expect(view.getByTestId('value-a-wall').textContent).toBe('5m 56s'));
    expect(view.getByTestId('compare-table')).toBeDefined();
  });

  test('plans missing on both sides degrade to an empty-diff message', () => {
    const withoutPlan: Run = { ...fixtureRun(), plan: undefined };
    const state: SkyState = {
      ...createInitialState(),
      runs: { [withoutPlan.id]: withoutPlan },
      activeRunId: withoutPlan.id,
      connection: 'demo',
    };
    const view = render(<ComparePage state={state} />);
    expect(view.getByTestId('plan-diff').textContent).toContain('No plans to compare');
  });

  test('respects prefers-reduced-motion on the page root', () => {
    const view = render(<ComparePage state={fixtureState()} />);
    expect(view.getByTestId('compare-page').getAttribute('data-reduced-motion')).toBe('false');
  });

  test('demo mode never asks the hub, even with a fetch implementation', () => {
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return new Response('{}');
    }) as unknown as typeof fetch;
    render(<ComparePage state={twoRunState()} fetchImpl={fetchImpl} />);
    expect(called).toBe(false);
  });
});
