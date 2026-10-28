import { describe, expect, test } from 'bun:test';
import type { Plan, Run, TaskRun, TaskSpec } from '@starling/core/browser';
import {
  compareStats,
  deltaChip,
  formatMetricValue,
  hasTaskTimings,
  isSerialBaseline,
  nodeTaskCounts,
  peakParallel,
  type RunStats,
  runStats,
  SERIAL_BASELINE_LABEL,
  SERIAL_STEP_OVERHEAD_MS,
  serialBaseline,
  serialMs,
} from './derive';
import { diffPlanTasks } from './plan-diff';
import { fixtureRun } from './test-fixtures';

const NOW = 1_731_000_400_000;

function spec(key: string, overrides: Partial<TaskSpec> = {}): TaskSpec {
  return {
    key,
    title: `Task ${key}`,
    goal: `Do ${key}`,
    deliverables: [`${key} works`],
    outOfScope: [],
    definitionOfDone: ['tests pass'],
    dependsOn: [],
    lane: { owns: [`src/${key}/**`], reads: ['src/main.ts'] },
    estimateMin: 10,
    ...overrides,
  };
}

function task(key: string, overrides: Partial<TaskRun> = {}): TaskRun {
  return {
    runId: 'run-1',
    taskKey: key,
    status: 'merged',
    attempts: 0,
    usage: { input: 0, output: 0, cached: 0 },
    costUsd: 0,
    ...overrides,
  };
}

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: 'run-1',
    goal: {
      id: 'goal-1',
      text: 'Ship the thing',
      repoPath: '/tmp/sky-todo',
      baseBranch: 'main',
      createdAt: 0,
      constraints: [],
    },
    status: 'finished',
    tasks: {},
    startedAt: 0,
    finishedAt: 60_000,
    metrics: {
      agentsActive: 0,
      tasksMerged: 0,
      tasksFailed: 0,
      apiUsage: { input: 0, output: 0, cached: 0 },
      localUsage: { input: 0, output: 0, cached: 0 },
      apiCostUsd: 0,
      localCallCount: 0,
      estSavedUsd: 0,
      elapsedMs: 60_000,
    },
    ...overrides,
  };
}

describe('runStats on the recorded launch-day fixture', () => {
  const run = fixtureRun();
  const stats = runStats(run, run.finishedAt ?? NOW);

  test('wall clock, task counts and fix attempts come from the snapshot', () => {
    expect(stats.wallMs).toBe(356_000);
    expect(stats.tasks).toBe(7);
    expect(stats.merged).toBe(7);
    expect(stats.failed).toBe(0);
    expect(stats.attempts).toBe(2);
  });

  test('peak parallelism is four overlapping task intervals', () => {
    expect(stats.peakParallel).toBe(4);
  });

  test('cost, local savings and API tokens use the run metrics', () => {
    expect(stats.apiCostUsd).toBeCloseTo(0.0421956, 7);
    expect(stats.savedUsd).toBeCloseTo(0.01854, 5);
    expect(stats.tokens).toBe(103_500 + 16_050);
  });

  test('nodes are the de-duplicated node ids, hub and Air', () => {
    expect(stats.nodes).toEqual(['air', 'hub']);
  });

  test('the serial baseline makes the 5m 56s run read as a 1.44× speedup', () => {
    expect(stats.serialMs).toBe(512_300);
    expect(stats.speedup).toBeCloseTo(1.439, 3);
    expect(stats.speedup).toBeGreaterThan(1.4);
    expect(stats.serialMs).toBeGreaterThan(stats.wallMs);
  });

  test('goal and status survive', () => {
    expect(stats.id).toBe(run.id);
    expect(stats.goal).toBe(run.goal.text);
    expect(stats.status).toBe('finished');
  });
});

