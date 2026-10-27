import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { type RepoMap, RepoMapSchema, StarlingError } from '../lib/core';
import { readJson } from '../lib/json';
import { REPO_ROOT } from '../lib/paths';
import { type PlannerCase, PlannerCaseSchema } from './case';

export const PLANNER_CASES_DIR = join(import.meta.dir, 'cases');

/** Load every `*.json` planner case in a directory, sorted by name. */
export function loadPlannerCases(dir: string = PLANNER_CASES_DIR): PlannerCase[] {
  const files = readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .sort();
  return files.map((file) => {
    const parsed = PlannerCaseSchema.safeParse(readJson(join(dir, file)));
    if (!parsed.success) {
      throw new StarlingError('INVALID_ARGUMENT', `Invalid planner case ${file}: ${parsed.error.message}`);
    }
    assertCaseConsistent(parsed.data, file);
    return parsed.data;
  });
}

/** Load the RepoMap a case points at. Paths are relative to the repo root. */
export function loadRepoMap(relativePath: string): RepoMap {
  const parsed = RepoMapSchema.safeParse(readJson(resolve(REPO_ROOT, relativePath)));
  if (!parsed.success) {
    throw new StarlingError('INVALID_ARGUMENT', `Invalid repo map ${relativePath}: ${parsed.error.message}`);
  }
  return parsed.data;
}

export function findPlannerCase(cases: PlannerCase[], name: string): PlannerCase {
  const found = cases.find((testCase) => testCase.name === name);
  if (found === undefined) {
    throw new StarlingError(
      'INVALID_ARGUMENT',
      `Unknown planner case "${name}". Known: ${cases.map((c) => c.name).join(', ')}`,
    );
  }
  return found;
}

/** Answer-key invariants that zod cannot express on a single object. */
export function assertCaseConsistent(testCase: PlannerCase, source = testCase.name): void {
  const ids = testCase.features.map((feature) => feature.id);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicates.length > 0) {
    throw new StarlingError(
      'INVALID_ARGUMENT',
      `planner case ${source}: duplicate feature ids ${duplicates.join(', ')}`,
    );
  }
  for (const [dependency, dependent] of testCase.requiredDeps) {
    for (const id of [dependency, dependent]) {
      if (!ids.includes(id)) {
        throw new StarlingError(
          'INVALID_ARGUMENT',
          `planner case ${source}: requiredDeps references unknown feature "${id}"`,
        );
      }
    }
    if (dependency === dependent) {
      throw new StarlingError(
        'INVALID_ARGUMENT',
        `planner case ${source}: requiredDeps cannot self-reference "${dependency}"`,
      );
    }
  }
  if (testCase.taskCount.min > testCase.features.length) {
    // Not fatal, but it almost always means the answer key was copied without editing.
    throw new StarlingError(
      'INVALID_ARGUMENT',
      `planner case ${source}: taskCount.min (${testCase.taskCount.min}) exceeds feature count (${testCase.features.length})`,
    );
  }
}
