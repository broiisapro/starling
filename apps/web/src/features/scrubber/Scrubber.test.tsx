import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { demoEvents } from '../../data/demo';
import { applyEvents, createInitialState } from '../../data/reducer';
import { ensureDom } from '../../lib/test-dom';
import { previewAt } from './derive';
import { buildMarkers, eventSpan, indexAtTime, timeAtIndex } from './markers';
import { Scrubber } from './Scrubber';
import type { ScrubberProps } from './types';

/**
 * Component tests for the replay scrubber. The DOM is registered by `lib/test-dom` before Testing
 * Library is imported; every test re-registers defensively because Bun shares one process across the
 * workspace.
 */
ensureDom();
beforeEach(ensureDom);
afterEach(() => {
  if (typeof document !== 'undefined') cleanup();
  restoreAnimationFrames();
});

const events = demoEvents();
const markers = buildMarkers(events);
const end = events.length - 1;
const failureIndex = markers.find((marker) => marker.kind === 'fail')?.index ?? -1;

let savedRaf: typeof globalThis.requestAnimationFrame | undefined;
let savedCaf: typeof globalThis.cancelAnimationFrame | undefined;

/** Replace requestAnimationFrame with a queue the test can flush by hand. */
function installFakeFrames(): FrameRequestCallback[] {
  const frames: FrameRequestCallback[] = [];
  savedRaf = globalThis.requestAnimationFrame;
  savedCaf = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback): number => {
    frames.push(callback);
    return frames.length;
  }) as typeof globalThis.requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((handle: number): void => {
    void handle;
  }) as typeof globalThis.cancelAnimationFrame;
  return frames;
}

function restoreAnimationFrames(): void {
  if (savedRaf !== undefined) globalThis.requestAnimationFrame = savedRaf;
  if (savedCaf !== undefined) globalThis.cancelAnimationFrame = savedCaf;
  savedRaf = undefined;
  savedCaf = undefined;
}

function stubWidth(element: Element, width = 1_000): void {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      left: 0,
      top: 0,
      right: width,
      bottom: 44,
      width,
      height: 44,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
  });
}

function renderScrubber(overrides: Partial<ScrubberProps> = {}) {
  const props: ScrubberProps = {
    state: createInitialState(),
    events,
    ...overrides,
  };
  return render(<Scrubber {...props} />);
}

function keyHead(container: HTMLElement, key: string, init: Record<string, unknown> = {}): void {
  fireEvent.keyDown(container, { key, ...init });
}

describe('slider semantics', () => {
  test('exposes min, max, now and a spoken time at the default end position', () => {
    const view = renderScrubber();
    const head = view.getByRole('slider', { name: 'Replay position' });
    expect(head.getAttribute('aria-valuemin')).toBe('0');
    expect(head.getAttribute('aria-valuemax')).toBe(String(end));
    expect(head.getAttribute('aria-valuenow')).toBe(String(end));
    expect(head.getAttribute('aria-valuetext')).toBe('5:56, run finished');
    expect(view.getByTestId('scrubber-clock').textContent).toBe('T+5:56 / 5:56');
  });

  test('defaults events to state.events', () => {
    const state = applyEvents(createInitialState(), events);
    const view = render(<Scrubber state={state} />);
    expect(view.getByRole('slider').getAttribute('aria-valuemax')).toBe(String(end));
    expect(view.getByTestId('scrubber-event-count').textContent).toContain(`/ ${events.length}`);
  });

  test('the value text names the marker on the head', () => {
    const view = renderScrubber({ index: failureIndex, onSeek: () => {} });
    expect(view.getByRole('slider').getAttribute('aria-valuetext')).toBe('1:03, theme failed audit');
  });

  test('clusters markers closer than four pixels and keeps both labels', () => {
    const view = renderScrubber();
    const cluster = view.getByTestId('scrubber-cluster-90');
    expect(cluster.getAttribute('data-kind')).toBe('fail');
    expect(cluster.textContent).toBe('2');
    expect(cluster.getAttribute('aria-label')).toContain('theme failed audit');
    expect(cluster.getAttribute('aria-label')).toContain('shortcuts merged');
  });
});

