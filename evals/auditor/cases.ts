import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { StarlingError } from '../lib/core';
import { readJson } from '../lib/json';
import { type AuditorCase, AuditorCaseSchema } from './case';

export const AUDITOR_CASES_DIR = join(import.meta.dir, 'cases');

/** Load every `*.json` auditor case, sorted by name, and enforce answer-key invariants. */
export function loadAuditorCases(dir: string = AUDITOR_CASES_DIR): AuditorCase[] {
  const files = readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .sort();
  return files.map((file) => {
    const parsed = AuditorCaseSchema.safeParse(readJson(join(dir, file)));
    if (!parsed.success) {
      throw new StarlingError('INVALID_ARGUMENT', `Invalid auditor case ${file}: ${parsed.error.message}`);
    }
    assertAuditorCaseConsistent(parsed.data, file);
    return parsed.data;
  });
}

export function findAuditorCase(cases: AuditorCase[], name: string): AuditorCase {
  const found = cases.find((testCase) => testCase.name === name);
  if (found === undefined) {
    throw new StarlingError(
      'INVALID_ARGUMENT',
      `Unknown auditor case "${name}". Known: ${cases.map((c) => c.name).join(', ')}`,
    );
  }
  return found;
}

/**
 * Invariants that keep the answer key honest:
 * - `changedFiles` and `diff.files` describe the same set;
 * - an empty diff carries an empty patch;
 * - a pass case has no fix instructions, a fail case has a reference fix that hits every keyword.
 */
export function assertAuditorCaseConsistent(testCase: AuditorCase, source = testCase.name): void {
  const diffPaths = testCase.diff.files.map((file) => file.path).sort();
  const changed = [...testCase.changedFiles].sort();
  if (diffPaths.join('\n') !== changed.join('\n')) {
    throw new StarlingError(
      'INVALID_ARGUMENT',
      `auditor case ${source}: changedFiles and diff.files disagree`,
    );
  }
  if (testCase.diff.files.length === 0 && testCase.diff.patch.trim() !== '') {
    throw new StarlingError('INVALID_ARGUMENT', `auditor case ${source}: empty diff has a non-empty patch`);
  }
  if (testCase.task.lane.owns.length === 0) {
    throw new StarlingError('INVALID_ARGUMENT', `auditor case ${source}: task lane owns nothing`);
  }
  if (testCase.task.definitionOfDone.length === 0) {
    throw new StarlingError('INVALID_ARGUMENT', `auditor case ${source}: task has an empty DoD`);
  }

  const { expected } = testCase;
  if (expected.pass) {
    if (expected.mustMention.length > 0 || expected.referenceFix !== undefined) {
      throw new StarlingError(
        'INVALID_ARGUMENT',
        `auditor case ${source}: pass case must not carry fix instructions`,
      );
    }
    if (expected.laneViolations.length > 0) {
      throw new StarlingError(
        'INVALID_ARGUMENT',
        `auditor case ${source}: pass case must not expect lane violations`,
      );
    }
    return;
  }

  if (expected.referenceFix === undefined || expected.referenceFix.trim() === '') {
    throw new StarlingError('INVALID_ARGUMENT', `auditor case ${source}: fail case needs a referenceFix`);
  }
  if (expected.mustMention.length === 0) {
    throw new StarlingError(
      'INVALID_ARGUMENT',
      `auditor case ${source}: fail case needs mustMention keywords`,
    );
  }
  for (const group of expected.mustMention) {
    const hit = group.some((word) => expected.referenceFix?.toLowerCase().includes(word.toLowerCase()));
    if (!hit) {
      throw new StarlingError(
        'INVALID_ARGUMENT',
        `auditor case ${source}: referenceFix does not mention any of ${group.join(' | ')}`,
      );
    }
  }
}
