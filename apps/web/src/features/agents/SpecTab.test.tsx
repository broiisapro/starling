import './test-env';
import { afterEach, expect, test } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/react';
import { SpecTab } from './SpecTab';
import { failingVerdict, passingVerdict, sampleTask } from './test-fixtures';

afterEach(() => cleanup());

test('shows the goal, deliverables, out-of-scope items and lane', () => {
  render(<SpecTab task={sampleTask} verdict={passingVerdict()} />);

  expect(screen.getByText(sampleTask.goal)).toBeTruthy();
  expect(screen.getByText('src/features/theme/index.ts exports initTheme()')).toBeTruthy();
  expect(screen.getByText('Changing the default light theme')).toBeTruthy();
  expect(screen.getByText('src/ui/styles.css')).toBeTruthy();
  expect(screen.getByText('src/main.ts')).toBeTruthy();
});

test('ticks every DoD item when the latest verdict passed the DoD check', () => {
  const { container } = render(<SpecTab task={sampleTask} verdict={passingVerdict()} />);

  const boxes = container.querySelectorAll('input[type="checkbox"]');
  expect(boxes).toHaveLength(sampleTask.definitionOfDone.length);
  for (const box of boxes) expect((box as HTMLInputElement).checked).toBe(true);
  expect(screen.getByTestId('dod-evidence').textContent).toContain('Every DoD item is satisfied');
});

test('leaves DoD items unticked when the verdict failed, and shows the evidence', () => {
  const { container } = render(<SpecTab task={sampleTask} verdict={failingVerdict()} />);

  const boxes = container.querySelectorAll('input[type="checkbox"]');
  for (const box of boxes) expect((box as HTMLInputElement).checked).toBe(false);
  expect(screen.getByTestId('dod-evidence').textContent).toContain('Missing: toggle persists across reloads');
  expect(screen.getByTestId('dod-evidence').textContent).toContain('attempt 1');
});

test('renders without a verdict or a task', () => {
  const { unmount } = render(<SpecTab task={sampleTask} />);
  expect(screen.queryByTestId('dod-evidence')).toBeNull();
  unmount();

  render(<SpecTab />);
  expect(screen.getByText('No task spec to show.')).toBeTruthy();
});
