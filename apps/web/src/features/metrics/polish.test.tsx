import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import type { RunMetrics, StarlingEvent } from '@starling/core';
import { StarlingEventSchema } from '@starling/core';
import type { ReactElement } from 'react';
import type { MetricsSample } from './cost';
import { COUNT_UP_MS } from './count-up';
import { MetricsPanel } from './index';

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

function text(container: HTMLElement, testId: string): string {
  return container.querySelector(`[data-testid="${testId}"]`)?.textContent?.trim() ?? '';
}

const FIXTURE_URL = new URL('../../../../../fixtures/runs/sky-todo-launch-day.jsonl', import.meta.url);
const samples: MetricsSample[] = readFileSync(FIXTURE_URL, 'utf8')
  .trim()
  .split('\n')
  .map((line) => StarlingEventSchema.parse(JSON.parse(line)) as StarlingEvent)
  .flatMap((event) => (event.type === 'metrics' ? [{ ts: event.ts, metrics: event.payload }] : []));
const finalMetrics = samples[samples.length - 1]?.metrics as RunMetrics;

test('the API figure carries an off-peak note with the peak-rate explanation', async () => {
  const view = await mount(<MetricsPanel metrics={finalMetrics} history={samples} />);
  try {
    const note = view.container.querySelector<HTMLElement>('[data-testid="cost-offpeak"]');
    expect(note?.textContent).toBe('peak rates · off-peak ≈ $0.02');
    expect(note?.getAttribute('title')).toContain('exactly half of peak');
    expect(note?.getAttribute('title')).toContain('budget guardrail');
  } finally {
    await view.unmount();
  }
});

test('local calls are a counted stat, not a footnote', async () => {
  const view = await mount(<MetricsPanel metrics={finalMetrics} history={samples} />);
  try {
    const calls = view.container.querySelector<HTMLElement>('[data-testid="cost-local-calls"]');
    expect(calls?.textContent?.replace(/\s+/g, ' ').trim()).toBe('9 local calls');
    expect(calls?.querySelector('span')?.className).toContain('tabular-nums');
    expect(text(view.container, 'cost-local-calls')).toContain('9 local calls');
  } finally {
    await view.unmount();
  }
});

test('the saved figure explains its estimate to screen readers and on hover', async () => {
  const view = await mount(<MetricsPanel metrics={finalMetrics} history={samples} />);
  try {
    const saved = view.container.querySelector<HTMLElement>('[data-testid="cost-saved"]');
    const describedBy = saved?.getAttribute('aria-describedby') ?? '';
    expect(describedBy).toBe('cost-saved-note');
    const note = view.container.querySelector(`#${describedBy}`);
    expect(note?.textContent).toContain('local tokens priced at');
    expect(note?.textContent).toContain('peak rates');
    expect(note?.textContent).toContain('Nothing was actually billed');
  } finally {
    await view.unmount();
  }
});

test('a live meter counts up to the exact value and lands on it', async () => {
  const empty = await mount(<MetricsPanel metrics={undefined} history={[]} live />);
  try {
    expect(text(empty.container, 'cost-api')).toBe('$0.00');

    await empty.rerender(<MetricsPanel metrics={finalMetrics} history={samples} live animate />);
    // Mid-flight the number is climbing; it must never read as the final value immediately.
    const midway = text(empty.container, 'cost-api');
    expect(midway).not.toBe('');

    const { act } = await import('react');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, COUNT_UP_MS + 120));
    });
    expect(text(empty.container, 'cost-api')).toBe('$0.04');
    expect(text(empty.container, 'cost-saved')).toBe('$0.02');
  } finally {
    await empty.unmount();
  }
});

test('reduced motion skips the count-up entirely', async () => {
  ensureDom();
  const original = window.matchMedia;
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) =>
      ({
        matches: query.includes('prefers-reduced-motion'),
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
    const view = await mount(<MetricsPanel metrics={undefined} history={[]} live animate />);
    try {
      await view.rerender(<MetricsPanel metrics={finalMetrics} history={samples} live animate />);
      expect(text(view.container, 'cost-api')).toBe('$0.04');
    } finally {
      await view.unmount();
    }
  } finally {
    Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: original });
  }
});
