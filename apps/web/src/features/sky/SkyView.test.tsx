import { afterAll, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { makeNodeInfo, makePlan, makeRun, makeTaskRun, makeTaskSpec } from '@starling/core/testing';
import type { ReactElement } from 'react';
import { useState } from 'react';
import { layoutRoosts, roostPerchOffset } from './layout';
import { SkyView } from './SkyView';
import { type SkyAudio, SOUND_STORAGE_KEY } from './sound';

// `apps/web/bunfig.toml` preloads happy-dom when tests run from this package; the root
// `bun run test` does not load nested bunfigs, so register here as well (idempotently).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const registeredHere = typeof document === 'undefined';
if (registeredHere) GlobalRegistrator.register({ url: 'http://localhost/' });

const plan = makePlan({
  tasks: [
    makeTaskSpec({ key: 'theme', title: 'Dark mode' }),
    makeTaskSpec({ key: 'search', title: 'Live search' }),
  ],
});

const run = makeRun({
  plan,
  tasks: {
    theme: makeTaskRun({ taskKey: 'theme', status: 'merged', nodeId: 'hub' }),
    search: makeTaskRun({ taskKey: 'search', status: 'running', nodeId: 'hub', attempts: 1 }),
  },
});

const nodes = [makeNodeInfo({ id: 'hub', name: 'MacBook Pro', status: 'busy' })];

const pendingRun = makeRun({
  plan,
  tasks: {
    theme: makeTaskRun({ taskKey: 'theme', status: 'pending', nodeId: 'hub' }),
    search: makeTaskRun({ taskKey: 'search', status: 'pending', nodeId: 'hub' }),
  },
});

async function mount(ui: () => ReactElement) {
  const [{ act }, { createRoot }] = await Promise.all([import('react'), import('react-dom/client')]);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(ui());
  });
  return {
    container,
    async rerender(next: () => ReactElement) {
      await act(async () => {
        root.render(next());
      });
    },
    async click(element: Element | null) {
      await act(async () => {
        element?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
    },
    async unmount() {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

/** A tiny stateful wrapper: the shell (E23) does this with the real selection. */
function StatefulSky(props: { run: typeof run; nodes: typeof nodes; onSelect: (key: string) => void }) {
  const [selected, setSelected] = useState<string | undefined>();
  return (
    <SkyView
      run={props.run}
      nodes={props.nodes}
      recent={[]}
      selectedTask={selected}
      onSelectTask={(key) => {
        props.onSelect(key);
        setSelected(key);
      }}
    />
  );
}

test('renders an accessible canvas and a live summary of the run', async () => {
  const view = await mount(() => (
    <SkyView run={run} nodes={nodes} recent={[]} onSelectTask={() => {}} selectedTask="search" />
  ));

  const canvas = view.container.querySelector('canvas');
  expect(canvas).not.toBeNull();
  expect(canvas?.getAttribute('aria-label')).toContain('arrow keys');

  const panel = view.container.querySelector('[data-testid="sky-view"]');
  expect(panel?.getAttribute('role')).toBe('application');
  expect(panel?.getAttribute('aria-label')).toContain('2 tasks');
  expect(panel?.getAttribute('aria-label')).toContain('1 merged');

  const live = view.container.querySelector('[aria-live="polite"]');
  expect(live?.textContent).toContain('1 merged');
  expect(live?.textContent).toContain('1 running');
  expect(live?.textContent).toContain('1 machine');

  await view.unmount();
});

test('arrow keys cycle selection without a pointer', async () => {
  const selected: string[] = [];
  const view = await mount(() => (
    <StatefulSky run={run} nodes={nodes} onSelect={(key) => selected.push(key)} />
  ));

  const canvas = view.container.querySelector('canvas');
  const [{ act }] = await Promise.all([import('react')]);
  await act(async () => {
    canvas?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  });
  expect(selected).toEqual(['theme']);

  await act(async () => {
    canvas?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  });
  expect(selected.length).toBe(2);
  expect(selected[1]).toBe('search');

  await view.unmount();
});

test('clicking a flock leader selects that task', async () => {
  const selected: string[] = [];
  const view = await mount(() => (
    <SkyView run={pendingRun} nodes={nodes} recent={[]} onSelectTask={(key) => selected.push(key)} />
  ));

  // happy-dom reports a 0×0 rect, so the Sky falls back to 720×420 CSS px. Ask the layout where the
  // hub roost is rather than hard-coding pixels that Epic 47 moved.
  const roost = layoutRoosts(nodes, 720, 420).find((candidate) => candidate.nodeId === 'hub');
  if (!roost) throw new Error('missing hub roost');
  const canvas = view.container.querySelector('canvas');
  const [{ act }] = await Promise.all([import('react')]);
  await act(async () => {
    canvas?.dispatchEvent(
      new MouseEvent('click', {
        clientX: roost.x + roostPerchOffset(0, 2),
        clientY: roost.y - 8,
        bubbles: true,
      }),
    );
  });
  expect(selected.length).toBeGreaterThan(0);
  expect(selected[0]).toBe('theme');

  await view.unmount();
});

test('reduced motion still renders the sky and its summary', async () => {
  const view = await mount(() => (
    <SkyView run={run} nodes={nodes} recent={[]} onSelectTask={() => {}} reducedMotion />
  ));
  const canvas = view.container.querySelector('canvas');
  expect(canvas?.getAttribute('aria-label')).toContain('Task murmuration');
  expect(view.container.querySelector('[aria-live="polite"]')?.textContent).toContain('2 tasks');
  await view.unmount();
});

test('an empty sky still explains itself', async () => {
  const view = await mount(() => <SkyView nodes={[]} recent={[]} onSelectTask={() => {}} />);
  expect(view.container.querySelector('[role="application"]')?.getAttribute('aria-label')).toContain(
    'No run',
  );
  expect(view.container.querySelector('[aria-live="polite"]')?.textContent).toBe('No run. 0 machines.');
  await view.unmount();
});

// ── Epic 47: pausing and the sound toggle ───────────────────────────────────────────────────────

function stubAudio(): { audio: SkyAudio; state: { enabled: boolean; cues: string[]; hum: number[] } } {
  const state = { enabled: false, cues: [] as string[], hum: [] as number[] };
  return {
    state,
    audio: {
      get enabled() {
        return state.enabled;
      },
      setEnabled(on: boolean) {
        state.enabled = on;
        return on;
      },
      cue(kind) {
        state.cues.push(kind);
      },
      setHum(level) {
        state.hum.push(level);
      },
      resume() {},
      dispose() {
        state.enabled = false;
      },
    },
  };
}

test('the paused prop stops the rAF loop and unpausing restarts it', async () => {
  const originalRaf = globalThis.requestAnimationFrame;
  const originalCancel = globalThis.cancelAnimationFrame;
  const frames: FrameRequestCallback[] = [];
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  }) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;

  const fpsCalls: number[] = [];
  const sky = (isPaused: boolean) => (
    <SkyView
      run={run}
      nodes={nodes}
      recent={[]}
      onSelectTask={() => {}}
      paused={isPaused}
      onFps={(fps) => fpsCalls.push(fps)}
    />
  );

  // React schedules a few callbacks of its own, so the test drives the queue by hand and uses two
  // signals that only the Sky's own loop can produce: a self-rescheduling pending frame, and fps
  // callbacks. A paused Sky drains the queue; a live one never does (it always queues its successor).
  let now = performance.now() + 1000;
  const flush = (limit = 40) => {
    for (let i = 0; i < limit && frames.length > 0; i++) {
      const callback = frames.shift();
      now += 120;
      callback?.(now);
    }
  };

  try {
    const view = await mount(() => sky(true));
    flush();
    expect(frames.length).toBe(0);
    expect(fpsCalls.length).toBe(0);

    await view.rerender(() => sky(false));
    flush(12);
    // The live loop re-queues itself, so the queue is never drained and the fps hook fires.
    expect(frames.length).toBe(1);
    expect(fpsCalls.length).toBeGreaterThan(0);

    const fpsWhileRunning = fpsCalls.length;
    await view.rerender(() => sky(true));
    flush();
    expect(frames.length).toBe(0);
    expect(fpsCalls.length).toBe(fpsWhileRunning);

    await view.rerender(() => sky(false));
    flush(12);
    expect(frames.length).toBe(1);
    expect(fpsCalls.length).toBeGreaterThan(fpsWhileRunning);

    await view.unmount();
  } finally {
    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCancel;
  }
});

test('the sound toggle is remembered per viewer', async () => {
  localStorage.removeItem(SOUND_STORAGE_KEY);
  const { audio, state } = stubAudio();
  const view = await mount(() => (
    <SkyView run={run} nodes={nodes} recent={[]} onSelectTask={() => {}} createAudio={() => audio} />
  ));
  const button = view.container.querySelector('button[aria-pressed]');
  expect(button?.getAttribute('aria-pressed')).toBe('false');
  expect(button?.getAttribute('aria-label')).toContain('Play');

  await view.click(button);
  expect(button?.getAttribute('aria-pressed')).toBe('true');
  expect(button?.getAttribute('aria-label')).toContain('Mute');
  expect(state.enabled).toBe(true);
  expect(localStorage.getItem(SOUND_STORAGE_KEY)).toBe('on');
  await view.unmount();

  // A fresh viewer (another mount) restores the preference.
  const second = stubAudio();
  const again = await mount(() => (
    <SkyView run={run} nodes={nodes} recent={[]} onSelectTask={() => {}} createAudio={() => second.audio} />
  ));
  expect(again.container.querySelector('button[aria-pressed]')?.getAttribute('aria-pressed')).toBe('true');
  expect(second.state.enabled).toBe(true);
  await again.unmount();
  localStorage.removeItem(SOUND_STORAGE_KEY);
});

test('a blocked localStorage does not break the sound toggle', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      throw new Error('SecurityError: denied');
    },
  });
  const { audio } = stubAudio();
  try {
    const view = await mount(() => (
      <SkyView run={run} nodes={nodes} recent={[]} onSelectTask={() => {}} createAudio={() => audio} />
    ));
    const button = view.container.querySelector('button[aria-pressed]');
    expect(button?.getAttribute('aria-pressed')).toBe('false');
    await view.click(button);
    // The toggle still works for this page view; only the preference is lost.
    expect(button?.getAttribute('aria-pressed')).toBe('true');
    await view.unmount();
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

afterAll(() => {
  if (registeredHere) GlobalRegistrator.unregister();
});
