import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AuditCheck, AuditVerdict } from '@starling/core';
import { AuditVerdictSchema } from '@starling/core';
import { DETAIL_TAIL_CHARS, type ExplainedCheck, explainVerdict, formatVerdictExplanation } from './index.ts';

function check(name: string, ok: boolean, detail = ''): AuditCheck {
  return { name, ok, detail, durationMs: 1 };
}

function verdictOf(checks: AuditCheck[], overrides: Partial<AuditVerdict> = {}): AuditVerdict {
  return {
    taskKey: 't01-explain',
    attempt: 1,
    pass: checks.every((entry) => entry.ok),
    checks,
    laneViolations: [],
    summary: 'A summary.',
    model: { provider: 'starling', model: 'deterministic' },
    ts: 1_700_000_000_000,
    ...overrides,
  };
}

function labels(checks: ExplainedCheck[]): string[] {
  return checks.map((entry) => entry.label);
}

/** Every `audit.verdict` event in the recorded launch-day run. */
const FIXTURE = join(import.meta.dir, '../../../fixtures/runs/sky-todo-launch-day.jsonl');

const FIXTURE_VERDICTS: AuditVerdict[] = readFileSync(FIXTURE, 'utf8')
  .split('\n')
  .filter((line) => line.trim() !== '')
  .map((line) => JSON.parse(line) as { type: string; payload: unknown })
  .filter((event) => event.type === 'audit.verdict')
  .map((event) => AuditVerdictSchema.parse(event.payload));

describe('explainVerdict — recorded fixture (golden)', () => {
  test('the fixture really holds both a pass and a fail', () => {
    expect(FIXTURE_VERDICTS.length).toBeGreaterThanOrEqual(6);
    expect(FIXTURE_VERDICTS.some((entry) => entry.pass)).toBe(true);
    expect(FIXTURE_VERDICTS.some((entry) => !entry.pass)).toBe(true);
  });

  test('every recorded verdict explains consistently', () => {
    for (const entry of FIXTURE_VERDICTS) {
      const explanation = explainVerdict(entry);
      expect(explanation.level).toBe(entry.pass ? 'pass' : 'fail');
      expect(explanation.headline.length).toBeGreaterThan(0);
      expect(explanation.blocking.length + explanation.advisory.length + explanation.passed.length).toBe(
        entry.checks.length,
      );
      for (const explained of [...explanation.blocking, ...explanation.advisory]) {
        expect(explained.detailTail.length).toBeLessThanOrEqual(DETAIL_TAIL_CHARS);
        expect(explained.why.length).toBeGreaterThan(0);
      }
      const formatted = formatVerdictExplanation(explanation);
      expect(formatted.split('\n').length).toBeLessThanOrEqual(6);
      expect(formatted.split('\n')[0]?.startsWith(entry.pass ? '✔' : '✘')).toBe(true);
    }
  });

  test('the recorded failing verdict names both blocking checks and the reviewer’s next step', () => {
    const failing = FIXTURE_VERDICTS.find((entry) => entry.taskKey === 'theme' && !entry.pass);
    expect(failing).toBeDefined();
    if (failing === undefined) return;

    const explanation = explainVerdict(failing);
    expect(explanation.level).toBe('fail');
    expect(explanation.headline).toBe('Failed: 2 blocking checks.');
    expect(labels(explanation.blocking)).toEqual(['Tests', 'Definition of done']);
    expect(explanation.advisory).toEqual([]);
    expect(explanation.passed).toEqual(['Lane']);
    expect(explanation.nextStep).toContain('Add a test that mounts initTheme() twice');

    const formatted = formatVerdictExplanation(explanation);
    expect(formatted).toContain('✘ Failed: 2 blocking checks.');
    expect(formatted).toContain('Tests: The repository test command failed.');
    expect(formatted).toContain('Definition of done:');
    expect(formatted).toContain('Next: Add a test that mounts initTheme() twice');
  });

  test('a recorded passing verdict is a clean pass', () => {
    const passing = FIXTURE_VERDICTS.find((entry) => entry.pass);
    expect(passing).toBeDefined();
    if (passing === undefined) return;

    const explanation = explainVerdict(passing);
    expect(explanation.level).toBe('pass');
    expect(explanation.headline).toBe('Passed: every check is green.');
    expect(explanation.blocking).toEqual([]);
    expect(explanation.advisory).toEqual([]);
    expect(explanation.passed).toEqual(['Tests', 'Lane', 'Definition of done']);
    expect(explanation.nextStep).toBeUndefined();
    expect(formatVerdictExplanation(explanation).startsWith('✔ Passed: every check is green.')).toBe(true);
  });
});