describe('runStats edge cases', () => {
  test('a live run measures open intervals and wall clock against now', () => {
    const run = makeRun({
      status: 'running',
      startedAt: 0,
      finishedAt: undefined,
      tasks: {
        a: task('a', { status: 'running', startedAt: 1_000 }),
        b: task('b', { status: 'running', startedAt: 2_000 }),
      },
    });
    const stats = runStats(run, 3_000);
    expect(stats.wallMs).toBe(3_000);
    expect(stats.peakParallel).toBe(2);
    expect(stats.serialMs).toBe(2_000 + 1_000 + 2 * SERIAL_STEP_OVERHEAD_MS);
  });

  test('tasks without timings fall back to their plan estimate', () => {
    const plan: Plan = {
      id: 'plan-1',
      goalId: 'goal-1',
      summary: 'one task',
      tasks: [spec('a', { estimateMin: 10 })],
      lockedDecisions: [],
      model: { provider: 'deepseek', model: 'deepseek-v4.1-flash' },
      createdAt: 0,
    };
    const run = makeRun({ plan, tasks: { a: task('a', { status: 'pending' }) } });
    const stats = runStats(run, NOW);
    expect(hasTaskTimings(run)).toBe(false);
    expect(stats.peakParallel).toBe(0);
    expect(stats.serialMs).toBe(600_000 + SERIAL_STEP_OVERHEAD_MS);
  });

  test('an empty run is all zeros and a neutral speedup', () => {
    const stats = runStats(makeRun(), 60_000);
    expect(stats.tasks).toBe(0);
    expect(stats.serialMs).toBe(0);
    expect(stats.speedup).toBe(1);
    expect(stats.peakParallel).toBe(0);
    expect(stats.nodes).toEqual([]);
  });

  test('a plan with no task runs yet still sizes the baseline', () => {
    const plan: Plan = {
      id: 'plan-1',
      goalId: 'goal-1',
      summary: 'two tasks',
      tasks: [spec('a', { estimateMin: 5 }), spec('b', { estimateMin: 6 })],
      lockedDecisions: [],
      model: { provider: 'deepseek', model: 'deepseek-v4.1-flash' },
      createdAt: 0,
    };
    const run = makeRun({ plan, tasks: {}, status: 'planned' });
    expect(runStats(run, NOW).serialMs).toBe(11 * 60_000 + 2 * SERIAL_STEP_OVERHEAD_MS);
    expect(runStats(run, NOW).tasks).toBe(2);
  });

  test('peakParallel treats touching intervals as sequential', () => {
    const run = makeRun({
      tasks: {
        a: task('a', { startedAt: 0, finishedAt: 10_000 }),
        b: task('b', { startedAt: 10_000, finishedAt: 20_000 }),
      },
    });
    expect(peakParallel(run, 20_000)).toBe(1);
  });
});

describe('serialBaseline', () => {
  const run = fixtureRun();
  const baseline = serialBaseline(run, run.finishedAt ?? NOW);

  test('is labelled, suffixed and structurally detectable', () => {
    expect(baseline.id).toBe(`${run.id}:serial`);
    expect(isSerialBaseline(baseline)).toBe(true);
    expect(isSerialBaseline(run)).toBe(false);
    expect(SERIAL_BASELINE_LABEL).toContain('one agent, one task at a time');
  });

  test('keeps the plan, tasks, attempts and cost', () => {
    expect(Object.keys(baseline.tasks).sort()).toEqual(Object.keys(run.tasks).sort());
    expect(baseline.tasks.theme?.attempts).toBe(run.tasks.theme?.attempts);
    expect(baseline.metrics.apiCostUsd).toBe(run.metrics.apiCostUsd);
    expect(baseline.plan).toEqual(run.plan);
  });

  test('finishes after exactly the serial estimate and reports it as elapsed', () => {
    expect(baseline.finishedAt).toBe(run.startedAt + 512_300);
    expect(baseline.metrics.elapsedMs).toBe(512_300);
    const stats = runStats(baseline, baseline.finishedAt ?? NOW);
    expect(stats.wallMs).toBe(512_300);
    expect(stats.speedup).toBeCloseTo(1, 10);
  });

  test('lays tasks end to end with one agent', () => {
    const ordered = Object.values(baseline.tasks).sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1];
      const next = ordered[index];
      expect(previous?.finishedAt ?? 0).toBeLessThanOrEqual(next?.startedAt ?? 0);
    }
    expect(runStats(baseline, baseline.finishedAt ?? NOW).peakParallel).toBe(1);
  });

  test('serialMs adds the per-task overhead to the flight times', () => {
    const flights = Object.values(run.tasks).reduce(
      (total, entry) => total + ((entry.finishedAt ?? 0) - (entry.startedAt ?? 0)),
      0,
    );
    expect(serialMs(run, run.finishedAt ?? NOW)).toBe(flights + 7 * SERIAL_STEP_OVERHEAD_MS);
  });
});

