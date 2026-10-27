/**
 * The guarantee that makes the planner trustworthy, tested over 200 seeded random plans:
 *
 * for any plan a model can emit — cycles, dangling deps, duplicate keys, empty lanes, empty DoDs,
 * overlapping concurrent lanes — `plan()` returns a plan with zero error-level issues.
 *
 * A tiny mulberry32 PRNG keeps it deterministic; the seed is printed in the assertion object when
 * a case fails. No network, no LLM: `MockLLM` replays the generated draft.
 */
import { describe, expect, test } from 'bun:test';
import type { PlanIssue, TaskSpec } from '@starling/core';
import { FakeClock, globsOverlap } from '@starling/core';
import { MockLLM, makeGoal } from '@starling/core/testing';
import type { PlanDraft } from './draft';
import { buildDepGraph, canRunConcurrently } from './graph';
import { createPlanner } from './planner';
import { loadRepoMapFixture, planOf, task } from './test-fixtures';
import { validatePlan } from './validate';

const CASES = 200;
const MODEL = { provider: 'local', model: 'fuzz-model' };
const DIRS = [
  'src/features/alpha/**',
  'src/features/beta/**',
  'src/features/gamma/**',
  'src/shared/**',
  'src/ui/styles.css',
  'docs/notes/**',
];

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function randomDraft(seed: number): PlanDraft {
  const random = mulberry32(seed);
  const count = 1 + Math.floor(random() * 7);
  const keys = Array.from({ length: count }, (_, index) => `t${index}`);
  const pick = <T>(values: T[]): T => values[Math.floor(random() * values.length)] as T;

  const tasks: TaskSpec[] = keys.map((key, index) => {
    // The first task is always executable, so repair can never empty the plan and plan() never
    // legitimately throws. Everything after it is deliberately hostile.
    if (index === 0) {
      return task('t0', {
        lane: { owns: ['src/features/alpha/**'], reads: [] },
        definitionOfDone: ['bun test passes'],
        dependsOn: [],
        estimateMin: 10,
      });
    }

    const owns: string[] = [];
    if (random() < 0.85) owns.push(pick(DIRS));
    if (random() < 0.35) owns.push(pick(DIRS));

    const deps: string[] = [];
    const depCount = Math.floor(random() * 3);
    const depPool = [...keys, 'ghost'];
    for (let i = 0; i < depCount; i += 1) deps.push(pick(depPool));

    return task(random() < 0.06 ? '' : key, {
      lane: { owns: random() < 0.08 ? [] : owns, reads: ['src/main.ts'] },
      definitionOfDone: random() < 0.08 ? [] : ['bun test passes', 'behaviour is asserted'],
      dependsOn: deps,
      estimateMin: 5 + Math.floor(random() * 50),
    });
  });

  return {
    summary: `fuzz plan ${seed}`,
    lockedDecisions: ['Vanilla TypeScript, bun test'],
    tasks,
  };
}

function errorsIn(issues: PlanIssue[]): PlanIssue[] {
  return issues.filter((issue) => issue.severity === 'error');
}

describe('deterministic-repair guarantee', () => {
  test(`${CASES} seeded random plans all come back executable`, async () => {
    const map = loadRepoMapFixture();
    const goal = makeGoal({ id: 'goal-fuzz', text: 'Fuzz the planner', repoPath: map.root });

    for (let index = 0; index < CASES; index += 1) {
      const seed = 10_000 + index;
      const draft = randomDraft(seed);
      const llm = new MockLLM({
        responder: () => ({ text: JSON.stringify(draft) }),
        model: MODEL,
      });
      const planner = createPlanner({
        llm,
        clock: new FakeClock(1_700_000_000_000 + index),
        maxRepairs: 0,
        minTasks: 1,
        maxTasks: 12,
      });

      const { plan, issues } = await planner.plan(goal, map);
      const remaining = validatePlan(plan, { map, minTasks: 1, maxTasks: 12 });

      expect({ seed, plan: errorsIn(issues), validate: errorsIn(remaining) }).toEqual({
        seed,
        plan: [],
        validate: [],
      });
      expect(plan.tasks.length).toBeGreaterThan(0);
    }
  });

  test('the repair pass also settles plans the model was allowed to retry', async () => {
    const map = loadRepoMapFixture();
    const draft = randomDraft(99);
    const llm = new MockLLM({ responder: () => ({ text: JSON.stringify(draft) }), model: MODEL });
    const planner = createPlanner({ llm, maxRepairs: 2, minTasks: 1 });

    const { plan } = await planner.plan(makeGoal(), map);

    expect(errorsIn(validatePlan(plan, { map, minTasks: 1 }))).toEqual([]);
  });
});

describe('validator property: lane-overlap is exactly concurrent overlap', () => {
  test('across 50 generated DAGs the reported pairs match an independent check', () => {
    const random = mulberry32(4_242);
    const pick = <T>(values: T[]): T => values[Math.floor(random() * values.length)] as T;

    for (let caseIndex = 0; caseIndex < 50; caseIndex += 1) {
      const count = 2 + Math.floor(random() * 5);
      const keys = Array.from({ length: count }, (_, index) => `p${index}`);
      // Dependencies only ever point at an earlier task, so the generated DAG is acyclic by design.
      const tasks: TaskSpec[] = keys.map((key, index) =>
        task(key, {
          lane: { owns: [pick(DIRS), ...(random() < 0.4 ? [pick(DIRS)] : [])], reads: [] },
          dependsOn: index > 0 && random() < 0.4 ? [keys[Math.floor(random() * index)] as string] : [],
          definitionOfDone: ['bun test passes'],
          estimateMin: 10,
        }),
      );

      const graph = buildDepGraph(tasks);
      const expected: string[] = [];
      for (let i = 0; i < tasks.length; i += 1) {
        for (let j = i + 1; j < tasks.length; j += 1) {
          const a = tasks[i] as TaskSpec;
          const b = tasks[j] as TaskSpec;
          if (!canRunConcurrently(graph, a.key, b.key)) continue;
          if (globsOverlap(a.lane.owns, b.lane.owns).length === 0) continue;
          expected.push([a.key, b.key].sort().join('|'));
        }
      }

      const actual = validatePlan(planOf(tasks), { minTasks: 1 })
        .filter((issue) => issue.code === 'lane-overlap')
        .map((issue) => [...issue.taskKeys].sort().join('|'))
        .sort();

      expect({ caseIndex, actual }).toEqual({ caseIndex, actual: expected.sort() });
    }
  });
});
