import './test-env';
import { afterEach, expect, test } from 'bun:test';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { PLAYGROUND_RUNS } from './fixtures';
import { DEMO_GOALS } from './goals';
import { Playground } from './Playground';

afterEach(() => {
  if (typeof document !== 'undefined') cleanup();
});

test('the playground renders the fixture runs and goals without a server', () => {
  const view = render(<Playground latencyMs={0} />);

  expect(view.getByTestId('launch-panel')).toBeTruthy();
  expect(view.getAllByTestId('launch-goal-chip')).toHaveLength(DEMO_GOALS.length);
  expect(view.getAllByTestId('launch-history-run')).toHaveLength(PLAYGROUND_RUNS.length);
  expect((view.getByTestId('launch-repo') as HTMLInputElement).value).toBe('examples/sky-todo');
  expect(view.getByTestId('launch-history').textContent).toContain('Finished');
});

test('a fixture preview fills the plan table and a fixture launch adds a run', async () => {
  const view = render(<Playground latencyMs={0} />);

  fireEvent.click(view.getByRole('button', { name: 'quick-wins' }));
  fireEvent.click(view.getByTestId('launch-preview-button'));
  await view.findByTestId('launch-preview-ready');
  expect(view.getAllByTestId('launch-plan-task')).toHaveLength(3);
  expect(view.getByTestId('launch-overlap-state').textContent).toContain('Lanes clear');

  fireEvent.click(view.getByTestId('launch-release'));
  fireEvent.click(view.getByTestId('launch-confirm-button'));
  await view.findByTestId('launch-success');
  expect(view.getAllByTestId('launch-history-run')).toHaveLength(PLAYGROUND_RUNS.length + 1);
});

test('the conflict-bait fixture demonstrates the overlap badge', async () => {
  const view = render(<Playground latencyMs={0} />);

  fireEvent.click(view.getByRole('button', { name: 'conflict-bait' }));
  fireEvent.click(view.getByTestId('launch-preview-button'));
  await view.findByTestId('launch-preview-ready');

  expect(view.getByTestId('launch-overlap-state').textContent).toContain('1 lane overlap');
});