describe('compareStats and deltas', () => {
  const a: RunStats = {
    id: 'a',
    goal: 'A',
    status: 'finished',
    wallMs: 300_000,
    serialMs: 450_000,
    speedup: 1.5,
    tasks: 5,
    merged: 5,
    failed: 0,
    attempts: 1,
    apiCostUsd: 0.04,
    savedUsd: 0.02,
    tokens: 100_000,
    peakParallel: 4,
    nodes: ['hub'],
  };
  const b: RunStats = {
    ...a,
    id: 'b',
    wallMs: 400_000,
    speedup: 1.2,
    merged: 4,
    failed: 1,
    attempts: 3,
    apiCostUsd: 0.06,
    savedUsd: 0.01,
    tokens: 120_000,
    peakParallel: 2,
  };

  test('one row per metric in a stable order', () => {
    expect(compareStats(a, b).map((row) => row.metric)).toEqual([
      'wall',
      'speedup',
      'peakParallel',
      'merged',
      'failed',
      'attempts',
      'apiCost',
      'tokens',
      'saved',
    ]);
  });

  test('lower-is-better metrics pick the smaller side', () => {
    const rows = new Map(compareStats(a, b).map((row) => [row.metric, row]));
    expect(rows.get('wall')?.better).toBe('a');
    expect(rows.get('failed')?.better).toBe('a');
    expect(rows.get('attempts')?.better).toBe('a');
    expect(rows.get('apiCost')?.better).toBe('a');
    expect(rows.get('tokens')?.better).toBe('a');
  });

  test('higher-is-better metrics pick the larger side', () => {
    const rows = new Map(compareStats(a, b).map((row) => [row.metric, row]));
    expect(rows.get('speedup')?.better).toBe('a');
    expect(rows.get('peakParallel')?.better).toBe('a');
    expect(rows.get('merged')?.better).toBe('a');
    expect(rows.get('saved')?.better).toBe('a');
  });

  test('delta is A minus B, so a negative delta means A is numerically lower', () => {
    const rows = new Map(compareStats(a, b).map((row) => [row.metric, row]));
    expect(rows.get('wall')?.delta).toBe(-100_000);
    expect(rows.get('merged')?.delta).toBe(1);
  });

  test('identical sides are all "same" with zero deltas', () => {
    for (const row of compareStats(a, a)) {
      expect(row.better).toBe('same');
      expect(row.delta).toBe(0);
      expect(deltaChip(row).arrow).toBe('=');
    }
  });

  test('delta chips use arrows and text, never colour alone', () => {
    const rows = new Map(compareStats(a, b).map((row) => [row.metric, row]));
    const wall = rows.get('wall');
    expect(wall).toBeDefined();
    if (wall === undefined) return;
    const chip = deltaChip(wall);
    expect(chip.arrow).toBe('▲');
    expect(chip.text).toBe('1m 40s');
    expect(chip.winner).toBe('a');
    expect(chip.label).toContain('A better');

    const cost = rows.get('apiCost');
    expect(cost).toBeDefined();
    if (cost === undefined) return;
    expect(deltaChip(cost).arrow).toBe('▲');
  });

  test('formatMetricValue renders every format deterministically', () => {
    expect(formatMetricValue('duration', 356_000)).toBe('5m 56s');
    expect(formatMetricValue('usd', 0.0422)).toBe('$0.042');
    expect(formatMetricValue('tokens', 119_550)).toBe('119.5k');
    expect(formatMetricValue('multiplier', 1.439)).toBe('1.44×');
    expect(formatMetricValue('count', 4.4)).toBe('4');
  });
});

