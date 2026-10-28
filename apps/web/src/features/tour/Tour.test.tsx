import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { useState } from 'react';
import { createInitialState, type SkyState } from '../../data/reducer';
import { ensureDom } from '../../lib/test-dom';

ensureDom();
const { act, cleanup, fireEvent, render } = await import('@testing-library/react');

const { Tour } = await import('./Tour');
const { ShellMock } = await import('./ShellMock');
const { demoStateAt, setViewport, stubRects, stubReducedMotion } = await import('./test-support');
const { TOUR_STORAGE_KEY } = await import('./storage');

const restorers: Array<() => void> = [];

/** Mounts the shell only after a click, so the tour has to notice a late anchor. */
function LateAnchorHarness({ state }: { state: SkyState }) {
  const [mounted, setMounted] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setMounted(true)}>
        mount the shell
      </button>
      {mounted ? <ShellMock state={state} selectedTask="search" /> : null}
      <Tour state={state} />
    </>
  );
}

beforeEach(() => {
  localStorage.clear();
  setViewport(1280, 720);
});

afterEach(() => {
  cleanup();
  while (restorers.length > 0) restorers.pop()?.();
  localStorage.clear();
});

function seenRecord(): { seen: boolean; at: number } | undefined {
  const raw = localStorage.getItem(TOUR_STORAGE_KEY);
  if (raw === null) return undefined;
  return JSON.parse(raw) as { seen: boolean; at: number };
}

type View = ReturnType<typeof render>;

function progress(view: View): string | null {
  return view.getByTestId('tour-progress').textContent;
}

function primary(view: View): HTMLElement {
  return view.getByRole('button', { name: /^(Next|Finish)$/ });
}

function advance(view: View, times: number): void {
  for (let step = 0; step < times; step += 1) fireEvent.click(primary(view));
}

describe('Tour rendering', () => {
  test('opens on step 1 as a labelled dialog with x/7 progress', () => {
    const view = render(<Tour state={createInitialState()} />);
    const card = view.getByTestId('tour-card');

    expect(card.getAttribute('role')).toBe('dialog');
    expect(card.getAttribute('aria-modal')).toBe('true');
    expect(card.getAttribute('aria-live')).toBe('polite');
    expect(view.getByTestId('tour-progress').textContent).toBe('Step 1 of 7');
    expect(view.getByText('This is the murmuration')).toBeTruthy();
    expect(primary(view).textContent).toContain('Next');
  });

  test('renders nothing while closed, and a reopened tour starts over', () => {
    const view = render(<Tour state={createInitialState()} open={false} />);
    expect(view.queryByTestId('tour-overlay')).toBeNull();

    view.rerender(<Tour state={createInitialState()} open />);
    expect(view.queryByTestId('tour-overlay')).not.toBeNull();

    advance(view, 2);
    expect(progress(view)).toBe('Step 3 of 7');
    view.rerender(<Tour state={createInitialState()} open={false} />);
    view.rerender(<Tour state={createInitialState()} open />);
    expect(progress(view)).toBe('Step 1 of 7');
  });

  test('Next walks forward and Back returns', () => {
    const view = render(<Tour state={createInitialState()} />);
    fireEvent.click(primary(view));
    expect(progress(view)).toBe('Step 2 of 7');
    expect(view.getByText('Two ways to watch the same run')).toBeTruthy();

    fireEvent.click(view.getByRole('button', { name: 'Back' }));
    expect(progress(view)).toBe('Step 1 of 7');
    expect((view.getByRole('button', { name: 'Back' }) as HTMLButtonElement).disabled).toBe(true);
  });

  test('arrow keys move between steps while the card has focus', () => {
    const view = render(<Tour state={createInitialState()} />);
    const card = view.getByTestId('tour-card');

    fireEvent.keyDown(card, { key: 'ArrowRight' });
    fireEvent.keyDown(card, { key: 'ArrowRight' });
    expect(progress(view)).toBe('Step 3 of 7');

    fireEvent.keyDown(card, { key: 'ArrowLeft' });
    expect(progress(view)).toBe('Step 2 of 7');
  });

  test('Enter advances from the card but not from a focused button (no double step)', () => {
    const view = render(<Tour state={createInitialState()} />);
    const card = view.getByTestId('tour-card');

    fireEvent.keyDown(primary(view), { key: 'Enter' });
    expect(progress(view)).toBe('Step 1 of 7');

    fireEvent.keyDown(card, { key: 'Enter' });
    expect(progress(view)).toBe('Step 2 of 7');
  });

  test('starts with focus on the primary action', () => {
    const view = render(<Tour state={createInitialState()} />);
    expect(document.activeElement).toBe(primary(view));
  });

  test('traps Tab inside the card, wrapping both ways', () => {
    const view = render(<Tour state={createInitialState()} />);
    const card = view.getByTestId('tour-card');

    fireEvent.keyDown(card, { key: 'Tab' });
    expect(document.activeElement?.textContent).toBe('Skip');

    fireEvent.keyDown(card, { key: 'Tab', shiftKey: true });
    expect(document.activeElement?.textContent).toContain('Next');
  });
});

