import { describe, expect, test } from 'bun:test';
import type { Plan, TaskRun, TaskSpec } from '@starling/core';
import { makeAuditVerdict, makePlan, makeTaskRun, makeTaskSpec } from '@starling/core/testing';
import { buildExplainPrompt, explainFacts, renderExplainFacts } from './index.ts';
import { skyTodoPlan } from './testing/context.ts';

function planWith(tasks: TaskSpec[]): Plan {
  return makePlan({ tasks });
}

function task(key: string, dependsOn: string[] = [], estimateMin = 10): TaskSpec {
  return makeTaskSpec({
    key,
    title: key,
    dependsOn,
    estimateMin,
    lane: { owns: [`src/${key}/**`], reads: [] },
  });
}

function taskRuns(plan: Plan, overrides: Record<string, Partial<TaskRun>> = {}): Record<string, TaskRun> {
  const runs: Record<string, TaskRun> = {};
  for (const spec of plan.tasks) {
    runs[spec.key] = makeTaskRun({ taskKey: spec.key, status: 'merged', attempts: 1 });
  }
  for (const [key, override] of Object.entries(overrides)) {
    runs[key] = { ...(runs[key] ?? makeTaskRun({ taskKey: key })), ...override };
  }
  return runs;
}

describe('explainFacts — the sky-todo fixture', () => {
  const plan = skyTodoPlan();
  const facts = explainFacts(plan);

  test('finds two waves of parallel work', () => {
    expect(facts.waves).toEqual([
      ['csv-export', 'dates-fix', 'search', 'shortcuts', 'theme'],
      ['due-badges', 'help-overlay'],
    ]);
    expect(facts.taskCount).toBe(7);
    expect(facts.cyclic).toEqual([]);
  });

  test('sums serial and ideal-parallel minutes from estimateMin', () => {
    expect(facts.serialMinutes).toBe(91);
    expect(facts.parallelMinutes).toBe(30);
  });

  test('names the critical path and marks its tasks', () => {
    expect(facts.criticalPath).toEqual({ keys: ['dates-fix', 'due-badges'], minutes: 25 });
    const onPath = facts.tasks.filter((task) => task.onCriticalPath).map((task) => task.key);
    expect(onPath).toEqual(['due-badges', 'dates-fix']);
  });

  test('maps every owned glob to its task, sorted', () => {
    expect(facts.laneOwners['src/features/theme/**']).toEqual(['theme']);
    expect(facts.laneOwners['src/lib/dates.ts']).toEqual(['dates-fix']);
    expect(facts.laneOwners['src/ui/styles.css']).toEqual(['theme']);
    expect(Object.keys(facts.laneOwners)).toEqual([...Object.keys(facts.laneOwners)].sort());
    expect(Object.keys(facts.laneOwners)).toHaveLength(9);
  });

  test('assigns a level to every task', () => {
    for (const task of facts.tasks) {
      const expected = facts.waves.findIndex((wave) => wave.includes(task.key));
      expect(task.level).toBe(expected);
    }
  });

  test('is deterministic and does not mutate the plan', () => {
    const before = JSON.stringify(plan);
    expect(explainFacts(plan)).toEqual(facts);
    expect(JSON.stringify(plan)).toBe(before);
  });
});

describe('explainFacts — outcome', () => {
  const plan = planWith([task('a'), task('b', ['a']), task('c')]);

  test('counts merged, failed, conflicted and cancelled tasks', () => {
    const facts = explainFacts(plan, {
      tasks: taskRuns(plan, {
        b: { status: 'failed', attempts: 2 },
        c: { status: 'conflict', attempts: 1 },
      }),
    });
    expect(facts.outcome?.merged).toBe(1);
    expect(facts.outcome?.failed).toBe(1);
    expect(facts.outcome?.conflicted).toBe(1);
    expect(facts.outcome?.cancelled).toBe(0);
    expect(facts.outcome?.statuses).toEqual({ a: 'merged', b: 'failed', c: 'conflict' });
  });

  test('carries the last verdict summary and lane violations for a failure', () => {
    const verdict = makeAuditVerdict({
      taskKey: 'b',
      pass: false,
      summary: 'The new test never runs',
      fixInstructions: 'Wire the test into the suite',
      laneViolations: ['src/main.ts'],
    });
    const facts = explainFacts(plan, {
      tasks: taskRuns(plan, { b: { status: 'failed', attempts: 2, lastVerdict: verdict } }),
    });
    expect(facts.outcome?.failures).toEqual([
      {
        taskKey: 'b',
        status: 'failed',
        attempts: 2,
        summary: 'The new test never runs',
        fixInstructions: 'Wire the test into the suite',
        laneViolations: ['src/main.ts'],
      },
    ]);
  });

  test('a failed attempt that was later fixed is not a failure', () => {
    const failedAttempt = makeAuditVerdict({ taskKey: 'a', pass: false, summary: 'First try failed' });
    const facts = explainFacts(plan, {
      tasks: taskRuns(plan, { a: { status: 'merged', attempts: 2, lastVerdict: failedAttempt } }),
    });
    expect(facts.outcome?.failures).toEqual([]);
    expect(facts.outcome?.merged).toBe(3);
  });

  test('copies merge results in order', () => {
    const merge = {
      taskKey: 'a',
      status: 'merged' as const,
      conflictedFiles: [],
      detail: 'fast-forward',
      ts: 1,
    };
    const facts = explainFacts(plan, { tasks: taskRuns(plan), merges: [merge] });
    expect(facts.outcome?.merges).toEqual([merge]);
  });

  test('a run record with no status is treated as pending', () => {
    const facts = explainFacts(plan, { tasks: { a: makeTaskRun({ taskKey: 'a' }) } });
    expect(facts.outcome?.statuses).toEqual({ a: 'pending', b: 'pending', c: 'pending' });
  });
});

