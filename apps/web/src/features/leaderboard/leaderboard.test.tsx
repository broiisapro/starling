import { afterEach, describe, expect, test } from 'bun:test';
import { BASE_TS, makeNodeInfo, makeRun, makeTaskRun } from '@starling/core/testing';
import { demoEvents } from '../../data/demo';
import { applyEvents, createInitialState, type SkyState } from '../../data/reducer';
import { ensureDom } from '../../lib/test-dom';
import { Leaderboard } from './Leaderboard';

ensureDom();
const { act, cleanup, fireEvent, render, screen } = await import('@testing-library/react');

afterEach(cleanup);

const FIXTURE: SkyState = applyEvents(createInitialState(), demoEvents());

function rankKeyOf(container: HTMLElement, boardId: string): string | null | undefined {
  const first = container.querySelector(`[data-testid="board-${boardId}"] li`);
  return first?.getAttribute('data-rank-key');
}

/** Two merged tasks on one roost; `alphaMs`/`zuluMs` decide who wins the fastest board. */
function raceState(alphaMs: number, zuluMs: number): SkyState {
  const run = makeRun({
    id: 'run-race',
    status: 'running',
    tasks: {
      alpha: makeTaskRun({
        runId: 'run-race',
        taskKey: 'alpha',
        status: 'merged',
        startedAt: BASE_TS,
        finishedAt: BASE_TS + alphaMs,
        nodeId: 'hub',
        costUsd: 0.002,
      }),
      zulu: makeTaskRun({
        runId: 'run-race',
        taskKey: 'zulu',
        status: 'merged',
        startedAt: BASE_TS,
        finishedAt: BASE_TS + zuluMs,
        nodeId: 'hub',
        costUsd: 0.002,
      }),
    },
  });
  return {
    ...createInitialState(),
    runs: { [run.id]: run },
    activeRunId: run.id,
    nodes: { hub: makeNodeInfo({ id: 'hub', name: 'MacBook Pro' }) },
  };
}

describe('Leaderboard (feature panel)', () => {
  test('the recorded run ends with dates-fix first on Fastest bird', () => {
    const { container } = render(<Leaderboard state={FIXTURE} />);
    expect(rankKeyOf(container, 'fastest')).toBe('fastest:dates-fix');
    expect(container.querySelector('[data-testid="board-fastest"]')?.textContent).toContain('33.4s');
  });

  test('the recorded run ends with MacBook Pro first on Busiest perch', () => {
    const { container } = render(<Leaderboard state={FIXTURE} />);
    expect(rankKeyOf(container, 'perch')).toBe('perch:hub');
    const perch = container.querySelector('[data-testid="board-perch"]');
    expect(perch?.textContent).toContain('MacBook Pro');
    expect(perch?.textContent).toContain('5 tasks');
  });

  test('renders every non-empty board with a crown for its leader', () => {
    const { container } = render(<Leaderboard state={FIXTURE} />);
    const panel = screen.getByTestId('leaderboard');
    expect(panel.getAttribute('data-board-count')).toBe('6');
    expect(screen.getByTestId('leaderboard-summary').textContent).toContain('6 boards · 7 birds');
    for (const board of ['fastest', 'hungriest', 'cleanest', 'stubborn', 'perch', 'thriftiest']) {
      expect(screen.getByTestId(`board-card-${board}`)).toBeDefined();
      expect(screen.getByTestId(`crown-${board}`)).toBeDefined();
    }
    expect(container.querySelectorAll('[data-testid="bird-avatar"]').length).toBeGreaterThan(0);
  });

  test('clicking a bird selects its task by key', () => {
    const calls: string[] = [];
    render(<Leaderboard state={FIXTURE} onSelectTask={(key) => calls.push(key)} />);
    fireEvent.click(
      screen.getByTestId('entry-fastest-dates-fix').querySelector('button') as HTMLButtonElement,
    );
    expect(calls).toEqual(['dates-fix']);
  });

  test('node entries are not clickable and never call onSelectTask', () => {
    const calls: string[] = [];
    render(<Leaderboard state={FIXTURE} onSelectTask={(key) => calls.push(key)} />);
    const hub = screen.getByTestId('entry-perch-hub');
    expect(hub.querySelector('button')).toBeNull();
    fireEvent.click(hub);
    expect(calls).toEqual([]);
  });

  test('the selected task is highlighted with aria-current', () => {
    const state: SkyState = { ...FIXTURE, selectedTask: 'theme' };
    render(<Leaderboard state={state} onSelectTask={() => {}} />);
    const row = screen.getByTestId('entry-hungriest-theme');
    expect(row.getAttribute('data-selected')).toBe('true');
    expect(row.querySelector('button')?.getAttribute('aria-current')).toBe('true');
  });

  test('an empty run shows the friendly empty state, not an empty grid', () => {
    render(<Leaderboard state={createInitialState()} />);
    expect(screen.getByText('No birds on the board yet')).toBeDefined();
    expect(screen.queryByTestId('leaderboard-grid')).toBeNull();
    expect(screen.getByTestId('leaderboard-summary').textContent).toContain('No landings yet');
  });

  test('a rank swap moves the rows and shows ▲/▼ badges', () => {
    const view = render(<Leaderboard state={raceState(20_000, 30_000)} badgeMs={2_000} />);
    // alpha leads before the swap.
    expect(rankKeyOf(view.container, 'fastest')).toBe('fastest:alpha');
    view.rerender(<Leaderboard state={raceState(40_000, 30_000)} badgeMs={2_000} />);
    expect(rankKeyOf(view.container, 'fastest')).toBe('fastest:zulu');
    expect(screen.getByTestId('rank-badge-fastest-zulu').getAttribute('title')).toBe('up 1 place');
    expect(screen.getByTestId('rank-badge-fastest-alpha').getAttribute('title')).toBe('down 1 place');
  });

  test('the badge is temporary and clears after the window', async () => {
    const view = render(<Leaderboard state={raceState(20_000, 30_000)} badgeMs={0} />);
    view.rerender(<Leaderboard state={raceState(40_000, 30_000)} badgeMs={0} />);
    expect(screen.queryByTestId('rank-badge-fastest-alpha')).not.toBeNull();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(screen.queryByTestId('rank-badge-fastest-alpha')).toBeNull();
  });

  test('reduced motion turns the FLIP slide off but keeps the information', () => {
    const view = render(<Leaderboard state={raceState(20_000, 30_000)} reducedMotion badgeMs={2_000} />);
    expect(screen.getByTestId('leaderboard').getAttribute('data-rank-motion')).toBe('off');
    expect(screen.getByTestId('entry-fastest-alpha').getAttribute('data-motion')).toBe('off');
    view.rerender(<Leaderboard state={raceState(40_000, 30_000)} reducedMotion badgeMs={2_000} />);
    // The badge is information, not decoration: it still appears without the animation.
    expect(screen.getByTestId('rank-badge-fastest-alpha')).toBeDefined();
    for (const row of view.container.querySelectorAll('[data-rank-key]')) {
      expect(row.getAttribute('data-motion')).toBe('off');
      expect((row as HTMLElement).style.transform).toBe('');
    }
  });

  test('motion is on by default, so the slide runs unless the user opted out', () => {
    render(<Leaderboard state={raceState(20_000, 30_000)} />);
    expect(screen.getByTestId('leaderboard').getAttribute('data-rank-motion')).toBe('on');
    expect(screen.getByTestId('entry-fastest-alpha').getAttribute('data-motion')).toBe('on');
  });
});
