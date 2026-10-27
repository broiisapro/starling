import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ensureDom } from '../../lib/test-dom';

ensureDom();
const { cleanup, fireEvent, render } = await import('@testing-library/react');

const { Tour } = await import('./Tour');
const { ShellMock } = await import('./ShellMock');
const { TOUR_STEPS } = await import('./steps');
const { TOUR_STORAGE_KEY } = await import('./storage');
const { demoStateAt, setViewport } = await import('./test-support');

beforeEach(() => {
  localStorage.clear();
  setViewport(1280, 720);
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

/**
 * The definition-of-done walk: a judge's whole trip through the tour, keyboard only, over the mock of
 * the real shell, ending with the seen record on disk.
 */
describe('keyboard walkthrough', () => {
  test('seven ArrowRights visit every step and Enter finishes with the record written', () => {
    let closed = 0;
    const state = demoStateAt(160);
    const view = render(
      <>
        <ShellMock state={state} selectedTask="search" />
        <Tour state={state} onClose={() => (closed += 1)} />
      </>,
    );

    const visited: string[] = [];
    for (let index = 0; index < TOUR_STEPS.length; index += 1) {
      const card = view.getByTestId('tour-card');
      visited.push(card.dataset.step ?? 'unknown');
      expect(view.getByTestId('tour-progress').textContent).toBe(`Step ${index + 1} of 7`);
      // Every step except the last advances with the right arrow.
      if (index < TOUR_STEPS.length - 1) fireEvent.keyDown(card, { key: 'ArrowRight' });
    }

    expect(visited).toEqual(TOUR_STEPS.map((step) => step.id));
    expect(view.getByRole('button', { name: 'Finish' })).toBeTruthy();

    fireEvent.keyDown(view.getByTestId('tour-card'), { key: 'Enter' });

    expect(closed).toBe(1);
    expect(view.queryByTestId('tour-overlay')).toBeNull();
    const stored = localStorage.getItem(TOUR_STORAGE_KEY);
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored ?? '{}')).toMatchObject({ seen: true });
  });

  test('Esc halfway through closes the tour and still records the visit', () => {
    let closed = 0;
    const view = render(<Tour state={demoStateAt(160)} onClose={() => (closed += 1)} />);

    fireEvent.keyDown(view.getByTestId('tour-card'), { key: 'ArrowRight' });
    fireEvent.keyDown(view.getByTestId('tour-card'), { key: 'ArrowRight' });
    fireEvent.keyDown(view.getByTestId('tour-card'), { key: 'Escape' });

    expect(closed).toBe(1);
    expect(JSON.parse(localStorage.getItem(TOUR_STORAGE_KEY) ?? '{}')).toMatchObject({ seen: true });
  });

  test('walks all seven steps even when the shell provides no anchors at all', () => {
    const view = render(<Tour state={demoStateAt(160)} />);
    for (let index = 0; index < TOUR_STEPS.length - 1; index += 1) {
      const card = view.getByTestId('tour-card');
      expect(card.dataset.placement).toBe('center');
      fireEvent.keyDown(card, { key: 'ArrowRight' });
    }
    expect(view.getByTestId('tour-progress').textContent).toBe('Step 7 of 7');
  });
});
