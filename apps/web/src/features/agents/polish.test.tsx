import './test-env';
import { afterEach, expect, test } from 'bun:test';
import type { AgentEvent, AuditVerdict, DiffSummary } from '@starling/core';
import { BASE_TS, makeAgentEvent, makeAuditVerdict, makeTaskRun } from '@starling/core/testing';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { AgentDrawer } from './AgentDrawer';
import { groupToolCalls } from './activity';
import type { AgentDrawerProps } from './handshake';
import { sampleDiff, sampleTask } from './test-fixtures';

afterEach(() => {
  if (typeof document !== 'undefined') cleanup();
});

function toolEvents(runs: number): AgentEvent[] {
  const events: AgentEvent[] = [];
  for (let index = 0; index < runs; index += 1) {
    const ts = BASE_TS + index * 2;
    events.push(
      makeAgentEvent({ ts, kind: 'tool.call', data: { tool: 'bash', command: 'bun test' } }),
      makeAgentEvent({ ts: ts + 1, kind: 'tool.result', data: { ok: true, tests: '14 pass' } }),
    );
  }
  return events;
}

function verdictWithDod(): AuditVerdict {
  return makeAuditVerdict({
    taskKey: 'theme',
    attempt: 2,
    pass: false,
    summary: 'Two items met, one missing.',
    checks: [{ name: 'tests', ok: true, detail: 'bun test: 14 pass' }],
    dod: [
      { item: 'bun test passes', met: true, evidence: 'bun test: 14 pass, 0 fail' },
      { item: 'The theme survives a reload', met: false, evidence: 'no test mounts the store twice' },
      { item: 'The toggle lives in the header', met: true },
    ],
  });
}

function props(overrides: Partial<AgentDrawerProps> = {}): AgentDrawerProps {
  return {
    task: sampleTask,
    run: makeTaskRun({ taskKey: 'theme', status: 'running', attempts: 1, costUsd: 0.0042 }),
    events: [],
    verdicts: [],
    diff: sampleDiff,
    onClose: () => {},
    ...overrides,
  };
}

test('three identical tool calls collapse into one row with a x3 badge', () => {
  const rows = groupToolCalls([
    {
      id: 'a',
      ts: 1,
      kind: 'tool.call',
      tool: { name: 'bash', summary: '$ bun test', ok: true },
    },
    {
      id: 'b',
      ts: 2,
      kind: 'tool.call',
      tool: { name: 'bash', summary: '$ bun test', ok: true },
    },
    {
      id: 'c',
      ts: 3,
      kind: 'tool.call',
      tool: { name: 'bash', summary: '$ bun test', ok: false, detail: '1 failing' },
    },
    {
      id: 'd',
      ts: 4,
      kind: 'tool.call',
      tool: { name: 'read', summary: 'src/main.ts' },
    },
  ]);

  expect(rows).toHaveLength(2);
  expect(rows[0]?.repeats).toBe(3);
  expect(rows[0]?.id).toBe('a');
  // One failed repeat keeps the whole row red; the latest detail wins.
  expect(rows[0]?.tool?.ok).toBe(false);
  expect(rows[0]?.tool?.detail).toBe('1 failing');
  expect(rows[1]?.repeats).toBeUndefined();
});

test('grouping never merges across a different tool or a different command', () => {
  const rows = groupToolCalls([
    { id: 'a', ts: 1, kind: 'tool.call', tool: { name: 'bash', summary: '$ bun test' } },
    { id: 'b', ts: 2, kind: 'tool.call', tool: { name: 'bash', summary: '$ bun run check' } },
    { id: 'c', ts: 3, kind: 'tool.call', tool: { name: 'read', summary: '$ bun test' } },
    { id: 'd', ts: 4, kind: 'text', text: 'thinking' },
    { id: 'e', ts: 5, kind: 'tool.call', tool: { name: 'bash', summary: '$ bun test' } },
  ]);

  expect(rows).toHaveLength(5);
});

test('the activity tab renders one grouped row for repeated commands', () => {
  const view = render(<AgentDrawer {...props({ events: toolEvents(3) })} />);

  const rows = view.container.querySelectorAll('[data-testid="tool-row"]');
  expect(rows).toHaveLength(1);
  expect(rows[0]?.getAttribute('data-repeats')).toBe('3');
  expect(rows[0]?.textContent).toContain('×3');
  expect(rows[0]?.textContent).toContain('$ bun test');
});

