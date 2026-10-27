import { describe, expect, test } from 'bun:test';
import type { MergeResult, TaskRun, TaskStatus } from '@starling/core';
import { makePlan, makeTaskRun, makeTaskSpec } from '@starling/core/testing';
import type { QueueColumnId } from './columns';
import {
  assignColumn,
  buildQueueBoard,
  COLUMN_BY_STATUS,
  latestMergeResult,
  pendingRun,
  QUEUE_COLUMNS,
  taskElapsedMs,
  transitionOffset,
  unmetDependencies,
  waitingLabel,
  wireOrder,
} from './columns';

const NOW = 1_700_000_500_000;

type Statuses = Record<string, TaskStatus>;

function tasksWith(statuses: Statuses): Record<string, TaskRun> {
  const tasks: Record<string, TaskRun> = {};
  for (const [key, status] of Object.entries(statuses)) {
    tasks[key] = makeTaskRun({ taskKey: key, status, startedAt: NOW - 30_000 });
  }
  return tasks;
}

function merge(overrides: Partial<MergeResult>): MergeResult {
  return {
    taskKey: 'theme',
    status: 'merged',
    conflictedFiles: [],
    detail: 'Merged into integration',
    ts: NOW - 10_000,
    ...overrides,
  };
}

// ── column assignment ──────────────────────────────────────────────────────────────────────────────

const COLUMN_CASES: readonly (readonly [TaskStatus, QueueColumnId])[] = [
  ['pending', 'waiting'],
  ['ready', 'waiting'],
  ['running', 'flying'],
  ['auditing', 'audit'],
  ['fixing', 'audit'],
  ['merging', 'landing'],
  ['merged', 'wire'],
  ['failed', 'grounded'],
  ['conflict', 'grounded'],
  ['cancelled', 'grounded'],
];

for (const [status, column] of COLUMN_CASES) {
  test(`assigns ${status} to the ${column} column`, () => {
    expect(assignColumn(status)).toBe(column);
  });
}

describe('column map', () => {
  test('covers every TaskStatus exactly once', () => {
    const statuses = Object.keys(COLUMN_BY_STATUS);
    expect(statuses).toHaveLength(COLUMN_CASES.length);
    for (const [status] of COLUMN_CASES) expect(statuses).toContain(status);
  });

  test('only points at real columns', () => {
    for (const column of Object.values(COLUMN_BY_STATUS)) {
      expect(QUEUE_COLUMNS).toContain(column);
    }
  });

  test('orders the board waiting → grounded', () => {
    expect(QUEUE_COLUMNS).toEqual(['waiting', 'flying', 'audit', 'landing', 'wire', 'grounded']);
  });
});

// ── dependency gating ─────────────────────────────────────────────────────────────────────────────

describe('waiting reasons', () => {
  test('a ready task whose dependency has not merged is blocked', () => {
    const plan = makePlan({
      tasks: [
        makeTaskSpec({ key: 'dates-fix' }),
        makeTaskSpec({ key: 'due-badges', dependsOn: ['dates-fix'] }),
      ],
    });
    const board = buildQueueBoard(plan, tasksWith({ 'dates-fix': 'running', 'due-badges': 'ready' }), []);
    const card = board.columns.waiting.find((entry) => entry.taskKey === 'due-badges');
    expect(card?.waitingReason).toBe('blocked');
    expect(card?.unmetDeps).toEqual(['dates-fix']);
    expect(card && waitingLabel(card)).toBe('waiting on dates-fix');
  });

  test('a ready task with merged dependencies is queued for a slot', () => {
    const plan = makePlan({
      tasks: [
        makeTaskSpec({ key: 'dates-fix' }),
        makeTaskSpec({ key: 'due-badges', dependsOn: ['dates-fix'] }),
      ],
    });
    const board = buildQueueBoard(plan, tasksWith({ 'dates-fix': 'merged', 'due-badges': 'ready' }), []);
    const card = board.columns.waiting.find((entry) => entry.taskKey === 'due-badges');
    expect(card?.waitingReason).toBe('queued');
    expect(card?.unmetDeps).toEqual([]);
    expect(card && waitingLabel(card)).toBe('queued for a slot');
  });

  test('a dependency missing from the run counts as unmet', () => {
    const spec = makeTaskSpec({ key: 'theme', dependsOn: ['ghost'] });
    expect(unmetDependencies(spec, {})).toEqual(['ghost']);
  });

  test('no spec means no dependency information', () => {
    expect(unmetDependencies(undefined, {})).toEqual([]);
  });

  test('waiting cards sort queued before blocked, then by plan order', () => {
    const plan = makePlan({
      tasks: [
        makeTaskSpec({ key: 'a', dependsOn: ['later'] }),
        makeTaskSpec({ key: 'b' }),
        makeTaskSpec({ key: 'later' }),
      ],
    });
    const board = buildQueueBoard(plan, tasksWith({ a: 'ready', b: 'ready', later: 'pending' }), []);
    expect(board.columns.waiting.map((card) => card.taskKey)).toEqual(['b', 'later', 'a']);
  });
});

