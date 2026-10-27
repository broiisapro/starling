import { afterEach, describe, expect, mock, test } from 'bun:test';
import { demoEvents, rebaseEvents } from '../data/demo';
import { applyEvents, createInitialState, type SkyState } from '../data/reducer';
import type { DemoSpeed } from '../lib/speed';
import { ensureDom } from '../lib/test-dom';
import { Layout, type LayoutProps } from './Layout';

ensureDom();
const { cleanup, fireEvent, render, screen } = await import('@testing-library/react');

afterEach(cleanup);

const events = rebaseEvents(demoEvents(), 1_800_000_000_000);
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
    onSelectTask: mock((_key: string) => {}),
    ...overrides,
  };
  return { ...render(<Layout {...props} />), props };
}

describe('Layout regions', () => {
  test('mounts every wired panel in its region', () => {
    const { container } = renderLayout();
    expect(screen.getByText('Starling')).toBeDefined();
    expect(screen.getByRole('heading', { name: 'The sky' })).toBeDefined();

    for (const region of ['flock', 'sky', 'drawer', 'strip', 'queue', 'metrics']) {
      expect(container.querySelector(`[data-region="${region}"]`)).not.toBeNull();
    }

    // The six feature panels, not placeholders.
    expect(container.querySelector('[data-testid="flock-panel"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="sky-view"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="dag-canvas"]')).not.toBeNull();
    expect(container.querySelector('[data-starling-queue]')).not.toBeNull();
    expect(container.querySelector('[data-testid="metrics-panel"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-region-placeholder]')).toHaveLength(0);

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
    expect(container.querySelector('[data-testid="flock-panel"]')).toBeNull();
    expect(screen.getByText(/Flock ·/)).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Expand the flock region' }));
    expect(container.querySelector('[data-testid="flock-panel"]')).not.toBeNull();
  });

  test('switches the centre region between the sky and the flight plan', () => {
    const { container } = renderLayout();
    expect(screen.getByRole('heading', { name: 'The sky' })).toBeDefined();

    fireEvent.click(screen.getByRole('tab', { name: 'DAG' }));
    expect(screen.getByRole('heading', { name: 'Flight plan' })).toBeDefined();
    expect(container.querySelector('[data-view="sky"]')?.getAttribute('data-active')).toBe('false');
    expect(container.querySelector('[data-view="dag"]')?.getAttribute('data-active')).toBe('true');
    // Both stay mounted, so the Sky keeps its flocks and React Flow keeps its measured size.
    expect(container.querySelector('[data-testid="sky-view"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="dag-canvas"]')).not.toBeNull();
  });

  test('keys 1 and 2 switch the centre view', () => {
    renderLayout();
    fireEvent.keyDown(document, { key: '2' });
    expect(screen.getByRole('heading', { name: 'Flight plan' })).toBeDefined();
    fireEvent.keyDown(document, { key: '1' });
    expect(screen.getByRole('heading', { name: 'The sky' })).toBeDefined();
  });

  test('opens the drawer for the selected task and closes it', () => {
    const { container, props } = renderLayout({ ...baseState, selectedTask: 'theme' });
    expect(container.querySelector('[data-region="drawer"]')).not.toBeNull();
    const drawer = container.querySelector('[data-testid="agent-drawer"]');
    expect(drawer).not.toBeNull();
    expect(drawer?.textContent).toContain('theme');

    fireEvent.click(screen.getByRole('button', { name: 'Close agent drawer' }));
    expect(props.onCloseDrawer).toHaveBeenCalledTimes(1);
  });

  test('Escape closes the drawer through the shell', () => {
    const { props } = renderLayout({ ...baseState, selectedTask: 'theme' });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(props.onCloseDrawer).toHaveBeenCalled();
  });

  test('keeps the drawer closed until a task is selected', () => {
    const { container } = renderLayout();
    expect(container.querySelector('[data-testid="agent-drawer"]')).toBeNull();
  });

  test('collapses and expands the bottom strip, from the button and from `b`', () => {
    renderLayout();
    expect(screen.getByRole('heading', { name: 'Landing strip' })).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Collapse the bottom strip' }));
    expect(screen.queryByRole('heading', { name: 'Landing strip' })).toBeNull();
    expect(screen.getByRole('button', { name: /landed/ })).toBeDefined();

    fireEvent.keyDown(document, { key: 'b' });
    expect(screen.getByRole('heading', { name: 'Landing strip' })).toBeDefined();
  });

  test('`?` opens the keyboard help and Escape closes it', () => {
    renderLayout();
    expect(screen.queryByTestId('keyboard-help')).toBeNull();

    fireEvent.keyDown(document, { key: '?' });
    expect(screen.getByTestId('keyboard-help')).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Keyboard shortcuts' })).toBeDefined();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('keyboard-help')).toBeNull();
  });

  test('ignores shortcuts while a text field has focus', () => {
    renderLayout();
    const picker = screen.getByLabelText('Active run');
    fireEvent.keyDown(picker, { key: '2' });
    expect(screen.getByRole('heading', { name: 'The sky' })).toBeDefined();
  });

  test('renders a useful empty state before the first run', () => {
    const { container } = renderLayout(createInitialState());
    expect(screen.getByText('No runs yet')).toBeDefined();
    expect(screen.getByText(/No run yet/)).toBeDefined();
    expect(container.querySelector('[data-region="sky"]')).not.toBeNull();
    // The panels still mount; they just have nothing to draw.
    expect(container.querySelector('[data-testid="sky-view"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="flock-panel"]')).not.toBeNull();
  });
});
