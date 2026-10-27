import { describe, expect, test } from 'bun:test';
import type { Plan, PlanIssue, RepoMap } from '@starling/core';
import { loadPlanFixture, loadRepoMapFixture, planOf, task } from './test-fixtures';
import { globCanNameNewFile, hasErrors, validatePlan, warningsOf } from './validate';

const map = loadRepoMapFixture();

function mapWithFiles(count: number): RepoMap {
  return {
    root: '/tmp/big-repo',
    tree: '',
    languages: { typescript: count },
    files: Array.from({ length: count }, (_, index) => ({
      path: `src/big/file-${String(index).padStart(2, '0')}.ts`,
      bytes: 100,
      lang: 'typescript',
      symbols: [],
    })),
    tokenEstimate: count * 10,
    createdAt: 0,
  };
}

function swarmPlan(count: number, lane: string): Plan {
  return planOf(
    Array.from({ length: count }, (_, index) =>
      task(`s${String(index).padStart(3, '0')}`, {
        estimateMin: 10,
        lane: { owns: [lane], reads: [] },
      }),
    ),
  );
}

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

describe('actionable hints', () => {
  const cases: Array<{ name: string; plan: Plan; code: PlanIssue['code']; prefix: string; hint: string }> = [
    {
      name: 'cycle',
      plan: planOf([task('a', { dependsOn: ['b'] }), task('b', { dependsOn: ['a'] })]),
      code: 'cycle',
      prefix: 'dependency cycle: ',
      hint: 'dependsOn',
    },
    {
      name: 'missing-dep',
      plan: planOf([task('a', { dependsOn: ['ghost'] })]),
      code: 'missing-dep',
      prefix: 'task "a" depends on unknown task "ghost"',
      hint: 'add a task with key "ghost"',
    },
    {
      name: 'lane-overlap',
      plan: planOf([
        task('a', { lane: { owns: ['src/ui/styles.css'], reads: [] } }),
        task('b', { lane: { owns: ['src/ui/styles.css'], reads: [] } }),
      ]),
      code: 'lane-overlap',
      prefix: 'tasks "a" and "b" can run concurrently but their lanes overlap: ',
      hint: 'add "a" to b.dependsOn or narrow b\'s lane',
    },
    {
      name: 'empty-dod',
      plan: planOf([task('a', { definitionOfDone: [] })]),
      code: 'empty-dod',
      prefix: 'task "a" has an empty definitionOfDone; the auditor cannot verify it',
      hint: 'add the test command plus one observable assertion',
    },
    {
      name: 'empty-lane',
      plan: planOf([task('a', { lane: { owns: [], reads: [] } })]),
      code: 'empty-lane',
      prefix: 'task "a" has an empty lane.owns; a worker would have nowhere to write',
      hint: 'add the folder this capability creates',
    },
    {
      name: 'other (duplicate key)',
      plan: planOf([task('dup'), task('dup', { lane: { owns: ['src/features/other/**'], reads: [] } })]),
      code: 'other',
      prefix: 'task key "dup" appears 2 times; keys must be unique',
      hint: 'rename all but one "dup"',
    },
  ];

  test.each(cases.map((entry) => [entry.name, entry] as const))(
    '%s keeps its first clause and appends a fix',
    (_name, { plan, code, prefix, hint }) => {
      const found = validatePlan(plan).find((entry) => entry.code === code);
      expect(found).toBeDefined();
      expect(found?.message.startsWith(prefix)).toBe(true);
      expect(found?.message).toContain('; fix: ');
      expect(found?.message).toContain(hint);
    },
  );

  test('warnings carry hints too', () => {
    const issues = validatePlan(
      planOf([
        task('big', { estimateMin: 90 }),
        task('vague', { definitionOfDone: ['It looks nice'] }),
        task('legacy', { lane: { owns: ['vendor/legacy/**'], reads: [] } }),
      ]),
      { map, minTasks: 1 },
    );
    const warnings = warningsOf(issues);
    expect(warnings.length).toBeGreaterThanOrEqual(3);
    expect(warnings.every((entry) => entry.message.includes('; fix: '))).toBe(true);
    expect(warnings.some((entry) => entry.message.includes('split "big"'))).toBe(true);
    expect(warnings.some((entry) => entry.message.includes('<test command> passes'))).toBe(true);
    expect(warnings.some((entry) => entry.message.includes('existing folder'))).toBe(true);
  });

  test('the task-count warning explains both directions', () => {
    const tooFew = validatePlan(planOf([task('a')]), { minTasks: 3 });
    expect(tooFew[0]?.message).toContain('outside the configured bounds (3..12)');
    expect(tooFew[0]?.message).toContain('lower minTasks to 1');

    const many = swarmPlan(15, 'src/shared/**');
    const tooMany = validatePlan(many, { minTasks: 1, maxTasks: 12 });
    const countWarning = tooMany.find((entry) => entry.message.includes('outside the configured bounds'));
    expect(countWarning?.message).toContain('raise maxTasks above 15');
  });
});

