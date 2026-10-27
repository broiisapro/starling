import { describe, expect, test } from 'bun:test';
import type { TaskSpec } from '@starling/core';
import { diffPlans, formatPlanDiff, normalizeTaskTitle } from './diff';
import { planOf, task } from './test-fixtures';

function keys(tasks: TaskSpec[]): string[] {
  return tasks.map((entry) => entry.key);
}

/** A task whose fields other than the ones under test are identical across keys. */
function stable(key: string, overrides: Partial<TaskSpec> = {}): TaskSpec {
  return task(key, {
    title: 'Stable title',
    goal: 'stable goal',
    deliverables: ['stable.ts'],
    outOfScope: ['stable scope'],
    definitionOfDone: ['bun test passes', 'stable assertion'],
    lane: { owns: ['src/features/stable/**'], reads: [] },
    ...overrides,
  });
}

describe('diffPlans — identity matching', () => {
  test('identical plans produce an empty diff', () => {
    const a = planOf([task('one'), task('two')]);
    const b = planOf([task('one'), task('two')]);
    const diff = diffPlans(a, b);

    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.renamed).toEqual([]);
    expect(diff.changed).toEqual([]);
    expect(diff.unchanged).toEqual(['one', 'two']);
    expect(diff.summary).toBe('0 added, 0 removed, 0 renamed, 0 changed, 2 unchanged');
  });

  test('reordering tasks is not a change', () => {
    const diff = diffPlans(planOf([task('one'), task('two')]), planOf([task('two'), task('one')]));

    expect(diff.changed).toEqual([]);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    // Unchanged follows the older plan's task order.
    expect(diff.unchanged).toEqual(['one', 'two']);
  });

  test('a new task is added, in the newer plan order', () => {
    const diff = diffPlans(planOf([task('one')]), planOf([task('zero'), task('one'), task('two')]));

    expect(keys(diff.added)).toEqual(['zero', 'two']);
    expect(diff.removed).toEqual([]);
    expect(diff.unchanged).toEqual(['one']);
  });

  test('a deleted task is removed, in the older plan order', () => {
    const diff = diffPlans(planOf([task('one'), task('two'), task('three')]), planOf([task('two')]));

    expect(keys(diff.removed)).toEqual(['one', 'three']);
    expect(diff.added).toEqual([]);
  });

  test('a re-keyed task with the same title is a rename, not add+remove', () => {
    const before = planOf([stable('old-export', { title: 'CSV export' })]);
    const after = planOf([stable('t04-csv-export', { title: 'CSV export' })]);
    const diff = diffPlans(before, after);

    expect(diff.renamed).toEqual([{ from: 'old-export', to: 't04-csv-export' }]);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.changed).toEqual([]);
    expect(diff.unchanged).toEqual([]);
  });

  test('renamed titles match through the task-number prefix, case and whitespace', () => {
    const before = planOf([task('a', { title: '  CSV   Export ' })]);
    const after = planOf([task('b', { title: 't07-csv export' })]);
    const diff = diffPlans(before, after);

    expect(diff.renamed).toEqual([{ from: 'a', to: 'b' }]);
  });

  test('a rename with edits reports both the rename and the changed fields', () => {
    const before = planOf([stable('a', { title: 'Theme', estimateMin: 10 })]);
    const after = planOf([stable('b', { title: 'Theme', estimateMin: 20 })]);
    const diff = diffPlans(before, after);

    expect(diff.renamed).toEqual([{ from: 'a', to: 'b' }]);
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0]?.key).toBe('b');
    expect(diff.changed[0]?.fields).toEqual(['estimateMin']);
  });

  test('duplicate normalised titles are paired greedily and deterministically', () => {
    const before = planOf([task('a', { title: 'Same' }), task('b', { title: 'Same' })]);
    const after = planOf([task('c', { title: 'Same' })]);
    const diff = diffPlans(before, after);

    expect(diff.renamed).toEqual([{ from: 'a', to: 'c' }]);
    expect(keys(diff.removed)).toEqual(['b']);
  });

  test('plan metadata (id, summary, model) is ignored', () => {
    const before = planOf([task('one', { title: 'One' })], { summary: 'old' });
    const after = planOf([task('one', { title: 'One' })], { summary: 'new' });

    expect(diffPlans(before, after).changed).toEqual([]);
    expect(diffPlans(before, after).unchanged).toEqual(['one']);
  });

  test('normalizeTaskTitle documents its contract', () => {
    expect(normalizeTaskTitle('  t12-csv   Export ')).toBe('csv export');
    expect(normalizeTaskTitle('CSV Export')).toBe('csv export');
  });
});

