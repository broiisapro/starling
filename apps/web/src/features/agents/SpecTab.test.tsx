import './test-env';
import { afterEach, expect, test } from 'bun:test';
import { cleanup, render } from '@testing-library/react';
import { SpecTab } from './SpecTab';
import { failingVerdict, passingVerdict, sampleTask } from './test-fixtures';

afterEach(() => {
  if (typeof document !== 'undefined') cleanup();
});

test('shows the goal, deliverables, out-of-scope items and lane', () => {
  const view = render(<SpecTab task={sampleTask} verdict={passingVerdict()} />);

  expect(view.getByText(sampleTask.goal)).toBeTruthy();
  expect(view.getByText('src/features/theme/index.ts exports initTheme()')).toBeTruthy();
  expect(view.getByText('Changing the default light theme')).toBeTruthy();
  expect(view.getByText('src/ui/styles.css')).toBeTruthy();
  expect(view.getByText('src/main.ts')).toBeTruthy();
});

test('ticks every DoD item when the latest verdict passed the DoD check', () => {
  const { container, getByTestId } = render(<SpecTab task={sampleTask} verdict={passingVerdict()} />);

  const boxes = container.querySelectorAll('input[type="checkbox"]');
  expect(boxes).toHaveLength(sampleTask.definitionOfDone.length);
  for (const box of boxes) expect((box as HTMLInputElement).checked).toBe(true);
  expect(getByTestId('dod-evidence').textContent).toContain('Every DoD item is satisfied');
});

test('leaves DoD items unticked when the verdict failed, and shows the evidence', () => {
  const { container, getByTestId } = render(<SpecTab task={sampleTask} verdict={failingVerdict()} />);

  const boxes = container.querySelectorAll('input[type="checkbox"]');
  for (const box of boxes) expect((box as HTMLInputElement).checked).toBe(false);
  expect(getByTestId('dod-evidence').textContent).toContain('Missing: toggle persists across reloads');
  expect(getByTestId('dod-evidence').textContent).toContain('attempt 1');
});

test('renders without a verdict or a task', () => {
  const withoutVerdict = render(<SpecTab task={sampleTask} />);
  expect(withoutVerdict.queryByTestId('dod-evidence')).toBeNull();
  withoutVerdict.unmount();

  const withoutTask = render(<SpecTab />);
  expect(withoutTask.getByText('No task spec to show.')).toBeTruthy();
});