test('a file chip opens the Diff tab and highlights that file', () => {
  const events = [
    makeAgentEvent({
      ts: BASE_TS,
      kind: 'file.edited',
      data: { path: 'src/lib/dates.ts', added: 2, removed: 1 },
    }),
  ];
  const view = render(<AgentDrawer {...props({ events })} />);

  const chip = view.getByTestId('file-chip');
  expect(chip.getAttribute('title')).toContain('Diff tab');
  fireEvent.click(chip);

  expect(view.getByRole('tab', { name: /Diff/ }).getAttribute('aria-selected')).toBe('true');
  const file = view.container.querySelector('[data-path="src/lib/dates.ts"]');
  expect(file?.getAttribute('data-focused')).toBe('true');
  expect(
    view.container.querySelector('[data-path="src/features/theme/index.ts"]')?.getAttribute('data-focused'),
  ).toBe('false');
});

test('the audit tab renders the DoD checklist with evidence quotes', () => {
  const view = render(<AgentDrawer {...props({ verdicts: [verdictWithDod()] })} />);

  fireEvent.click(view.getByRole('tab', { name: /Audit/ }));
  const checklist = view.getByTestId('dod-checklist-2');
  expect(checklist.textContent).toContain('2 of 3 met');

  const items = view.container.querySelectorAll('[data-testid="dod-item"]');
  expect(items).toHaveLength(3);
  expect(items[0]?.getAttribute('data-met')).toBe('true');
  expect(items[1]?.getAttribute('data-met')).toBe('false');

  const quotes = view.container.querySelectorAll('[data-testid="dod-evidence-quote"]');
  expect(quotes[0]?.textContent).toContain('bun test: 14 pass, 0 fail');
  expect(quotes[1]?.textContent).toContain('no test mounts the store twice');
  // An item without an evidence quote says so instead of rendering an empty block.
  expect(items[2]?.textContent).toContain('No evidence quote');
});

test('the header shows a live elapsed clock and the token total', () => {
  const run = makeTaskRun({ taskKey: 'theme', status: 'running', startedAt: Date.now() - 65_000 });
  const view = render(<AgentDrawer {...props({ run })} />);

  const elapsed = view.getByTestId('drawer-elapsed');
  expect(elapsed.getAttribute('data-live')).toBe('true');
  expect(elapsed.textContent).toMatch(/1m \d\ds/);
  expect(view.getByTestId('drawer-tokens').textContent).toBe('0');
  expect(view.getByTestId('drawer-live').textContent).toContain('live');
});

test('a finished run freezes the clock and drops the live badge', () => {
  const run = makeTaskRun({
    taskKey: 'theme',
    status: 'merged',
    startedAt: BASE_TS,
    finishedAt: BASE_TS + 90_000,
  });
  const view = render(<AgentDrawer {...props({ run })} />);

  expect(view.getByTestId('drawer-elapsed').getAttribute('data-live')).toBe('false');
  expect(view.getByTestId('drawer-elapsed').textContent).toContain('1m 30s');
  expect(view.queryByTestId('drawer-live')).toBeNull();
});

test('a published nodeName wins over the node id in the header', () => {
  const run = makeTaskRun({ taskKey: 'theme', status: 'running', nodeId: 'air' });
  const withName = { ...run, nodeName: 'M2 Air' };

  const view = render(<AgentDrawer {...props({ run: withName })} />);
  expect(view.getByTestId('drawer-node').textContent).toBe('M2 Air');
});

test('word-level marks appear only inside small hunks', () => {
  const small: DiffSummary = {
    files: [{ path: 'a.ts', added: 1, removed: 1 }],
    patch: [
      'diff --git a/a.ts b/a.ts',
      '--- a/a.ts',
      '+++ b/a.ts',
      '@@ -1 +1 @@',
      '-let x = 1;',
      '+let x = 2;',
    ].join('\n'),
    truncated: false,
  };
  const view = render(<AgentDrawer {...props({ diff: small })} />);

  fireEvent.click(view.getByRole('tab', { name: /Diff/ }));
  const marks = view.container.querySelectorAll('[data-word="changed"]');
  expect(marks.length).toBeGreaterThan(0);
  expect([...marks].map((mark) => mark.textContent).join('|')).toContain('2');
  expect(view.container.querySelector('[data-line-kind="add"]')?.getAttribute('data-word-diff')).toBe('true');
});

test('the header counters use tabular numerals', () => {
  const run = makeTaskRun({ taskKey: 'theme', status: 'running', startedAt: Date.now() - 5_000 });
  const view = render(<AgentDrawer {...props({ run })} />);

  for (const id of ['drawer-elapsed', 'drawer-cost', 'drawer-attempts', 'drawer-tokens', 'drawer-events']) {
    expect(view.getByTestId(id).className).toContain('tabular-nums');
  }
});
