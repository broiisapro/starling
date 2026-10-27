import { afterAll, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { makeNodeInfo, makePlan, makeRun, makeTaskRun, makeTaskSpec } from '@starling/core/testing';
import type { ReactElement } from 'react';
import { useState } from 'react';
import { SkyView } from './SkyView';

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

  // happy-dom reports a 0×0 rect, so the Sky falls back to 720×420 CSS px. The hub roost sits at
  // (72, 394); the first pending flock perches at x≈53, so a click there hits `theme`.
  const canvas = view.container.querySelector('canvas');
  const [{ act }] = await Promise.all([import('react')]);
  await act(async () => {
    canvas?.dispatchEvent(new MouseEvent('click', { clientX: 53, clientY: 386, bubbles: true }));
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

afterAll(() => {
  if (registeredHere) GlobalRegistrator.unregister();
});
