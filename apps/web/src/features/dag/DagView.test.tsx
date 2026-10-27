import { afterEach, beforeEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { makePlan, makeTaskRun, makeTaskSpec } from '@starling/core/testing';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { DagView } from './DagView';
import { installDomShims } from './test-dom';

/**
 * Re-register the DOM and the React Flow shims before every test. Bun runs every workspace's test
 * files in one process, and another lane's teardown may unregister happy-dom between files.
 */
function ensureDom(): void {
  if (typeof document === 'undefined') GlobalRegistrator.register({ url: 'http://localhost/' });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  installDomShims();
}

ensureDom();
beforeEach(ensureDom);
afterEach(() => {
  if (typeof document !== 'undefined') cleanup();
});

const plan = makePlan({
  id: 'plan-dag-view',
  tasks: [
    makeTaskSpec({ key: 'a', title: 'Alpha', dependsOn: [], lane: { owns: ['src/alpha/**'], reads: [] } }),
    makeTaskSpec({ key: 'b', title: 'Beta', dependsOn: ['a'], lane: { owns: ['src/beta/**'], reads: [] } }),
    makeTaskSpec({ key: 'c', title: 'Gamma', dependsOn: ['b'], lane: { owns: ['src/gamma/**'], reads: [] } }),
  ],
});

function runs(statuses: Record<string, ReturnType<typeof makeTaskRun>['status']>) {
  return Object.fromEntries(
    Object.entries(statuses).map(([key, status]) => [key, makeTaskRun({ taskKey: key, status })]),
  );
}

test('renders one node per task and one edge per dependency', () => {
  const { container } = render(
    <DagView plan={plan} tasks={runs({ a: 'merged', b: 'running', c: 'pending' })} onSelectTask={() => {}} />,
  );

  expect(container.querySelectorAll('.react-flow__node')).toHaveLength(3);
  expect(container.querySelectorAll('.react-flow__edge')).toHaveLength(2);
  expect(container.textContent).toContain('a');
  expect(container.textContent).toContain('Beta');
});

test('shows the status, node badge, attempts and elapsed time on a card', () => {
  const tasks = {
    a: makeTaskRun({
      taskKey: 'a',
      status: 'running',
      nodeId: 'M2-Air',
      attempts: 2,
      startedAt: Date.now() - 65_000,
    }),
  };
  const view = render(<DagView plan={plan} tasks={tasks} onSelectTask={() => {}} />);

  const card = view.getByTestId('task-node-a');
  expect(card.textContent).toContain('running');
  expect(card.getAttribute('data-status')).toBe('running');
  expect(card.textContent).toContain('M2-Air');
  expect(card.textContent).toContain('↻ 2');
  expect(card.textContent).toMatch(/1m \d\ds/);
});

test('clicking a node reports its key and selection is highlighted', () => {
  const selected: string[] = [];
  const view = render(
    <DagView
      plan={plan}
      tasks={runs({ a: 'merged', b: 'ready', c: 'pending' })}
      onSelectTask={(key) => selected.push(key)}
    />,
  );

  fireEvent.click(view.getByTestId('rf__node-b'));
  expect(selected).toEqual(['b']);

  view.rerender(
    <DagView
      plan={plan}
      tasks={runs({ a: 'merged', b: 'ready', c: 'pending' })}
      selectedTask="b"
      onSelectTask={() => {}}
    />,
  );
  expect(view.getByTestId('task-node-b').getAttribute('data-selected')).toBe('true');
  expect(view.getByTestId('task-node-a').getAttribute('data-selected')).toBe('false');
});

test('edges animate while the downstream task waits on a running upstream', () => {
  const view = render(
    <DagView
      plan={plan}
      tasks={runs({ a: 'running', b: 'pending', c: 'pending' })}
      onSelectTask={() => {}}
    />,
  );

  expect(view.container.querySelector('.react-flow__edge.animated')).not.toBeNull();
  expect(view.getByTestId('rf__edge-a->b').classList.contains('animated')).toBe(true);
});

test('edges do not animate once upstream is done', () => {
  const view = render(
    <DagView plan={plan} tasks={runs({ a: 'merged', b: 'ready', c: 'pending' })} onSelectTask={() => {}} />,
  );

  expect(view.getByTestId('rf__edge-a->b').classList.contains('animated')).toBe(false);
});

test('hovering a node reveals its lane globs', () => {
  const view = render(<DagView plan={plan} tasks={runs({ a: 'pending' })} onSelectTask={() => {}} />);

  expect(view.queryByTestId('lane-tooltip-a')).toBeNull();
  fireEvent.mouseEnter(view.getByTestId('task-node-a'));
  const tooltip = view.getByTestId('lane-tooltip-a');
  expect(tooltip.textContent).toContain('src/alpha/**');
  fireEvent.mouseLeave(view.getByTestId('task-node-a'));
  expect(view.queryByTestId('lane-tooltip-a')).toBeNull();
});

test('arrow keys move the selection along the DAG', () => {
  const selected: string[] = [];
  const tasks = runs({ a: 'merged', b: 'running', c: 'pending' });
  const view = render(
    <DagView plan={plan} tasks={tasks} selectedTask="a" onSelectTask={(key) => selected.push(key)} />,
  );

  fireEvent.keyDown(view.getByTestId('dag-canvas'), { key: 'ArrowRight' });
  expect(selected).toEqual(['b']);

  // Selection is controlled by the shell, so feed the new selection back before moving again.
  view.rerender(
    <DagView plan={plan} tasks={tasks} selectedTask="b" onSelectTask={(key) => selected.push(key)} />,
  );
  fireEvent.keyDown(view.getByTestId('dag-canvas'), { key: 'ArrowLeft' });
  expect(selected).toEqual(['b', 'a']);
});

test('the minimap toggles on and off', () => {
  const view = render(<DagView plan={plan} tasks={runs({ a: 'pending' })} onSelectTask={() => {}} />);

  const toggle = view.getByLabelText('Toggle minimap');
  expect(toggle.getAttribute('aria-pressed')).toBe('false');
  expect(view.container.querySelector('.react-flow__minimap')).toBeNull();

  fireEvent.click(toggle);
  expect(toggle.getAttribute('aria-pressed')).toBe('true');
  expect(view.container.querySelector('.react-flow__minimap')).not.toBeNull();

  fireEvent.click(toggle);
  expect(view.container.querySelector('.react-flow__minimap')).toBeNull();
});

test('a new plan replaces the graph without losing the canvas', () => {
  const nextPlan = makePlan({
    id: 'plan-dag-view-2',
    tasks: [makeTaskSpec({ key: 'solo', title: 'Solo task' })],
  });
  const view = render(<DagView plan={plan} tasks={runs({ a: 'merged' })} onSelectTask={() => {}} />);
  expect(view.container.querySelectorAll('.react-flow__node')).toHaveLength(3);

  view.rerender(
    <DagView plan={nextPlan} tasks={{ solo: makeTaskRun({ taskKey: 'solo' }) }} onSelectTask={() => {}} />,
  );
  expect(view.container.querySelectorAll('.react-flow__node')).toHaveLength(1);
  expect(view.getByTestId('dag-canvas').getAttribute('data-plan-id')).toBe('plan-dag-view-2');
});

test('renders a friendly empty state when there is no plan', () => {
  const view = render(<DagView tasks={{}} onSelectTask={() => {}} />);

  expect(view.getByTestId('dag-empty').textContent).toContain('flock is still thinking');
});
