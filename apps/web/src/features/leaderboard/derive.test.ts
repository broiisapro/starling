import { describe, expect, test } from 'bun:test';
import type { AuditVerdict, NodeInfo, Run, StarlingEvent, TaskRun } from '@starling/core/browser';
import { BASE_TS, makeAuditVerdict, makeNodeInfo, makeRun, makeTaskRun } from '@starling/core/testing';
import { demoEvents } from '../../data/demo';
import { applyEvents, createInitialState, type SkyState } from '../../data/reducer';
import { auditDurationMs, BOARD_SIZE, type Board, buildBoards, formatBoardSeconds } from './derive';

const FIXTURE_STATE = applyEvents(createInitialState(), demoEvents());

function board(state: SkyState, id: string): Board {
  const found = buildBoards(state).find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`board ${id} is absent`);
  return found;
}

function stateOf(run: Run, extra: Partial<SkyState> = {}): SkyState {
  return { ...createInitialState(), runs: { [run.id]: run }, activeRunId: run.id, ...extra };
}

function merged(key: string, startedAt: number, finishedAt: number, over: Partial<TaskRun> = {}): TaskRun {
  return makeTaskRun({
    taskKey: key,
    status: 'merged',
    startedAt,
    finishedAt,
    nodeId: 'hub',
    ...over,
  });
}

describe('fixture truths (recorded launch-day run)', () => {
  test('fastest bird is dates-fix at 33.4s', () => {
    const fastest = board(FIXTURE_STATE, 'fastest');
    expect(fastest.entries[0]?.key).toBe('dates-fix');
    expect(fastest.entries[0]?.display).toBe('33.4s');
    expect(fastest.entries[0]?.value).toBe(33_400);
  });

  test('busiest perch is the MacBook Pro hub with five tasks', () => {
    const perch = board(FIXTURE_STATE, 'perch');
    expect(perch.entries[0]?.key).toBe('hub');
    expect(perch.entries[0]?.label).toBe('MacBook Pro');
    expect(perch.entries[0]?.nodeId).toBe('hub');
    expect(perch.entries[0]?.value).toBe(5);
    expect(perch.entries[0]?.display).toBe('5 tasks');
    expect(perch.entries[1]?.key).toBe('air');
    expect(perch.entries[1]?.value).toBe(2);
  });

  test('most stubborn is theme after one fix', () => {
    const stubborn = board(FIXTURE_STATE, 'stubborn');
    expect(stubborn.entries[0]?.key).toBe('theme');
    expect(stubborn.entries[0]?.display).toBe('1 fix');
    // search also has one attempt but no failed verdict, so theme's failed audit wins the tie.
    expect(stubborn.entries.map((entry) => entry.key)).toEqual(['theme', 'search']);
  });

  test('hungriest counts input + output without double-counting cached tokens', () => {
    const hungriest = board(FIXTURE_STATE, 'hungriest');
    expect(hungriest.entries[0]?.key).toBe('theme');
    expect(hungriest.entries[0]?.value).toBe(29_400);
    expect(hungriest.entries[0]?.display).toBe('29.4k');
  });

  test('cleanest audit is dates-fix: first attempt, every check ok, 30.4s', () => {
    const cleanest = board(FIXTURE_STATE, 'cleanest');
    expect(cleanest.entries[0]?.key).toBe('dates-fix');
    expect(cleanest.entries[0]?.display).toBe('30.4s');
    expect(cleanest.entries.map((entry) => entry.key)).not.toContain('theme');
    expect(cleanest.entries.map((entry) => entry.key)).not.toContain('search');
  });

  test('thriftiest perch averages cost over merged landings', () => {
    const thriftiest = board(FIXTURE_STATE, 'thriftiest');
    expect(thriftiest.entries[0]?.key).toBe('air');
    expect(thriftiest.entries[0]?.label).toBe('MacBook Air');
    expect(thriftiest.entries[0]?.value).toBeCloseTo(0.005_330_4, 6);
  });

  test('boards keep reading order, cap at five and only list the active run', () => {
    const boards = buildBoards(FIXTURE_STATE);
    expect(boards.map((entry) => entry.id)).toEqual([
      'fastest',
      'hungriest',
      'cleanest',
      'stubborn',
      'perch',
      'thriftiest',
    ]);
    for (const entry of boards) expect(entry.entries.length).toBeLessThanOrEqual(BOARD_SIZE);
    expect(board(FIXTURE_STATE, 'fastest').entries).toHaveLength(5);
  });

  test('task entries carry no nodeId, node entries carry theirs', () => {
    expect(board(FIXTURE_STATE, 'fastest').entries.every((entry) => entry.nodeId === undefined)).toBe(true);
    expect(board(FIXTURE_STATE, 'perch').entries.every((entry) => entry.nodeId !== undefined)).toBe(true);
  });
});

