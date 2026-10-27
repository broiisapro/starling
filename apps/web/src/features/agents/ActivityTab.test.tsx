import './test-env';
import { afterEach, expect, test } from 'bun:test';
import { makeAgentEvent } from '@starling/core/testing';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ActivityTab } from './ActivityTab';
import { sampleEvents } from './test-fixtures';

afterEach(() => {
  if (typeof document !== 'undefined') cleanup();
});

test('renders every event kind as a readable timeline', () => {
  const view = render(<ActivityTab events={sampleEvents()} />);

  expect(view.getByText(/session started · hub · deepseek\/deepseek-v4.1-flash/)).toBeTruthy();
  expect(view.getByText('read')).toBeTruthy();
  // The path appears twice: as the tool summary and as the edited-file chip.
  expect(view.getAllByText('src/lib/dates.ts').length).toBeGreaterThanOrEqual(2);
  expect(view.getByTestId('file-chip').textContent).toContain('src/features/theme/index.ts');
  expect(view.getByTestId('file-chip').textContent).toContain('34');
  expect(view.getByTestId('usage-footer').textContent).toContain('12k in');
  expect(view.getByText('session idle')).toBeTruthy();
  expect(view.container.querySelectorAll('li[data-kind]')).toHaveLength(6);
});

test('pairs the tool result into the call row with an ok badge', () => {
  const view = render(<ActivityTab events={sampleEvents()} />);

  const toolRow = view.getByText('read').closest('details');
  expect(toolRow).not.toBeNull();
  expect(toolRow?.textContent).toContain('ok');
  expect(toolRow?.textContent).toContain('1,180 bytes');
});

test('renders markdown-lite: inline code and fenced blocks', () => {
  const events = [
    makeAgentEvent({
      kind: 'text',
      data: { text: 'Run `bun test` first.\n```ts\nconst a = 1;\n```' },
    }),
  ];
  const { container, getByText } = render(<ActivityTab events={events} />);

  expect(getByText('bun test').tagName).toBe('CODE');
  expect(container.querySelector('pre code')?.textContent).toBe('const a = 1;');
  expect(container.querySelector('pre code')?.getAttribute('data-lang')).toBe('ts');
});

test('windowed rendering keeps 500 events cheap', () => {
  const events = Array.from({ length: 500 }, (_, index) =>
    makeAgentEvent({ ts: 1_700_000_000_000 + index, kind: 'text', data: { text: `event ${index}` } }),
  );
  const { container, getByTestId } = render(<ActivityTab events={events} />);

  expect(getByTestId('activity-list').getAttribute('data-virtualized')).toBe('true');
  expect(container.querySelectorAll('li[data-kind]').length).toBeLessThan(500);
  expect(container.querySelectorAll('li[aria-hidden="true"]').length).toBeGreaterThan(0);
});

test('shows an empty state before the first event', () => {
  const view = render(<ActivityTab events={[]} />);

  expect(view.getByText(/stretching its wings/)).toBeTruthy();
});

test('scrolling away from the tail reveals a jump-to-latest pill', () => {
  const view = render(<ActivityTab events={sampleEvents()} />);
  const list = view.getByTestId('activity-list');
  Object.defineProperty(list, 'scrollHeight', { value: 1_000, configurable: true });
  Object.defineProperty(list, 'clientHeight', { value: 300, configurable: true });

  list.scrollTop = 0;
  fireEvent.scroll(list);
  expect(view.getByText('Jump to latest')).toBeTruthy();

  fireEvent.click(view.getByText('Jump to latest'));
  expect(view.queryByText('Jump to latest')).toBeNull();
});
