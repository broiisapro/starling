import { afterEach, describe, expect, mock, test } from 'bun:test';
import { demoEvents } from '../data/demo';
import { applyEvents, createInitialState, type SkyState } from '../data/reducer';
import type { DemoSpeed } from '../lib/speed';
import { ensureDom } from '../lib/test-dom';
import { Layout, type LayoutProps } from './Layout';

ensureDom();
const { cleanup, fireEvent, render, screen } = await import('@testing-library/react');

afterEach(cleanup);

const events = demoEvents();
const RUN_ID = events[0]?.runId ?? 'run';
const baseState: SkyState = { ...applyEvents(createInitialState(), events), connection: 'demo' };

function renderLayout(state: SkyState = baseState, overrides: Partial<LayoutProps> = {}) {
  const props: LayoutProps = {
    state,
    speed: 1,
    onSpeedChange: mock((_speed: DemoSpeed) => {}),
    theme: 'dark',
    onToggleTheme: mock(() => {}),
    onSelectRun: mock((_runId: string) => {}),
    onCloseDrawer: mock(() => {}),
    ...overrides,
  };
  return { ...render(<Layout {...props} />), props };
}

describe('Layout regions', () => {
  test('renders the top bar, all five regions and both strip panels', () => {
    const { container } = renderLayout();
    expect(screen.getByText('Starling')).toBeDefined();
    expect(screen.getByRole('heading', { name: 'The sky' })).toBeDefined();

    for (const region of ['flock', 'sky', 'drawer', 'strip', 'queue', 'metrics']) {
      expect(container.querySelector(`[data-region="${region}"]`)).not.toBeNull();
    }

    expect(container.querySelector('[data-region-placeholder="sky"]')).not.toBeNull();
    expect(container.querySelector('[data-region-placeholder="dag"]')).not.toBeNull();
    expect(container.querySelector('[data-region-placeholder="flock"]')).not.toBeNull();
    expect(container.querySelector('[data-region-placeholder="drawer"]')).not.toBeNull();
    expect(container.querySelector('[data-region-placeholder="queue"]')).not.toBeNull();
    expect(container.querySelector('[data-region-placeholder="metrics"]')).not.toBeNull();
    expect(screen.getByText('7/7 landed')).toBeDefined();
  });

  test('shows one option per run and reports picker changes', () => {
    const run = baseState.runs[RUN_ID];
    if (run === undefined) throw new Error('fixture run missing');
    const older = { ...run, id: 'older-run', startedAt: run.startedAt - 60_000 };
    const state: SkyState = { ...baseState, runs: { ...baseState.runs, 'older-run': older } };
    const { props } = renderLayout(state);

    const picker = screen.getByLabelText('Active run') as HTMLSelectElement;
    expect(picker.value).toBe(RUN_ID);
    expect(picker.options).toHaveLength(2);

    fireEvent.change(picker, { target: { value: 'older-run' } });
    expect(props.onSelectRun).toHaveBeenCalledWith('older-run');
  });

  test('shows the demo connection and the active speed, and reports control changes', () => {
    const { props } = renderLayout();
    expect(screen.getByText('demo')).toBeDefined();

    fireEvent.click(screen.getByRole('tab', { name: '16×' }));
    expect(props.onSpeedChange).toHaveBeenCalledWith(16);

    fireEvent.click(screen.getByRole('button', { name: 'Switch to light theme' }));
    expect(props.onToggleTheme).toHaveBeenCalledTimes(1);
  });

  test('collapses the flock region and brings it back', () => {
    const { container } = renderLayout();
    const collapse = screen.getByRole('button', { name: 'Collapse the flock region' });
    expect(collapse.getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(collapse);
    expect(
      screen.getByRole('button', { name: 'Expand the flock region' }).getAttribute('aria-expanded'),
    ).toBe('false');
    expect(container.querySelector('[data-region-placeholder="flock"]')).toBeNull();
    expect(screen.getByText(/Flock ·/)).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Expand the flock region' }));
    expect(container.querySelector('[data-region-placeholder="flock"]')).not.toBeNull();
  });

  test('switches the centre region between the sky and the flight plan', () => {
    renderLayout();
    const dagWrapper = screen.getByText(/The flight plan/).closest('[hidden]') as HTMLElement | null;
    expect(dagWrapper?.hasAttribute('hidden')).toBe(true);

    fireEvent.click(screen.getByRole('tab', { name: 'Flight plan' }));
    const dagAfter = screen.getByText(/The flight plan/).closest('[hidden]') as HTMLElement | null;
    expect(dagAfter).toBeNull();
  });

  test('shows the selected task in the drawer and closes it', () => {
    const { props } = renderLayout({ ...baseState, selectedTask: 'theme' });
    expect(screen.getByText('theme')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Close the agent drawer' }));
    expect(props.onCloseDrawer).toHaveBeenCalledTimes(1);
  });

  test('renders a useful empty state before the first run', () => {
    const { container } = renderLayout(createInitialState());
    expect(screen.getByText('No runs yet')).toBeDefined();
    expect(screen.getByText(/No run yet/)).toBeDefined();
    expect(container.querySelector('[data-region="sky"]')).not.toBeNull();
    expect(container.querySelector('[data-region-placeholder="sky"]')).not.toBeNull();
  });
});
