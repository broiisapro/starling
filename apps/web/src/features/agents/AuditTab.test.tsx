import './test-env';
import { afterEach, expect, test } from 'bun:test';
import { cleanup, render, within } from '@testing-library/react';
import { AuditTab } from './AuditTab';
import { failingVerdict, passingVerdict } from './test-fixtures';

afterEach(() => {
  if (typeof document !== 'undefined') cleanup();
});

test('renders newest verdict first with pass and fail banners', () => {
  const { container } = render(<AuditTab verdicts={[failingVerdict(), passingVerdict()]} />);

  const cards = container.querySelectorAll('[data-testid^="verdict-attempt-"]');
  expect(cards).toHaveLength(2);
  expect(cards[0]?.getAttribute('data-testid')).toBe('verdict-attempt-2');
  expect(cards[0]?.textContent).toContain('Passed');
  expect(cards[1]?.textContent).toContain('Failed');
});

test('a failing verdict shows the checks table, lane violations and numbered fix steps', () => {
  const view = render(<AuditTab verdicts={[failingVerdict()]} />);

  const table = view.getByTestId('checks-table-1');
  expect(table.textContent).toContain('tests');
  expect(table.textContent).toContain('bun test: 1 failing test');
  expect(within(table).getAllByLabelText('not ok')).toHaveLength(2);
  expect(within(table).getAllByLabelText('ok')).toHaveLength(1);
  expect(table.textContent).toContain('1.2s');

  expect(view.getByTestId('lane-violations').textContent).toContain('src/main.ts');
  expect(view.getByTestId('lane-violations').textContent).toContain('index.html');

  const steps = view.getByTestId('fix-instructions').querySelectorAll('li');
  expect(steps).toHaveLength(2);
  expect(steps[0]?.textContent).toContain('stubbed localStorage');
  expect(steps[1]?.textContent).toContain('Keep the change inside');
});

test('a passing verdict shows no fix instructions or lane violations', () => {
  const view = render(<AuditTab verdicts={[passingVerdict()]} />);

  expect(view.getByTestId('verdict-attempt-2').getAttribute('data-pass')).toBe('true');
  expect(view.queryByTestId('fix-instructions')).toBeNull();
  expect(view.queryByTestId('lane-violations')).toBeNull();
});

test('shows the attempt count and an empty state', () => {
  const both = render(<AuditTab verdicts={[failingVerdict(), passingVerdict()]} />);
  expect(both.getByText('2 audit attempts')).toBeTruthy();
  both.unmount();

  const empty = render(<AuditTab verdicts={[]} />);
  expect(empty.getByText(/still reviewing/)).toBeTruthy();
});
