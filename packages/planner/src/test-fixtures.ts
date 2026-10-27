/**
 * Test-only helpers. Not exported from `index.ts`: production code never needs fixture files.
 */
import { readFileSync } from 'node:fs';
import type { Plan, RepoMap, TaskSpec } from '@starling/core';
import { makePlan } from '@starling/core/testing';
import type { PlanDraft } from './draft';

function fixturePath(relative: string): URL {
  return new URL(`../../../fixtures/${relative}`, import.meta.url);
}

export function loadPlanFixture(): Plan {
  return JSON.parse(readFileSync(fixturePath('plans/sky-todo-launch-day.json'), 'utf8')) as Plan;
}

export function loadRepoMapFixture(): RepoMap {
  return JSON.parse(readFileSync(fixturePath('repomaps/sky-todo.json'), 'utf8')) as RepoMap;
}

export function loadDraftFixture(): PlanDraft {
  const plan = loadPlanFixture();
  return {
    summary: plan.summary,
    lockedDecisions: plan.lockedDecisions,
    tasks: plan.tasks,
  };
}

/** A small, valid task: unique feature folder, test-bearing DoD, sensible estimate. */
export function task(key: string, overrides: Partial<TaskSpec> = {}): TaskSpec {
  return {
    key,
    title: `Task ${key}`,
    goal: `Implement ${key} end to end.`,
    deliverables: [`src/features/${key}/index.ts`],
    outOfScope: ['src/main.ts'],
    definitionOfDone: ['bun test passes', `${key} behaviour is asserted`],
    dependsOn: [],
    lane: { owns: [`src/features/${key}/**`], reads: ['src/main.ts'] },
    estimateMin: 10,
    ...overrides,
  };
}

export function planOf(tasks: TaskSpec[], overrides: Partial<Plan> = {}): Plan {
  return makePlan({ ...overrides, tasks });
}

export function draftOf(tasks: TaskSpec[], summary = 'a small plan'): PlanDraft {
  return { summary, lockedDecisions: ['Vanilla TypeScript, bun test'], tasks };
}
