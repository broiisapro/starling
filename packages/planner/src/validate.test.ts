import { describe, expect, test } from 'bun:test';
import type { PlanIssue } from '@starling/core';
import { loadPlanFixture, loadRepoMapFixture, planOf, task } from './test-fixtures';
import { globCanNameNewFile, hasErrors, validatePlan, warningsOf } from './validate';

const map = loadRepoMapFixture();

function codes(issues: PlanIssue[]): string[] {
  return issues.map((issue) => issue.code);
}

function errors(issues: PlanIssue[]): PlanIssue[] {
  return issues.filter((issue) => issue.severity === 'error');
}

describe('validatePlan on the launch-day fixture', () => {
  test('the recorded sky-todo plan is clean: no errors and no warnings', () => {
    const issues = validatePlan(loadPlanFixture(), { map });
    expect(issues).toEqual([]);
  });

  test('the same plan without a repo map still has no issues', () => {
    expect(validatePlan(loadPlanFixture())).toEqual([]);
  });
});

describe('validatePlan errors', () => {
  test('duplicate task keys', () => {
    const issues = validatePlan(
      planOf([task('dup'), task('dup', { lane: { owns: ['src/features/other/**'], reads: [] } })]),
    );
    expect(errors(issues)).toHaveLength(1);
    expect(errors(issues)[0]?.code).toBe('other');
    expect(errors(issues)[0]?.message).toContain('"dup" appears 2 times');
  });

  test('empty definitionOfDone', () => {
    const issues = errors(validatePlan(planOf([task('a', { definitionOfDone: [] })])));
    expect(codes(issues)).toEqual(['empty-dod']);
  });

  test('blank-only definitionOfDone counts as empty', () => {
    const issues = errors(validatePlan(planOf([task('a', { definitionOfDone: ['  ', ''] })])));
    expect(codes(issues)).toEqual(['empty-dod']);
  });

  test('empty lane.owns', () => {
    const issues = errors(validatePlan(planOf([task('a', { lane: { owns: [], reads: [] } })])));
    expect(codes(issues)).toEqual(['empty-lane']);
  });

  test('missing dependency names both tasks', () => {
    const issues = errors(validatePlan(planOf([task('a', { dependsOn: ['ghost'] })])));
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe('missing-dep');
    expect(issues[0]?.taskKeys).toEqual(['a', 'ghost']);
  });

  test('cycle reports the path', () => {
    const issues = errors(
      validatePlan(planOf([task('a', { dependsOn: ['b'] }), task('b', { dependsOn: ['a'] })])),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe('cycle');
    expect(issues[0]?.message).toMatch(/a -> b -> a|b -> a -> b/);
  });

  test('lane overlap between concurrent tasks names both keys and the globs', () => {
    const issues = errors(
      validatePlan(
        planOf([
          task('alpha', { lane: { owns: ['src/ui/styles.css'], reads: [] } }),
          task('beta', { lane: { owns: ['src/ui/styles.css'], reads: [] } }),
        ]),
      ),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe('lane-overlap');
    expect(issues[0]?.taskKeys).toEqual(['alpha', 'beta']);
    expect(issues[0]?.message).toContain('src/ui/styles.css <=> src/ui/styles.css');
  });

  test('directory semantics: one task owning a folder overlaps a child folder', () => {
    const issues = errors(
      validatePlan(
        planOf([
          task('wide', { lane: { owns: ['src/features/**'], reads: [] } }),
          task('narrow', { lane: { owns: ['src/features/narrow/**'], reads: [] } }),
        ]),
      ),
    );
    expect(codes(issues)).toEqual(['lane-overlap']);
  });

  test('an ancestor pair is allowed to share a file (it is serialised by the DAG)', () => {
    const issues = validatePlan(
      planOf([
        task('first', { lane: { owns: ['src/ui/styles.css'], reads: [] } }),
        task('second', {
          lane: { owns: ['src/ui/styles.css'], reads: [] },
          dependsOn: ['first'],
        }),
      ]),
    );
    expect(errors(issues)).toEqual([]);
  });

  test('transitive ancestry also allows overlap', () => {
    const issues = validatePlan(
      planOf([
        task('one'),
        task('two', { dependsOn: ['one'] }),
        task('three', { dependsOn: ['two'], lane: { owns: ['src/features/one/**'], reads: [] } }),
      ]),
    );
    expect(errors(issues)).toEqual([]);
  });

  test('reads may overlap freely', () => {
    const issues = validatePlan(
      planOf([
        task('a', { lane: { owns: ['src/features/a/**'], reads: ['src/ui/render.ts'] } }),
        task('b', { lane: { owns: ['src/features/b/**'], reads: ['src/ui/render.ts'] } }),
      ]),
    );
    expect(errors(issues)).toEqual([]);
  });
});

describe('validatePlan warnings', () => {
  test('long estimates warn but do not block', () => {
    const issues = validatePlan(planOf([task('big', { estimateMin: 45 })]), { minTasks: 1 });
    expect(errors(issues)).toEqual([]);
    expect(codes(warningsOf(issues))).toContain('other');
    expect(warningsOf(issues).some((issue) => issue.message.includes('45 min'))).toBe(true);
  });

  test('task count outside the configured bounds warns', () => {
    const issues = validatePlan(planOf([task('solo')]), { minTasks: 2, maxTasks: 12 });
    expect(errors(issues)).toEqual([]);
    expect(warningsOf(issues)[0]?.message).toContain('outside the configured bounds (2..12)');
  });

  test('an owns glob that matches nothing and is not plausible warns', () => {
    const issues = validatePlan(
      planOf([task('legacy', { lane: { owns: ['vendor/legacy/**'], reads: [] } })]),
      { map, minTasks: 1 },
    );
    expect(errors(issues)).toEqual([]);
    expect(codes(warningsOf(issues))).toContain('other');
    expect(warningsOf(issues).some((issue) => issue.message.includes('vendor/legacy/**'))).toBe(true);
  });

  test('a brand-new feature folder under a known folder is plausible', () => {
    const issues = validatePlan(
      planOf([task('fresh', { lane: { owns: ['src/features/brand-new/**'], reads: [] } })]),
      { map, minTasks: 1 },
    );
    expect(issues).toEqual([]);
  });

  test('a definition of done with no test step warns', () => {
    const issues = validatePlan(planOf([task('vague', { definitionOfDone: ['It looks nice'] })]), {
      minTasks: 1,
    });
    expect(errors(issues)).toEqual([]);
    expect(warningsOf(issues).some((issue) => issue.message.includes('no test step'))).toBe(true);
  });
});

describe('globCanNameNewFile', () => {
  test('accepts existing files, new files in known folders and brand-new feature folders', () => {
    expect(globCanNameNewFile('src/lib/dates.ts', map)).toBe(true);
    expect(globCanNameNewFile('src/features/theme/**', map)).toBe(true);
    expect(globCanNameNewFile('src/features/brand-new/**', map)).toBe(true);
    expect(globCanNameNewFile('src/features/theme/new-file.ts', map)).toBe(true);
    expect(globCanNameNewFile('**', map)).toBe(true);
  });

  test('rejects a path in a folder the repo does not have', () => {
    expect(globCanNameNewFile('vendor/legacy/**', map)).toBe(false);
    expect(globCanNameNewFile('src/missing/deep/file.ts', map)).toBe(false);
  });
});

describe('issue helpers', () => {
  test('hasErrors and warningsOf split severities', () => {
    const issues = validatePlan(
      planOf([task('a', { estimateMin: 60 }), task('b', { definitionOfDone: [] })]),
      { minTasks: 1 },
    );
    expect(hasErrors(issues)).toBe(true);
    expect(warningsOf(issues).every((issue) => issue.severity === 'warn')).toBe(true);
  });
});
