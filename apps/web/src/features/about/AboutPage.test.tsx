import { expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import type { ReactElement } from 'react';

import { AboutPage, FIXTURE_STATS, swarmStory } from './index';
import type { SwarmStats } from './types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** See the queue test: register lazily, never tear the DOM down (the root test run is one process). */
function ensureDom(): void {
  if (typeof document === 'undefined') GlobalRegistrator.register({ url: 'http://localhost/' });
}

interface Mounted {
  container: HTMLElement;
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

const EMPTY_STATS: SwarmStats = {
  version: 1,
  generatedAt: '2026-10-27T00:00:00.000Z',
  repo: { root: '/tmp/empty' },
  sources: { git: false, gh: false, epics: false, handbacks: false, logs: false },
  notes: ['logs: agent log directory missing'],
  totals: {
    epics: 0,
    epicsObserved: 0,
    plannedEpics: 0,
    prs: 0,
    commits: 0,
    added: 0,
    removed: 0,
    files: 0,
    mergedPrsFromGh: 0,
    tests: 0,
    testFiles: 0,
    testsAdded: 0,
    waves: 0,
    agentSessions: 0,
    peakConcurrentAgents: 0,
    wallTimeMs: 0,
    agentHours: 0,
    inFlight: 0,
  },
  epics: [],
  waves: [],
};

test('renders the story, the big numbers and the provenance footer', async () => {
  const view = await mount(<AboutPage stats={FIXTURE_STATS} />);
  try {
    expect(text(view.container, 'about-page')).toContain('One person, 4 agents');
    // The story is exactly three sentences, joined into one paragraph.
    const story = swarmStory(FIXTURE_STATS);
    expect(story).toHaveLength(3);
    expect(story.every((sentence) => sentence.endsWith('.'))).toBe(true);
    expect(text(view.container, 'about-story')).toBe(story.join(' '));

    expect(text(view.container, 'about-stat-epics')).toContain('4');
    expect(text(view.container, 'about-stat-agents')).toContain('4');
    expect(text(view.container, 'about-stat-prs')).toContain('4');
    expect(text(view.container, 'about-stat-tests')).toContain('312');
    expect(text(view.container, 'about-stat-hours')).toContain('4.9h');

    const sources = text(view.container, 'about-sources');
    expect(sources).toContain('tools/stats/out/stats.json');
    expect(sources).toContain('ff655e1');
    expect(sources).not.toContain('Unavailable this run');
  } finally {
    await view.unmount();
  }
});

test('draws one swim lane per wave and one bar per epic', async () => {
  const view = await mount(<AboutPage stats={FIXTURE_STATS} />);
  try {
    const timeline = view.container.querySelector('[data-testid="about-timeline"]');
    expect(timeline).not.toBeNull();
    expect(timeline?.getAttribute('role')).toBe('img');
    expect(view.container.querySelectorAll('[data-testid^="about-timeline-wave-"]')).toHaveLength(4);
    expect(view.container.querySelectorAll('svg [data-epic]')).toHaveLength(5);

    const bars = [...view.container.querySelectorAll('svg [data-epic]')].map((bar) =>
      bar.getAttribute('data-epic'),
    );
    expect(bars).toContain('00');
    expect(bars).toContain('68');

    // The bar's tooltip is the accessible long description for that epic.
    const inFlight = view.container.querySelector('svg [data-epic="68"] title')?.textContent ?? '';
    expect(inFlight).toContain('in flight');
    expect(inFlight).toContain('Built-by-the-flock stats page');
  } finally {
    await view.unmount();
  }
});

test('renders the epic table as the accessible copy of the chart', async () => {
  const view = await mount(<AboutPage stats={FIXTURE_STATS} />);
  try {
    const table = view.container.querySelector('[data-testid="about-epic-table"]');
    expect(table).not.toBeNull();
    expect(table?.querySelectorAll('tbody tr')).toHaveLength(5);

    const first = view.container.querySelector('[data-testid="about-epic-00"]');
    expect(first?.textContent).toContain('Foundation & frozen contracts');
    expect(first?.querySelector('a')?.getAttribute('href')).toBe(
      'https://github.com/broiisapro/starling/pull/52',
    );
    expect(first?.textContent).toContain('complete');

    const partial = view.container.querySelector('[data-testid="about-epic-34"]');
    expect(partial?.textContent).toContain('partial');

    const inFlight = view.container.querySelector('[data-testid="about-epic-68"]');
    expect(inFlight?.textContent).toContain('in flight');
    expect(inFlight?.textContent).toContain('pending');

    // Every header cell is scoped so screen readers can pair cells with their column.
    const headers = [...(table?.querySelectorAll('thead th') ?? [])];
    expect(headers.length).toBe(8);
    expect(headers.every((header) => header.getAttribute('scope') === 'col')).toBe(true);
    expect(table?.querySelectorAll('tbody th[scope="row"]')).toHaveLength(5);
  } finally {
    await view.unmount();
  }
});

test('renders honest empty states instead of zeros pretending to be data', async () => {
  const view = await mount(<AboutPage stats={EMPTY_STATS} />);
  try {
    expect(text(view.container, 'about-story')).toContain('No stats yet');
    expect(text(view.container, 'about-timeline-empty')).toContain('bun tools/stats/collect.ts');
    expect(text(view.container, 'about-table-empty')).toContain('Nothing collected yet');
    expect(text(view.container, 'about-sources')).toContain('Unavailable this run');
    expect(text(view.container, 'about-sources')).toContain('logs: agent log directory missing');
  } finally {
    await view.unmount();
  }
});
