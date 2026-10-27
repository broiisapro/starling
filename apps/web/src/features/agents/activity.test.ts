import './test-env';
import { describe, expect, test } from 'bun:test';
import { makeAgentEvent } from '@starling/core/testing';
import { buildTimeline, toolResultDetail } from './activity';
import { formatCost, formatDuration, formatTokens, truncate } from './format';
import { inlineParts, parseMarkdownLite } from './MarkdownLite';
import { computeWindow, isAtBottom, VIRTUALIZE_AFTER } from './windowing';

const session = 'ses_theme_hub_1';

function sampleEvents() {
  return [
    makeAgentEvent({
      ts: 3_000,
      kind: 'tool.result',
      sessionId: session,
      data: { ok: true, tests: '12 pass' },
    }),
    makeAgentEvent({
      ts: 1_000,
      kind: 'session.started',
      sessionId: session,
      data: { nodeId: 'hub', model: { provider: 'deepseek', model: 'deepseek-v4.1-flash' } },
    }),
    makeAgentEvent({
      ts: 2_000,
      kind: 'tool.call',
      sessionId: session,
      data: { tool: 'read', path: 'src/lib/dates.ts' },
    }),
    makeAgentEvent({
      ts: 4_000,
      kind: 'file.edited',
      sessionId: session,
      data: { path: 'src/lib/dates.ts', added: 34, removed: 18 },
    }),
    makeAgentEvent({
      ts: 5_000,
      kind: 'usage',
      sessionId: session,
      data: {
        input: 12_400,
        output: 1_800,
        cached: 3_200,
        local: false,
        model: { provider: 'deepseek', model: 'deepseek-v4.1-flash' },
      },
    }),
    makeAgentEvent({ ts: 6_000, kind: 'text', sessionId: session, data: { text: 'Ran `bun test`.' } }),
    makeAgentEvent({ ts: 7_000, kind: 'session.idle', sessionId: session, data: {} }),
  ];
}

describe('buildTimeline', () => {
  test('sorts by timestamp and pairs a tool call with its result', () => {
    const timeline = buildTimeline(sampleEvents());
    expect(timeline.map((entry) => entry.kind)).toEqual([
      'session.started',
      'tool.call',
      'file.edited',
      'usage',
      'text',
      'session.idle',
    ]);
    expect(timeline[1]?.tool).toEqual({
      name: 'read',
      summary: 'src/lib/dates.ts',
      ok: true,
      detail: 'tests: 12 pass',
    });
  });

  test('summarises session start with the node and model', () => {
    const first = buildTimeline(sampleEvents())[0];
    expect(first?.meta).toBe('hub · deepseek/deepseek-v4.1-flash');
  });

  test('keeps file edits, usage and prose intact', () => {
    const timeline = buildTimeline(sampleEvents());
    expect(timeline[2]?.file).toEqual({ path: 'src/lib/dates.ts', added: 34, removed: 18 });
    expect(timeline[3]?.usage).toEqual({
      input: 12_400,
      output: 1_800,
      cached: 3_200,
      local: false,
      model: 'deepseek/deepseek-v4.1-flash',
    });
    expect(timeline[4]?.text).toBe('Ran `bun test`.');
  });

  test('renders an orphan tool result as its own row', () => {
    const timeline = buildTimeline([
      makeAgentEvent({ kind: 'tool.result', sessionId: 'ses_replay', data: { ok: false, error: 'ENOENT' } }),
    ]);
    expect(timeline[0]?.tool).toEqual({ name: 'result', summary: 'ENOENT', ok: false, detail: 'ENOENT' });
  });

  test('uses the command as the summary when a tool runs shell', () => {
    const timeline = buildTimeline([
      makeAgentEvent({ kind: 'tool.call', sessionId: 's', data: { tool: 'bash', command: 'bun test' } }),
    ]);
    expect(timeline[0]?.tool?.summary).toBe('$ bun test');
  });

  test('surfaces session errors with a readable message', () => {
    const timeline = buildTimeline([makeAgentEvent({ kind: 'session.error', data: { message: 'boom' } })]);
    expect(timeline[0]?.error).toBe('boom');
  });

  test('tolerates missing data on every kind', () => {
    const kinds = [
      'session.started',
      'text',
      'tool.call',
      'tool.result',
      'file.edited',
      'usage',
      'session.idle',
      'session.error',
    ] as const;
    // One session per event keeps the tool call and result unpaired.
    const events = kinds.map((kind, index) => makeAgentEvent({ kind, sessionId: `ses_${index}`, data: {} }));
    expect(() => buildTimeline(events)).not.toThrow();
    const timeline = buildTimeline(events);
    expect(timeline).toHaveLength(8);
  });

  test('toolResultDetail prefers tests, then bytes, then messages', () => {
    expect(toolResultDetail({ bytes: 1_180 })).toBe('1,180 bytes');
    expect(toolResultDetail({ message: 'done' })).toBe('done');
    expect(toolResultDetail({})).toBeUndefined();
  });
});

