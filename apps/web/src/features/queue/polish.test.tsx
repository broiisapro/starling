import { expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import type { Plan, TaskRun } from '@starling/core';
import { makePlan, makeTaskRun, makeTaskSpec } from '@starling/core/testing';
import type { ReactElement } from 'react';
import { MergeQueue } from './index';
import { columnWindow, QUEUE_ROW_HEIGHT, QUEUE_VIRTUALIZE_AFTER } from './window';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function ensureDom(): void {
  if (typeof document === 'undefined') GlobalRegistrator.register({ url: 'http://localhost/' });
}

interface Mounted {
  container: HTMLElement;
  rerender(next: ReactElement): Promise<void>;
  unmount(): Promise<void>;
}

async function mount(element: ReactElement): Promise<Mounted> {
  ensureDom();
  const [{ act }, { createRoot }] = await Promise.all([import('react'), import('react-dom/client')]);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(element);
  });
  return {
    container,
    async rerender(next) {
      await act(async () => {
        root.render(next);
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

function manyTasks(count: number): { plan: Plan; tasks: Record<string, TaskRun> } {
  const keys = Array.from({ length: count }, (_, index) => `t${String(index).padStart(2, '0')}`);
  return {
    plan: makePlan({ id: `plan-${count}`, tasks: keys.map((key) => makeTaskSpec({ key, title: key })) }),
    tasks: Object.fromEntries(keys.map((key) => [key, makeTaskRun({ taskKey: key, status: 'pending' })])),
  };
}

test('window maths renders everything below the threshold', () => {
  const window = columnWindow({ count: QUEUE_VIRTUALIZE_AFTER, scrollTop: 999, viewportHeight: 100 });

  expect(window).toEqual({
    start: 0,
    end: QUEUE_VIRTUALIZE_AFTER,
    topPad: 0,
    bottomPad: 0,
    virtualized: false,
  });
});

test('window maths keeps a viewport plus overscan and honest spacers', () => {
  const window = columnWindow({ count: 100, scrollTop: QUEUE_ROW_HEIGHT * 20, viewportHeight: 200 });

  expect(window.virtualized).toBe(true);
  expect(window.start).toBe(16);
  expect(window.end).toBeLessThan(100);
  expect(window.topPad).toBe(16 * QUEUE_ROW_HEIGHT);
  expect(window.bottomPad).toBe((100 - window.end) * QUEUE_ROW_HEIGHT);
  expect(window.end - window.start).toBeLessThan(20);
});

test('window maths clamps a negative scroll and guards a zero row height', () => {
  const negative = columnWindow({ count: 80, scrollTop: -50, viewportHeight: 200 });
  expect(negative.start).toBe(0);

  const zero = columnWindow({ count: 80, scrollTop: 100, viewportHeight: 200, rowHeight: 0 });
  expect(zero.virtualized).toBe(false);
  expect(zero.end).toBe(80);
});

test('the selected card is highlighted and announced', async () => {
  const { plan, tasks } = manyTasks(2);
  const view = await mount(
    <MergeQueue plan={plan} tasks={tasks} merges={[]} selectedTask="t01" onSelectTask={() => {}} />,
  );
  try {
    const selected = view.container.querySelector<HTMLElement>('[data-task-key="t01"]');
    expect(selected?.getAttribute('data-selected')).toBe('true');
    expect(selected?.getAttribute('aria-current')).toBe('true');
    expect(selected?.className).toContain('ring-sky-400/50');

    const other = view.container.querySelector<HTMLElement>('[data-task-key="t00"]');
    expect(other?.getAttribute('data-selected')).toBe('false');
    expect(other?.getAttribute('aria-current')).toBeNull();
  } finally {
    await view.unmount();
  }
});

test('each column owns its scroll container so a click never moves the page', async () => {
  const { plan, tasks } = manyTasks(3);
  const view = await mount(<MergeQueue plan={plan} tasks={tasks} merges={[]} onSelectTask={() => {}} />);
  try {
    const list = view.container.querySelector<HTMLElement>('[data-column-scroll="waiting"]');
    expect(list).not.toBeNull();
    expect(list?.className).toContain('overflow-y-auto');
    expect(list?.className).toContain('overscroll-contain');
    // The board itself never scrolls vertically; only sideways between columns.
    const board = view.container.querySelector<HTMLElement>('[data-starling-queue] > div');
    expect(board?.className).toContain('overflow-x-auto');
    expect(board?.className).toContain('overflow-y-hidden');
  } finally {
    await view.unmount();
  }
});

test('a column past 30 cards windows its children', async () => {
  const { plan, tasks } = manyTasks(60);
  const view = await mount(<MergeQueue plan={plan} tasks={tasks} merges={[]} onSelectTask={() => {}} />);
  try {
    const column = view.container.querySelector<HTMLElement>('[data-column-section="waiting"]');
    expect(column?.getAttribute('data-virtualized')).toBe('true');
    const cards = column?.querySelectorAll('button[data-task-key]') ?? [];
    expect(cards.length).toBeLessThan(60);
    expect(cards.length).toBeGreaterThan(0);
    // Spacer rows keep the scrollbar proportional to the real list.
    expect(column?.querySelectorAll('li[aria-hidden="true"]').length).toBeGreaterThan(0);
  } finally {
    await view.unmount();
  }
});

test('a small board is not virtualised, so every card is reachable', async () => {
  const { plan, tasks } = manyTasks(7);
  const view = await mount(<MergeQueue plan={plan} tasks={tasks} merges={[]} onSelectTask={() => {}} />);
  try {
    const column = view.container.querySelector<HTMLElement>('[data-column-section="waiting"]');
    expect(column?.getAttribute('data-virtualized')).toBe('false');
    expect(column?.querySelectorAll('button[data-task-key]').length).toBe(7);
  } finally {
    await view.unmount();
  }
});

test('a published nodeName is preferred over the node id on a card', async () => {
  const run = makeTaskRun({ taskKey: 'theme', status: 'running', nodeId: 'air', startedAt: 1 });
  const tasks = { theme: { ...run, nodeName: 'M2 Air' } };

  const view = await mount(<MergeQueue tasks={tasks} merges={[]} onSelectTask={() => {}} />);
  try {
    const card = view.container.querySelector<HTMLElement>('[data-task-key="theme"]');
    expect(card?.textContent).toContain('M2 Air');
    expect(card?.getAttribute('aria-label')).toContain('on M2 Air');
  } finally {
    await view.unmount();
  }
});
