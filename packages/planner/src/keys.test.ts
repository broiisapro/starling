import { describe, expect, test } from 'bun:test';
import { assignTaskKeys, dependencyOrder, stripTaskNumber } from './keys';
import { planOf, task } from './test-fixtures';

describe('stripTaskNumber', () => {
  test('removes exactly one zero-padded number prefix', () => {
    expect(stripTaskNumber('t01-dates-fix')).toBe('dates-fix');
    expect(stripTaskNumber('t123-csv-export')).toBe('csv-export');
    expect(stripTaskNumber('dates-fix')).toBe('dates-fix');
    expect(stripTaskNumber('t1-short')).toBe('t1-short');
  });
});

describe('dependencyOrder', () => {
  test('puts dependencies before dependents and keeps model order for ties', () => {
    const tasks = [task('c', { dependsOn: ['b'] }), task('a'), task('b', { dependsOn: ['a'] })];
    expect(dependencyOrder(tasks)).toEqual([1, 2, 0]);
  });

  test('is stable for a plan with no edges', () => {
    expect(dependencyOrder([task('b'), task('a'), task('c')])).toEqual([0, 1, 2]);
  });

  test('survives a cycle by falling back to the original order', () => {
    const tasks = [task('a', { dependsOn: ['b'] }), task('b', { dependsOn: ['a'] })];
    expect(dependencyOrder(tasks)).toHaveLength(2);
  });
});

describe('assignTaskKeys', () => {
  test('renumbers tasks in dependency order and rewrites dependsOn', () => {
    const plan = planOf([
      task('wire', { dependsOn: ['dates-fix', 'theme'] }),
      task('theme'),
      task('dates-fix'),
    ]);
    const keyed = assignTaskKeys(plan);

    expect(keyed.tasks.map((entry) => entry.key)).toEqual(['t01-theme', 't02-dates-fix', 't03-wire']);
    expect(keyed.tasks[2]?.dependsOn).toEqual(['t02-dates-fix', 't01-theme']);
  });

  test('keeps the descriptive slug and is idempotent', () => {
    const once = assignTaskKeys(
      planOf([task('csv-export'), task('due-badges', { dependsOn: ['csv-export'] })]),
    );
    const twice = assignTaskKeys(once);
    expect(once.tasks.map((entry) => entry.key)).toEqual(['t01-csv-export', 't02-due-badges']);
    expect(twice.tasks.map((entry) => entry.key)).toEqual(once.tasks.map((entry) => entry.key));
    expect(twice.tasks.map((entry) => entry.dependsOn)).toEqual(once.tasks.map((entry) => entry.dependsOn));
  });

  test('never leaves a self-dependency after renaming', () => {
    const keyed = assignTaskKeys(planOf([task('solo', { dependsOn: ['solo'] })]));
    expect(keyed.tasks[0]?.key).toBe('t01-solo');
    expect(keyed.tasks[0]?.dependsOn).toEqual([]);
  });

  test('an empty plan stays empty', () => {
    expect(assignTaskKeys(planOf([])).tasks).toEqual([]);
  });
});
