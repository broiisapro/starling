import { afterEach, beforeEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import type { TaskRun } from '@starling/core';
import { makePlan, makeTaskRun, makeTaskSpec } from '@starling/core/testing';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { DagView } from './DagView';
import { nodeLabel } from './format';
import { installDomShims } from './test-dom';
import { STATUS_FLASH_MS } from './use-status-flash';

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
  id: 'plan-dag-polish',
  tasks: [
    makeTaskSpec({ key: 'a', title: 'Alpha', estimateMin: 10, dependsOn: [] }),
    makeTaskSpec({ key: 'b', title: 'Beta', estimateMin: 5, dependsOn: ['a'] }),
    makeTaskSpec({ key: 'c', title: 'Gamma', estimateMin: 50, dependsOn: ['a'] }),
    makeTaskSpec({ key: 'd', title: 'Delta', estimateMin: 40, dependsOn: ['b'] }),
  ],
});

function taskMap(entries: Record<string, Partial<TaskRun>>): Record<string, TaskRun> {
  return Object.fromEntries(
    Object.entries(entries).map(([key, overrides]) => [key, makeTaskRun({ taskKey: key, ...overrides })]),
  );
}

test('the longest chain is marked on the cards and in the legend', () => {
  const view = render(<DagView plan={plan} tasks={{}} onSelectTask={() => {}} />);

  expect(view.getByTestId('critical-path-legend').textContent).toContain('60 min');
  expect(view.getByTestId('critical-path-legend').textContent).toContain('2 tasks');
  expect(view.getByTestId('dag-canvas').getAttribute('data-critical-path')).toBe('a,c');

  expect(view.getByTestId('task-node-a').getAttribute('data-critical')).toBe('true');
  expect(view.getByTestId('task-node-c').getAttribute('data-critical')).toBe('true');
  expect(view.getByTestId('task-node-b').getAttribute('data-critical')).toBe('false');
  expect(view.getByTestId('critical-badge-a').textContent).toContain('critical');
  expect(view.queryByTestId('critical-badge-b')).toBeNull();

  const edge = view.getByTestId('rf__edge-a->c');
  expect(edge.querySelector('path')?.getAttribute('style')).toContain('#fbbf24');
  expect(edge.textContent).toContain('critical');
  expect(view.getByTestId('rf__edge-a->b').querySelector('path')?.getAttribute('style')).toContain('#475569');
});

test('the follow toggle is keyboard reachable and off by default', () => {
  const view = render(<DagView plan={plan} tasks={{}} onSelectTask={() => {}} />);
  const toggle = view.getByTestId('dag-follow');

  expect(toggle.getAttribute('aria-pressed')).toBe('false');
  fireEvent.click(toggle);
  expect(toggle.getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(toggle);
  expect(toggle.getAttribute('aria-pressed')).toBe('false');
});

test('following the action pans without unmounting the graph', () => {
  const tasks = taskMap({ a: { status: 'running', startedAt: 1_000 } });
  const view = render(<DagView plan={plan} tasks={tasks} onSelectTask={() => {}} />);

  fireEvent.click(view.getByTestId('dag-follow'));
  view.rerender(
    <DagView
      plan={plan}
      tasks={taskMap({
        a: { status: 'running', startedAt: 1_000 },
        b: { status: 'fixing', startedAt: 2_000 },
      })}
      onSelectTask={() => {}}
    />,
  );

  expect(view.getByTestId('dag-canvas')).toBeTruthy();
  expect(view.container.querySelectorAll('.react-flow__node')).toHaveLength(4);
});

test('a status change flashes the card, then settles', async () => {
  const view = render(<DagView plan={plan} tasks={{}} onSelectTask={() => {}} />);
  expect(view.getByTestId('task-node-a').getAttribute('data-flash')).toBe('false');

  view.rerender(
    <DagView
      plan={plan}
      tasks={taskMap({ a: { status: 'running', startedAt: 1_000 } })}
      onSelectTask={() => {}}
    />,
  );
  expect(view.getByTestId('task-node-a').getAttribute('data-flash')).toBe('true');
  expect(view.getByTestId('task-node-a').getAttribute('data-status')).toBe('running');

  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, STATUS_FLASH_MS + 60));
  });
  expect(view.getByTestId('task-node-a').getAttribute('data-flash')).toBe('false');
});

test('reduced motion is reflected on the canvas so the stylesheet can stop the flash', () => {
  const view = render(<DagView plan={plan} tasks={{}} onSelectTask={() => {}} reducedMotion />);

  const canvas = view.getByTestId('dag-canvas');
  expect(canvas.getAttribute('data-reduced-motion')).toBe('true');
  expect(view.container.querySelector('style')?.textContent).toContain(
    '@media (prefers-reduced-motion: reduce)',
  );
});

test('the lane legend lists owns, reads, dependencies and the estimate', () => {
  const view = render(<DagView plan={plan} tasks={{}} onSelectTask={() => {}} />);

  fireEvent.mouseEnter(view.getByTestId('task-node-c'));
  const legend = view.getByTestId('lane-tooltip-c');
  expect(legend.textContent).toContain('est 50 min');
  expect(legend.textContent).toContain('src/features/theme/**');
  expect(legend.textContent).toContain('src/main.ts');
  expect(legend.textContent).toContain('after a');
});

test('a published nodeName is preferred over the node id', () => {
  const tasks = taskMap({ a: { status: 'running', nodeId: 'air' } });
  // `TaskRun.nodeName` is not in this worktree's contract yet (FIX REQUEST to Epic 40), so the test
  // publishes it the way the engine will: an extra field on the run.
  const withName = tasks.a === undefined ? tasks : { ...tasks, a: { ...tasks.a, nodeName: 'M2 Air' } };

  const view = render(<DagView plan={plan} tasks={withName} onSelectTask={() => {}} />);
  expect(view.getByTestId('task-node-a').textContent).toContain('M2 Air');
  // The id still wins when no name was published: the fallback is the pre-existing behaviour.
  expect(nodeLabel(tasks.a)).toBe('air');
  expect(nodeLabel(withName.a)).toBe('M2 Air');
});
