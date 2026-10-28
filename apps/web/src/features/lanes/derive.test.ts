import { describe, expect, test } from 'bun:test';
import type { StarlingEvent } from '@starling/core/browser';
import {
  BASE_TS,
  makeAgentEvent,
  makeAuditVerdict,
  makePlan,
  makeRun,
  makeTaskRun,
  makeTaskSpec,
} from '@starling/core/testing';
import { createInitialState, diffKey, type SkyState } from '../../data/reducer';
import {
  buildLaneModel,
  buildLaneTree,
  formatLaneSummary,
  globTarget,
  type LaneNode,
  laneOverlapIssues,
  laneOverlaps,
  laneRows,
  primaryLaneOwner,
} from './derive';

const RUN_ID = 'run-lanes-derive';

function stateFor(
  tasks = [
    makeTaskSpec({
      key: 'a',
      title: 'Alpha',
      lane: { owns: ['src/alpha/**', 'src/shared/one.ts'], reads: ['src/main.ts'] },
    }),
    makeTaskSpec({ key: 'b', title: 'Beta', lane: { owns: ['src/beta/**'], reads: [] } }),
  ],
  overrides: Partial<SkyState> = {},
): SkyState {
  const plan = makePlan({ id: 'plan-lanes', goalId: 'goal-lanes', tasks });
  const run = makeRun({
    id: RUN_ID,
    plan,
    tasks: Object.fromEntries(
      tasks.map((task) => [task.key, makeTaskRun({ runId: RUN_ID, taskKey: task.key })]),
    ),
  });
  return {
    ...createInitialState(),
    runs: { [run.id]: run },
    activeRunId: run.id,
    ...overrides,
  };
}

