import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import type { NodeInfo } from '@starling/core';
import { BASE_TS, makeNodeInfo, makeTaskRun } from '@starling/core/testing';
import { FlockPanel } from './FlockPanel';
import type { JoinInfo } from './handshake';
import {
  all,
  ensureDom,
  mockClipboard,
  mount,
  one,
  releaseDom,
  restoreClipboard,
  text,
  wait,
} from './test-dom';

const registeredHere = ensureDom();
afterAll(() => releaseDom(registeredHere));

const NOW = BASE_TS + 12_000;
const JOIN: JoinInfo = {
  code: 'STAR-LING',
  hubUrl: 'http://192.168.1.42:7777',
  command: 'starling perch --hub http://192.168.1.42:7777 --code STAR-LING',
};

const tasks = {
  theme: makeTaskRun({ taskKey: 'theme', status: 'running', nodeId: 'hub' }),
  search: makeTaskRun({ taskKey: 'search', status: 'merging', nodeId: 'air' }),
  'csv-export': makeTaskRun({ taskKey: 'csv-export', status: 'merged', nodeId: 'air' }),
  'dates-fix': makeTaskRun({ taskKey: 'dates-fix', status: 'pending' }),
};

function airNode(overrides: Partial<NodeInfo> = {}): NodeInfo {
  return makeNodeInfo({
    id: 'air',
    name: 'MacBook Air',
    kind: 'remote',
    url: 'http://192.168.1.42:7778',
    platform: 'darwin',
    arch: 'arm64',
    cpuCores: 8,
    memGb: 16,
    maxSessions: 5,
    activeSessions: 3,
    localModels: ['qwen3.8:27b'],
    status: 'busy',
    lastSeen: NOW - 2_000,
    latencyMs: 18,
    ...overrides,
  });
}

function hubNode(overrides: Partial<NodeInfo> = {}): NodeInfo {
  return makeNodeInfo({
    platform: 'darwin',
    arch: 'arm64',
    cpuCores: 12,
    memGb: 32,
    maxSessions: 8,
    activeSessions: 3,
    localModels: ['qwen3.8:27b'],
    status: 'busy',
    lastSeen: NOW,
    latencyMs: 1,
    ...overrides,
  });
}

const liveMounted: Awaited<ReturnType<typeof mount>>[] = [];
async function render(ui: Parameters<typeof mount>[0]) {
  const mounted = await mount(ui);
  liveMounted.push(mounted);
  return mounted;
}

afterEach(async () => {
  while (liveMounted.length > 0) {
    await liveMounted.pop()?.unmount();
  }
  restoreClipboard();
});

function cardIds(container: ParentNode): (string | null)[] {
  return all(container, '[data-testid="roost-card"]').map((card) => card.getAttribute('data-node-id'));
}

function card(container: ParentNode, nodeId: string): Element {
  const element = all(container, '[data-testid="roost-card"]').find(
    (candidate) => candidate.getAttribute('data-node-id') === nodeId,
  );
  if (!element) throw new Error(`no roost card for ${nodeId}`);
  return element;
}