describe('explainVerdict — each check name', () => {
  const failing: Array<{ name: string; label: string; detail: string; hint: string }> = [
    {
      name: 'lane',
      label: 'Lane',
      detail: '2 file(s) outside the lane: docs/readme.md and 1 more',
      hint: 'Revert or move the out-of-lane files',
    },
    {
      name: 'non-empty',
      label: 'Diff',
      detail: 'diff is empty: no files changed',
      hint: 'Implement the deliverables',
    },
    {
      name: 'tests',
      label: 'Tests',
      detail: 'tests: exit 1; output tail:\n1 failing test',
      hint: 'Make the test command pass',
    },
    {
      name: 'missing-tests',
      label: 'Tests added',
      detail: 'the definition of done requires tests but no test file changed',
      hint: 'Add the tests the definition of done asks for',
    },
    {
      name: 'llm-review',
      label: 'Review',
      detail: 'deepseek/deepseek-v4.1-flash: the tests are hollow',
      hint: 'Address the reviewer’s finding',
    },
  ];

  for (const entry of failing) {
    test(`${entry.name} fails the verdict with a blocking explanation`, () => {
      const verdict = verdictOf([check(entry.name, false, entry.detail), check('lane', true, 'clean')]);
      const explanation = explainVerdict(verdict);

      expect(explanation.level).toBe('fail');
      expect(explanation.headline).toBe('Failed: 1 blocking check.');
      expect(labels(explanation.blocking)).toEqual([entry.label]);
      expect(explanation.blocking[0]?.name).toBe(entry.name);
      expect(explanation.blocking[0]?.why.length).toBeGreaterThan(0);
      expect(explanation.blocking[0]?.detailTail).toBe(entry.detail);
      expect(explanation.nextStep).toContain(entry.hint);
    });
  }

  test('a non-blocking lint failure is advisory and only warns', () => {
    const verdict = verdictOf(
      [check('lint', false, 'lint: exit 1; output tail:\nunused import; non-blocking')],
      { pass: true },
    );
    const explanation = explainVerdict(verdict);

    expect(explanation.level).toBe('warn');
    expect(explanation.headline).toBe('Passed with warnings: 1 advisory check.');
    expect(explanation.blocking).toEqual([]);
    expect(labels(explanation.advisory)).toEqual(['Lint']);
    expect(explanation.advisory[0]?.why).toContain('non-blocking');
    expect(explanation.nextStep).toContain('Nothing blocks the merge');
  });

  test('a blocking lint failure (no "non-blocking" marker) blocks the verdict', () => {
    const verdict = verdictOf([check('lint', false, 'lint: exit 1; output tail:\nunused import')]);
    const explanation = explainVerdict(verdict);

    expect(explanation.level).toBe('fail');
    expect(labels(explanation.blocking)).toEqual(['Lint']);
  });

  test('a lane failure plus an advisory lint failure counts one blocker', () => {
    const verdict = verdictOf([
      check('lane', false, '1 file(s) outside the lane: docs/readme.md'),
      check('lint', false, 'lint: exit 1; output tail:\nx; non-blocking'),
    ]);
    const explanation = explainVerdict(verdict);

    expect(explanation.headline).toBe('Failed: 1 blocking check.');
    expect(labels(explanation.blocking)).toEqual(['Lane']);
    expect(labels(explanation.advisory)).toEqual(['Lint']);
  });
});

