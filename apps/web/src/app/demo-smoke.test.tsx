import { afterEach, describe, expect, test } from 'bun:test';
import { demoEvents, rebaseEvents } from '../data/demo';
import { skyProps } from '../data/selectors';
import { skyActions, useSky } from '../data/store';
import { ensureDom } from '../lib/test-dom';
import { Layout } from './Layout';

ensureDom();
const { cleanup, fireEvent, render, screen } = await import('@testing-library/react');

afterEach(() => {
  cleanup();
  useSky.getState().reset();
});

/** The store as the dashboard sees it after the whole recorded run has been ingested. */
const events = rebaseEvents(demoEvents(), 1_800_000_000_000);
const RUN_ID = events[0]?.runId ?? 'run';
const CSV_KEY = 'csv-export';

/** Mirrors `AppShell`: read the live store, hand it to `Layout`, let selectors default to it. */
function Harness() {
  const state = useSky();
  return (
    <Layout
      state={state}
      speed={1}
      onSpeedChange={() => {}}
      theme="dark"
      onToggleTheme={() => {}}
      onSelectRun={(runId) => useSky.getState().setActiveRun(runId)}
      onCloseDrawer={() => useSky.getState().selectTask()}
      onSelectTask={(key) => useSky.getState().selectTask(key)}
    />
  );
}

describe('demo mode, end to end', () => {
  test('the recorded run drives every panel and selecting a task opens its drawer', () => {
    const store = useSky.getState();
    store.reset();
    store.setConnection('demo');
    // `ingestMany` is the replay's final state — exactly what the demo player produces, 252 events.
    useSky.getState().ingestMany(events);

    const state = useSky.getState();
    const run = state.runs[RUN_ID];
    if (run === undefined) throw new Error('the fixture did not create a run');

    // ── the store's view of the run ────────────────────────────────────────────────────────────
    expect(state.activeRunId).toBe(RUN_ID);
    expect(Object.keys(run.tasks)).toHaveLength(7);
    expect(Object.keys(state.nodes)).toHaveLength(2);
    expect(run.status).toBe('finished');

    const { container } = render(<Harness />);

    // ── all six panels mounted, none fell back to the error placeholder ───────────────────────
    expect(container.querySelector('[data-testid="sky-view"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="dag-canvas"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="flock-panel"]')).not.toBeNull();
    expect(container.querySelector('[data-starling-queue]')).not.toBeNull();
    expect(container.querySelector('[data-testid="metrics-panel"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-region-placeholder]')).toHaveLength(0);
    expect(screen.getByText('7/7 landed')).toBeDefined();

    // ── the Sky is handed 7 tasks and 2 nodes ─────────────────────────────────────────────────
    const sky = skyProps(state);
    expect(Object.keys(sky.run?.tasks ?? {})).toHaveLength(7);
    expect(sky.nodes.map((node) => node.name)).toEqual(['MacBook Pro', 'MacBook Air']);
    expect(sky.nodes).toHaveLength(2);
    expect(sky.recent.length).toBeGreaterThan(0);

    // ── the queue shows the whole plan on the wire ────────────────────────────────────────────
    expect(container.querySelectorAll('[data-starling-queue] [data-column="wire"]')).toHaveLength(7);

    // ── the meter has a real API cost and local calls ─────────────────────────────────────────
    const apiCost = screen.getByTestId('cost-api').textContent ?? '';
    expect(apiCost).toMatch(/^\$\d/);
    expect(apiCost).not.toBe('$0.00');
    expect(screen.getByTestId('cost-meter').textContent).toMatch(/[1-9]\d* local calls?/);

    // ── selecting the CSV-export task opens the drawer with its verdict history ───────────────
    const verdicts = state.verdicts[CSV_KEY] ?? [];
    expect(verdicts.length).toBeGreaterThan(0);
    const csvCard = container.querySelector(`[data-starling-queue] [data-task-key="${CSV_KEY}"]`);
    expect(csvCard).not.toBeNull();
    if (csvCard === null) throw new Error('no queue card for the CSV export');

    fireEvent.click(csvCard);
    expect(useSky.getState().selectedTask).toBe(CSV_KEY);

    // The store change re-rendered the shell: drawer open, highlighted everywhere.
    const drawer = screen.getByTestId('agent-drawer');
    expect(drawer.textContent).toContain(CSV_KEY);
    expect(drawer.getAttribute('aria-label')).toContain(CSV_KEY);
    expect(
      container.querySelector('[data-testid="task-node-csv-export"]')?.getAttribute('data-selected'),
    ).toBe('true');

    // The Audit tab counts every attempt for the task, newest first.
    const auditTab = screen.getByRole('tab', { name: /Audit/ });
    expect(auditTab.textContent).toContain(String(verdicts.length));
    fireEvent.click(auditTab);
    const cards = container.querySelectorAll('[data-testid^="verdict-attempt-"]');
    expect(cards).toHaveLength(verdicts.length);
    expect(container.querySelector('[data-testid="audit-tab"]')).not.toBeNull();

    // ── closing the drawer goes back to the full-width sky ────────────────────────────────────
    fireEvent.click(screen.getByRole('button', { name: 'Close agent drawer' }));
    expect(useSky.getState().selectedTask).toBeUndefined();
    expect(container.querySelector('[data-testid="agent-drawer"]')).toBeNull();
  });

  test('the demo player reaches the same final state as the fixture fold', () => {
    // Guard against the replay drifting from the fold: the store must end on 7 merged tasks.
    useSky.getState().reset();
    useSky.getState().setConnection('demo');
    for (const event of events) skyActions.ingest(event);
    const run = useSky.getState().runs[RUN_ID];
    expect(run?.tasks[CSV_KEY]?.status).toBe('merged');
    expect(Object.values(run?.tasks ?? {}).filter((task) => task.status === 'merged')).toHaveLength(7);
  });
});
