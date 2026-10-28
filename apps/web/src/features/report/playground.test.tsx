import { afterEach, beforeEach, expect, test } from 'bun:test';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { demoEvents } from '../../data/demo';
import { ensureDom } from '../../lib/test-dom';
import Playground from './Playground';

ensureDom();
beforeEach(ensureDom);
afterEach(() => {
  if (typeof document !== 'undefined') cleanup();
});

test('renders the landed report at the end of the fixture', () => {
  const view = render(<Playground />);
  const page = view.getByTestId('report-page');
  expect(page.textContent).toContain('7/7 tasks landed');
  expect(page.textContent).toContain('5m 56s');
  expect(page.textContent?.toLowerCase()).toContain('estimate');
  expect(view.getByTestId('report-outcome').textContent).toBe('Landed.');
});

test('the slider scrubs mid-run and the report says it is still flying', () => {
  const view = render(<Playground />);
  const slider = view.getByLabelText('Event position') as HTMLInputElement;
  expect(Number(slider.max)).toBe(demoEvents().length);
  fireEvent.change(slider, { target: { value: '6' } });
  expect(view.getByTestId('report-page')).toBeTruthy();
  expect(view.getByTestId('report-outcome').textContent).toBe('Still flying.');
  expect(view.getByTestId('report-live-note')).toBeTruthy();
});

test('selecting a task in the playground keeps the chip pressed', () => {
  const view = render(<Playground />);
  fireEvent.click(view.getByTestId('report-task-theme'));
  expect(view.getByTestId('report-task-theme').getAttribute('aria-pressed')).toBe('true');
});