describe('keyboard', () => {
  test('arrow keys move one event and ask the parent to seek', () => {
    const seeks: number[] = [];
    const view = renderScrubber({ index: 0, onSeek: (next) => seeks.push(next) });
    keyHead(view.getByTestId('scrubber-head'), 'ArrowRight');
    expect(seeks).toEqual([1]);

    view.rerender(
      <Scrubber state={createInitialState()} events={events} index={5} onSeek={(next) => seeks.push(next)} />,
    );
    keyHead(view.getByTestId('scrubber-head'), 'ArrowLeft');
    expect(seeks).toEqual([1, 4]);
  });

  test('Shift+→ walks marker to marker until the theme audit failure (DoD 4)', () => {
    const seeks: number[] = [];
    const onSeek = (next: number): void => {
      seeks.push(next);
    };
    const view = renderScrubber({ index: 0, onSeek });

    for (let guard = 0; guard < 40 && !seeks.includes(failureIndex); guard += 1) {
      fireEvent.keyDown(view.getByTestId('scrubber-head'), { key: 'ArrowRight', shiftKey: true });
      const last = seeks.at(-1);
      if (last === undefined) break;
      view.rerender(<Scrubber state={createInitialState()} events={events} index={last} onSeek={onSeek} />);
    }

    expect(seeks).toContain(failureIndex);
    expect(seeks.at(-1)).toBe(failureIndex);
    expect(seeks).toEqual([2, 5, 57, 72, failureIndex]);
  });

  test('Shift+← walks back to the previous marker', () => {
    const seeks: number[] = [];
    const view = renderScrubber({ index: 91, onSeek: (next) => seeks.push(next) });
    fireEvent.keyDown(view.getByTestId('scrubber-head'), { key: 'ArrowLeft', shiftKey: true });
    expect(seeks).toEqual([90]);
  });

  test('PageDown/PageUp move ten seconds of recording time', () => {
    const seeks: number[] = [];
    const onSeek = (next: number): void => {
      seeks.push(next);
    };
    const view = renderScrubber({ index: 0, onSeek });
    fireEvent.keyDown(view.getByTestId('scrubber-head'), { key: 'PageDown' });
    const expectedDown = indexAtTime(events, timeAtIndex(events, 0) + 10_000);
    expect(seeks).toEqual([expectedDown]);

    view.rerender(<Scrubber state={createInitialState()} events={events} index={100} onSeek={onSeek} />);
    fireEvent.keyDown(view.getByTestId('scrubber-head'), { key: 'PageUp' });
    expect(seeks.at(-1)).toBe(indexAtTime(events, timeAtIndex(events, 100) - 10_000));
  });

  test('Home and End jump to the ends', () => {
    const seeks: number[] = [];
    const onSeek = (next: number): void => {
      seeks.push(next);
    };
    const view = renderScrubber({ index: 100, onSeek });
    fireEvent.keyDown(view.getByTestId('scrubber-head'), { key: 'End' });
    expect(seeks).toEqual([end]);

    view.rerender(<Scrubber state={createInitialState()} events={events} index={end} onSeek={onSeek} />);
    fireEvent.keyDown(view.getByTestId('scrubber-head'), { key: 'Home' });
    expect(seeks).toEqual([end, 0]);
  });

  test('Space toggles play/pause', () => {
    const calls: boolean[] = [];
    const onPlayPause = (next: boolean): void => {
      calls.push(next);
    };
    const view = renderScrubber({ playing: false, onPlayPause });
    fireEvent.keyDown(view.getByTestId('scrubber-head'), { key: ' ' });
    expect(calls).toEqual([true]);

    view.rerender(
      <Scrubber state={createInitialState()} events={events} playing onPlayPause={onPlayPause} />,
    );
    fireEvent.keyDown(view.getByTestId('scrubber-head'), { key: ' ' });
    expect(calls).toEqual([true, false]);
  });
});

describe('pointer dragging', () => {
  test('coalesces moves to one seek per frame and always emits a final seek on release', () => {
    const frames = installFakeFrames();
    const seeks: number[] = [];
    const view = renderScrubber({ index: 0, onSeek: (next) => seeks.push(next) });
    const track = view.getByTestId('scrubber-track');
    stubWidth(track, 1_000);

    fireEvent.pointerDown(track, { clientX: 100, pointerId: 1, button: 0, bubbles: true });
    fireEvent.pointerMove(track, { clientX: 400, pointerId: 1, bubbles: true });
    fireEvent.pointerMove(track, { clientX: 700, pointerId: 1, bubbles: true });
    expect(seeks).toEqual([]);
    expect(frames).toHaveLength(1);

    act(() => {
      const frame = frames.shift();
      frame?.(0);
    });
    const expected = indexAtTime(events, eventSpan(events).start + eventSpan(events).duration * 0.7);
    expect(seeks).toEqual([expected]);

    fireEvent.pointerUp(track, { clientX: 1_000, pointerId: 1, bubbles: true });
    expect(seeks).toHaveLength(2);
    expect(seeks.at(-1)).toBe(end);
  });

  test('a click without moving still seeks once on release', () => {
    const seeks: number[] = [];
    const view = renderScrubber({ index: 0, onSeek: (next) => seeks.push(next) });
    const track = view.getByTestId('scrubber-track');
    stubWidth(track, 1_000);

    fireEvent.pointerDown(track, { clientX: 250, pointerId: 1, button: 0, bubbles: true });
    fireEvent.pointerUp(track, { clientX: 250, pointerId: 1, bubbles: true });
    expect(seeks).toHaveLength(1);
    expect(seeks[0]).toBe(indexAtTime(events, eventSpan(events).start + eventSpan(events).duration * 0.25));
  });
});

