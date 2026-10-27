import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import type { MergeResult, Plan, StarlingEvent, TaskRun } from '@starling/core';
import { StarlingEventSchema } from '@starling/core';
import { makePlan, makeTaskRun, makeTaskSpec } from '@starling/core/testing';
import type { ReactElement } from 'react';

import { MergeQueue } from './index';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * happy-dom is registered lazily and never unregistered: the root `bun run test` loads every package
 * in one process, and another web test file may have torn the DOM down between modules.
 */
function ensureDom(): void {
  if (typeof document === 'undefined') GlobalRegistrator.register({ url: 'http://localhost/' });
}

interface Mounted {
  container: HTMLElement;
  click(element: Element | null): Promise<void>;
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
    async click(target) {
      await act(async () => {
        if (target instanceof HTMLElement) target.click();
      });
    },
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

function cardFor(container: HTMLElement, taskKey: string): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>(`button[data-task-key="${taskKey}"]`);
}

function cardsIn(container: HTMLElement, column: string): HTMLButtonElement[] {
  const section = container.querySelector<HTMLElement>(`[data-column-section="${column}"]`);
  return section === null ? [] : [...section.querySelectorAll<HTMLButtonElement>('button[data-task-key]')];
}

const FIXTURE_URL = new URL('../../../../../fixtures/runs/sky-todo-launch-day.jsonl', import.meta.url);

function loadFixture(): {
  plan: Plan;
  tasks: Record<string, TaskRun>;
  merges: MergeResult[];
} {
  const raw = readFileSync(FIXTURE_URL, 'utf8');
  const events: StarlingEvent[] = raw
    .trim()
    .split('\n')
    .map((line) => StarlingEventSchema.parse(JSON.parse(line)));

  const created = events.find((event) => event.type === 'run.created');
  if (created === undefined || created.type !== 'run.created') throw new Error('fixture has no run.created');
  const plan = created.payload.run.plan;
  if (plan === undefined) throw new Error('fixture run has no plan');

  const tasks: Record<string, TaskRun> = {};
  const merges: MergeResult[] = [];
  for (const event of events) {
    if (event.type === 'task.status') tasks[event.payload.taskKey] = event.payload.run;
    if (event.type === 'merge.result') merges.push(event.payload);
  }
  return { plan, tasks, merges };
}

const fixture = loadFixture();

test('renders all six columns with headings and empty states', async () => {
  const view = await mount(<MergeQueue plan={undefined} tasks={{}} merges={[]} onSelectTask={() => {}} />);
  try {
    const sections = [...view.container.querySelectorAll<HTMLElement>('[data-column-section]')];
    expect(sections.map((section) => section.dataset.columnSection)).toEqual([
      'waiting',
      'flying',
      'audit',
      'landing',
      'wire',
      'grounded',
    ]);
    const headings = [...view.container.querySelectorAll('h3')].map((heading) => heading.textContent);
    expect(headings).toEqual(['Waiting', 'Flying', 'Audit', 'Landing', 'On the wire', 'Grounded']);
    expect(view.container.textContent).toContain('Nothing on the wire yet');
    expect(view.container.textContent).toContain('0 of 0');
  } finally {
    await view.unmount();
  }
});

test('final fixture state puts all seven tasks on the wire in merge order', async () => {
  const view = await mount(
    <MergeQueue plan={fixture.plan} tasks={fixture.tasks} merges={fixture.merges} onSelectTask={() => {}} />,
  );
  try {
    expect(view.container.querySelector('[data-testid="queue-landed"]')?.textContent).toBe('7 of 7');
    expect(cardsIn(view.container, 'wire').map((card) => card.dataset.taskKey)).toEqual([
      'dates-fix',
      'csv-export',
      'shortcuts',
      'theme',
      'due-badges',
      'help-overlay',
      'search',
    ]);
    const first = cardsIn(view.container, 'wire')[0];
    expect(first?.textContent).toContain('#1');
    expect(first?.textContent).toContain('c0ffee0');
    expect(cardsIn(view.container, 'flying')).toHaveLength(0);
    expect(cardsIn(view.container, 'grounded')).toHaveLength(0);
  } finally {
    await view.unmount();
  }
});

test('clicking a card asks the shell to select that task', async () => {
  const selected: string[] = [];
  const view = await mount(
    <MergeQueue
      plan={fixture.plan}
      tasks={fixture.tasks}
      merges={fixture.merges}
      onSelectTask={(key) => selected.push(key)}
    />,
  );
  try {
    await view.click(cardFor(view.container, 'theme'));
    await view.click(cardFor(view.container, 'search'));
    expect(selected).toEqual(['theme', 'search']);
  } finally {
    await view.unmount();
  }
});

test('audit cards show the attempt badge, the node badge and a live elapsed', async () => {
  const plan = makePlan({ tasks: [makeTaskSpec({ key: 'theme', title: 'Dark mode' })] });
  const tasks: Record<string, TaskRun> = {
    theme: makeTaskRun({
      taskKey: 'theme',
      status: 'fixing',
      attempts: 2,
      nodeId: 'air',
      startedAt: Date.now() - 30_000,
    }),
  };
  const view = await mount(<MergeQueue plan={plan} tasks={tasks} merges={[]} onSelectTask={() => {}} />);
  try {
    const card = cardFor(view.container, 'theme');
    const text = card?.textContent ?? '';
    expect(text).toContain('×2');
    expect(text).toContain('air');
    expect(text).toContain('30s');
    expect(card?.getAttribute('aria-label')).toBe('theme, fixing, attempt 2, on air');
  } finally {
    await view.unmount();
  }
});