describe('explainFacts — degraded plans', () => {
  test('handles an empty plan', () => {
    const facts = explainFacts(planWith([]));
    expect(facts.waves).toEqual([]);
    expect(facts.criticalPath).toEqual({ keys: [], minutes: 0 });
    expect(facts.serialMinutes).toBe(0);
    expect(facts.parallelMinutes).toBe(0);
    expect(facts.laneOwners).toEqual({});
  });

  test('ignores a dependency that is not in the plan', () => {
    const facts = explainFacts(planWith([task('a', ['ghost'])]));
    expect(facts.waves).toEqual([['a']]);
    expect(facts.cyclic).toEqual([]);
  });

  test('reports a cycle instead of looping, and still explains it', () => {
    const facts = explainFacts(planWith([task('a', ['b']), task('b', ['a']), task('c')]));
    expect(facts.waves[0]).toEqual(['c']);
    expect(facts.cyclic).toEqual(['a', 'b']);
    expect(facts.waves.at(-1)).toEqual(['a', 'b']);
    expect(facts.tasks.find((task) => task.key === 'a')?.level).toBe(1);
  });

  test('a self-dependency is a cycle', () => {
    const facts = explainFacts(planWith([task('a', ['a'])]));
    expect(facts.cyclic).toEqual(['a']);
  });

  test('breaks critical-path ties by the lexicographically smaller path', () => {
    const facts = explainFacts(planWith([task('b'), task('a'), task('c', ['a']), task('d', ['b'])]));
    expect(facts.criticalPath.minutes).toBe(20);
    expect(facts.criticalPath.keys).toEqual(['a', 'c']);
  });

  test('a single task is its own wave and critical path', () => {
    const facts = explainFacts(planWith([task('solo', [], 7)]));
    expect(facts.waves).toEqual([['solo']]);
    expect(facts.criticalPath).toEqual({ keys: ['solo'], minutes: 7 });
    expect(facts.parallelMinutes).toBe(7);
  });
});

describe('renderExplainFacts and buildExplainPrompt', () => {
  const facts = explainFacts(skyTodoPlan(), {
    tasks: taskRuns(skyTodoPlan(), {
      theme: {
        status: 'failed',
        attempts: 2,
        lastVerdict: makeAuditVerdict({ taskKey: 'theme', pass: false, summary: 'Toggle not tested' }),
      },
    }),
  });

  test('renders waves, path, lanes and failures without JavaScript artefacts', () => {
    const text = renderExplainFacts(facts);
    expect(text).toContain('Plan: Seven lane-disjoint tasks');
    expect(text).toContain('Wave 1 (5): `csv-export`, `dates-fix`, `search`, `shortcuts`, `theme`');
    expect(text).toContain('Wave 2 (2): `due-badges`, `help-overlay`');
    expect(text).toContain('Critical path: `dates-fix` → `due-badges` (25 min)');
    expect(text).toContain('`src/lib/dates.ts` → `dates-fix`');
    expect(text).toContain('Failure `theme` (failed, attempt 2) — Toggle not tested');
    expect(text).not.toContain('undefined');
    expect(text).not.toContain('NaN');
  });

  test('the plan prompt asks for a briefing grounded in the facts', () => {
    const prompt = buildExplainPrompt(facts);
    expect(prompt.system).toContain('explaining a plan');
    expect(prompt.system).toContain('Never invent');
    expect(prompt.user).toContain('FACTS');
    expect(prompt.user).toContain('critical one');
    expect(prompt.user).toContain(renderExplainFacts(facts));
  });

  test('the run prompt asks for what happened', () => {
    const prompt = buildExplainPrompt(facts, 'run');
    expect(prompt.system).toContain('finished run');
    expect(prompt.user).toContain('what failed');
    expect(prompt.user).toContain('Outcome:');
  });

  test('both prompts are deterministic', () => {
    expect(buildExplainPrompt(facts)).toEqual(buildExplainPrompt(facts));
    expect(buildExplainPrompt(facts, 'run')).toEqual(buildExplainPrompt(facts, 'run'));
  });
});
