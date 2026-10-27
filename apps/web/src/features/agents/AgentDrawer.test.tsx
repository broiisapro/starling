import './test-env';
import { afterEach, expect, test } from 'bun:test';
import { makeTaskRun } from '@starling/core/testing';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { AgentDrawer } from './AgentDrawer';
import type { AgentDrawerProps } from './handshake';
import { failingVerdict, passingVerdict, sampleDiff, sampleEvents, sampleTask } from './test-fixtures';

afterEach(() => {
  if (typeof document !== 'undefined') cleanup();
});

function props(onClose: () => void = () => {}): AgentDrawerProps {
  return {
    task: sampleTask,
    run: makeTaskRun({
      taskKey: 'theme',
      status: 'running',
      nodeId: 'M2-Air',
      attempts: 2,
      costUsd: 0.0042,
    }),
    events: sampleEvents(),
    verdicts: [failingVerdict(), passingVerdict()],
    diff: sampleDiff,
    onClose,
  };
}

test('header shows key, title, status, node, attempts and cost', () => {
  const view = render(<AgentDrawer {...props()} />);

  expect(view.getByText('theme')).toBeTruthy();
  expect(view.getByText('Dark mode with a toggle')).toBeTruthy();
  expect(view.getByTestId('drawer-status').textContent).toBe('running');
  expect(view.getByTestId('drawer-node').textContent).toBe('M2-Air');
  expect(view.getByTestId('drawer-attempts').textContent).toBe('2');
  expect(view.getByTestId('drawer-cost').textContent).toBe('$0.0042');
});

test('opens on Activity and switches through all four tabs', () => {
  const view = render(<AgentDrawer {...props()} />);

  expect(view.getByTestId('activity-list')).toBeTruthy();

  fireEvent.click(view.getByRole('tab', { name: /Audit/ }));
  expect(view.getByTestId('audit-tab')).toBeTruthy();
  expect(view.getByTestId('verdict-attempt-2')).toBeTruthy();

  fireEvent.click(view.getByRole('tab', { name: /Diff/ }));
  expect(view.getByTestId('diff-tab')).toBeTruthy();

  fireEvent.click(view.getByRole('tab', { name: /Spec/ }));
  expect(view.getByTestId('spec-tab')).toBeTruthy();
  expect(view.getByTestId('dod-list')).toBeTruthy();

  expect(view.getByRole('tab', { name: /Spec/ }).getAttribute('aria-selected')).toBe('true');
});

test('arrow keys cycle the tabs', () => {
  const view = render(<AgentDrawer {...props()} />);
  const tablist = view.getByRole('tablist');

  fireEvent.keyDown(tablist, { key: 'ArrowRight' });
  expect(view.getByRole('tab', { name: /Audit/ }).getAttribute('aria-selected')).toBe('true');

  fireEvent.keyDown(tablist, { key: 'ArrowLeft' });
  expect(view.getByRole('tab', { name: /Activity/ }).getAttribute('aria-selected')).toBe('true');

  for (let index = 0; index < 4; index += 1) fireEvent.keyDown(tablist, { key: 'ArrowRight' });
  expect(view.getByRole('tab', { name: /Activity/ }).getAttribute('aria-selected')).toBe('true');
});

test('Esc closes the drawer', () => {
  let closed = 0;
  render(<AgentDrawer {...props(() => (closed += 1))} />);

  fireEvent.keyDown(document, { key: 'Escape' });
  expect(closed).toBe(1);
});

test('the close button calls onClose', () => {
  let closed = 0;
  const view = render(<AgentDrawer {...props(() => (closed += 1))} />);

  fireEvent.click(view.getByLabelText('Close agent drawer'));
  expect(closed).toBe(1);
});

test('asks for a task when nothing is selected', () => {
  const view = render(<AgentDrawer events={[]} verdicts={[]} onClose={() => {}} />);

  expect(view.getByText(/Pick a task from the DAG/)).toBeTruthy();
  expect(view.queryByRole('tablist')).toBeNull();
});
