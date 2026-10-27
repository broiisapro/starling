import './test-env';
import { describe, expect, test } from 'bun:test';
import { makeAuditVerdict, makeTaskSpec } from '@starling/core/testing';
import { checkDuration, sortVerdicts, splitFixInstructions } from './audit';
import { dodChecklist, dodEvidence } from './spec';

const dod = makeTaskSpec().definitionOfDone;

/** Attach C1's optional per-item DoD evidence to a verdict (the field is not in core yet). */
function withDod(
  verdict: ReturnType<typeof makeAuditVerdict>,
  judgements: { item: string; met?: boolean; ok?: boolean; evidence?: string }[],
): ReturnType<typeof makeAuditVerdict> {
  return { ...verdict, dod: judgements } as unknown as ReturnType<typeof makeAuditVerdict>;
}

describe('checkDuration', () => {
  test('reads an opportunistic durationMs and ignores its absence', () => {
    const check = { name: 'tests', ok: true, detail: 'ok' };
    const withDuration: typeof check & { durationMs: number } = { ...check, durationMs: 1_200 };
    const withBadDuration: typeof check & { durationMs: number } = { ...check, durationMs: Number.NaN };
    expect(checkDuration(check)).toBeUndefined();
    expect(checkDuration(withDuration)).toBe(1_200);
    expect(checkDuration(withBadDuration)).toBeUndefined();
  });
});

describe('sortVerdicts', () => {
  test('newest first, attempt breaking timestamp ties', () => {
    const a = makeAuditVerdict({ attempt: 1, ts: 100 });
    const b = makeAuditVerdict({ attempt: 2, ts: 200 });
    const c = makeAuditVerdict({ attempt: 3, ts: 200 });
    expect(sortVerdicts([a, b, c]).map((verdict) => verdict.attempt)).toEqual([3, 2, 1]);
  });
});

describe('splitFixInstructions', () => {
  test('splits one paragraph into numbered steps', () => {
    const steps = splitFixInstructions(
      'Add a test that mounts initTheme() twice with a stubbed localStorage and asserts the second mount reads data-theme="dark". Keep the change inside src/features/theme/**.',
    );
    expect(steps).toHaveLength(2);
    expect(steps[0]).toContain('stubbed localStorage');
    expect(steps[1]).toBe('Keep the change inside src/features/theme/**.');
  });

  test('strips bullets and explicit numbering', () => {
    expect(splitFixInstructions('- one\n2. two\n* three')).toEqual(['one', 'two', 'three']);
  });

  test('returns an empty list for no instructions', () => {
    expect(splitFixInstructions(undefined)).toEqual([]);
    expect(splitFixInstructions('   ')).toEqual([]);
  });
});

describe('dodChecklist', () => {
  test('ticks everything when the auditor passed the DoD check', () => {
    const verdict = makeAuditVerdict({
      pass: true,
      checks: [{ name: 'definition-of-done', ok: true, detail: 'Every DoD item is satisfied' }],
    });
    expect(dodChecklist(dod, verdict).every((entry) => entry.done)).toBe(true);
  });

  test('ticks nothing when the DoD check failed, and surfaces the evidence', () => {
    const verdict = makeAuditVerdict({
      pass: false,
      checks: [
        { name: 'tests', ok: false, detail: 'bun test: 1 failing test' },
        { name: 'definition-of-done', ok: false, detail: 'Missing: toggle persists across reloads' },
      ],
    });
    expect(dodChecklist(dod, verdict).every((entry) => !entry.done)).toBe(true);
    expect(dodEvidence(verdict)).toBe('Missing: toggle persists across reloads');
  });

  test('falls back to the overall verdict when there is no DoD check', () => {
    const passing = makeAuditVerdict({ pass: true, checks: [] });
    const failing = makeAuditVerdict({ pass: false, checks: [] });
    expect(dodChecklist(dod, passing).every((entry) => entry.done)).toBe(true);
    expect(dodChecklist(dod, failing).every((entry) => !entry.done)).toBe(true);
  });

  test('leaves everything unticked without a verdict', () => {
    expect(dodChecklist(dod, undefined).every((entry) => !entry.done)).toBe(true);
    expect(dodEvidence(undefined)).toBeUndefined();
  });

  test('reads per-item evidence when a verdict carries it (C1 core field)', () => {
    // `dod` arrives with C1's core consolidation; until it lands the test attaches it by cast, which
    // is exactly how the drawer feature-detects it.
    const verdict = withDod(
      makeAuditVerdict({
        pass: false,
        checks: [{ name: 'definition-of-done', ok: false, detail: 'two items missing' }],
      }),
      [
        { item: dod[0] ?? 'first', met: true, evidence: 'test added' },
        { item: dod[1] ?? 'second', met: false, evidence: 'no reload coverage' },
      ],
    );
    const checklist = dodChecklist(dod, verdict);
    // Matched items use their own judgement; unmatched ones inherit the check's failure.
    expect(checklist[0]).toEqual({ item: dod[0] ?? '', done: true, evidence: 'test added' });
    expect(checklist[1]).toEqual({ item: dod[1] ?? '', done: false, evidence: 'no reload coverage' });
    expect(checklist.slice(2).every((entry) => !entry.done)).toBe(true);
    expect(dodEvidence(verdict)).toBe('1 of 2 items met');
  });

  test('accepts the `ok` spelling and tolerates an empty dod array', () => {
    const verdict = withDod(makeAuditVerdict({ pass: true, checks: [] }), [
      { item: dod[0] ?? 'first', ok: true },
    ]);
    expect(dodChecklist(dod, verdict)[0]?.done).toBe(true);

    const empty = withDod(makeAuditVerdict({ pass: true, checks: [] }), []);
    expect(dodChecklist(dod, empty).every((entry) => entry.done)).toBe(true);
    expect(dodEvidence(empty)).toBeUndefined();
  });
});
