import type { AuditVerdict } from '../lib/core';
import { makeAuditVerdict } from '../lib/core-testing';
import type { AuditorCase } from './case';

/** The reference (answer-key) verdict for a case, used by `--impl mock` to self-test scoring. */
export function referenceVerdict(testCase: AuditorCase): AuditVerdict {
  const { expected } = testCase;
  const failing = new Set(expected.failingChecks);
  return makeAuditVerdict({
    taskKey: testCase.task.key,
    attempt: 1,
    pass: expected.pass,
    checks: [
      checksFor('tests', failing, 'bun test is green and the new behaviour is covered'),
      checksFor('lane', failing, 'every changed file is inside the lane'),
      checksFor('definition-of-done', failing, 'each DoD item is satisfied'),
    ],
    laneViolations: expected.laneViolations,
    summary: expected.rationale,
    ...(expected.referenceFix === undefined ? {} : { fixInstructions: expected.referenceFix }),
  });
}

function checksFor(name: string, failing: Set<string>, detail: string): AuditVerdict['checks'][number] {
  return {
    name,
    ok: !failing.has(name),
    detail: failing.has(name) ? `Failed: ${detail}` : detail,
  };
}
