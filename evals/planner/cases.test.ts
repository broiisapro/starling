import { describe, expect, test } from 'bun:test';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../lib/paths';
import { findPlannerCase, loadPlannerCases, loadRepoMap } from './cases';
import { referenceCaseNames } from './reference';

const cases = loadPlannerCases();

describe('planner cases', () => {
  test('all eight cases load and validate against the zod schema', () => {
    expect(cases.length).toBe(8);
    expect(new Set(cases.map((entry) => entry.name)).size).toBe(cases.length);
  });

  test('the five sky-todo cases cover every demo-goals answer key', () => {
    const expected = readdirSync(join(REPO_ROOT, 'examples/sky-todo/demo-goals')).filter((file) =>
      file.endsWith('.expected.md'),
    );
    const skyTodo = cases.filter((entry) => entry.repomap.endsWith('fixtures/repomaps/sky-todo.json'));
    expect(skyTodo.length).toBe(expected.length);
  });

  test('every case points at a valid RepoMap', () => {
    for (const entry of cases) {
      const map = loadRepoMap(entry.repomap);
      expect(map.files.length).toBeGreaterThan(0);
      expect(map.testCommand).toBeDefined();
    }
  });

  test('required and forbidden lane files never contradict each other', () => {
    for (const entry of cases) {
      const overlap = entry.requiredLaneFiles.filter((file) => entry.forbiddenFiles.includes(file));
      expect(overlap).toEqual([]);
    }
  });

  test('every case has a hand-written reference plan', () => {
    expect(referenceCaseNames()).toEqual(cases.map((entry) => entry.name).sort());
    expect(findPlannerCase(cases, 'sky-todo-launch-day').taskCount).toEqual({ min: 6, max: 8 });
    expect(findPlannerCase(cases, 'sky-todo-launch-day-xl').taskCount).toEqual({ min: 9, max: 11 });
  });
});