test('a failure detail is exposed as a tooltip and to screen readers', async () => {
  const plan = makePlan({ tasks: [makeTaskSpec({ key: 'theme' })] });
  const tasks: Record<string, TaskRun> = {
    theme: makeTaskRun({ taskKey: 'theme', status: 'failed', attempts: 1 }),
  };
  const merges: MergeResult[] = [
    {
      taskKey: 'theme',
      status: 'tests-failed',
      conflictedFiles: [],
      detail: 'bun test: 2 fail in dates.test.ts',
      ts: Date.now(),
    },
  ];
  const view = await mount(<MergeQueue plan={plan} tasks={tasks} merges={merges} onSelectTask={() => {}} />);
  try {
    const card = cardFor(view.container, 'theme');
    expect(card?.getAttribute('title')).toBe('bun test: 2 fail in dates.test.ts');
    const describedBy = card?.getAttribute('aria-describedby');
    expect(describedBy).not.toBeNull();
    expect(view.container.querySelector(`#${describedBy ?? 'missing'}`)?.textContent).toBe(
      'bun test: 2 fail in dates.test.ts',
    );
    expect(card?.textContent).toContain('failed');
  } finally {
    await view.unmount();
  }
});

test('a conflicted task shows its status and the merge detail', async () => {
  const tasks: Record<string, TaskRun> = {
    theme: makeTaskRun({ taskKey: 'theme', status: 'conflict' }),
  };
  const merges: MergeResult[] = [
    {
      taskKey: 'theme',
      status: 'conflict',
      conflictedFiles: ['src/ui/styles.css'],
      detail: 'conflict in src/ui/styles.css',
      ts: Date.now(),
    },
  ];
  const view = await mount(
    <MergeQueue plan={undefined} tasks={tasks} merges={merges} onSelectTask={() => {}} />,
  );
  try {
    const card = cardFor(view.container, 'theme');
    expect(card?.textContent).toContain('conflict');
    expect(card?.getAttribute('title')).toBe('conflict in src/ui/styles.css');
    expect(view.container.textContent).toContain('1 grounded');
  } finally {
    await view.unmount();
  }
});

test('a card that changes column is marked as arriving from the right side', async () => {
  const plan = makePlan({ tasks: [makeTaskSpec({ key: 'theme' })] });
  const running: Record<string, TaskRun> = {
    theme: makeTaskRun({ taskKey: 'theme', status: 'running', startedAt: Date.now() - 5_000 }),
  };
  const view = await mount(<MergeQueue plan={plan} tasks={running} merges={[]} onSelectTask={() => {}} />);
  try {
    expect(cardFor(view.container, 'theme')?.dataset.arrived).toBe('false');
    expect(cardsIn(view.container, 'flying')).toHaveLength(1);

    const auditing: Record<string, TaskRun> = {
      theme: makeTaskRun({
        taskKey: 'theme',
        status: 'auditing',
        attempts: 1,
        startedAt: Date.now() - 5_000,
      }),
    };
    await view.rerender(<MergeQueue plan={plan} tasks={auditing} merges={[]} onSelectTask={() => {}} />);

    const card = cardFor(view.container, 'theme');
    expect(cardsIn(view.container, 'audit')).toHaveLength(1);
    expect(card?.dataset.arrived).toBe('true');
    expect(card?.getAttribute('style')).toContain('--starling-from-x: -18px');
  } finally {
    await view.unmount();
  }
});

test('the board injects reduced-motion rules and reflects the OS preference', async () => {
  ensureDom();
  const original = window.matchMedia;
  const stub = (query: string): MediaQueryList =>
    ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;

  Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: stub });
  try {
    const view = await mount(<MergeQueue plan={undefined} tasks={{}} merges={[]} onSelectTask={() => {}} />);
    try {
      const root = view.container.querySelector<HTMLElement>('[data-starling-queue]');
      expect(root?.dataset.reducedMotion).toBe('true');
      const css = view.container.querySelector('style')?.textContent ?? '';
      expect(css).toContain('@media (prefers-reduced-motion: reduce)');
      expect(css).toContain('--starling-motion-duration: 0ms');
      expect(css).toContain("[data-starling-card][data-arrived='true']");
    } finally {
      await view.unmount();
    }
  } finally {
    Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: original });
  }
});

test('motion is on by default', async () => {
  ensureDom();
  const original = window.matchMedia;
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  });
  try {
    const view = await mount(<MergeQueue plan={undefined} tasks={{}} merges={[]} onSelectTask={() => {}} />);
    try {
      const root = view.container.querySelector<HTMLElement>('[data-starling-queue]');
      expect(root?.dataset.reducedMotion).toBe('false');
    } finally {
      await view.unmount();
    }
  } finally {
    Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: original });
  }
});

test('a cancelled task is shown as grounded, not lost', async () => {
  const tasks: Record<string, TaskRun> = {
    theme: makeTaskRun({ taskKey: 'theme', status: 'cancelled', startedAt: Date.now() - 2_000 }),
  };
  const view = await mount(<MergeQueue plan={undefined} tasks={tasks} merges={[]} onSelectTask={() => {}} />);
  try {
    expect(cardsIn(view.container, 'grounded').map((card) => card.dataset.taskKey)).toEqual(['theme']);
    expect(view.container.textContent).toContain('cancelled');
  } finally {
    await view.unmount();
  }
});