describe('board edge cases', () => {
  const NODES: NodeInfo[] = [
    makeNodeInfo({ id: 'hub', name: 'MacBook Pro' }),
    makeNodeInfo({ id: 'air', name: 'MacBook Air', kind: 'remote' }),
  ];

  test('no active run means no boards at all', () => {
    expect(buildBoards(createInitialState())).toEqual([]);
  });

  test('empty boards are hidden rather than rendered with a placeholder', () => {
    const run = makeRun({
      id: 'run-empty',
      tasks: { theme: merged('theme', BASE_TS, BASE_TS + 1_000, { costUsd: 0.01 }) },
    });
    const ids = buildBoards(stateOf(run, { nodes: Object.fromEntries(NODES.map((n) => [n.id, n])) })).map(
      (entry) => entry.id,
    );
    expect(ids).toEqual(['fastest', 'perch', 'thriftiest']);
  });

  test('a merged task without timings never wins fastest', () => {
    const run = makeRun({
      id: 'run-notimes',
      tasks: {
        theme: makeTaskRun({ taskKey: 'theme', status: 'merged', nodeId: 'hub' }),
        broken: makeTaskRun({ taskKey: 'broken', status: 'merged', startedAt: BASE_TS, nodeId: 'hub' }),
      },
    });
    const boards = buildBoards(stateOf(run, { nodes: { hub: NODES[0] as NodeInfo } }));
    expect(boards.find((entry) => entry.id === 'fastest')).toBeUndefined();
  });

  test('ties break by key, so ranks are stable across engines', () => {
    const run = makeRun({
      id: 'run-tie',
      tasks: {
        zulu: merged('zulu', BASE_TS, BASE_TS + 10_000),
        alpha: merged('alpha', BASE_TS, BASE_TS + 10_000),
      },
    });
    const fastest = board(stateOf(run), 'fastest');
    expect(fastest.entries.map((entry) => entry.key)).toEqual(['alpha', 'zulu']);
  });

  test('stubborn ties break on failed verdicts before the key', () => {
    const run = makeRun({
      id: 'run-stubborn',
      tasks: {
        alpha: makeTaskRun({ taskKey: 'alpha', status: 'merged', attempts: 1, nodeId: 'hub' }),
        zulu: makeTaskRun({ taskKey: 'zulu', status: 'merged', attempts: 1, nodeId: 'hub' }),
        quiet: makeTaskRun({ taskKey: 'quiet', status: 'merged', attempts: 0, nodeId: 'hub' }),
      },
    });
    const verdicts: Record<string, AuditVerdict[]> = {
      alpha: [makeAuditVerdict({ taskKey: 'alpha', attempt: 1, pass: true })],
      zulu: [
        makeAuditVerdict({ taskKey: 'zulu', attempt: 1, pass: false }),
        makeAuditVerdict({ taskKey: 'zulu', attempt: 2, pass: true }),
      ],
    };
    const stubborn = board(stateOf(run, { verdicts }), 'stubborn');
    expect(stubborn.entries.map((entry) => entry.key)).toEqual(['zulu', 'alpha']);
  });

  test('only the active run contributes', () => {
    const oldRun = makeRun({ id: 'run-old', tasks: { old: merged('old', BASE_TS, BASE_TS + 1_000) } });
    const activeRun = makeRun({ id: 'run-new', tasks: { live: merged('live', BASE_TS, BASE_TS + 2_000) } });
    const state: SkyState = {
      ...createInitialState(),
      runs: { [oldRun.id]: oldRun, [activeRun.id]: activeRun },
      activeRunId: activeRun.id,
    };
    expect(board(state, 'fastest').entries.map((entry) => entry.key)).toEqual(['live']);
  });

  test('a migration already applied to the snapshot is not double-counted', () => {
    const run = makeRun({
      id: 'run-migrated',
      tasks: { search: merged('search', BASE_TS, BASE_TS + 1_000, { nodeId: 'hub' }) },
    });
    const events: StarlingEvent[] = [
      {
        type: 'task.migrated',
        runId: run.id,
        ts: BASE_TS,
        payload: { taskKey: 'search', fromNode: 'air', toNode: 'hub', reason: 'air went offline' },
      },
    ];
    const perch = board(stateOf(run, { nodes: { hub: NODES[0] as NodeInfo }, events }), 'perch');
    expect(perch.entries).toHaveLength(1);
    expect(perch.entries[0]?.value).toBe(1);
  });

  test('a migration for a task the snapshot does not list still credits the destination', () => {
    const run = makeRun({ id: 'run-lag', tasks: {} });
    const events: StarlingEvent[] = [
      {
        type: 'task.migrated',
        runId: run.id,
        ts: BASE_TS,
        payload: { taskKey: 'ghost', fromNode: 'air', toNode: 'hub', reason: 'air went offline' },
      },
    ];
    const perch = board(stateOf(run, { nodes: { hub: NODES[0] as NodeInfo }, events }), 'perch');
    expect(perch.entries[0]?.key).toBe('hub');
    expect(perch.entries[0]?.value).toBe(1);
  });

  test('an unknown node id reads as the id, never as blank', () => {
    const run = makeRun({
      id: 'run-unknown-node',
      tasks: { theme: merged('theme', BASE_TS, BASE_TS + 1_000, { nodeId: 'stranger' }) },
    });
    expect(board(stateOf(run), 'perch').entries[0]?.label).toBe('stranger');
  });

  test('cleanest excludes attempt 2 passes, failed checks and empty check lists', () => {
    const run = makeRun({
      id: 'run-clean',
      tasks: {
        later: merged('later', BASE_TS, BASE_TS + 1_000),
        dirty: merged('dirty', BASE_TS, BASE_TS + 1_000),
        empty: merged('empty', BASE_TS, BASE_TS + 1_000),
      },
    });
    const verdicts: Record<string, AuditVerdict[]> = {
      later: [makeAuditVerdict({ taskKey: 'later', attempt: 2, pass: true })],
      dirty: [
        makeAuditVerdict({
          taskKey: 'dirty',
          attempt: 1,
          pass: true,
          checks: [{ name: 'tests', ok: false, detail: 'one failing test' }],
        }),
      ],
      empty: [makeAuditVerdict({ taskKey: 'empty', attempt: 1, pass: true, checks: [] })],
    };
    expect(buildBoards(stateOf(run, { verdicts })).find((entry) => entry.id === 'cleanest')).toBeUndefined();
  });

  test('hungriest skips tasks that burned no tokens', () => {
    const run = makeRun({
      id: 'run-quiet',
      tasks: { theme: makeTaskRun({ taskKey: 'theme', status: 'running' }) },
    });
    expect(buildBoards(stateOf(run)).find((entry) => entry.id === 'hungriest')).toBeUndefined();
  });
});

