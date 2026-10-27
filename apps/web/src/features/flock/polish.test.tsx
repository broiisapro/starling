import { afterAll, afterEach, expect, test } from 'bun:test';
import type { NodeInfo } from '@starling/core';
import { BASE_TS, makeNodeInfo, makeTaskRun } from '@starling/core/testing';
import { FlockPanel } from './FlockPanel';
import type { JoinInfo } from './handshake';
import { all, ensureDom, mount, one, releaseDom, restoreClipboard, text } from './test-dom';

const registeredHere = ensureDom();
afterAll(() => releaseDom(registeredHere));

const NOW = BASE_TS + 4_000;
const JOIN: JoinInfo = {
  code: 'STAR-LING',
  hubUrl: 'http://192.168.1.42:7777',
  command: 'starling perch --hub http://192.168.1.42:7777 --code STAR-LING',
};

const tasks = {
  theme: makeTaskRun({ taskKey: 'theme', status: 'running', nodeId: 'hub' }),
  search: makeTaskRun({ taskKey: 'search', status: 'merging', nodeId: 'air' }),
};

function hubNode(overrides: Partial<NodeInfo> = {}): NodeInfo {
  return makeNodeInfo({ status: 'busy', activeSessions: 2, lastSeen: NOW, ...overrides });
}

function airNode(overrides: Partial<NodeInfo> = {}): NodeInfo {
  return makeNodeInfo({
    id: 'air',
    name: 'MacBook Air',
    kind: 'remote',
    url: 'http://192.168.1.42:7778',
    maxSessions: 5,
    activeSessions: 1,
    localModels: ['qwen3.8:27b'],
    status: 'busy',
    latencyMs: 18,
    lastSeen: NOW - 2_000,
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
  while (liveMounted.length > 0) await liveMounted.pop()?.unmount();
  restoreClipboard();
});

test('compact mode opens a drawer with the full roost cards', async () => {
  const selected: string[] = [];
  const view = await render(
    <FlockPanel
      nodes={[hubNode(), airNode()]}
      join={JOIN}
      tasks={tasks}
      now={NOW}
      compact
      reducedMotion
      onSelectTask={(key) => selected.push(key)}
    />,
  );

  expect(all(document, '[data-testid="flock-drawer"]')).toHaveLength(0);
  const toggle = one(view.container, '[data-testid="compact-expand"]');
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(text(toggle)).toContain('All roosts');

  await view.click(toggle);

  // The drawer is portalled to `document.body` so the rail's backdrop-filter cannot clip it.
  const drawer = one(document, '[data-testid="flock-drawer"]');
  expect(drawer.getAttribute('role')).toBe('dialog');
  expect(drawer.getAttribute('aria-label')).toBe('All roosts');
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(all(drawer, '[data-testid="roost-card"]')).toHaveLength(2);
  expect(text(drawer)).toContain('MacBook Air');
  expect(all(drawer, '[data-testid="task-chip"]').length).toBeGreaterThan(0);

  // The drawer's chips are the same click path as the projector layout.
  const search = all(drawer, '[data-task-key="search"]')[0] ?? null;
  await view.click(search);
  expect(selected).toEqual(['search']);

  await view.click(one(drawer, 'button[aria-label="Close all roosts"][type="button"]'));
  expect(all(document, '[data-testid="flock-drawer"]')).toHaveLength(0);
});

test('the drawer closes on Escape', async () => {
  const view = await render(
    <FlockPanel nodes={[hubNode(), airNode()]} tasks={{}} now={NOW} compact reducedMotion />,
  );

  await view.click(one(view.container, '[data-testid="compact-expand"]'));
  expect(all(document, '[data-testid="flock-drawer"]')).toHaveLength(1);

  const { act } = await import('react');
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });
  expect(all(document, '[data-testid="flock-drawer"]')).toHaveLength(0);
});

test('the compact row still exists while the drawer is open', async () => {
  const view = await render(
    <FlockPanel nodes={[hubNode(), airNode()]} tasks={tasks} now={NOW} compact reducedMotion />,
  );

  await view.click(one(view.container, '[data-testid="compact-expand"]'));
  expect(all(view.container, '[data-testid="compact-roost"]')).toHaveLength(2);
});

test('with two roosts and no join info the card says unavailable, never off', async () => {
  const view = await render(<FlockPanel nodes={[hubNode(), airNode()]} tasks={{}} now={NOW} reducedMotion />);

  const card = one(view.container, '[data-testid="join-card"]');
  expect(card.getAttribute('data-join-disabled')).toBe('true');
  expect(card.getAttribute('data-join-reason')).toBe('unavailable');
  expect(text(card)).toContain('Join info unavailable');
  expect(text(card)).toContain('2 roosts are already in this run');
  expect(text(card)).not.toContain('Flock mode is off');
});

test('with only the hub and no join info the card explains flock is off', async () => {
  const view = await render(<FlockPanel nodes={[hubNode()]} tasks={{}} now={NOW} reducedMotion />);

  const card = one(view.container, '[data-testid="join-card"]');
  expect(card.getAttribute('data-join-reason')).toBe('off');
  expect(text(card)).toContain('Flock mode is off for this run.');
  // No invitation to a card that cannot help: the empty state is hidden too.
  expect(all(view.container, '[data-testid="empty-flock"]')).toHaveLength(0);
});

test('a join card appears as soon as join info is present, whatever the node count', async () => {
  const view = await render(<FlockPanel nodes={[hubNode(), airNode()]} tasks={{}} now={NOW} reducedMotion />);
  expect(all(view.container, '[data-testid="join-qr"]')).toHaveLength(0);

  await view.update(
    <FlockPanel nodes={[hubNode(), airNode()]} join={JOIN} tasks={{}} now={NOW} reducedMotion />,
  );
  expect(one(view.container, '[data-testid="join-card"]').getAttribute('data-join-code')).toBe(JOIN.code);
  expect(one(view.container, '[data-testid="join-code"]').textContent).toBe(JOIN.code);
});

test('the hardware line wraps between facts, never through "16 GB"', async () => {
  const view = await render(<FlockPanel nodes={[hubNode()]} tasks={{}} now={NOW} reducedMotion />);

  const hardware = one(view.container, '[data-testid="hardware"]');
  // Same words, same order — splitting must not lose the separators.
  expect(text(hardware)).toContain('darwin · arm64 · 12 cores · 32 GB');
  const atoms = [...hardware.querySelectorAll('span.whitespace-nowrap')];
  expect(atoms.map((atom) => atom.textContent)).toEqual(['darwin · arm64', '12 cores · 32 GB']);
});

test('the full panel does not re-title or re-frame the region the shell already frames', async () => {
  const view = await render(
    <FlockPanel nodes={[hubNode(), airNode()]} join={JOIN} tasks={{}} now={NOW} reducedMotion />,
  );

  // The shell's Panel says "Flock"; a second "Roosts in the sky" heading was a third title in the rail.
  expect(text(view.container)).not.toContain('Roosts in the sky');
  const panel = one(view.container, '[data-testid="flock-panel"]');
  expect(panel.className).not.toContain('rounded-2xl');
  expect(panel.className).not.toContain('border-white/10');
  // The summary the panel does contribute is still there.
  expect(text(one(view.container, '[data-testid="flock-summary"]'))).toContain('2 roosts');
});
