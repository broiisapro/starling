import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import type { RunMetrics, StarlingEvent } from '@starling/core';
import { StarlingEventSchema } from '@starling/core';
import type { ReactElement } from 'react';

import type { MetricsSample } from './cost';
import { MetricsPanel } from './index';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** See the note in the queue test: register lazily, never tear the DOM down. */
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

const fixtureSamples: MetricsSample[] = readFileSync(FIXTURE_URL, 'utf8')
  .trim()
  .split('\n')
  .map((line) => StarlingEventSchema.parse(JSON.parse(line)) as StarlingEvent)
  .flatMap((event) => (event.type === 'metrics' ? [{ ts: event.ts, metrics: event.payload }] : []));

const finalMetrics: RunMetrics = fixtureSamples[fixtureSamples.length - 1]?.metrics as RunMetrics;

test('the cost meter tells the open-weight story with fixture metrics', async () => {
  const view = await mount(<MetricsPanel metrics={finalMetrics} history={fixtureSamples} />);
  try {
    expect(text(view.container, 'cost-api')).toBe('$0.03');
    expect(text(view.container, 'cost-local')).toBe('$0.00');
    expect(text(view.container, 'cost-saved')).toBe('$0.01');
    expect(view.container.textContent).toContain('local');
    expect(view.container.textContent).toContain('9 local calls');
  } finally {
    await view.unmount();
  }
});

test('the split bar carries a tooltip with exact token counts', async () => {
  const view = await mount(<MetricsPanel metrics={finalMetrics} history={fixtureSamples} />);
  try {
    const tooltip = view.container.querySelector('[data-testid="token-split-tooltip"]');
    const tooltipText = tooltip?.textContent ?? '';
    expect(tooltipText).toContain('103,500 in');
    expect(tooltipText).toContain('27,600 cached');
    expect(tooltipText).toContain('16,050 out');
    expect(tooltipText).toContain('53,200 in');
    expect(tooltipText).toContain('6,560 out');

    const svg = view.container.querySelector('[data-testid="token-split"] svg');
    expect(svg?.getAttribute('role')).toBe('img');
    expect(svg?.querySelector('title')?.textContent).toBe('API vs local token split');
    expect(svg?.querySelector('desc')?.textContent).toContain('103,500');
    expect(svg?.querySelectorAll('rect')).toHaveLength(3);
  } finally {
    await view.unmount();
  }
});

test('counters, elapsed and throughput come from the fixture', async () => {
  const view = await mount(<MetricsPanel metrics={finalMetrics} history={fixtureSamples} />);
  try {
    expect(text(view.container, 'metrics-merged')).toBe('7');
    expect(text(view.container, 'metrics-failed')).toBe('0');
    expect(text(view.container, 'metrics-elapsed')).toBe('5m 55s');
    expect(text(view.container, 'metrics-throughput')).toBe('11.8');
    expect(text(view.container, 'metrics-samples')).toBe('72 samples');
  } finally {
    await view.unmount();
  }
});

test('elapsed and throughput digits are tabular so they never reflow', async () => {
  const view = await mount(<MetricsPanel metrics={finalMetrics} history={fixtureSamples} />);
  try {
    for (const id of ['metrics-elapsed', 'metrics-throughput', 'metrics-merged', 'cost-api']) {
      expect(view.container.querySelector(`[data-testid="${id}"]`)?.className).toContain('tabular-nums');
    }
  } finally {
    await view.unmount();
  }
});

test('the agents sparkline is an accessible SVG with a title and description', async () => {
  const view = await mount(<MetricsPanel metrics={finalMetrics} history={fixtureSamples} />);
  try {
    const svg = view.container.querySelector('[data-testid="sparkline"]');
    expect(svg?.getAttribute('role')).toBe('img');
    expect(svg?.getAttribute('aria-label')).toContain('Agents active');
    expect(svg?.querySelector('title')?.textContent).toContain('Agents active');
    expect(svg?.querySelector('desc')?.textContent).toContain('72 samples');
    expect(svg?.querySelector('path')?.getAttribute('d')).toContain('M ');
    expect(text(view.container, 'metrics-agents')).toBe('0');
  } finally {
    await view.unmount();
  }
});