describe('formatting helpers', () => {
  test('formatBoardSeconds keeps one honest decimal under a minute', () => {
    expect(formatBoardSeconds(33_400)).toBe('33.4s');
    expect(formatBoardSeconds(30_000)).toBe('30s');
    expect(formatBoardSeconds(450)).toBe('0.5s');
    expect(formatBoardSeconds(60_000)).toBe('1m 00s');
    expect(formatBoardSeconds(125_400)).toBe('2m 05s');
    expect(formatBoardSeconds(Number.NaN)).toBe('—');
    expect(formatBoardSeconds(-1)).toBe('—');
  });

  test('auditDurationMs sums check durations only when every check reported one', () => {
    const task = makeTaskRun({ taskKey: 'theme', startedAt: BASE_TS });
    const complete = makeAuditVerdict({
      ts: BASE_TS + 9_000,
      checks: [
        { name: 'tests', ok: true, detail: 'ok', durationMs: 1_200 },
        { name: 'lane', ok: true, detail: 'ok', durationMs: 300 },
      ],
    });
    expect(auditDurationMs(complete, task)).toBe(1_500);

    const partial = makeAuditVerdict({
      ts: BASE_TS + 4_000,
      checks: [
        { name: 'tests', ok: true, detail: 'ok', durationMs: 1_200 },
        { name: 'lane', ok: true, detail: 'ok' },
      ],
    });
    expect(auditDurationMs(partial, task)).toBe(4_000);
  });

  test('auditDurationMs returns undefined when there is no timing at all', () => {
    const task = makeTaskRun({ taskKey: 'theme' });
    const verdict = makeAuditVerdict({ checks: [{ name: 'tests', ok: true, detail: 'ok' }] });
    expect(auditDurationMs(verdict, task)).toBeUndefined();
  });
});
