import './test-env';
import { afterEach, expect, test } from 'bun:test';
import { cleanup, render } from '@testing-library/react';
import { DiffTab } from './DiffTab';
import { sampleDiff } from './test-fixtures';

afterEach(() => {
  if (typeof document !== 'undefined') cleanup();
});

test('lists changed files with add and remove counts', () => {
  const view = render(<DiffTab diff={sampleDiff} />);

  const rows = view.getAllByTestId('diff-file-row');
  expect(rows).toHaveLength(2);
  expect(rows[0]?.textContent).toContain('src/lib/dates.ts');
  expect(rows[1]?.textContent).toContain('+34');
  expect(rows[1]?.textContent).toContain('−6');
});

test('colours patch lines per kind and counts them', () => {
  const { container } = render(<DiffTab diff={sampleDiff} />);

  expect(container.querySelectorAll('[data-line-kind="add"]')).toHaveLength(3);
  expect(container.querySelectorAll('[data-line-kind="del"]')).toHaveLength(2);
  expect(container.querySelectorAll('[data-line-kind="hunk"]')).toHaveLength(2);
  expect(container.querySelector('[data-line-kind="add"]')?.className).toContain('text-emerald-200');
  expect(container.querySelector('[data-line-kind="del"]')?.className).toContain('text-rose-200');
});

test('files are collapsible and open by default', () => {
  const { container } = render(<DiffTab diff={sampleDiff} />);

  const details = container.querySelectorAll('details');
  expect(details).toHaveLength(2);
  expect(details[0]?.hasAttribute('open')).toBe(true);
});

test('shows a truncated-patch notice', () => {
  const view = render(<DiffTab diff={sampleDiff} />);

  expect(view.getByTestId('diff-truncated').textContent).toContain('Patch truncated');
});

test('handles a file with no textual patch and a missing diff', () => {
  const noPatch = render(
    <DiffTab diff={{ files: [{ path: 'logo.png', added: 0, removed: 0 }], patch: '', truncated: false }} />,
  );
  expect(noPatch.getByText(/No textual patch/)).toBeTruthy();
  expect(noPatch.queryByTestId('diff-truncated')).toBeNull();
  noPatch.unmount();

  const empty = render(<DiffTab />);
  expect(empty.getByText('No diff recorded yet.')).toBeTruthy();
});
