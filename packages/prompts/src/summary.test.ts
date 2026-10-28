import { describe, expect, test } from 'bun:test';
import type { Run, TaskRun } from '@starling/core';
import { emptyMetrics } from '@starling/core';
import { makeAuditVerdict, makePlan, makeRun, makeTaskRun } from '@starling/core/testing';
import { buildRunSummaryPrompt, explainFacts, renderRunSummaryFacts } from './index.ts';
import { skyTodoGoal, skyTodoPlan } from './testing/context.ts';

function fixtureRun(overrides: Partial<Run> = {}): Run {
  const plan = skyTodoPlan();
  const tasks: Record<string, TaskRun> = {};
  for (const task of plan.tasks) {
    tasks[task.key] = makeTaskRun({ taskKey: task.key, status: 'merged', attempts: 1 });
  }
  const run = makeRun({
    goal: skyTodoGoal(),
    plan,
    tasks,
    status: 'finished',
    startedAt: 1_731_000_000_000,
    finishedAt: 1_731_000_356_000,
    metrics: {
      ...emptyMetrics(),
      tasksMerged: 7,
      apiUsage: { input: 12_345, output: 4_321, cached: 100 },
      apiCostUsd: 0.0422,
      estSavedUsd: 0.0185,
      localCallCount: 210,
      elapsedMs: 356_000,
    },
  });
  return { ...run, ...overrides };
}

