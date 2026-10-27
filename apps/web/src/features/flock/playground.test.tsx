import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import type { StarlingEvent } from '@starling/core';
import { BASE_TS, makeNodeInfo } from '@starling/core/testing';
import { Playground } from './Playground';
import { all, ensureDom, mount, one, releaseDom, text } from './test-dom';

const registeredHere = ensureDom();
afterAll(() => releaseDom(registeredHere));

const FIXTURE = new URL('../../../../../fixtures/runs/sky-todo-launch-day.jsonl', import.meta.url);

const mountedPanels: Awaited<ReturnType<typeof mount>>[] = [];
async function render(ui: Parameters<typeof mount>[0]) {
  const mounted = await mount(ui);
  mountedPanels.push(mounted);
  return mounted;
}

afterEach(async () => {
  while (mountedPanels.length > 0) {
    await mountedPanels.pop()?.unmount();
  }
});

function nodeLog(): string {
  const hub = makeNodeInfo({ lastSeen: BASE_TS });
  const air = makeNodeInfo({
    id: 'air',
    name: 'MacBook Air',
    kind: 'remote',
    url: 'http://192.168.1.42:7778',
    maxSessions: 5,
    activeSessions: 2,
    status: 'busy',
    lastSeen: BASE_TS + 2_000,
  });
  const events = [
    { type: 'node.joined', runId: '*', ts: BASE_TS, payload: { node: hub } },
    { type: 'node.joined', runId: '*', ts: BASE_TS + 2_000, payload: { node: air } },
    { type: 'node.left', runId: '*', ts: BASE_TS + 9_000, payload: { nodeId: 'air', reason: 'lid closed' } },
  ] satisfies StarlingEvent[];
  return events.map((event) => JSON.stringify(event)).join('\n');
}

describe('Playground', () => {
  test('steps through the log roost event by roost event', async () => {
    const fixture = nodeLog();
    const mounted = await render(<Playground fixture={fixture} />);
    const { container } = mounted;

    expect(all(container, '[data-testid="roost-card"]')).toHaveLength(0);
    expect(text(one(container, '[data-testid="playground-clock"]'))).toContain('0/3 events');

    await mounted.click(one(container, '[data-testid="playground-next-roost"]'));
    expect(all(container, '[data-testid="roost-card"]')).toHaveLength(1);
    expect(text(one(container, '[data-testid="playground-air"]'))).toBe('no perch yet');

    await mounted.click(one(container, '[data-testid="playground-next-roost"]'));
    expect(all(container, '[data-testid="roost-card"]')).toHaveLength(2);
    expect(text(one(container, '[data-testid="playground-air"]'))).toBe('MacBook Air: busy');

    await mounted.click(one(container, '[data-testid="playground-next-roost"]'));
    const air = all(container, '[data-testid="roost-card"]').find(
      (candidate) => candidate.getAttribute('data-node-id') === 'air',
    );
    expect(air?.getAttribute('data-status')).toBe('offline');
    expect(text(one(container, '[data-testid="playground-air"]'))).toBe('MacBook Air: offline');
  });

  test('reports malformed log lines rather than dropping them silently', async () => {
    const { container } = await render(<Playground fixture={`${nodeLog()}\nnot json\n{"type":7}`} />);
    expect(text(one(container, '[data-testid="playground-skipped"]'))).toContain('Skipped 2 malformed');
  });

  test('the recorded launch-day run shows the Air joining, dropping and returning', async () => {
    const fixture = await Bun.file(FIXTURE).text();
    const mounted = await render(<Playground fixture={fixture} />);
    const { container } = mounted;

    expect(text(one(container, '[data-testid="playground-clock"]'))).toContain('0/252 events');

    const step = async () => {
      await mounted.click(one(container, '[data-testid="playground-next-roost"]'));
    };
    const airCard = () =>
      all(container, '[data-testid="roost-card"]').find(
        (candidate) => candidate.getAttribute('data-node-id') === 'air',
      );

    for (let index = 0; index < 7; index += 1) {
      await step();
      expect(airCard() === undefined || airCard()?.getAttribute('data-status') !== 'offline').toBe(true);
    }

    await step();
    expect(airCard()?.getAttribute('data-status')).toBe('offline');
    expect(text(airCard() as Element)).toContain('last seen');

    await step();
    await step();
    expect(airCard()?.getAttribute('data-status')).toBe('online');
    expect(text(airCard() as Element)).not.toContain('last seen');
  });

  test('renders explicit events fully revealed and resumes playback from a scrub', async () => {
    const events: StarlingEvent[] = [
      { type: 'node.joined', runId: '*', ts: BASE_TS, payload: { node: makeNodeInfo() } },
    ];
    const { container } = await render(<Playground events={events} />);
    expect(all(container, '[data-testid="roost-card"]')).toHaveLength(1);
    expect(one(container, '[data-testid="playground-toggle"]').hasAttribute('disabled')).toBe(true);
    expect(text(one(container, '[data-testid="playground-clock"]'))).toContain('1/1 events');
  });
});