describe('lane-size warning', () => {
  test('warns above the default 40 owned files, naming the count', () => {
    const bigMap = mapWithFiles(45);
    const issues = warningsOf(
      validatePlan(planOf([task('wide', { lane: { owns: ['src/big/**'], reads: [] } })]), {
        map: bigMap,
      }),
    );
    const warning = issues.find((entry) => entry.message.includes('above the 40-file'));

    expect(warning).toBeDefined();
    expect(warning?.severity).toBe('warn');
    expect(warning?.code).toBe('other');
    expect(warning?.taskKeys).toEqual(['wide']);
    expect(warning?.message).toContain('owns 45 files');
    expect(warning?.message).toContain('split it into per-capability tasks');
  });

  test('exactly the threshold is fine', () => {
    const issues = validatePlan(planOf([task('wide', { lane: { owns: ['src/big/**'], reads: [] } })]), {
      map: mapWithFiles(40),
    });
    expect(warningsOf(issues).some((entry) => entry.message.includes('-file advisory limit'))).toBe(false);
  });

  test('ownedFilesWarnAt overrides the threshold', () => {
    const issues = validatePlan(planOf([task('wide', { lane: { owns: ['src/big/**'], reads: [] } })]), {
      map: mapWithFiles(6),
      ownedFilesWarnAt: 5,
    });
    expect(warningsOf(issues).some((entry) => entry.message.includes('above the 5-file'))).toBe(true);
  });

  test('counts the union of globs without double-counting files', () => {
    const issues = validatePlan(
      planOf([task('wide', { lane: { owns: ['src/big/**', 'src/big/file-00.ts'], reads: [] } })]),
      { map: mapWithFiles(45) },
    );
    const warning = warningsOf(issues).find((entry) => entry.message.includes('files in the repo map'));
    expect(warning?.message).toContain('owns 45 files');
  });

  test('is skipped without a repo map', () => {
    const issues = validatePlan(planOf([task('wide', { lane: { owns: ['src/**'], reads: [] } })]));
    expect(issues).toEqual([]);
  });
});

describe('swarm-scale validation (op counts, not wall clock)', () => {
  test('60 tasks with one shared lane produce exactly one issue per concurrent pair', () => {
    const issues = validatePlan(swarmPlan(60, 'src/shared/**'), { minTasks: 1, maxTasks: 60 });
    const overlaps = issues.filter((entry) => entry.code === 'lane-overlap');

    // C(60, 2): every pair is examined once and reported once. This is the validator's work unit.
    expect(overlaps).toHaveLength((60 * 59) / 2);
    expect(overlaps[0]?.taskKeys).toEqual(['s000', 's001']);
    expect(overlaps.at(-1)?.taskKeys).toEqual(['s058', 's059']);
    expect(issues.filter((entry) => entry.code !== 'lane-overlap')).toEqual([]);
  });

  test('60 disjoint lanes examine the same pairs but report nothing', () => {
    const tasks = Array.from({ length: 60 }, (_, index) =>
      task(`s${String(index).padStart(3, '0')}`, {
        estimateMin: 10,
        lane: { owns: [`src/features/f${String(index).padStart(3, '0')}/**`], reads: [] },
      }),
    );
    expect(validatePlan(planOf(tasks), { minTasks: 1, maxTasks: 60 })).toEqual([]);
  });

  test('a 100-task plan at the hard limit is accepted without a count warning', () => {
    const tasks = Array.from({ length: 100 }, (_, index) =>
      task(`s${String(index).padStart(3, '0')}`, {
        estimateMin: 5,
        lane: { owns: [`src/features/f${String(index).padStart(3, '0')}/**`], reads: [] },
      }),
    );
    const issues = validatePlan(planOf(tasks), { minTasks: 1, maxTasks: 100 });
    expect(issues.filter((entry) => entry.message.includes('outside the configured bounds'))).toEqual([]);
  });
});
