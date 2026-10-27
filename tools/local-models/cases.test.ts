/**
 * cases.test.ts — the corpus is data, so these tests are the type checker for it: a case that is
 * malformed, unbalanced or unreachable by the fake server would quietly fake a model's score.
 */

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { caseRequest, findCaseForPrompt, loadCases, parseCase } from './cases';

const HERE = dirname(new URL(import.meta.url).pathname);
const CASES = loadCases(join(HERE, 'cases'));

const valid = {
  key: 'sample-case',
  title: 'A sample',
  goal: 'Do the thing.',
  definitionOfDone: ['the thing is done'],
  diff: 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-a\n+b\n',
  testOutput: '1 pass',
  expect: { pass: true, mustMention: [] },
  why: 'because',
};

describe('the shipped corpus', () => {
  test('has twelve cases with unique kebab-case keys', () => {
    expect(CASES).toHaveLength(12);
    const keys = CASES.map((c) => c.key);
    expect(new Set(keys).size).toBe(12);
    for (const key of keys) expect(key).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  test('is balanced: six must pass, six must fail', () => {
    expect(CASES.filter((c) => c.expect.pass)).toHaveLength(6);
    expect(CASES.filter((c) => !c.expect.pass)).toHaveLength(6);
  });

  test('every case has a checkable DoD, a real diff, and a rationale', () => {
    for (const c of CASES) {
      expect(c.definitionOfDone.length).toBeGreaterThan(0);
      expect(c.diff.startsWith('diff --git ')).toBe(true);
      expect(c.diff).toContain('@@');
      expect(c.why.length).toBeGreaterThan(10);
    }
  });

  test('mustMention stays a short, literal token the auditor would actually write', () => {
    for (const c of CASES) {
      expect(c.expect.mustMention.length).toBeLessThanOrEqual(2);
      for (const term of c.expect.mustMention) {
        expect(term).toBe(term.toLowerCase());
        expect(term.length).toBeGreaterThanOrEqual(4);
        expect(term).not.toContain(' ');
      }
    }
  });

  test('only the lane case carries a lane, so the others do not invite a lane verdict', () => {
    const withLane = CASES.filter((c) => c.lane !== undefined);
    expect(withLane).toHaveLength(1);
    expect(withLane[0]?.key).toBe('lane-violation');
  });
});

describe('the audit prompt', () => {
  test('numbers the DoD, fences the diff and keeps the test tail verbatim', () => {
    const c = CASES.find((x) => x.key === 'csv-export-no-tests');
    expect(c).toBeDefined();
    if (!c) return;
    const { system, user, schema } = caseRequest(c);

    expect(system).toContain('auditor');
    expect(schema).toMatchObject({ required: ['pass', 'summary'], additionalProperties: false });
    expect(user).toContain(`GOAL: ${c.goal}`);
    c.definitionOfDone.forEach((item, i) => {
      expect(user).toContain(`${i + 1}. ${item}`);
    });
    expect(user).toContain('```diff');
    expect(user).toContain(c.diff.trimEnd());
    expect(user).toContain(c.testOutput.trimEnd());
    expect(user).toContain('TEST OUTPUT (tail):');
    expect(user).not.toContain('LANE');
  });

  test('states the lane when the task has one', () => {
    const c = CASES.find((x) => x.key === 'lane-violation');
    expect(c).toBeDefined();
    if (!c) return;
    const { user } = caseRequest(c);
    expect(user).toContain('LANE');
    expect(user).toContain('owns: src/ui/**');
    expect(user).toContain('reads: src/lib/**, docs/**');
  });

  test('every case is identifiable from its own prompt (what the fake server keys on)', () => {
    for (const c of CASES) {
      const { user } = caseRequest(c);
      expect(findCaseForPrompt(user, CASES)?.key).toBe(c.key);
    }
    expect(findCaseForPrompt('no diff here', CASES)).toBeUndefined();
  });
});

describe('validation', () => {
  test('accepts a well-formed case', () => {
    expect(parseCase(valid, 'sample.json').key).toBe('sample-case');
  });

  test('rejects a non-kebab key, a missing diff and a bad expectation', () => {
    expect(() => parseCase({ ...valid, key: 'Sample Case' }, 's.json')).toThrow(/kebab-case/);
    expect(() => parseCase({ ...valid, diff: 'not a diff' }, 's.json')).toThrow(/unified diff/);
    expect(() => parseCase({ ...valid, expect: { pass: 'yes' } }, 's.json')).toThrow(/expect.pass/);
    expect(() => parseCase({ ...valid, definitionOfDone: [] }, 's.json')).toThrow(/definitionOfDone/);
  });

  test('rejects an uppercase mustMention, because matching is case-insensitive anyway', () => {
    expect(() => parseCase({ ...valid, expect: { pass: false, mustMention: ['Test'] } }, 's.json')).toThrow(
      /lowercase/,
    );
  });

  test('rejects a lane without both glob lists', () => {
    expect(() => parseCase({ ...valid, lane: { owns: ['src/**'] } }, 's.json')).toThrow(/lane must be/);
  });

  test('loadCases reports a missing directory and a duplicate key', () => {
    expect(() => loadCases('/definitely/not/here')).toThrow(/cannot read the case directory/);

    const dir = mkdtempSync(join(tmpdir(), 'starling-cases-'));
    try {
      writeFileSync(join(dir, 'a.json'), JSON.stringify(valid));
      writeFileSync(join(dir, 'b.json'), JSON.stringify({ ...valid, title: 'copy' }));
      expect(() => loadCases(dir)).toThrow(/duplicate case key/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