describe('FlockPanel roost cards', () => {
  test('renders one card per node, hub first, no matter the input order', async () => {
    const { container } = await render(
      <FlockPanel nodes={[airNode(), hubNode()]} join={JOIN} tasks={tasks} now={NOW} reducedMotion />,
    );

    expect(cardIds(container)).toEqual(['hub', 'air']);
    expect(text(container)).toContain('2 roosts');
    expect(text(container)).toContain('6/13 sessions busy');
    expect(text(container)).toContain('7 free');
  });

  test('a roost card carries name, hub/perch badge, hardware, latency and lent models', async () => {
    const { container } = await render(
      <FlockPanel nodes={[hubNode(), airNode()]} join={JOIN} tasks={tasks} now={NOW} reducedMotion />,
    );

    const hub = card(container, 'hub');
    const air = card(container, 'air');
    expect(hub.getAttribute('aria-label')).toContain('MacBook Pro, hub');
    expect(air.getAttribute('aria-label')).toContain('MacBook Air, perch');
    expect(text(one(hub, '[data-testid="kind-badge"]'))).toBe('hub');
    expect(text(one(air, '[data-testid="kind-badge"]'))).toBe('perch');
    expect(text(one(air, '[data-testid="hardware"]'))).toContain('darwin · arm64 · 8 cores · 16 GB');
    expect(text(one(air, '[data-testid="latency"]'))).toBe('18 ms');
    expect(text(one(air, '[data-testid="model-chip"]'))).toBe('lends qwen3.8:27b');
  });

  test('the session meter fills activeSessions of maxSessions pips and announces the ratio', async () => {
    const { container } = await render(
      <FlockPanel
        nodes={[hubNode({ activeSessions: 3, maxSessions: 8 })]}
        tasks={{}}
        now={NOW}
        reducedMotion
      />,
    );

    const meter = one(container, '[data-testid="session-meter"]');
    expect(meter.getAttribute('aria-label')).toBe('3 of 8 sessions in use');
    expect(meter.getAttribute('data-active')).toBe('3');
    const pips = all(container, '[data-testid="session-pip"]');
    expect(pips).toHaveLength(8);
    expect(pips.filter((pip) => pip.getAttribute('data-filled') === 'true')).toHaveLength(3);
    expect(text(one(container, '[data-testid="session-count"]'))).toBe('3/8');
  });

  test('the session meter clamps an over-reported node instead of filling phantom pips', async () => {
    const { container } = await render(
      <FlockPanel
        nodes={[hubNode({ activeSessions: 9, maxSessions: 5 })]}
        tasks={{}}
        now={NOW}
        reducedMotion
      />,
    );

    const pips = all(container, '[data-testid="session-pip"]');
    expect(pips).toHaveLength(5);
    expect(pips.filter((pip) => pip.getAttribute('data-filled') === 'true')).toHaveLength(5);
    expect(text(container)).toContain('full');
  });

  test('task chips show only the tasks on that roost and report clicks upward', async () => {
    const selected: string[] = [];
    const { container } = await render(
      <FlockPanel
        nodes={[hubNode(), airNode()]}
        tasks={tasks}
        now={NOW}
        reducedMotion
        onSelectTask={(key) => selected.push(key)}
      />,
    );

    const hubKeys = all(card(container, 'hub'), '[data-testid="task-chip"]').map((chip) =>
      chip.getAttribute('data-task-key'),
    );
    const airKeys = all(card(container, 'air'), '[data-testid="task-chip"]').map((chip) =>
      chip.getAttribute('data-task-key'),
    );
    expect(hubKeys).toEqual(['theme']);
    expect(airKeys).toEqual(['csv-export', 'search']);
    expect(all(container, '[data-task-key="dates-fix"]')).toHaveLength(0);

    const mounted = liveMounted[liveMounted.length - 1];
    await mounted?.click(one(card(container, 'air'), '[data-task-key="search"]'));
    expect(selected).toEqual(['search']);
  });

  test('an offline roost is dimmed and says when it was last seen', async () => {
    const { container } = await render(
      <FlockPanel
        nodes={[hubNode(), airNode({ status: 'offline', activeSessions: 0, lastSeen: NOW - 12_000 })]}
        tasks={tasks}
        now={NOW}
        reducedMotion
      />,
    );

    const air = card(container, 'air');
    expect(air.getAttribute('data-status')).toBe('offline');
    expect(air.getAttribute('data-dimmed')).toBe('true');
    expect(air.getAttribute('class')).toContain('opacity-50');
    expect(text(one(air, '[data-testid="last-seen"]'))).toContain('last seen 12s ago');
    expect(one(air, '[data-testid="last-seen"]').getAttribute('title')).toBe(
      new Date(NOW - 12_000).toISOString(),
    );
  });

  test('the offline age keeps climbing when the shell does not pin the clock', async () => {
    const { container } = await render(
      <FlockPanel
        nodes={[hubNode(), airNode({ status: 'offline', activeSessions: 0, lastSeen: Date.now() - 12_000 })]}
        tasks={{}}
        reducedMotion
      />,
    );
    const label = () => text(one(container, '[data-testid="last-seen"]'));
    expect(label()).toContain('12s ago');
    await wait(1_100);
    expect(label()).toMatch(/last seen 1[34]s ago/);
  });

  test('a busy roost pulses, unless the user asked for reduced motion', async () => {
    const { container, update } = await render(
      <FlockPanel nodes={[hubNode({ status: 'busy' })]} tasks={{}} now={NOW} />,
    );
    expect(all(container, '[data-testid="status-pulse"]')).toHaveLength(1);

    await update(<FlockPanel nodes={[hubNode({ status: 'busy' })]} tasks={{}} now={NOW} reducedMotion />);
    expect(all(container, '[data-testid="status-pulse"]')).toHaveLength(0);
  });

  test('entering cards transition normally but not under reduced motion', async () => {
    const { container, update } = await render(<FlockPanel nodes={[hubNode()]} tasks={{}} now={NOW} />);
    const animated = card(container, 'hub');
    expect(animated.getAttribute('data-animated')).toBe('true');
    expect(animated.getAttribute('class')).toContain('transition-all');

    await update(<FlockPanel nodes={[hubNode()]} tasks={{}} now={NOW} reducedMotion />);
    const still = card(container, 'hub');
    expect(still.getAttribute('data-animated')).toBe('false');
    expect(still.getAttribute('class')).not.toContain('transition-all');
  });

  test('a departed roost plays its exit transition before leaving the DOM', async () => {
    const { container, update } = await render(
      <FlockPanel nodes={[hubNode(), airNode()]} tasks={{}} now={NOW} />,
    );
    await update(<FlockPanel nodes={[hubNode()]} tasks={{}} now={NOW} />);

    const leaving = card(container, 'air');
    expect(leaving.getAttribute('data-leaving')).toBe('true');

    await wait(400);
    expect(all(container, '[data-node-id="air"]')).toHaveLength(0);
  });

  test('under reduced motion a departed roost disappears immediately', async () => {
    const { container, update } = await render(
      <FlockPanel nodes={[hubNode(), airNode()]} tasks={{}} now={NOW} reducedMotion />,
    );
    await update(<FlockPanel nodes={[hubNode()]} tasks={{}} now={NOW} reducedMotion />);
    expect(all(container, '[data-node-id="air"]')).toHaveLength(0);
  });
});

