import type { AuditVerdict } from '../lib/core';
import type { AuditorCase } from './case';

export interface AuditCaseResult {
  caseName: string;
  expectedPass: boolean;
  actualPass: boolean;
  correct: boolean;
  /** 0..1 over the case's `mustMention` groups; `null` when the case expects a pass. */
  fixQuality: number | null;
  missingFixKeywords: string[];
  expectedLaneViolations: string[];
  actualLaneViolations: string[];
  laneOk: boolean;
  rationale: string;
}

export interface AuditorScore {
  caseCount: number;
  /** Share of verdicts whose pass/fail matches the answer key. */
  accuracy: number;
  /** Dangerous direction: expected fail, verdict said pass. */
  falsePassRate: number;
  /** Annoying direction: expected pass, verdict said fail. */
  falseFailRate: number;
  /** Mean share of required fix-instruction keywords present (0 for a wrong pass). */
  fixQuality: number;
  /** Share of cases whose lane-violation list matches the answer key. */
  laneDetection: number;
  results: AuditCaseResult[];
}

/**
 * Score auditor verdicts against the seeded answer key.
 *
 * Accuracy is symmetric; false-pass is the number that matters (a bad diff ships), false-fail just
 * burns a retry. Fix quality is measured only on fail cases: a passing verdict has no instructions.
 */
export function scoreAuditor(
  verdicts: Array<{ testCase: AuditorCase; verdict: AuditVerdict }>,
): AuditorScore {
  const results = verdicts.map(({ testCase, verdict }) => scoreOne(testCase, verdict));
  const expectedFails = results.filter((result) => !result.expectedPass);
  const expectedPasses = results.filter((result) => result.expectedPass);
  const wrongPasses = expectedFails.filter((result) => result.actualPass);
  const wrongFails = expectedPasses.filter((result) => !result.actualPass);

  return {
    caseCount: results.length,
    accuracy: ratio(results.filter((result) => result.correct).length, results.length),
    falsePassRate: ratio(wrongPasses.length, expectedFails.length),
    falseFailRate: ratio(wrongFails.length, expectedPasses.length),
    fixQuality: mean(expectedFails.map((result) => (result.actualPass ? 0 : (result.fixQuality ?? 0)))),
    laneDetection: mean(results.map((result) => (result.laneOk ? 1 : 0))),
    results,
  };
}

function scoreOne(testCase: AuditorCase, verdict: AuditVerdict): AuditCaseResult {
  const expected = testCase.expected;
  const fix = verdict.fixInstructions ?? '';
  const missing = expected.mustMention.filter(
    (group) => !group.some((word) => fix.toLowerCase().includes(word.toLowerCase())),
  );
  const fixQuality =
    expected.mustMention.length === 0
      ? null
      : (expected.mustMention.length - missing.length) / expected.mustMention.length;
  const laneOk =
    expected.laneViolations.every((file) => verdict.laneViolations.includes(file)) &&
    (expected.pass ? verdict.laneViolations.length === 0 : true);

  return {
    caseName: testCase.name,
    expectedPass: expected.pass,
    actualPass: verdict.pass,
    correct: expected.pass === verdict.pass,
    fixQuality,
    missingFixKeywords: missing.map((group) => group.join(' | ')),
    expectedLaneViolations: expected.laneViolations,
    actualLaneViolations: verdict.laneViolations,
    laneOk,
    rationale: expected.rationale,
  };
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : round(numerator / denominator);
}

function mean(values: number[]): number {
  return values.length === 0 ? 1 : round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
