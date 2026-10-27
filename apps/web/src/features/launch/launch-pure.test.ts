import { describe, expect, test } from 'bun:test';
import type { PlanIssue } from '@starling/core';
import { BASE_TS, makeGoal, makePlan, makeRun, makeTaskRun, makeTaskSpec } from '@starling/core/testing';
import {
  budgetUsedPercent,
  estimateMinutes,
  estimatePlanCostUsd,
  estimateWidth,
  planDepths,
} from './estimate';
import { fixturePlan } from './fixtures';
import {
  applyGoal,
  DEFAULT_FORM,
  editedGoal,
  goalError,
  hasErrors,
  initialFormValues,
  requestKey,
  toLaunchInput,
  validateForm,
} from './form';
import { repoName, runHistory, runStatusLabel, summarizeRun } from './history';
import { dependsOn, findLaneOverlaps, overlapReport } from './overlap';

const VALID_FORM = {
  repoPath: 'examples/sky-todo',
  goal: 'Add dark mode with a toggle',
  maxParallel: '4',
  budgetUsd: '3',
  dryRun: false,
};

describe('launch form', () => {
  test('starts from the most recent repo and the config defaults', () => {
    const values = initialFormValues(['', 'examples/sky-todo']);
    expect(values.repoPath).toBe('examples/sky-todo');
    expect(values.maxParallel).toBe('8');
    expect(values.budgetUsd).toBe('5');
    expect(values.dryRun).toBe(false);
    expect(initialFormValues([])).toEqual(DEFAULT_FORM);
  });

  test('requires a repo and a goal with enough detail', () => {
    const errors = validateForm({ ...VALID_FORM, repoPath: '   ', goal: 'dark' });
    expect(errors.repoPath).toBeDefined();
    expect(errors.goal).toContain('at least 10');
    expect(validateForm({ ...VALID_FORM, goal: '   ' }).goal).toContain('Tell the flock');
    expect(hasErrors(validateForm(VALID_FORM))).toBe(false);
  });

  test('rejects non-integer / out-of-range parallelism and budgets', () => {
    expect(validateForm({ ...VALID_FORM, maxParallel: '2.5' }).maxParallel).toContain('Whole numbers');
    expect(validateForm({ ...VALID_FORM, maxParallel: '0' }).maxParallel).toContain('At least one');
    expect(validateForm({ ...VALID_FORM, maxParallel: '65' }).maxParallel).toContain('64');
    expect(validateForm({ ...VALID_FORM, maxParallel: '' }).maxParallel).toBeDefined();
    expect(validateForm({ ...VALID_FORM, budgetUsd: '' }).budgetUsd).toBeDefined();
    expect(validateForm({ ...VALID_FORM, budgetUsd: '-1' }).budgetUsd).toContain('negative');
    expect(validateForm({ ...VALID_FORM, budgetUsd: '1001' }).budgetUsd).toContain('mortgage');
    expect(validateForm({ ...VALID_FORM, budgetUsd: '0' }).budgetUsd).toBeUndefined();
  });

  test('builds a trimmed StartRunInput and omits dryRun when it is off', () => {
    expect(toLaunchInput({ ...VALID_FORM, repoPath: ' examples/sky-todo ', goal: '  ship it  ' })).toEqual({
      repoPath: 'examples/sky-todo',
      goal: 'ship it',
      maxParallel: 4,
      budgetUsd: 3,
    });
    expect(toLaunchInput({ ...VALID_FORM, dryRun: true }).dryRun).toBe(true);
  });

  test('the request key changes with the inputs, and a chip marks itself selected', () => {
    const chip = applyGoal(DEFAULT_FORM, { name: 'quick-wins', text: VALID_FORM.goal });
    expect(chip.goalName).toBe('quick-wins');
    expect(requestKey(chip)).toBe(requestKey({ ...chip }));
    expect(requestKey(chip)).not.toBe(requestKey({ ...chip, goal: 'something else entirely' }));
    expect(requestKey(chip)).toBe(requestKey({ ...chip, maxParallel: '9', budgetUsd: '12' }));
    expect(editedGoal(chip, 'something else').goalName).toBeUndefined();
    expect(goalError('short')).toBeDefined();
  });
});

