import { describe, expect, test } from 'bun:test';
import type { PlanIssue } from '@starling/core';
import { explainIssues } from './explain';
import { planOf, task } from './test-fixtures';
import { validatePlan } from './validate';

function issue(overrides: Partial<PlanIssue> = {}): PlanIssue {
  return {
    severity: 'error',
    code: 'other',
    message: 'something is wrong',
    taskKeys: ['a'],
    ...overrides,
  };
}

describe('explainIssues', () => {
  test('a clean plan says so', () => {
    expect(explainIssues([])).toBe('No plan issues.');
  });

  test('heads with singular counts', () => {
    expect(explainIssues([issue()])).toBe(
      '1 error\n\nErrors\n  other (1)\n    - something is wrong [tasks: a]',
    );
  });

  test('groups by severity and then by code, keeping issue order', () => {
    const text = explainIssues([
      issue({
        severity: 'error',
        code: 'cycle',
        message: 'dependency cycle: a -> b -> a',
        taskKeys: ['a', 'b'],
      }),
      issue({ severity: 'warn', code: 'other', message: 'a warning', taskKeys: [] }),
      issue({
        severity: 'error',
        code: 'cycle',
        message: 'dependency cycle: c -> d -> c',
        taskKeys: ['c', 'd'],
      }),
    ]);

    expect(text.split('\n')[0]).toBe('2 errors, 1 warning');
    expect(text).toContain('Errors\n  cycle (2)');
    expect(text).toContain('    - dependency cycle: a -> b -> a [tasks: a, b]');
    expect(text).toContain('    - dependency cycle: c -> d -> c [tasks: c, d]');
    expect(text).toContain('Warnings\n  other (1)');
    expect(text.indexOf('cycle (2)')).toBeLessThan(text.indexOf('Warnings'));
    // Plan-level issues (no keys) do not print an empty bracket.
    expect(text).toContain('    - a warning');
    expect(text).not.toContain('[tasks: ]');
  });

  test('explains real validator output, one block per code', () => {
    const issues = validatePlan(
      planOf([
        task('a', { dependsOn: ['ghost'], lane: { owns: [], reads: [] } }),
        task('b', { definitionOfDone: [] }),
      ]),
    );
    const text = explainIssues(issues);

    expect(text).toContain('Errors');
    expect(text).toContain('empty-lane (1)');
    expect(text).toContain('empty-dod (1)');
    expect(text).toContain('missing-dep (1)');
  });

  test.each([
    ['cycle', 'error'],
    ['missing-dep', 'error'],
    ['lane-overlap', 'error'],
    ['empty-dod', 'error'],
    ['empty-lane', 'error'],
    ['other', 'error'],
  ] as const)('renders the %s code', (code, severity) => {
    const text = explainIssues([issue({ code, severity, message: `${code} message` })]);
    expect(text).toContain(`  ${code} (1)`);
    expect(text).toContain(`    - ${code} message [tasks: a]`);
  });
});