describe('JoinCard', () => {
  test('copies the join code and reports it in the button', async () => {
    const writes = mockClipboard();
    const { container } = await render(<FlockPanel nodes={[hubNode()]} join={JOIN} tasks={{}} now={NOW} />);

    const button = one(container, '[data-testid="copy-join-code"]');
    await liveMounted[liveMounted.length - 1]?.click(button);

    expect(writes).toEqual([JOIN.code]);
    expect(button.getAttribute('data-copy-state')).toBe('copied');
    expect(text(button)).toBe('Copied');
    expect(one(container, '[data-testid="join-code"]').textContent).toBe(JOIN.code);
  });

  test('copies the full perch command', async () => {
    const writes = mockClipboard();
    const { container } = await render(<FlockPanel nodes={[hubNode()]} join={JOIN} tasks={{}} now={NOW} />);

    await liveMounted[liveMounted.length - 1]?.click(one(container, '[data-testid="copy-join-command"]'));
    expect(writes).toEqual([JOIN.command]);
  });

  test('renders a scannable SVG QR for the command', async () => {
    const { container } = await render(<FlockPanel nodes={[hubNode()]} join={JOIN} tasks={{}} now={NOW} />);

    const svg = one(container, 'svg[data-testid="join-qr"]');
    expect(svg.getAttribute('data-qr-value')).toBe(JOIN.command);
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toBe('Scan to join the flock');
    const path = one(svg, 'path');
    expect((path.getAttribute('d') ?? '').length).toBeGreaterThan(100);
  });

  test('explains the on-ramp in one sentence', async () => {
    const { container } = await render(<FlockPanel nodes={[hubNode()]} join={JOIN} tasks={{}} now={NOW} />);
    expect(text(container)).toContain(
      'Run this on any laptop with opencode + Starling installed to add it to the flock.',
    );
    expect(one(container, '[data-testid="join-command"]').textContent).toBe(JOIN.command);
    expect(text(one(container, '[data-testid="join-hub-url"]'))).toBe(`hub ${JOIN.hubUrl}`);
  });

  test('falls back to a flock-off card when the hub exposes no join info', async () => {
    const { container } = await render(<FlockPanel nodes={[hubNode()]} tasks={{}} now={NOW} />);
    expect(one(container, '[data-testid="join-card"]').getAttribute('data-join-disabled')).toBe('true');
    expect(text(container)).toContain('Flock mode is off for this run.');
    expect(all(container, '[data-testid="join-qr"]')).toHaveLength(0);
  });
});