describe('diffPlans — field changes', () => {
  const before = planOf([
    task('dep'),
    task('dep2'),
    task('x', {
      title: 'Old title',
      goal: 'old goal',
      deliverables: ['old.ts'],
      outOfScope: ['old scope'],
      lane: { owns: ['src/ui/**', 'src/x/**'], reads: ['src/read-a.ts'] },
      dependsOn: ['dep'],
      definitionOfDone: ['bun test passes', 'old assertion'],
      estimateMin: 10,
    }),
  ]);

  const after = planOf([
    task('dep'),
    task('dep2'),
    task('x', {
      title: 'New title',
      goal: 'new goal',
      deliverables: ['new.ts'],
      outOfScope: ['new scope'],
      lane: { owns: ['src/ui/**', 'src/y/**'], reads: ['src/read-b.ts'] },
      dependsOn: ['dep', 'dep2'],
      definitionOfDone: ['bun test passes', 'new assertion'],
      estimateMin: 15,
    }),
  ]);

  test('every changed field is named once, in the documented order', () => {
    const diff = diffPlans(before, after);

    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0]?.key).toBe('x');
    expect(diff.changed[0]?.fields).toEqual([
      'title',
      'lane',
      'dependsOn',
      'definitionOfDone',
      'estimateMin',
      'description',
    ]);
  });

  test('lane additions and removals are listed separately', () => {
    const change = diffPlans(before, after).changed[0];
    expect(change?.laneAdded).toEqual(['src/y/**']);
    expect(change?.laneRemoved).toEqual(['src/x/**']);
  });

  test('dependsOn order alone is not a change', () => {
    const one = planOf([task('a'), task('b'), task('c', { dependsOn: ['a', 'b'] })]);
    const two = planOf([task('a'), task('b'), task('c', { dependsOn: ['b', 'a'] })]);
    expect(diffPlans(one, two).changed).toEqual([]);
  });

  test('definitionOfDone order is a change: the list is read in order', () => {
    const one = planOf([task('a', { definitionOfDone: ['bun test passes', 'first'] })]);
    const two = planOf([task('a', { definitionOfDone: ['first', 'bun test passes'] })]);
    expect(diffPlans(one, two).changed[0]?.fields).toEqual(['definitionOfDone']);
  });

  test('a description-only edit names just description', () => {
    const one = planOf([task('a', { goal: 'one' })]);
    const two = planOf([task('a', { goal: 'two' })]);
    expect(diffPlans(one, two).changed[0]?.fields).toEqual(['description']);
  });

  test('a reads-only lane edit is a lane change with no owned globs added or removed', () => {
    const one = planOf([task('a', { lane: { owns: ['src/features/a/**'], reads: ['src/main.ts'] } })]);
    const two = planOf([task('a', { lane: { owns: ['src/features/a/**'], reads: ['src/store.ts'] } })]);
    const change = diffPlans(one, two).changed[0];
    expect(change?.fields).toEqual(['lane']);
    expect(change?.laneAdded).toEqual([]);
    expect(change?.laneRemoved).toEqual([]);
  });
});

describe('formatPlanDiff', () => {
  test('renders added, removed, renamed, changed and unchanged sections', () => {
    const before = planOf([
      stable('keep', { title: 'Keep' }),
      stable('old-key', { title: 'Renamed' }),
      stable('gone', { title: 'Gone' }),
    ]);
    const after = planOf([
      stable('keep', { title: 'Keep' }),
      stable('new-key', { title: 'Renamed', estimateMin: 20 }),
      stable('fresh', { title: 'Fresh' }),
    ]);

    const markdown = formatPlanDiff(diffPlans(before, after));

    expect(markdown).toContain('# Plan diff');
    expect(markdown).toContain('**Summary:** 1 added, 1 removed, 1 renamed, 1 changed, 1 unchanged');
    expect(markdown).toContain('## Added (1)');
    expect(markdown).toContain('- `fresh` — Fresh');
    expect(markdown).toContain('## Removed (1)');
    expect(markdown).toContain('- `gone` — Gone');
    expect(markdown).toContain('## Renamed (1)');
    expect(markdown).toContain('- `old-key` -> `new-key`');
    expect(markdown).toContain('## Changed (1)');
    expect(markdown).toContain('- `new-key`: estimateMin');
    expect(markdown).toContain('## Unchanged (1)');
    expect(markdown).toContain('- `keep`');
  });

  test('renders lane additions and removals inline', () => {
    const before = planOf([task('a', { lane: { owns: ['src/old/**'], reads: [] } })]);
    const after = planOf([task('a', { lane: { owns: ['src/new/**'], reads: [] } })]);
    const markdown = formatPlanDiff(diffPlans(before, after));

    expect(markdown).toContain('- `a`: lane (lane +src/new/** -src/old/**)');
  });

  test('a clean diff says so instead of printing empty sections', () => {
    const markdown = formatPlanDiff(diffPlans(planOf([task('a')]), planOf([task('a')])));

    expect(markdown).toContain('0 added, 0 removed, 0 renamed, 0 changed, 1 unchanged');
    expect(markdown).toContain('No task changes.');
    expect(markdown).not.toContain('## Added');
    expect(markdown).not.toContain('## Unchanged');
  });
});