// ── wire order ────────────────────────────────────────────────────────────────────────────────────

describe('the wire', () => {
  test('follows merge order, not plan order', () => {
    const tasks = tasksWith({ theme: 'merged', search: 'merged', 'csv-export': 'merged' });
    const merges = [
      merge({ taskKey: 'search', ts: 300, commit: 'aaaaaaa111' }),
      merge({ taskKey: 'theme', ts: 200, commit: 'bbbbbbb222' }),
      merge({ taskKey: 'csv-export', ts: 100, commit: 'ccccccc333' }),
    ];
    expect(wireOrder(merges, tasks).map((entry) => entry.taskKey)).toEqual(['csv-export', 'theme', 'search']);
  });

  test('shortens the merge commit sha to seven characters', () => {
    const entries = wireOrder(
      [merge({ taskKey: 'theme', commit: 'c0ffee001' })],
      tasksWith({ theme: 'merged' }),
    );
    expect(entries[0]?.commit).toBe('c0ffee0');
  });

  test('keeps the first merge for a task that merged twice', () => {
    const merges = [
      merge({ taskKey: 'theme', ts: 100, commit: 'first00' }),
      merge({ taskKey: 'theme', ts: 900, commit: 'second0' }),
    ];
    const entries = wireOrder(merges, tasksWith({ theme: 'merged' }));
    expect(entries).toHaveLength(1);
    expect(entries[0]?.commit).toBe('first00');
  });

  test('appends merged tasks that have no merge event, by finish time', () => {
    const tasks: Record<string, TaskRun> = {
      a: makeTaskRun({ taskKey: 'a', status: 'merged', finishedAt: NOW - 1_000 }),
      b: makeTaskRun({ taskKey: 'b', status: 'merged', finishedAt: NOW - 5_000 }),
    };
    const entries = wireOrder([], tasks);
    expect(entries.map((entry) => entry.taskKey)).toEqual(['b', 'a']);
    expect(entries[0]?.commit).toBeUndefined();
  });

  test('ignores conflict and tests-failed merge results', () => {
    const entries = wireOrder(
      [
        merge({ taskKey: 'theme', status: 'conflict', detail: 'add/add in styles.css' }),
        merge({ taskKey: 'search', status: 'tests-failed', detail: 'bun test: 2 fail' }),
      ],
      tasksWith({ theme: 'conflict', search: 'failed' }),
    );
    expect(entries).toEqual([]);
  });

  test('number the wire 1..n in merge order', () => {
    const plan = makePlan({ tasks: [makeTaskSpec({ key: 'a' }), makeTaskSpec({ key: 'b' })] });
    const board = buildQueueBoard(plan, tasksWith({ a: 'merged', b: 'merged' }), [
      merge({ taskKey: 'b', ts: 1, commit: 'bbbbbbb' }),
      merge({ taskKey: 'a', ts: 2, commit: 'aaaaaaa' }),
    ]);
    expect(board.columns.wire.map((card) => [card.taskKey, card.wireIndex])).toEqual([
      ['b', 1],
      ['a', 2],
    ]);
    expect(board.columns.wire[0]?.commit).toBe('bbbbbbb');
  });
});

// ── board assembly ───────────────────────────────────────────────────────────────────────────────