describe('plan estimates', () => {
  test('prices worker attempts and the planner call at the plan model', () => {
    const plan = makePlan({ tasks: [makeTaskSpec(), makeTaskSpec({ key: 'search' })] });
    const cost = estimatePlanCostUsd(plan);
    expect(cost).toBeGreaterThan(0.01);
    expect(cost).toBeLessThan(1);
    // A local model in the price table costs nothing.
    const local = makePlan({ model: { provider: 'ollama', model: 'qwen3.6:35b-a3b' } });
    expect(estimatePlanCostUsd(local)).toBe(0);
  });

  test('measures DAG depth, wall clock and width', () => {
    const plan = fixturePlan('Add dark mode with a toggle');
    const depths = planDepths(plan);
    expect(depths.get('shortcuts')).toBe(1);
    expect(depths.get('help-overlay')).toBe(2);
    expect(depths.get('due-badges')).toBe(2);
    // Five tasks at depth 1 (max 12) plus two at depth 2 (max 10).
    expect(estimateMinutes(plan)).toBe(22);
    expect(estimateWidth(plan)).toBe(5);
  });

  test('handles an empty plan and a budget share', () => {
    const empty = makePlan({ tasks: [] });
    expect(planDepths(empty).size).toBe(0);
    expect(estimateMinutes(empty)).toBe(0);
    expect(estimateWidth(empty)).toBe(0);
    expect(budgetUsedPercent(0.5, 5)).toBe(10);
    expect(budgetUsedPercent(10, 5)).toBe(100);
    expect(budgetUsedPercent(1, 0)).toBe(0);
  });
});

describe('lane overlap preview', () => {
  test('is clear when concurrent lanes are disjoint', () => {
    const plan = fixturePlan('Add dark mode with a toggle');
    const report = overlapReport(plan);
    expect(report.overlaps).toEqual([]);
    expect(report.clear).toBe(true);
  });

  test('flags two concurrent tasks writing the same file', () => {
    const plan = fixturePlan('sort by due date');
    const report = overlapReport(plan);
    expect(report.concurrent).toHaveLength(1);
    expect(report.concurrent[0]?.globs.join(' ')).toContain('src/ui/render.ts');
    expect(report.clear).toBe(false);
    expect(findLaneOverlaps(plan)[0]?.a).toBe('date-sort');
  });

  test('a shared lane across a dependency edge is a hand-off, not a conflict', () => {
    const plan = makePlan({
      tasks: [
        makeTaskSpec({ key: 'a', lane: { owns: ['src/ui/render.ts'], reads: [] } }),
        makeTaskSpec({
          key: 'b',
          dependsOn: ['a'],
          lane: { owns: ['src/ui/render.ts'], reads: [] },
        }),
      ],
    });
    expect(dependsOn(plan, 'b', 'a')).toBe(true);
    expect(dependsOn(plan, 'a', 'b')).toBe(false);
    const report = overlapReport(plan);
    expect(report.overlaps).toHaveLength(1);
    expect(report.overlaps[0]?.concurrent).toBe(false);
    expect(report.clear).toBe(true);
  });

  test('validator errors block "clear" even without a glob collision', () => {
    const issue: PlanIssue = {
      severity: 'error',
      code: 'cycle',
      message: 'a and b point at each other',
      taskKeys: ['a', 'b'],
    };
    const report = overlapReport(fixturePlan('Add dark mode with a toggle'), [issue]);
    expect(report.errorCount).toBe(1);
    expect(report.clear).toBe(false);
  });
});

describe('run history', () => {
  const goal = makeGoal({ text: 'Ship dark mode', repoPath: '/tmp/sky-todo', createdAt: BASE_TS });

  test('summarises merged, failed, cost and duration', () => {
    const run = makeRun({
      id: 'run_1',
      goal,
      status: 'finished',
      startedAt: BASE_TS,
      finishedAt: BASE_TS + 125_000,
      tasks: {
        theme: makeTaskRun({ taskKey: 'theme', status: 'merged' }),
        search: makeTaskRun({ taskKey: 'search', status: 'failed' }),
        help: makeTaskRun({ taskKey: 'help', status: 'pending' }),
      },
    });
    const summary = summarizeRun(run, BASE_TS + 999_999);
    expect(summary).toMatchObject({
      id: 'run_1',
      repoName: 'sky-todo',
      statusLabel: 'Finished',
      total: 3,
      merged: 1,
      failed: 1,
      active: 1,
      durationMs: 125_000,
    });
    expect(summary.planSummary).toBe(run.plan?.summary ?? '');
    expect(summary.tone).toBe('success');
  });

  test('a live run measures to now, and an empty task map falls back to the plan', () => {
    const run = makeRun({ goal, status: 'running', startedAt: BASE_TS, tasks: {} });
    const summary = summarizeRun(run, BASE_TS + 60_000);
    expect(summary.durationMs).toBe(60_000);
    expect(summary.total).toBe(run.plan?.tasks.length ?? 0);
    expect(runStatusLabel('running')).toBe('Flying');
  });

  test('sorts newest first and labels every status', () => {
    const older = makeRun({ id: 'older', goal, startedAt: BASE_TS });
    const newer = makeRun({ id: 'newer', goal, startedAt: BASE_TS + 10_000 });
    expect(runHistory([older, newer], BASE_TS + 30_000).map((run) => run.id)).toEqual(['newer', 'older']);
    expect(runStatusLabel('mapping')).toBe('Mapping the repo');
    expect(repoName('/Users/m/Code/sky-todo/')).toBe('sky-todo');
    expect(repoName('C:\\demo\\sky-todo')).toBe('sky-todo');
  });
});