describe('diffPlanTasks', () => {
  const base = fixtureRun().plan;
  if (base === undefined) throw new Error('fixture run has no plan');

  test('matches by key and finds added and removed tasks', () => {
    const changed: Plan = { ...base, tasks: base.tasks.filter((task) => task.key !== 'help-overlay') };
    const withExtra: Plan = { ...changed, tasks: [...changed.tasks, spec('a11y-audit')] };
    const diff = diffPlanTasks(changed, withExtra);
    expect(diff.added.map((task) => task.key)).toEqual(['a11y-audit']);
    expect(diff.removed).toEqual([]);

    const reverse = diffPlanTasks(withExtra, changed);
    expect(reverse.removed.map((task) => task.key)).toEqual(['a11y-audit']);
  });

  test('reports every changed field', () => {
    const original = spec('a');
    const changed: TaskSpec = {
      ...original,
      title: 'New title',
      lane: { owns: ['src/other/**'], reads: ['src/other.ts'] },
      dependsOn: ['b'],
      estimateMin: 42,
      deliverables: ['something else'],
    };
    const diff = diffPlanTasks({ ...base, tasks: [original] }, { ...base, tasks: [changed] });
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0]?.fields).toEqual([
      'title',
      'lane.owns',
      'lane.reads',
      'dependsOn',
      'estimateMin',
      'deliverables',
    ]);
    expect(diff.same).toEqual([]);
  });

  test('list order is not a change', () => {
    const original = spec('a', { dependsOn: ['x', 'y'], lane: { owns: ['b/**', 'a/**'], reads: [] } });
    const reordered = spec('a', { dependsOn: ['y', 'x'], lane: { owns: ['a/**', 'b/**'], reads: [] } });
    const diff = diffPlanTasks({ ...base, tasks: [original] }, { ...base, tasks: [reordered] });
    expect(diff.changed).toEqual([]);
    expect(diff.same).toEqual(['a']);
  });

  test('an unchanged plan is all "same"', () => {
    const diff = diffPlanTasks(base, structuredClone(base));
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.changed).toEqual([]);
    expect(diff.same).toHaveLength(base.tasks.length);
  });

  test('missing plans degrade to added/removed instead of throwing', () => {
    expect(diffPlanTasks(undefined, undefined)).toEqual({ added: [], removed: [], changed: [], same: [] });
    expect(diffPlanTasks(undefined, base).added).toHaveLength(base.tasks.length);
    expect(diffPlanTasks(base, undefined).removed).toHaveLength(base.tasks.length);
  });
});

describe('nodeTaskCounts', () => {
  test('counts tasks per node, hub first, with display names', () => {
    const run = fixtureRun();
    const counts = nodeTaskCounts(run, { hub: 'MacBook Pro', air: 'M2 Air' });
    expect(counts[0]).toEqual({ nodeId: 'hub', name: 'MacBook Pro', count: 5 });
    expect(counts[1]).toEqual({ nodeId: 'air', name: 'M2 Air', count: 2 });
  });

  test('unassigned tasks get their own bucket', () => {
    const counts = nodeTaskCounts(makeRun({ tasks: { a: task('a') } }));
    expect(counts).toEqual([{ nodeId: 'unassigned', name: 'unassigned', count: 1 }]);
  });
});