test('the elapsed clock ticks between samples while the stream is fresh', async () => {
  const startedAt = Date.now();
  const liveMetrics: RunMetrics = { ...finalMetrics, elapsedMs: 1_000, agentsActive: 2, tasksMerged: 1 };
  // The newest sample is 50 ms old on purpose: interpolation is `reported + (now - lastSampleTs)`,
  // and a sample stamped with `Date.now()` at render time can be 0 ms old, which is not "ticking".
  const history: MetricsSample[] = [
    { ts: startedAt - 2_000, metrics: { ...liveMetrics, elapsedMs: 0 } },
    { ts: startedAt - 50, metrics: liveMetrics },
  ];
  const view = await mount(<MetricsPanel metrics={liveMetrics} history={history} />);
  try {
    const elapsed = view.container.querySelector<HTMLElement>('[data-testid="metrics-elapsed"]');
    expect(elapsed?.getAttribute('data-live')).toBe('true');
    expect(elapsed?.textContent).toMatch(/^[12]s$/);
  } finally {
    await view.unmount();
  }
});

test('a finished run freezes its clock instead of ticking', async () => {
  const view = await mount(<MetricsPanel metrics={finalMetrics} history={fixtureSamples} />);
  try {
    const elapsed = view.container.querySelector('[data-testid="metrics-elapsed"]');
    expect(elapsed?.getAttribute('data-live')).toBe('false');
    expect(elapsed?.textContent).toBe('5m 55s');
  } finally {
    await view.unmount();
  }
});

test('an empty panel renders stable zeros and an empty sparkline', async () => {
  const view = await mount(<MetricsPanel metrics={undefined} history={[]} />);
  try {
    expect(text(view.container, 'cost-api')).toBe('$0.00');
    expect(text(view.container, 'cost-local')).toBe('$0.00');
    expect(text(view.container, 'cost-saved')).toBe('$0.00');
    expect(text(view.container, 'metrics-merged')).toBe('0');
    expect(text(view.container, 'metrics-failed')).toBe('0');
    expect(text(view.container, 'metrics-elapsed')).toBe('0s');
    expect(text(view.container, 'metrics-throughput')).toBe('0.0');
    expect(text(view.container, 'metrics-samples')).toBe('awaiting first sample');
    expect(view.container.querySelector('[data-testid="sparkline"]')?.getAttribute('aria-label')).toBe(
      'Agents active: no samples yet',
    );
  } finally {
    await view.unmount();
  }
});

test('reduced motion is reflected on the root and in the injected stylesheet', async () => {
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
    const view = await mount(<MetricsPanel metrics={finalMetrics} history={fixtureSamples} />);
    try {
      const root = view.container.querySelector<HTMLElement>('[data-testid="metrics-panel"]');
      expect(root?.dataset.reducedMotion).toBe('true');
      const css = view.container.querySelector('style')?.textContent ?? '';
      expect(css).toContain('@media (prefers-reduced-motion: reduce)');
      expect(css).toContain('--starling-motion-duration: 0ms');
    } finally {
      await view.unmount();
    }
  } finally {
    Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: original });
  }
});

test('the cost meter summarises itself for screen readers', async () => {
  const view = await mount(<MetricsPanel metrics={finalMetrics} history={fixtureSamples} />);
  try {
    const meter = view.container.querySelector('[data-testid="cost-meter"]');
    expect(meter?.getAttribute('aria-label')).toBe('$0.03 on DeepSeek, $0.00 on this laptop, $0.01 saved');
  } finally {
    await view.unmount();
  }
});

test('updating metrics re-renders the numbers without remounting the panel', async () => {
  const view = await mount(<MetricsPanel metrics={undefined} history={[]} />);
  try {
    const before = view.container.querySelector('[data-testid="metrics-panel"]');
    expect(text(view.container, 'metrics-merged')).toBe('0');
    await view.rerender(<MetricsPanel metrics={finalMetrics} history={fixtureSamples} />);
    const after = view.container.querySelector('[data-testid="metrics-panel"]');
    expect(after).toBe(before);
    expect(text(view.container, 'metrics-merged')).toBe('7');
    expect(text(view.container, 'cost-api')).toBe('$0.03');
  } finally {
    await view.unmount();
  }
});