function find(node: LaneNode, path: string): LaneNode | undefined {
  if (node.path === path) return node;
  for (const child of node.children) {
    const hit = find(child, path);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

function edited(taskKey: string, path: string, added: number, removed: number, runId = RUN_ID) {
  return makeAgentEvent({ runId, taskKey, kind: 'file.edited', ts: BASE_TS, data: { path, added, removed } });
}

describe('globTarget', () => {
  test('keeps only the static prefix of a glob', () => {
    expect(globTarget('src/features/theme/**')).toEqual({ path: 'src/features/theme', kind: 'dir' });
    expect(globTarget('src/**/x.ts')).toEqual({ path: 'src', kind: 'dir' });
    expect(globTarget('./src/ui/styles.css')).toEqual({ path: 'src/ui/styles.css', kind: 'file' });
    expect(globTarget('*.md')).toEqual({ path: '', kind: 'dir' });
  });
});

describe('buildLaneTree', () => {
  test('turns lane globs into nested directory and file nodes', () => {
    const tree = buildLaneTree(stateFor());

    expect(tree.kind).toBe('repo');
    expect(find(tree, 'src/alpha')?.kind).toBe('dir');
    expect(find(tree, 'src/shared/one.ts')?.kind).toBe('file');
    expect(find(tree, 'src/main.ts')?.readers).toEqual(['a']);
    expect(find(tree, 'src/missing')).toBeUndefined();
  });

  test('aggregates ownership up every ancestor directory', () => {
    const tree = buildLaneTree(stateFor());

    expect(find(tree, 'src')?.owners).toEqual(['a', 'b']);
    expect(find(tree, 'src/alpha')?.owners).toEqual(['a']);
    expect(find(tree, 'src/beta')?.owners).toEqual(['b']);
    expect(find(tree, 'src/main.ts')?.owners).toEqual([]);
  });

  test('records readers separately from owners', () => {
    const tree = buildLaneTree(stateFor());

    const main = find(tree, 'src/main.ts');
    expect(main?.readers).toEqual(['a']);
    expect(main?.owners).toEqual([]);
    expect(primaryLaneOwner(main as LaneNode)).toBe('a');
  });

  test('counts touched lines from file.edited agent events', () => {
    const state = stateFor(undefined, {
      agentLog: { a: [edited('a', 'src/alpha/index.ts', 30, 4)] },
    });

    const tree = buildLaneTree(state);
    expect(find(tree, 'src/alpha/index.ts')?.touched).toBe(34);
    expect(find(tree, 'src/alpha')?.touched).toBe(34);
    expect(buildLaneModel(state).summary.filesTouched).toBe(1);
  });

  test('sums several edits to the same path', () => {
    const state = stateFor(undefined, {
      agentLog: { a: [edited('a', 'src/alpha/index.ts', 10, 2), edited('a', 'src/alpha/index.ts', 5, 0)] },
    });

    expect(find(buildLaneTree(state), 'src/alpha/index.ts')?.touched).toBe(17);
  });

  test('ignores malformed file.edited payloads instead of crashing', () => {
    const state = stateFor(undefined, {
      agentLog: {
        a: [
          makeAgentEvent({ runId: RUN_ID, taskKey: 'a', kind: 'file.edited', data: {} }),
          makeAgentEvent({ runId: RUN_ID, taskKey: 'a', kind: 'file.edited', data: { path: 42 } }),
          makeAgentEvent({ runId: RUN_ID, taskKey: 'a', kind: 'file.edited', data: { path: 'src/a.ts' } }),
        ],
      },
    });

    const tree = buildLaneTree(state);
    expect(find(tree, 'src/a.ts')?.kind).toBe('file');
    expect(find(tree, 'src/a.ts')?.touched).toBe(0);
    expect(buildLaneModel(state).summary.filesTouched).toBe(1);
  });

  test('reads touched files from the lazily fetched diff cache', () => {
    const state = stateFor(undefined, {
      diffs: {
        [diffKey(RUN_ID, 'a')]: {
          files: [{ path: 'src/alpha/diff.ts', added: 12, removed: 3 }],
          patch: '',
          truncated: false,
        },
      },
    });

    expect(find(buildLaneTree(state), 'src/alpha/diff.ts')?.touched).toBe(15);
  });

  test('reads a structural task.diff event (not yet in core’s union)', () => {
    const event = {
      type: 'task.diff',
      runId: RUN_ID,
      ts: BASE_TS,
      payload: {
        taskKey: 'b',
        diff: {
          files: [{ path: 'src/beta/from-event.ts', added: 8, removed: 1 }],
          patch: '',
          truncated: false,
        },
      },
    } as unknown as StarlingEvent;
    const state = stateFor(undefined, { events: [event] });

    expect(find(buildLaneTree(state), 'src/beta/from-event.ts')?.touched).toBe(9);
  });

  test('ignores agent events from another run', () => {
    const state = stateFor(undefined, {
      agentLog: { a: [edited('a', 'src/alpha/index.ts', 30, 4, 'run-other')] },
    });

    expect(find(buildLaneTree(state), 'src/alpha/index.ts')).toBeUndefined();
  });

  test('weights a touched file by its lines', () => {
    const state = stateFor(undefined, {
      agentLog: { a: [edited('a', 'src/alpha/index.ts', 30, 4)] },
    });

    expect(find(buildLaneTree(state), 'src/alpha/index.ts')?.weight).toBe(34);
  });

  test('falls back to one per untouched file and one per lane glob', () => {
    const tree = buildLaneTree(
      stateFor([
        makeTaskSpec({ key: 'a', lane: { owns: ['src/alpha/**', 'src/shared/one.ts'], reads: [] } }),
      ]),
    );

    expect(find(tree, 'src/shared/one.ts')?.weight).toBe(1);
    expect(find(tree, 'src/alpha')?.weight).toBe(1);
  });

  test('a directory weighs the sum of its children', () => {
    const state = stateFor(undefined, {
      agentLog: { a: [edited('a', 'src/alpha/one.ts', 10, 0), edited('a', 'src/alpha/two.ts', 5, 0)] },
    });

    expect(find(buildLaneTree(state), 'src/alpha')?.weight).toBe(15);
  });

  test('flags conflict files and their ancestor frames', () => {
    const state = stateFor(undefined, {
      merges: [
        {
          taskKey: 'a',
          status: 'conflict',
          conflictedFiles: ['src/shared/one.ts'],
          detail: 'both changed it',
          ts: BASE_TS,
        },
      ],
    });

    const tree = buildLaneTree(state);
    expect(find(tree, 'src/shared/one.ts')?.conflict).toBe(true);
    expect(find(tree, 'src/shared')?.conflict).toBe(true);
    expect(buildLaneModel(state).summary.conflicts).toBe(1);
  });

  test('flags lane violations from audit verdicts', () => {
    const state = stateFor(undefined, {
      verdicts: { a: [makeAuditVerdict({ taskKey: 'a', laneViolations: ['src/beta/leak.ts'] })] },
    });

    const tree = buildLaneTree(state);
    expect(find(tree, 'src/beta/leak.ts')?.violation).toBe(true);
    expect(find(tree, 'src/beta/leak.ts')?.owners).toEqual(['b']);
    expect(buildLaneModel(state).summary.violations).toBe(1);
  });

  test('detects overlapping lane pairs with the colliding globs', () => {
    const tasks = [
      makeTaskSpec({ key: 'a', lane: { owns: ['src/ui/**'], reads: [] } }),
      makeTaskSpec({ key: 'b', lane: { owns: ['src/ui/**'], reads: [] } }),
      makeTaskSpec({ key: 'c', lane: { owns: ['src/api/**'], reads: [] } }),
    ];

    expect(laneOverlaps(tasks)).toEqual([{ a: 'a', b: 'b', globs: ['src/ui/** <=> src/ui/**'] }]);
  });

  test('hatches a path claimed by two tasks but not a shared parent', () => {
    const tasks = [
      makeTaskSpec({ key: 'a', lane: { owns: ['src/ui/**'], reads: [] } }),
      makeTaskSpec({ key: 'b', lane: { owns: ['src/ui/**', 'src/api/**'], reads: [] } }),
    ];

    const tree = buildLaneTree(stateFor(tasks));
    expect(find(tree, 'src/ui')?.overlap).toBe(true);
    expect(find(tree, 'src/ui')?.owners).toEqual(['a', 'b']);
    expect(find(tree, 'src')?.overlap).toBe(false);
    expect(find(tree, 'src/api')?.overlap).toBe(false);
  });

  test('hatches a file edited by two tasks', () => {
    const state = stateFor(undefined, {
      agentLog: {
        a: [edited('a', 'src/shared/one.ts', 4, 0)],
        b: [edited('b', 'src/shared/one.ts', 2, 0)],
      },
    });

    expect(find(buildLaneTree(state), 'src/shared/one.ts')?.overlap).toBe(true);
  });

  test('summarises lanes, overlaps, files and conflicts', () => {
    const state = stateFor(undefined, {
      agentLog: {
        a: [edited('a', 'src/alpha/index.ts', 30, 4)],
        b: [edited('b', 'src/beta/index.ts', 5, 0)],
      },
    });

    const summary = buildLaneModel(state).summary;
    expect(summary).toEqual({
      lanes: 2,
      overlaps: 0,
      filesTouched: 2,
      conflicts: 0,
      linesTouched: 39,
      violations: 0,
    });
    expect(formatLaneSummary(summary)).toBe('2 lanes · 0 overlaps · 2 files touched · 0 conflicts');
  });

  test('uses singular forms for one lane, one file and one conflict', () => {
    expect(
      formatLaneSummary({
        lanes: 1,
        overlaps: 1,
        filesTouched: 1,
        conflicts: 1,
        linesTouched: 0,
        violations: 0,
      }),
    ).toBe('1 lane · 1 overlap · 1 file touched · 1 conflict');
  });

  test('is deterministic across rebuilds', () => {
    const state = stateFor(undefined, {
      agentLog: { a: [edited('a', 'src/alpha/index.ts', 30, 4)] },
    });

    expect(buildLaneTree(state)).toEqual(buildLaneTree(state));
  });

  test('flattens the tree in pre-order for the table', () => {
    const rows = laneRows(buildLaneTree(stateFor()));
    const paths = rows.map((node) => node.path);
    expect(paths).toContain('src');
    expect(paths).toContain('src/alpha');
    expect(paths).toContain('src/shared/one.ts');
    expect(paths.indexOf('src')).toBeLessThan(paths.indexOf('src/alpha'));
  });

  test('surfaces lane-overlap plan issues when the event is present', () => {
    const plan = makePlan({
      id: 'p',
      goalId: 'g',
      tasks: [makeTaskSpec({ key: 'a' }), makeTaskSpec({ key: 'b' })],
    });
    const run = makeRun({ id: RUN_ID, plan, tasks: {} });
    const issue = {
      severity: 'warn' as const,
      code: 'lane-overlap' as const,
      message: 'a and b both own src/ui',
      taskKeys: ['a', 'b'],
    };
    const state: SkyState = {
      ...createInitialState(),
      runs: { [run.id]: run },
      activeRunId: run.id,
      events: [{ type: 'plan.created', runId: RUN_ID, ts: BASE_TS, payload: { plan, issues: [issue] } }],
    };

    expect(laneOverlapIssues(state)).toEqual([issue]);
    expect(buildLaneModel(state).issues).toEqual([issue]);
  });

  test('returns an empty tree before a plan exists', () => {
    const tree = buildLaneTree(createInitialState());
    expect(tree.children).toEqual([]);
    expect(tree.owners).toEqual([]);
    expect(tree.weight).toBe(1);
  });
});