describe('renderRunSummaryFacts', () => {
  const run = fixtureRun();
  const facts = explainFacts(skyTodoPlan(), { tasks: run.tasks });

  test('always returns between five and eight bullet facts', () => {
    const bulletFacts = renderRunSummaryFacts({ run, facts });
    expect(bulletFacts.length).toBeGreaterThanOrEqual(5);
    expect(bulletFacts.length).toBeLessThanOrEqual(8);
    for (const fact of bulletFacts) expect(fact.startsWith('**')).toBe(true);
  });

  test('states the outcome and the goal', () => {
    const [outcome] = renderRunSummaryFacts({ run, facts });
    expect(outcome).toContain('**Outcome:** success');
    expect(outcome).toContain('Add dark mode with a toggle');
  });

  test('counts merged and failed tasks', () => {
    const text = renderRunSummaryFacts({ run, facts }).join('\n');
    expect(text).toContain('**Tasks:** 7/7 merged · 0 failed · 0 conflict · 0 cancelled');
  });

  test('formats wall time and the plan estimates deterministically', () => {
    const text = renderRunSummaryFacts({ run, facts }).join('\n');
    expect(text).toContain('**Time:** 5m 56s wall · 91 min serial estimate · 30 min in parallel');
  });

  test('states the critical path', () => {
    const text = renderRunSummaryFacts({ run, facts }).join('\n');
    expect(text).toContain('**Critical path:** `dates-fix` → `due-badges` (25 min)');
  });

  test('formats cost, tokens and savings without locale formatting', () => {
    const text = renderRunSummaryFacts({ run, facts }).join('\n');
    expect(text).toContain('$0.0422 API');
    expect(text).toContain('12,345 in / 4,321 out');
    expect(text).toContain('100 cached');
    expect(text).toContain('210 local calls');
    expect(text).toContain('$0.0185 saved');
  });

  test('says when nothing failed', () => {
    const text = renderRunSummaryFacts({ run, facts }).join('\n');
    expect(text).toContain('**Failures:** none.');
  });

  test('falls back to lane coverage when there are no highlights', () => {
    const text = renderRunSummaryFacts({ run, facts }).join('\n');
    expect(text).toContain('**Lanes:** 9 owned glob(s) across 7 task(s).');
  });

  test('uses highlights when given and caps a long list', () => {
    const text = renderRunSummaryFacts({
      run,
      facts,
      highlights: ['search migrated air → hub', 'theme fixed on attempt 2', 'both perches online', 'one'],
    }).join('\n');
    expect(text).toContain('**Highlights:** search migrated air → hub');
    expect(text).not.toContain('**Lanes:**');

    const long = renderRunSummaryFacts({
      run,
      facts,
      highlights: ['a', 'b', 'c', 'd', 'e'],
    }).join('\n');
    expect(long).toContain('…and 1 more');
  });

  test('reports failures with their verdict summaries', () => {
    const tasks = { ...run.tasks };
    tasks.theme = makeTaskRun({
      taskKey: 'theme',
      status: 'failed',
      attempts: 2,
      lastVerdict: makeAuditVerdict({
        taskKey: 'theme',
        pass: false,
        summary: 'The toggle is not tested',
        laneViolations: ['src/main.ts'],
      }),
    });
    const failedRun = fixtureRun({ tasks, status: 'finished' });
    const failedFacts = explainFacts(skyTodoPlan(), { tasks });
    const text = renderRunSummaryFacts({ run: failedRun, facts: failedFacts }).join('\n');
    expect(text).toContain('**Tasks:** 6/7 merged · 1 failed');
    expect(text).toContain('**Failures:** `theme` (failed) — The toggle is not tested');
    expect(text).toContain('**Outcome:** partial');
  });

  test('caps a long failure list', () => {
    const specs = ['a', 'b', 'c', 'd', 'e'].map((key) => ({
      key,
      title: key,
      goal: key,
      deliverables: [],
      outOfScope: [],
      definitionOfDone: [],
      dependsOn: [],
      lane: { owns: [`src/${key}/**`], reads: [] },
      estimateMin: 1,
    }));
    const fullPlan = makePlan({ tasks: specs });
    const tasks: Record<string, TaskRun> = {};
    for (const spec of fullPlan.tasks) {
      tasks[spec.key] = makeTaskRun({
        taskKey: spec.key,
        status: 'failed',
        attempts: 1,
        lastVerdict: makeAuditVerdict({ taskKey: spec.key, pass: false, summary: `${spec.key} broke` }),
      });
    }
    const failedRun = fixtureRun({ plan: fullPlan, tasks, status: 'failed' });
    const failedFacts = explainFacts(fullPlan, { tasks });
    const text = renderRunSummaryFacts({ run: failedRun, facts: failedFacts }).join('\n');
    expect(text).toContain('…and 2 more');
  });

  test('handles a run that has not finished', () => {
    const running = fixtureRun({ status: 'running', finishedAt: undefined });
    const text = renderRunSummaryFacts({ run: running, facts }).join('\n');
    expect(text).toContain('**Time:** still running');
    expect(text).toContain('**Outcome:** in flight');
  });

  test('handles a cancelled run with no tasks', () => {
    const emptyPlan = makePlan({ tasks: [] });
    const emptyRun = makeRun({
      goal: skyTodoGoal(),
      plan: emptyPlan,
      tasks: {},
      status: 'cancelled',
      startedAt: 1_731_000_000_000,
    });
    const emptyFacts = explainFacts(emptyPlan, { tasks: {} });
    const text = renderRunSummaryFacts({ run: emptyRun, facts: emptyFacts }).join('\n');
    expect(text).toContain('**Outcome:** cancelled');
    expect(text).toContain('**Tasks:** 0/0 merged');
    expect(text).toContain('**Critical path:** none');
  });

  test('is deterministic and does not mutate the run', () => {
    const before = JSON.stringify(run);
    expect(renderRunSummaryFacts({ run, facts })).toEqual(renderRunSummaryFacts({ run, facts }));
    expect(JSON.stringify(run)).toBe(before);
  });
});

describe('buildRunSummaryPrompt', () => {
  const run = fixtureRun();
  const facts = explainFacts(skyTodoPlan(), { tasks: run.tasks });

  test('asks for a grounded report and includes the fact bullets', () => {
    const prompt = buildRunSummaryPrompt({ run, facts });
    expect(prompt.system).toContain('never invent');
    expect(prompt.user).toContain('FACTS');
    for (const fact of renderRunSummaryFacts({ run, facts })) {
      expect(prompt.user).toContain(fact);
    }
  });

  test('includes the goal, the plan summary and highlights', () => {
    const prompt = buildRunSummaryPrompt({
      run,
      facts,
      highlights: ['search migrated air → hub'],
    });
    expect(prompt.user).toContain(run.goal.text);
    expect(prompt.user).toContain('Seven lane-disjoint tasks');
    expect(prompt.user).toContain('HIGHLIGHTS');
    expect(prompt.user).toContain('search migrated air → hub');
  });

  test('is deterministic', () => {
    expect(buildRunSummaryPrompt({ run, facts })).toEqual(buildRunSummaryPrompt({ run, facts }));
  });
});