describe('explainVerdict — advisories on passing checks', () => {
  test('the hub-repo fallback is a warning, not a clean pass', () => {
    const verdict = verdictOf([
      check('tests', true, 'tests: exit 0; 3 pass (no task worktree: ran in the hub repo)'),
    ]);
    const explanation = explainVerdict(verdict);

    expect(explanation.level).toBe('warn');
    expect(labels(explanation.advisory)).toEqual(['Tests']);
    expect(explanation.advisory[0]?.why).toContain('hub repo');
    expect(explanation.passed).toEqual([]);
  });

  test('a skipped reviewer is a warning with the reason in the tail', () => {
    const verdict = verdictOf([check('llm-review', true, 'skipped: no reviewer model configured')], {
      model: { provider: 'starling', model: 'deterministic' },
    });
    const explanation = explainVerdict(verdict);

    expect(explanation.level).toBe('warn');
    expect(explanation.advisory[0]?.label).toBe('Review');
    expect(explanation.advisory[0]?.why).toContain('not consulted');
    expect(explanation.advisory[0]?.detailTail).toContain('no reviewer model configured');
  });

  test('a policy-disabled test command is a warning, not a failure', () => {
    const verdict = verdictOf([check('tests', true, 'skipped: tests disabled by policy')]);
    const explanation = explainVerdict(verdict);

    expect(explanation.level).toBe('warn');
    expect(explanation.advisory[0]?.why).toContain('skipped');
  });

  test('an unknown check name is title-cased, never dropped', () => {
    const verdict = verdictOf([check('dependency-hygiene', false, 'new dependency added')]);
    const explanation = explainVerdict(verdict);

    expect(explanation.blocking[0]?.label).toBe('Dependency Hygiene');
    expect(explanation.blocking[0]?.why).toBe('The Dependency Hygiene check failed.');
  });
});

describe('explainVerdict — detail tail and formatting', () => {
  test('detailTail is trimmed and cut to 300 characters', () => {
    const detail = `  ${'x'.repeat(DETAIL_TAIL_CHARS + 100)}  `;
    const explanation = explainVerdict(verdictOf([check('lane', false, detail)]));
    const tail = explanation.blocking[0]?.detailTail ?? '';

    expect(tail.length).toBeLessThanOrEqual(DETAIL_TAIL_CHARS);
    expect(tail.endsWith('…')).toBe(true);
    expect(tail.startsWith('x')).toBe(true);
  });

  test('formatVerdictExplanation caps at six lines and counts the rest', () => {
    const checks = [
      check('lane', false, 'a'),
      check('non-empty', false, 'b'),
      check('tests', false, 'c'),
      check('missing-tests', false, 'd'),
      check('lint', false, 'e'),
      check('llm-review', false, 'f'),
    ];
    const explanation = explainVerdict(verdictOf(checks));
    const lines = formatVerdictExplanation(explanation).split('\n');

    expect(lines).toHaveLength(6);
    expect(lines[0]).toBe('✘ Failed: 6 blocking checks.');
    expect(lines.some((line) => line.includes('(+3 more)'))).toBe(true);
    expect(lines.at(-1)?.startsWith('Next: ')).toBe(true);
  });

  test('multi-line details are collapsed into one line per check', () => {
    const explanation = explainVerdict(
      verdictOf([check('tests', false, 'tests: exit 1; output tail:\nline one\nline two')]),
    );
    const lines = formatVerdictExplanation(explanation).split('\n');

    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('line one line two');
    expect(lines[1]?.includes('\n')).toBe(false);
  });

  test('a reviewer fix instruction with a list marker becomes the next step', () => {
    const verdict = verdictOf([check('llm-review', false, 'reviewer: no')], {
      fixInstructions: '1. Add the round-trip test in src/features/export/index.test.ts.\n2. Re-run.',
    });
    expect(explainVerdict(verdict).nextStep).toBe(
      'Add the round-trip test in src/features/export/index.test.ts.',
    );
  });

  test('a failure with no instructions still offers the failing check’s hint', () => {
    const verdict = verdictOf([check('non-empty', false, 'diff is empty: no files changed')]);
    expect(explainVerdict(verdict).nextStep).toContain('Implement the deliverables');
  });
});

describe('explainVerdict — browser-safe module', () => {
  test('explain.ts imports core types only, never runtime code', () => {
    const source = readFileSync(join(import.meta.dir, 'explain.ts'), 'utf8');
    expect(source).toContain("import type { AuditCheck, AuditVerdict } from '@starling/core';");
    expect(source).not.toMatch(/^import \{[^}]*\} from '@starling\/core'/m);
    expect(source).not.toMatch(/from ['"]node:/);
    expect(source).not.toMatch(/from ['"]bun:/);
  });
});
