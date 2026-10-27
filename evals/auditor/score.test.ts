import { describe, expect, test } from 'bun:test';
import type { AuditVerdict } from '../lib/core';
import type { AuditorCase } from './case';
import { loadAuditorCases } from './cases';
import { referenceVerdict } from './reference';
import { scoreAuditor } from './score';

const cases = loadAuditorCases();

interface Scored {
  testCase: AuditorCase;
  verdict: AuditVerdict;
}

function referenceSet(): Scored[] {
  return cases.map((testCase) => ({ testCase, verdict: referenceVerdict(testCase) }));
}

function findByCase(list: Scored[], name: string): Scored {
  const found = list.find((entry) => entry.testCase.name === name);
  if (found === undefined) throw new Error(`missing case ${name}`);
  return found;
}

describe('scoreAuditor', () => {
  test('the reference verdicts are perfect: accuracy 1, no dangerous passes', () => {
    const score = scoreAuditor(referenceSet());
    expect(score.accuracy).toBe(1);
    expect(score.falsePassRate).toBe(0);
    expect(score.falseFailRate).toBe(0);
    expect(score.fixQuality).toBe(1);
    expect(score.laneDetection).toBe(1);
    expect(
      score.results.filter((result) => result.expectedPass).every((result) => result.fixQuality === null),
    ).toBe(true);
  });

  test('a false pass is the expensive mistake and moves false-pass, accuracy and fix quality', () => {
    const list = referenceSet();
    const target = findByCase(list, 'missing-tests-csv-export');
    target.verdict = { ...target.verdict, pass: true, fixInstructions: undefined };
    const score = scoreAuditor(list);
    expect(score.falsePassRate).toBe(0.125);
    expect(score.accuracy).toBe(0.917);
    expect(score.fixQuality).toBe(0.875);
  });

  test('a false fail is tracked separately from a false pass', () => {
    const list = referenceSet();
    const target = findByCase(list, 'docs-only-task');
    target.verdict = {
      ...target.verdict,
      pass: false,
      fixInstructions: 'Add tests for the README.',
    };
    const score = scoreAuditor(list);
    expect(score.falseFailRate).toBe(0.25);
    expect(score.falsePassRate).toBe(0);
    expect(score.accuracy).toBe(0.917);
  });

  test('vague fix instructions lower fix quality and name the missing keywords', () => {
    const list = referenceSet();
    const target = findByCase(list, 'partial-csv-quoting');
    target.verdict = { ...target.verdict, fixInstructions: 'Please try again.' };
    const score = scoreAuditor(list);
    expect(score.fixQuality).toBe(0.875);
    const result = score.results.find((entry) => entry.caseName === 'partial-csv-quoting');
    expect(result?.missingFixKeywords.length).toBe(3);
  });

  test('a missed lane violation lowers lane detection', () => {
    const list = referenceSet();
    const target = findByCase(list, 'lane-violation-lockfile');
    target.verdict = { ...target.verdict, laneViolations: [] };
    const score = scoreAuditor(list);
    expect(score.laneDetection).toBe(0.917);
    const result = score.results.find((entry) => entry.caseName === 'lane-violation-lockfile');
    expect(result?.laneOk).toBe(false);
  });
});