describe('finishing and skipping', () => {
  test('Skip writes the seen record and calls onClose', () => {
    let closed = 0;
    const view = render(<Tour state={createInitialState()} onClose={() => (closed += 1)} />);

    fireEvent.click(view.getByRole('button', { name: 'Skip' }));

    expect(closed).toBe(1);
    expect(seenRecord()?.seen).toBe(true);
    expect(view.queryByTestId('tour-overlay')).toBeNull();
  });

  test('Esc skips too', () => {
    let closed = 0;
    const view = render(<Tour state={createInitialState()} onClose={() => (closed += 1)} />);

    fireEvent.keyDown(view.getByTestId('tour-card'), { key: 'Escape' });

    expect(closed).toBe(1);
    expect(seenRecord()?.seen).toBe(true);
  });

  test('the last step finishes instead of advancing', () => {
    let closed = 0;
    const view = render(<Tour state={createInitialState()} onClose={() => (closed += 1)} />);

    advance(view, 6);
    expect(progress(view)).toBe('Step 7 of 7');
    expect(primary(view).textContent).toContain('Finish');

    fireEvent.click(primary(view));
    expect(closed).toBe(1);
    expect(seenRecord()?.seen).toBe(true);
  });
});

describe('anchors and the drawer action', () => {
  test('highlights the sky, then follows the centre-view tabs', () => {
    restorers.push(
      stubRects({
        '[data-region="sky"]': { left: 200, top: 80, width: 880, height: 500 },
        '[role="tablist"][aria-label="Centre view"]': { left: 600, top: 16, width: 200, height: 30 },
      }),
    );
    const state = demoStateAt(160);
    const view = render(
      <>
        <ShellMock state={state} selectedTask="search" />
        <Tour state={state} />
      </>,
    );

    const first = view.getByTestId('tour-card');
    expect(first.dataset.hasTarget).toBe('true');
    expect(view.getByTestId('tour-spotlight')).toBeTruthy();

    fireEvent.click(primary(view));
    const second = view.getByTestId('tour-card');
    expect(second.dataset.hasTarget).toBe('true');
    expect(second.dataset.placement).toBe('bottom');
  });

  test('a missing anchor degrades to a centred card', () => {
    const view = render(<Tour state={createInitialState()} />);
    const card = view.getByTestId('tour-card');

    expect(card.dataset.hasTarget).toBe('false');
    expect(card.dataset.placement).toBe('center');
    expect(card.textContent).toContain('no region to point at');
  });

  test('picks up an anchor that mounts after the tour opened', async () => {
    const state = demoStateAt(160);
    restorers.push(stubRects({ '[data-region="sky"]': { left: 40, top: 80, width: 900, height: 520 } }));
    const view = render(<LateAnchorHarness state={state} />);
    expect(view.getByTestId('tour-card').dataset.hasTarget).toBe('false');

    await act(async () => {
      fireEvent.click(view.getByText('mount the shell'));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(view.getByTestId('tour-card').dataset.hasTarget).toBe('true');
  });

  test('the drawer step selects the first running task', () => {
    const calls: string[] = [];
    const view = render(<Tour state={demoStateAt(160)} onSelectTask={(key) => calls.push(key)} />);

    advance(view, 3);

    expect(view.getByTestId('tour-card').dataset.step).toBe('drawer');
    expect(calls[0]).toBe('search');
  });

  test('the drawer step survives a run with no tasks', () => {
    const calls: string[] = [];
    const view = render(<Tour state={createInitialState()} onSelectTask={(key) => calls.push(key)} />);

    advance(view, 3);

    expect(view.getByTestId('tour-card').dataset.step).toBe('drawer');
    expect(view.getByTestId('tour-card').dataset.placement).toBe('center');
    expect(calls).toEqual([]);
  });
});

describe('prefers-reduced-motion', () => {
  test('marks the overlay so no spotlight animation runs', () => {
    restorers.push(stubReducedMotion(true));
    const view = render(<Tour state={createInitialState()} />);
    expect(view.getByTestId('tour-overlay').dataset.reducedMotion).toBe('true');
  });

  test('leaves animation on when the user has no preference', () => {
    restorers.push(stubReducedMotion(false));
    const view = render(<Tour state={createInitialState()} />);
    expect(view.getByTestId('tour-overlay').dataset.reducedMotion).toBe('false');
  });
});
