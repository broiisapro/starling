/**
 * Shared test data for this package. Not exported from `src/index.ts`: it is only used by the
 * colocated tests, and it reads the same committed fixtures the rest of the repo validates.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AuditVerdict, Goal, MergeResult, Plan, PromptContext, RepoMap } from '@starling/core';
import { PlanSchema, RepoMapSchema } from '@starling/core';

const FIXTURES = join(import.meta.dir, '../../../../fixtures');

/** The branch prefix used by the recorded launch-day run. */
export const SKY_TODO_BRANCH = 'starling/9w0x1y';

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(join(FIXTURES, path), 'utf8')) as T;
}

export function skyTodoPlan(): Plan {
  return PlanSchema.parse(readJson('plans/sky-todo-launch-day.json'));
}

export function skyTodoMap(): RepoMap {
  return RepoMapSchema.parse(readJson('repomaps/sky-todo.json'));
}

/** The goal recorded in `fixtures/runs/sky-todo-launch-day.jsonl`, kept in sync by `fixtures.test.ts`. */
export function skyTodoGoal(): Goal {
  return {
    id: '01jd2k7m3p4q5r6s7t8v9w0x3a',
    text: 'Add dark mode with a toggle, live search filtering, CSV export, keyboard shortcuts (n = new, / = search, ? = help), due-date badges, and fix the overdue-calculation and date-sorting bugs in src/lib/dates.ts.',
    repoPath: 'examples/sky-todo',
    baseBranch: 'main',
    createdAt: 1731000000000,
    constraints: ['Do not add runtime dependencies', 'Keep the bundle vanilla TypeScript'],
  };
}

export function skyTodoContext(taskKey = 'csv-export'): PromptContext {
  const plan = skyTodoPlan();
  const task = plan.tasks.find((candidate) => candidate.key === taskKey);
  if (task === undefined) throw new Error(`fixture plan has no task "${taskKey}"`);
  return {
    goal: skyTodoGoal(),
    plan,
    map: skyTodoMap(),
    task,
    branch: `${SKY_TODO_BRANCH}/${taskKey}`,
    testCommand: 'bun test',
  };
}

/** The failing attempt-1 verdict for `theme` from the recorded run, verbatim. */
export function themeFailureVerdict(): AuditVerdict {
  return {
    taskKey: 'theme',
    attempt: 1,
    pass: false,
    checks: [
      { name: 'tests', ok: false, detail: 'bun test: 1 failing test in src/features/theme' },
      { name: 'lane', ok: true, detail: 'No files outside the lane were touched' },
      { name: 'definition-of-done', ok: false, detail: 'Missing: toggle persists across reloads' },
    ],
    laneViolations: [],
    summary: 'The toggle works, but nothing proves the choice survives a reload.',
    fixInstructions:
      'Add a test that mounts initTheme() twice with a stubbed localStorage and asserts the second mount reads data-theme="dark". Keep the change inside src/features/theme/**.',
    model: { provider: 'ollama', model: 'qwen3.6:35b-a3b' },
    ts: 1731000063500,
  };
}

/** A conflict on the search feature, reported while merging `help-overlay`. */
export function helpOverlayConflict(): MergeResult {
  return {
    taskKey: 'help-overlay',
    status: 'conflict',
    conflictedFiles: ['src/features/search/index.ts'],
    detail: 'CONFLICT (content): Merge conflict in src/features/search/index.ts',
    ts: 1731000200000,
  };
}

/** A conflict that no plan lane claims, so the resolver has to attribute it itself. */
export function unattributedConflict(): MergeResult {
  return {
    taskKey: 'csv-export',
    status: 'conflict',
    conflictedFiles: ['src/main.ts'],
    detail: 'CONFLICT (content): Merge conflict in src/main.ts',
    ts: 1731000200000,
  };
}