describe('preview vs controlled', () => {
  test('preview mode is labelled and shows the numbers at the head', () => {
    const view = renderScrubber({ index: failureIndex });
    const preview = previewAt(events, failureIndex);
    const card = view.getByTestId('scrubber-preview');
    expect(card.textContent).toContain('preview: the live view keeps playing');
    expect(card.textContent).toContain(`landed ${preview?.landed}/${preview?.tasks}`);
    expect(card.textContent).toContain(`flying ${preview?.flying}`);
    expect(view.getByTestId('scrubber-preview-last').textContent).toContain('theme audit failed');
    expect(view.getByRole('slider').getAttribute('aria-valuenow')).toBe(String(failureIndex));
  });

  test('preview mode owns its head: End moves it and recomputes the card', () => {
    const view = renderScrubber({ index: failureIndex });
    fireEvent.keyDown(view.getByTestId('scrubber-head'), { key: 'End' });
    expect(view.getByRole('slider').getAttribute('aria-valuenow')).toBe(String(end));
    expect(view.getByTestId('scrubber-preview').textContent).toContain('landed 7/7');
    expect(view.getByTestId('scrubber-preview-last').textContent).toContain('run finished');
  });

  test('controlled mode asks the parent and does not move on its own', () => {
    const seeks: number[] = [];
    const onSeek = (next: number): void => {
      seeks.push(next);
    };
    const view = renderScrubber({ index: 0, onSeek });
    fireEvent.keyDown(view.getByTestId('scrubber-head'), { key: 'End' });
    expect(seeks).toEqual([end]);
    expect(view.getByRole('slider').getAttribute('aria-valuenow')).toBe('0');
    expect(view.queryByTestId('scrubber-preview')).toBeNull();

    view.rerender(<Scrubber state={createInitialState()} events={events} index={end} onSeek={onSeek} />);
    expect(view.getByRole('slider').getAttribute('aria-valuenow')).toBe(String(end));
  });
});

describe('controls', () => {
  test('play/pause button reports the requested state', () => {
    const calls: boolean[] = [];
    const view = renderScrubber({ onPlayPause: (next) => calls.push(next) });
    fireEvent.click(view.getByTestId('scrubber-toggle'));
    expect(calls).toEqual([true]);
    expect(view.getByTestId('scrubber-toggle').getAttribute('aria-label')).toBe('Pause replay');
  });

  test('speed tabs report 1x / 4x / 16x', () => {
    const speeds: number[] = [];
    const view = renderScrubber({ speed: 1, onSpeedChange: (next) => speeds.push(next) });
    fireEvent.click(view.getByRole('tab', { name: '4×' }));
    expect(speeds).toEqual([4]);
    expect(view.getByRole('tab', { name: '1×' }).getAttribute('aria-selected')).toBe('true');
  });

  test('jump to next failure seeks to the failed audit and disables when there is none', () => {
    const seeks: number[] = [];
    const onSeek = (next: number): void => {
      seeks.push(next);
    };
    const view = renderScrubber({ index: 0, onSeek });
    fireEvent.click(view.getByTestId('scrubber-failure'));
    expect(seeks).toEqual([failureIndex]);

    view.rerender(<Scrubber state={createInitialState()} events={events} index={end} onSeek={onSeek} />);
    const failureButton = view.getByTestId('scrubber-failure') as HTMLButtonElement;
    expect(failureButton.disabled).toBe(true);
  });

  test('legend chips filter marker groups and keep plan/finish bookends', () => {
    const view = renderScrubber();
    expect(view.getByTestId('scrubber-marker-2')).toBeDefined();
    const nodes = view.getByTestId('scrubber-filter-nodes');
    expect(nodes.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(nodes);
    expect(nodes.getAttribute('aria-pressed')).toBe('false');
    expect(view.queryByTestId('scrubber-marker-2')).toBeNull();
    expect(view.queryByTestId('scrubber-cluster-202')).toBeNull();
    expect(view.getByTestId('scrubber-marker-5')).toBeDefined();
    expect(view.getByTestId('scrubber-marker-251')).toBeDefined();

    fireEvent.click(nodes);
    expect(view.getByTestId('scrubber-marker-2')).toBeDefined();
  });

  test('hiding merges keeps the failure cluster visible', () => {
    const view = renderScrubber();
    fireEvent.click(view.getByTestId('scrubber-filter-merges'));
    expect(view.queryByTestId('scrubber-marker-57')).toBeNull();
    expect(view.getByTestId('scrubber-marker-90')).toBeDefined();
    expect(view.getByTestId('scrubber-marker-251')).toBeDefined();
  });

  test('renders a friendly empty state with no events', () => {
    const view = renderScrubber({ events: [] });
    expect(view.getByText('Nothing to scrub yet')).toBeDefined();
    expect(view.queryByRole('slider')).toBeNull();
  });
});

describe('motion', () => {
  test('the head has no transition when reduced motion is requested', () => {
    const original = window.matchMedia;
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) => ({
        matches: true,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }),
    });

    const view = renderScrubber();
    expect(view.getByTestId('scrubber-head').style.transition).toBe('none');

    Object.defineProperty(window, 'matchMedia', { configurable: true, value: original });
  });

  test('the head glides linearly otherwise', () => {
    const view = renderScrubber();
    expect(view.getByTestId('scrubber-head').style.transition).toContain('linear');
  });
});