describe('buildQueueBoard', () => {
  test('places one task in every column and counts the run', () => {
    const plan = makePlan({
      tasks: [
        makeTaskSpec({ key: 'waiting' }),
        makeTaskSpec({ key: 'flying' }),
        makeTaskSpec({ key: 'audit' }),
        makeTaskSpec({ key: 'landing' }),
        makeTaskSpec({ key: 'wire' }),
        makeTaskSpec({ key: 'grounded' }),
      ],
    });
    const tasks = tasksWith({
      waiting: 'pending',
      flying: 'running',
      audit: 'fixing',
      landing: 'merging',
      wire: 'merged',
      grounded: 'failed',
    });
    const board = buildQueueBoard(plan, tasks, [
      merge({ taskKey: 'wire', commit: 'c0ffee001' }),
      merge({ taskKey: 'grounded', status: 'tests-failed', detail: 'bun test: 3 fail', ts: NOW }),
    ]);

    expect(board.total).toBe(6);
    expect(board.landed).toBe(1);
    expect(board.grounded).toBe(1);
    expect(board.columns.waiting.map((card) => card.taskKey)).toEqual(['waiting']);
    expect(board.columns.flying.map((card) => card.taskKey)).toEqual(['flying']);
    expect(board.columns.audit.map((card) => card.taskKey)).toEqual(['audit']);
    expect(board.columns.landing.map((card) => card.taskKey)).toEqual(['landing']);
    expect(board.columns.wire.map((card) => card.taskKey)).toEqual(['wire']);
    expect(board.columns.grounded.map((card) => card.taskKey)).toEqual(['grounded']);
  });

  test('a plan task with no TaskRun yet appears in Waiting as pending', () => {
    const plan = makePlan({ tasks: [makeTaskSpec({ key: 'theme', title: 'Dark mode' })] });
    const board = buildQueueBoard(plan, {}, []);
    const card = board.columns.waiting[0];
    expect(card?.taskKey).toBe('theme');
    expect(card?.title).toBe('Dark mode');
    expect(card?.run.status).toBe('pending');
    expect(card?.waitingReason).toBe('queued');
  });

  test('tasks without a plan still appear, keyed by task key', () => {
    const board = buildQueueBoard(undefined, tasksWith({ orphan: 'running' }), []);
    expect(board.total).toBe(1);
    expect(board.columns.flying[0]?.title).toBe('orphan');
  });

  test('running, audit and landing cards sort by start time', () => {
    const plan = makePlan({
      tasks: [makeTaskSpec({ key: 'late' }), makeTaskSpec({ key: 'early' })],
    });
    const tasks: Record<string, TaskRun> = {
      late: makeTaskRun({ taskKey: 'late', status: 'running', startedAt: NOW - 1_000 }),
      early: makeTaskRun({ taskKey: 'early', status: 'running', startedAt: NOW - 9_000 }),
    };
    const board = buildQueueBoard(plan, tasks, []);
    expect(board.columns.flying.map((card) => card.taskKey)).toEqual(['early', 'late']);
  });

  test('grounded cards put the most recent failure first', () => {
    const tasks: Record<string, TaskRun> = {
      old: makeTaskRun({ taskKey: 'old', status: 'failed', finishedAt: NOW - 60_000 }),
      recent: makeTaskRun({ taskKey: 'recent', status: 'conflict', finishedAt: NOW - 1_000 }),
    };
    const board = buildQueueBoard(undefined, tasks, []);
    expect(board.columns.grounded.map((card) => card.taskKey)).toEqual(['recent', 'old']);
  });

  test('attaches the failing merge detail to the card for hover', () => {
    const tasks = tasksWith({ theme: 'failed' });
    const failure = merge({
      taskKey: 'theme',
      status: 'tests-failed',
      detail: 'bun test: 2 fail in dates.test.ts',
      ts: NOW,
    });
    const board = buildQueueBoard(makePlan({ tasks: [makeTaskSpec({ key: 'theme' })] }), tasks, [failure]);
    expect(board.columns.grounded[0]?.problem?.detail).toBe('bun test: 2 fail in dates.test.ts');
  });

  test('only the newest merge result for a task is reported', () => {
    const merges = [
      merge({ taskKey: 'theme', status: 'conflict', detail: 'older', ts: 10 }),
      merge({ taskKey: 'theme', status: 'tests-failed', detail: 'newer', ts: 20 }),
    ];
    expect(latestMergeResult(merges, 'theme')?.detail).toBe('newer');
    expect(latestMergeResult(merges, 'theme', ['conflict'])?.detail).toBe('older');
    expect(latestMergeResult(merges, 'nope')).toBeUndefined();
  });

  test('a cancelled task is grounded and keeps its elapsed time', () => {
    const board = buildQueueBoard(
      makePlan({ tasks: [makeTaskSpec({ key: 'theme' })] }),
      {
        theme: makeTaskRun({
          taskKey: 'theme',
          status: 'cancelled',
          startedAt: NOW - 12_000,
          finishedAt: NOW - 2_000,
        }),
      },
      [],
    );
    expect(board.columns.grounded[0]?.run.status).toBe('cancelled');
    expect(taskElapsedMs(board.columns.grounded[0]?.run ?? pendingRun('theme'), NOW)).toBe(10_000);
  });
});

// ── card geometry helpers ────────────────────────────────────────────────────────────────────────

describe('taskElapsedMs', () => {
  test('is zero before a task starts', () => {
    expect(taskElapsedMs(pendingRun('theme'), NOW)).toBe(0);
  });

  test('ticks while a task is running', () => {
    const run = makeTaskRun({ taskKey: 'theme', status: 'running', startedAt: NOW - 7_500 });
    expect(taskElapsedMs(run, NOW)).toBe(7_500);
  });

  test('freezes once finished', () => {
    const run = makeTaskRun({
      taskKey: 'theme',
      status: 'merged',
      startedAt: NOW - 20_000,
      finishedAt: NOW - 5_000,
    });
    expect(taskElapsedMs(run, NOW + 60_000)).toBe(15_000);
  });

  test('clamps clock skew to zero', () => {
    const run = makeTaskRun({ taskKey: 'theme', status: 'running', startedAt: NOW + 5_000 });
    expect(taskElapsedMs(run, NOW)).toBe(0);
  });
});

describe('transitionOffset', () => {
  test('moves right-to-left when the card advances a column', () => {
    expect(transitionOffset('waiting', 'flying')).toBe(-18);
  });

  test('moves left-to-right when a task is sent back a column', () => {
    expect(transitionOffset('audit', 'flying')).toBe(18);
  });

  test('is zero for a card that did not move', () => {
    expect(transitionOffset('wire', 'wire')).toBe(0);
  });

  test('clamps long jumps so a card never flies across the board', () => {
    expect(transitionOffset('waiting', 'grounded', 18, 72)).toBe(-72);
    expect(transitionOffset('grounded', 'waiting', 18, 72)).toBe(72);
  });
});
