import { afterAll, afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { makePlan, makeTaskRun, makeTaskSpec } from '@starling/core/testing';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DagView } from './DagView';
import { installDomShims } from './test-dom';

const registeredHere = typeof document === 'undefined';
if (registeredHere) GlobalRegistrator.register({ url: 'http://localhost/' });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
installDomShims();

afterEach(() => cleanup());

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
  expect(screen.getByText('a')).toBeTruthy();
  expect(screen.getByText('Beta')).toBeTruthy();
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
  render(<DagView plan={plan} tasks={tasks} onSelectTask={() => {}} />);

  const card = screen.getByTestId('task-node-a');
  expect(card.textContent).toContain('running');
  expect(card.getAttribute('data-status')).toBe('running');
  expect(card.textContent).toContain('M2-Air');
  expect(card.textContent).toContain('↻ 2');
  expect(card.textContent).toMatch(/1m \d\ds/);
});

test('clicking a node reports its key and selection is highlighted', () => {
  const selected: string[] = [];
  const { rerender } = render(
    <DagView
      plan={plan}
      tasks={runs({ a: 'merged', b: 'ready', c: 'pending' })}
      onSelectTask={(key) => selected.push(key)}
    />,
  );

  fireEvent.click(screen.getByTestId('rf__node-b'));
  expect(selected).toEqual(['b']);

  rerender(
    <DagView
      plan={plan}
      tasks={runs({ a: 'merged', b: 'ready', c: 'pending' })}
      selectedTask="b"
      onSelectTask={() => {}}
    />,
  );
  expect(screen.getByTestId('task-node-b').getAttribute('data-selected')).toBe('true');
  expect(screen.getByTestId('task-node-a').getAttribute('data-selected')).toBe('false');
});

test('edges animate while the downstream task waits on a running upstream', () => {
  const { container } = render(
    <DagView
      plan={plan}
      tasks={runs({ a: 'running', b: 'pending', c: 'pending' })}
      onSelectTask={() => {}}
    />,
  );

  expect(container.querySelector('.react-flow__edge.animated')).not.toBeNull();
  expect(screen.getByTestId('rf__edge-a->b').classList.contains('animated')).toBe(true);
});

test('edges do not animate once upstream is done', () => {
  render(
    <DagView plan={plan} tasks={runs({ a: 'merged', b: 'ready', c: 'pending' })} onSelectTask={() => {}} />,
  );

  expect(screen.getByTestId('rf__edge-a->b').classList.contains('animated')).toBe(false);
});

test('hovering a node reveals its lane globs', () => {
  render(<DagView plan={plan} tasks={runs({ a: 'pending' })} onSelectTask={() => {}} />);

  expect(screen.queryByTestId('lane-tooltip-a')).toBeNull();
  fireEvent.mouseEnter(screen.getByTestId('task-node-a'));
  const tooltip = screen.getByTestId('lane-tooltip-a');
  expect(tooltip.textContent).toContain('src/alpha/**');
  fireEvent.mouseLeave(screen.getByTestId('task-node-a'));
  expect(screen.queryByTestId('lane-tooltip-a')).toBeNull();
});

test('arrow keys move the selection along the DAG', () => {
  const selected: string[] = [];
  const tasks = runs({ a: 'merged', b: 'running', c: 'pending' });
  const { rerender } = render(
    <DagView plan={plan} tasks={tasks} selectedTask="a" onSelectTask={(key) => selected.push(key)} />,
  );

  fireEvent.keyDown(screen.getByTestId('dag-canvas'), { key: 'ArrowRight' });
  expect(selected).toEqual(['b']);

  // Selection is controlled by the shell, so feed the new selection back before moving again.
  rerender(<DagView plan={plan} tasks={tasks} selectedTask="b" onSelectTask={(key) => selected.push(key)} />);
  fireEvent.keyDown(screen.getByTestId('dag-canvas'), { key: 'ArrowLeft' });
  expect(selected).toEqual(['b', 'a']);
});

test('the minimap toggles on and off', () => {
  render(<DagView plan={plan} tasks={runs({ a: 'pending' })} onSelectTask={() => {}} />);

  const toggle = screen.getByLabelText('Toggle minimap');
  expect(toggle.getAttribute('aria-pressed')).toBe('false');
  expect(document.querySelector('.react-flow__minimap')).toBeNull();

  fireEvent.click(toggle);
  expect(toggle.getAttribute('aria-pressed')).toBe('true');
  expect(document.querySelector('.react-flow__minimap')).not.toBeNull();

  fireEvent.click(toggle);
  expect(document.querySelector('.react-flow__minimap')).toBeNull();
});

test('a new plan replaces the graph without losing the canvas', () => {
  const nextPlan = makePlan({
    id: 'plan-dag-view-2',
    tasks: [makeTaskSpec({ key: 'solo', title: 'Solo task' })],
  });
  const { container, rerender } = render(
    <DagView plan={plan} tasks={runs({ a: 'merged' })} onSelectTask={() => {}} />,
  );
  expect(container.querySelectorAll('.react-flow__node')).toHaveLength(3);

  rerender(
    <DagView plan={nextPlan} tasks={{ solo: makeTaskRun({ taskKey: 'solo' }) }} onSelectTask={() => {}} />,
  );
  expect(container.querySelectorAll('.react-flow__node')).toHaveLength(1);
  expect(screen.getByTestId('dag-canvas').getAttribute('data-plan-id')).toBe('plan-dag-view-2');
});

test('renders a friendly empty state when there is no plan', () => {
  render(<DagView tasks={{}} onSelectTask={() => {}} />);

  expect(screen.getByTestId('dag-empty').textContent).toContain('flock is still thinking');
});

afterAll(() => {
  cleanup();
  if (registeredHere) GlobalRegistrator.unregister();
});
