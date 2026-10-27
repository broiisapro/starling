import { describe, expect, test } from 'bun:test';
import type { AuditCheck, AuditVerdict } from '../lib/core';
import {
  AUDITOR_ACCURACY_THRESHOLD,
  DEFAULT_REVIEW_RETRIES,
  parseRealArgs,
  realReportPassed,
  reviewerDidNotAnswer,
} from './run-real';

function verdict(checks: AuditCheck[]): AuditVerdict {
  return {
    taskKey: 't01',
    attempt: 1,
    pass: false,
    checks,
    laneViolations: [],
    summary: 'Audit failed.',
    model: { provider: 'opencode', model: 'opencode-go/deepseek-v4.1-flash' },
    ts: 0,
  };
}

function llmReview(ok: boolean, detail: string): AuditCheck {
  return { name: 'llm-review', ok, detail };
}

describe('real auditor eval run rules', () => {
  test('a silent provider error is distinguishable from a deliberate skip', () => {
    expect(
      reviewerDidNotAnswer(verdict([llmReview(false, 'skipped: reviewer unavailable (LLM_BAD_JSON)')])),
    ).toBe(true);
    expect(reviewerDidNotAnswer(verdict([llmReview(true, 'skipped: empty diff, nothing to review')]))).toBe(
      false,
    );
    expect(reviewerDidNotAnswer(verdict([llmReview(true, 'skipped: no reviewer model configured')]))).toBe(
      false,
    );
  });

  test('a reviewer that answered is not a skip, even when the answer fails the audit', () => {
    const answered = verdict([llmReview(false, 'opencode/opencode-go/deepseek-v4.1-flash: missing tests')]);
    expect(reviewerDidNotAnswer(answered)).toBe(false);
  });

  test('the run passes only when accurate, false-pass-free and fully reviewed', () => {
    expect(realReportPassed({ accuracy: 1, falsePassRate: 0, reviewerSkipped: 0 })).toBe(true);
    expect(realReportPassed({ accuracy: 0, falsePassRate: 0, reviewerSkipped: 0 })).toBe(false);
    expect(realReportPassed({ accuracy: 1, falsePassRate: 0.1, reviewerSkipped: 0 })).toBe(false);
    expect(realReportPassed({ accuracy: 1, falsePassRate: 0, reviewerSkipped: 1 })).toBe(false);
  });

  test('accuracy is compared against the documented threshold, not a magic number', () => {
    const justBelow = AUDITOR_ACCURACY_THRESHOLD - 0.001;
    expect(realReportPassed({ accuracy: justBelow, falsePassRate: 0, reviewerSkipped: 0 })).toBe(false);
    expect(
      realReportPassed({ accuracy: AUDITOR_ACCURACY_THRESHOLD, falsePassRate: 0, reviewerSkipped: 0 }),
    ).toBe(true);
  });

  test('--retries defaults to one re-audit and accepts an explicit count', () => {
    expect(parseRealArgs([]).retries).toBe(DEFAULT_REVIEW_RETRIES);
    expect(parseRealArgs(['--retries', '0']).retries).toBe(0);
    expect(parseRealArgs(['--retries=3', '--set', 'heldout']).retries).toBe(3);
    expect(() => parseRealArgs(['--retries', '-1'])).toThrow(/non-negative/);
  });

  test('the default is a single retry, so a broken reviewer still fails the run', () => {
    expect(DEFAULT_REVIEW_RETRIES).toBe(1);
  });
});