describe('empty state and compact mode', () => {
  test('the hub alone invites a second laptop, and the invitation goes away', async () => {
    const { container, update } = await render(
      <FlockPanel nodes={[hubNode()]} join={JOIN} tasks={{}} now={NOW} reducedMotion />,
    );
    expect(one(container, '[data-testid="empty-flock"]')).toBeTruthy();
    expect(text(one(container, '[data-testid="empty-flock"]'))).toContain('Your flock is just you.');
    expect(text(one(container, '[data-testid="empty-flock-cta"]'))).toBe('Add a laptop');

    await update(
      <FlockPanel nodes={[hubNode(), airNode()]} join={JOIN} tasks={{}} now={NOW} reducedMotion />,
    );
    expect(all(container, '[data-testid="empty-flock"]')).toHaveLength(0);
  });

  test('compact mode is one row of mini roosts with an add tile', async () => {
    const writes = mockClipboard();
    const { container } = await render(
      <FlockPanel nodes={[airNode(), hubNode()]} join={JOIN} tasks={tasks} now={NOW} compact reducedMotion />,
    );

    expect(one(container, '[data-testid="flock-panel"]').getAttribute('data-compact')).toBe('true');
    expect(one(container, '[data-testid="compact-flock"]')).toBeTruthy();
    expect(all(container, '[data-testid="roost-card"]')).toHaveLength(0);
    const roosts = all(container, '[data-testid="compact-roost"]');
    expect(roosts.map((roost) => roost.getAttribute('data-node-id'))).toEqual(['hub', 'air']);
    expect(roosts.map((roost) => roost.getAttribute('data-status'))).toEqual(['busy', 'busy']);
    const air = roosts[1];
    if (!air) throw new Error('expected a compact row for the Air');
    expect(text(air)).toContain('3/5');
    expect(text(air)).toContain('1 model');

    await liveMounted[liveMounted.length - 1]?.click(one(container, '[data-testid="compact-join"]'));
    expect(writes).toEqual([JOIN.command]);
  });

  test('compact mode dims an offline perch and shows its age', async () => {
    const { container } = await render(
      <FlockPanel
        nodes={[hubNode(), airNode({ status: 'offline', activeSessions: 0, lastSeen: NOW - 12_000 })]}
        join={JOIN}
        tasks={{}}
        now={NOW}
        compact
        reducedMotion
      />,
    );
    const roosts = all(container, '[data-testid="compact-roost"]');
    const air = roosts[1];
    if (!air) throw new Error('expected a compact row for the Air');
    expect(air.getAttribute('data-status')).toBe('offline');
    expect(air.getAttribute('class')).toContain('opacity-50');
    expect(text(air)).toContain('12s ago');
  });
});