describe('markdown-lite', () => {
  test('splits fenced code from prose', () => {
    const blocks = parseMarkdownLite('Before\n```ts\nconst a = 1;\n```\nAfter');
    expect(blocks).toEqual([
      { kind: 'prose', text: 'Before' },
      { kind: 'code', lang: 'ts', code: 'const a = 1;' },
      { kind: 'prose', text: 'After' },
    ]);
  });

  test('keeps an unterminated fence as code', () => {
    expect(parseMarkdownLite('```\nstill code')).toEqual([{ kind: 'code', lang: '', code: 'still code' }]);
  });

  test('splits inline code spans', () => {
    expect(inlineParts('run `bun test` now')).toEqual([
      { code: false, text: 'run ' },
      { code: true, text: 'bun test' },
      { code: false, text: ' now' },
    ]);
    expect(inlineParts('no code')).toEqual([{ code: false, text: 'no code' }]);
  });
});

describe('windowing', () => {
  test('renders everything below the threshold', () => {
    expect(
      computeWindow({ count: VIRTUALIZE_AFTER, scrollTop: 500, viewportHeight: 400, rowHeight: 80 }),
    ).toEqual({
      start: 0,
      end: VIRTUALIZE_AFTER,
      topPad: 0,
      bottomPad: 0,
      virtualized: false,
    });
  });

  test('windows a long list with padding for what is hidden', () => {
    const range = computeWindow({
      count: 500,
      scrollTop: 4_000,
      viewportHeight: 400,
      rowHeight: 80,
      overscan: 2,
    });
    expect(range.virtualized).toBe(true);
    expect(range.start).toBe(48);
    expect(range.end).toBeLessThan(500);
    expect(range.topPad).toBe(48 * 80);
    expect(range.bottomPad).toBe((500 - range.end) * 80);
  });

  test('clamps negative scroll and zero viewports', () => {
    const range = computeWindow({ count: 200, scrollTop: -50, viewportHeight: 0, rowHeight: 50 });
    expect(range.start).toBe(0);
    expect(range.end).toBeGreaterThan(0);
  });

  test('detects the bottom of a scroller within a slack', () => {
    expect(isAtBottom({ scrollTop: 900, scrollHeight: 1_000, clientHeight: 100 })).toBe(true);
    expect(isAtBottom({ scrollTop: 900, scrollHeight: 2_000, clientHeight: 100 })).toBe(false);
    expect(isAtBottom({ scrollTop: 880, scrollHeight: 2_000, clientHeight: 100 }, 2_000)).toBe(true);
  });
});

describe('formatters', () => {
  test('durations', () => {
    expect(formatDuration(undefined)).toBe('—');
    expect(formatDuration(240)).toBe('240ms');
    expect(formatDuration(1_200)).toBe('1.2s');
    expect(formatDuration(12_000)).toBe('12s');
    expect(formatDuration(125_000)).toBe('2m 05s');
    expect(formatDuration(7_260_000)).toBe('2h 01m');
  });

  test('costs', () => {
    expect(formatCost(undefined)).toBe('—');
    expect(formatCost(0)).toBe('$0.00');
    expect(formatCost(0.0042)).toBe('$0.0042');
    expect(formatCost(1.239)).toBe('$1.24');
  });

  test('tokens and truncation', () => {
    expect(formatTokens(999)).toBe('999');
    expect(formatTokens(1_240)).toBe('1.2k');
    expect(formatTokens(12_400)).toBe('12k');
    expect(formatTokens(2_400_000)).toBe('2.4M');
    expect(truncate('short', 20)).toBe('short');
    expect(truncate('x'.repeat(30), 10)).toHaveLength(10);
  });
});
