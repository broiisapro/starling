import './test-env';
import { afterEach, expect, test } from 'bun:test';
import { makeTaskRun } from '@starling/core/testing';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AgentDrawer } from './AgentDrawer';
import type { AgentDrawerProps } from './handshake';
import { failingVerdict, passingVerdict, sampleDiff, sampleEvents, sampleTask } from './test-fixtures';

afterEach(() => cleanup());

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
  render(<AgentDrawer {...props()} />);

  expect(screen.getByText('theme')).toBeTruthy();
  expect(screen.getByText('Dark mode with a toggle')).toBeTruthy();
  expect(screen.getByTestId('drawer-status').textContent).toBe('running');
  expect(screen.getByTestId('drawer-node').textContent).toBe('M2-Air');
  expect(screen.getByTestId('drawer-attempts').textContent).toBe('2');
  expect(screen.getByTestId('drawer-cost').textContent).toBe('$0.0042');
});

test('opens on Activity and switches through all four tabs', () => {
  render(<AgentDrawer {...props()} />);

  expect(screen.getByTestId('activity-list')).toBeTruthy();

  fireEvent.click(screen.getByRole('tab', { name: /Audit/ }));
  expect(screen.getByTestId('audit-tab')).toBeTruthy();
  expect(screen.getByTestId('verdict-attempt-2')).toBeTruthy();

  fireEvent.click(screen.getByRole('tab', { name: /Diff/ }));
  expect(screen.getByTestId('diff-tab')).toBeTruthy();

  fireEvent.click(screen.getByRole('tab', { name: /Spec/ }));
  expect(screen.getByTestId('spec-tab')).toBeTruthy();
  expect(screen.getByTestId('dod-list')).toBeTruthy();

  expect(screen.getByRole('tab', { name: /Spec/ }).getAttribute('aria-selected')).toBe('true');
});

test('arrow keys cycle the tabs', () => {
  render(<AgentDrawer {...props()} />);

  fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
  expect(screen.getByRole('tab', { name: /Audit/ }).getAttribute('aria-selected')).toBe('true');

  fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowLeft' });
  expect(screen.getByRole('tab', { name: /Activity/ }).getAttribute('aria-selected')).toBe('true');

  fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
  fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
  fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
  fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
  expect(screen.getByRole('tab', { name: /Activity/ }).getAttribute('aria-selected')).toBe('true');
});

test('Esc closes the drawer', () => {
  let closed = 0;
  render(<AgentDrawer {...props(() => (closed += 1))} />);

  fireEvent.keyDown(document, { key: 'Escape' });
  expect(closed).toBe(1);
});

test('the close button calls onClose', () => {
  let closed = 0;
  render(<AgentDrawer {...props(() => (closed += 1))} />);

  fireEvent.click(screen.getByLabelText('Close agent drawer'));
  expect(closed).toBe(1);
});

test('asks for a task when nothing is selected', () => {
  render(<AgentDrawer events={[]} verdicts={[]} onClose={() => {}} />);

  expect(screen.getByText(/Pick a task from the DAG/)).toBeTruthy();
  expect(screen.queryByRole('tablist')).toBeNull();
});
