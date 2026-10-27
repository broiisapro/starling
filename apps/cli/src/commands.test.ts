import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { defaultConfig, isStarlingError } from '@starling/core';
import { planCommand } from './commands/plan';
import { replayCommand } from './commands/replay';
import { runCommand } from './commands/run';
import { statusCommand } from './commands/status';
import type { CliDeps } from './context';
import { createCliContext } from './context';
import { parseEventsJsonl } from './jsonl';
import { tmpDir, tmpFile } from './testing/tmp';

const FIXTURE = join(import.meta.dir, '../../../fixtures/runs/sky-todo-launch-day.jsonl');

function makeContext(overrides: Partial<CliDeps> = {}) {
  const chunks: string[] = [];
  const context = createCliContext({
    io: { write: (text) => chunks.push(text), isTTY: false, columns: 100 },
    color: false,
    cwd: tmpDir(),
    config: defaultConfig,
    mockStepMs: 0,
    sleep: async () => {},
    ...overrides,
  });
  return { context, chunks, text: () => chunks.join('') };
}

describe('starling plan', () => {
  test('renders the plan and lauds a clean DAG', async () => {
    const { context, text } = makeContext();
    const code = await planCommand('add dark mode', {}, context);
    expect(code).toBe(0);
    expect(text()).toContain('Starling plan');
    expect(text()).toContain('Lane matrix');
    expect(text()).toContain('No issues');
    expect(text()).not.toContain('\x1b[');
  });

  test('--json prints a parseable plan and issues', async () => {
    const { context, text } = makeContext();
    await planCommand('add dark mode', { json: true }, context);
    const parsed = JSON.parse(text()) as { plan: { tasks: unknown[] }; issues: unknown[] };
    expect(parsed.plan.tasks).toHaveLength(5);
    expect(parsed.issues).toEqual([]);
  });
});

describe('starling run', () => {
  test('reaches a summary in mock mode and respects --no-dash', async () => {
    const { context, text } = makeContext();
    const code = await runCommand('add CSV export', { dash: false }, context);
    expect(code).toBe(0);
    expect(text()).toContain('run finished');
    expect(text()).toContain('5 merged');
    expect(text()).toContain('mock composition');
    expect(text()).not.toContain('http://localhost:7777');
    expect(text()).not.toContain('\x1b[');
  });

  test('prints the dashboard URL by default', async () => {
    const { context, text } = makeContext();
    await runCommand('add CSV export', {}, context);
    expect(text()).toContain('http://localhost:7777');
  });

  test('--dry-run renders a plan instead of launching agents', async () => {
    const { context, text } = makeContext();
    const code = await runCommand('add CSV export', { dryRun: true }, context);
    expect(code).toBe(0);
    expect(text()).toContain('Starling plan');
    expect(text()).toContain('Dry run');
    expect(text()).not.toContain('run finished');
  });

  test('--record appends every event as valid JSONL', async () => {
    const path = tmpFile('run.jsonl');
    const { context, text } = makeContext();
    const code = await runCommand('add CSV export', { dash: false, record: path }, context);
    expect(code).toBe(0);
    expect(text()).toContain('recorded');

    const { readFileSync } = await import('node:fs');
    const events = parseEventsJsonl(readFileSync(path, 'utf8'), path);
    expect(events.length).toBeGreaterThan(20);
    expect(events[0]?.type).toBe('run.created');
    expect(events.at(-1)?.type).toBe('run.finished');
    expect(text()).toContain(`starling replay ${path}`);
  });

  test('acknowledges --github and --fully-open as deferred, not broken', async () => {
    const { context, text } = makeContext();
    await runCommand('add CSV export', { dash: false, github: true, fullyOpen: true }, context);
    expect(text()).toContain('--github recorded');
    expect(text()).toContain('--fully-open recorded');
  });
});

describe('starling replay', () => {
  test('replays the 252-event fixture at speed 1000 and ends on the summary', async () => {
    const { context, text } = makeContext();
    const code = await replayCommand(FIXTURE, { speed: 1000 }, context);
    expect(code).toBe(0);
    expect(text()).toContain('replayed 252 events');
    expect(text()).toContain('run finished');
    expect(text()).toContain('7 merged');
    expect(text()).toContain('starling/9w0x1y/integration');
    expect(text()).toContain('×1000');
  });

  test('rejects a non-positive speed', async () => {
    const { context } = makeContext();
    try {
      await replayCommand(FIXTURE, { speed: 0 }, context);
      throw new Error('expected replay to throw');
    } catch (err) {
      expect(isStarlingError(err, 'INVALID_ARGUMENT')).toBe(true);
    }
  });

  test('reports a missing recording', async () => {
    const { context } = makeContext();
    await expect(replayCommand('nope.jsonl', { speed: 4 }, context)).rejects.toThrow(
      /Could not read recording/,
    );
  });
});

describe('starling status', () => {
  test('renders a recorded run with --file', async () => {
    const path = tmpFile('status.jsonl');
    const runCtx = makeContext();
    await runCommand('add CSV export', { dash: false, record: path }, runCtx.context);

    const { context, text } = makeContext();
    const code = await statusCommand(undefined, { file: path }, context);
    expect(code).toBe(0);
    expect(text()).toContain('Starling run');
    expect(text()).toContain('5 merged');
    expect(text()).toContain('finished');
  });

  test('--json prints the run object', async () => {
    const path = tmpFile('status-json.jsonl');
    const runCtx = makeContext();
    await runCommand('add CSV export', { dash: false, record: path }, runCtx.context);

    const { context, text } = makeContext();
    await statusCommand(undefined, { file: path, json: true }, context);
    const run = JSON.parse(text()) as { status: string; tasks: Record<string, unknown> };
    expect(run.status).toBe('finished');
    expect(Object.keys(run.tasks)).toHaveLength(5);
  });

  test('is friendly when no run exists, and rejects an unknown id', async () => {
    const empty = makeContext();
    expect(await statusCommand(undefined, {}, empty.context)).toBe(0);
    expect(empty.text()).toContain('No runs in this session yet');

    const unknown = makeContext();
    await expect(statusCommand('missing', {}, unknown.context)).rejects.toThrow(/No run missing/);
  });
});
