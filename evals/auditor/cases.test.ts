import { describe, expect, test } from 'bun:test';
import type { AuditorCase } from './case';
import {
  allAuditorCases,
  assertAuditorCaseConsistent,
  heldOutAuditorCases,
  loadAuditorCases,
  loadHeldOutAuditorCases,
  seededAuditorCases,
} from './cases';

const cases = allAuditorCases();

describe('auditor cases', () => {
  test('twelve tuning cases and four held-out cases load from separate directories', () => {
    expect(loadAuditorCases()).toHaveLength(12);
    expect(seededAuditorCases()).toHaveLength(12);
    expect(loadHeldOutAuditorCases()).toHaveLength(4);
    expect(heldOutAuditorCases(loadHeldOutAuditorCases())).toHaveLength(4);
    expect(cases).toHaveLength(16);
    expect(new Set(cases.map((entry) => entry.name)).size).toBe(cases.length);
  });

  test('the tuning set never contains a held-out case, so a prompt change cannot fit them', () => {
    expect(loadAuditorCases().some((entry) => entry.heldOut)).toBe(false);
  });

  test('held-out cases are named heldout- so a reader can spot them', () => {
    for (const entry of loadHeldOutAuditorCases()) {
      expect(entry.name.startsWith('heldout-')).toBe(true);
    }
  });

  test('the answer key spans both verdicts, with false-pass traps and false-fail traps', () => {
    const passes = cases.filter((entry) => entry.expected.pass);
    const fails = cases.filter((entry) => !entry.expected.pass);
    expect(passes.length).toBeGreaterThanOrEqual(4);
    expect(fails.length).toBeGreaterThanOrEqual(8);
    expect(passes.some((entry) => entry.changedFiles.length === 0)).toBe(false);
    expect(fails.some((entry) => entry.changedFiles.length === 0)).toBe(true);
  });

  test('every fail case has fix instructions that hit its own keywords', () => {
    for (const entry of cases.filter((candidate) => !candidate.expected.pass)) {
      const fix = entry.expected.referenceFix?.toLowerCase() ?? '';
      expect(fix.length).toBeGreaterThan(0);
      for (const group of entry.expected.mustMention) {
        expect(group.some((word) => fix.includes(word.toLowerCase()))).toBe(true);
      }
    }
  });

  test('the consistency guard rejects a case whose diff and changed files disagree', () => {
    const original = cases[0];
    if (original === undefined) throw new Error('expected at least one case');
    const broken: AuditorCase = { ...original, changedFiles: ['src/elsewhere.ts'] };
    expect(() => assertAuditorCaseConsistent(broken, 'broken')).toThrow(/disagree/);
  });

  test('the consistency guard rejects a fail case with no reference fix', () => {
    const original = cases.find((entry) => !entry.expected.pass);
    if (original === undefined) throw new Error('expected at least one fail case');
    const broken: AuditorCase = {
      ...original,
      expected: { ...original.expected, referenceFix: undefined },
    };
    expect(() => assertAuditorCaseConsistent(broken, 'broken')).toThrow(/referenceFix/);
  });
});
