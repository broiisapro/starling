import { describe, expect, test } from 'bun:test';
import type { Plan } from '@starling/core';
import { globsOverlap, isStarlingError } from '@starling/core';
import { applyLaneSuggestion, criticalPathMinutes, suggestLanes } from './suggest';
import { loadRepoMapFixture, planOf, task } from './test-fixtures';
import { validatePlan } from './validate';

const map = loadRepoMapFixture();

function errorSignatures(plan: Plan): Set<string> {
  return new Set(
    validatePlan(plan)
      .filter((issue) => issue.severity === 'error')
      .map((issue) => `${issue.code}:${[...issue.taskKeys].sort().join(',')}`),
  );
}

function onlySuggestion(plan: Plan, kind: 'serialise' | 'narrow' | 'merge') {
  const found = suggestLanes(plan, map).filter((entry) => entry.kind === kind);
  expect(found).toHaveLength(1);
  return found[0] as NonNullable<(typeof found)[0]>;
}

describe('suggestLanes — pairs', () => {
  test('a clean plan has nothing to suggest', () => {
    expect(suggestLanes(planOf([task('a'), task('b')]), map)).toEqual([]);
  });

  test('an ancestor pair that shares a file is legal and suggests nothing', () => {
    const plan = planOf([
      task('a', { lane: { owns: ['src/ui/styles.css'], reads: [] } }),
      task('b', {
        dependsOn: ['a'],
        lane: { owns: ['src/ui/styles.css'], reads: [] },
      }),
    ]);
    expect(suggestLanes(plan, map)).toEqual([]);
  });

  test('one suggestion set per overlapping concurrent pair, deterministically ordered', () => {
    const plan = planOf([
      task('c', { lane: { owns: ['src/features/theme/**'], reads: [] } }),
      task('a', { lane: { owns: ['src/features/theme/**'], reads: [] } }),
    ]);
    const first = suggestLanes(plan, map);
    const second = suggestLanes(plan, map);

    expect(first).toEqual(second);
    expect(first[0]?.taskKeys).toEqual(['a', 'c']);
    expect(first.map((entry) => entry.kind)).toEqual(['serialise', 'merge']);
  });

  test('suggestions are pure: the input plan is untouched', () => {
    const plan = planOf([
      task('a', { lane: { owns: ['src/ui/**'], reads: [] } }),
      task('b', { lane: { owns: ['src/ui/styles.css'], reads: [] } }),
    ]);
    const before = structuredClone(plan);
    const suggestions = suggestLanes(plan, map);
    for (const suggestion of suggestions) applyLaneSuggestion(plan, suggestion);
    expect(plan).toEqual(before);
  });
});

describe('suggestLanes — serialise', () => {
  test('adds the edge in the direction that keeps the critical path shortest', () => {
    const plan = planOf([
      task('root', { estimateMin: 30 }),
      task('a', {
        estimateMin: 10,
        dependsOn: ['root'],
        lane: { owns: ['src/ui/**'], reads: [] },
      }),
      task('b', { estimateMin: 10, lane: { owns: ['src/ui/styles.css'], reads: [] } }),
    ]);

    const suggestion = onlySuggestion(plan, 'serialise');

    expect(suggestion.patch).toEqual({ kind: 'serialise', task: 'a', dependsOn: 'b' });
    expect(suggestion.rationale).toContain('40 min instead of 50');
    expect(criticalPathMinutes(applyLaneSuggestion(plan, suggestion).tasks)).toBe(40);
  });

  test('serialising either way is valid when the critical path ties', () => {
    const plan = planOf([
      task('a', { estimateMin: 10, lane: { owns: ['src/ui/**'], reads: [] } }),
      task('b', { estimateMin: 10, lane: { owns: ['src/ui/styles.css'], reads: [] } }),
    ]);
    const suggestion = onlySuggestion(plan, 'serialise');
    expect(suggestion.patch).toEqual({ kind: 'serialise', task: 'b', dependsOn: 'a' });
    expect(criticalPathMinutes(applyLaneSuggestion(plan, suggestion).tasks)).toBe(20);
  });

  test('applying a serialise removes the pair from the validator', () => {
    const plan = planOf([
      task('a', { lane: { owns: ['src/ui/**'], reads: [] } }),
      task('b', { lane: { owns: ['src/ui/styles.css'], reads: [] } }),
    ]);
    const applied = applyLaneSuggestion(plan, onlySuggestion(plan, 'serialise'));
    const pairIssues = validatePlan(applied).filter(
      (issue) =>
        issue.code === 'lane-overlap' && issue.taskKeys.includes('a') && issue.taskKeys.includes('b'),
    );

    expect(pairIssues).toEqual([]);
    expect(errorSignatures(applied)).toEqual(new Set());
  });

  test('criticalPathMinutes follows the longest chain', () => {
    expect(
      criticalPathMinutes([
        task('a', { estimateMin: 5 }),
        task('b', { estimateMin: 7, dependsOn: ['a'] }),
        task('c', { estimateMin: 3, dependsOn: ['b'] }),
      ]),
    ).toBe(15);
  });
});

describe('suggestLanes — narrow', () => {
  const plan = planOf([
    task('a', { lane: { owns: ['src/ui/**'], reads: [] } }),
    task('b', { lane: { owns: ['src/ui/styles.css'], reads: [] } }),
  ]);

  test('needs a repo map: without one only serialise/merge are offered', () => {
    expect(suggestLanes(plan).some((entry) => entry.kind === 'narrow')).toBe(false);
  });

  test('replaces a broad glob with the concrete files it keeps', () => {
    const suggestion = onlySuggestion(plan, 'narrow');

    expect(suggestion.patch).toEqual({ kind: 'narrow', task: 'a', owns: ['src/ui/render.ts'] });
    expect(suggestion.rationale).toContain('leave the shared files to "b"');
  });

  test('applying a narrow removes the overlap and keeps an auditable lane', () => {
    const applied = applyLaneSuggestion(plan, onlySuggestion(plan, 'narrow'));
    const a = applied.tasks.find((entry) => entry.key === 'a');
    const b = applied.tasks.find((entry) => entry.key === 'b');

    expect(globsOverlap(a?.lane.owns ?? [], b?.lane.owns ?? [])).toEqual([]);
    expect(a?.lane.owns.length).toBeGreaterThan(0);
    expect(errorSignatures(applied)).toEqual(new Set());
  });

  test('is not offered for a pair whose files are all new (nothing to enumerate)', () => {
    const newFolders = planOf([
      task('a', { lane: { owns: ['src/features/fresh/**'], reads: [] } }),
      task('b', { lane: { owns: ['src/features/fresh/deep.ts'], reads: [] } }),
    ]);
    expect(suggestLanes(newFolders, map).some((entry) => entry.kind === 'narrow')).toBe(false);
  });
});

describe('suggestLanes — merge', () => {
  test('merges a pair whose lanes are almost entirely shared', () => {
    const plan = planOf([
      task('theme', { estimateMin: 10, lane: { owns: ['src/features/theme/**'], reads: [] } }),
      task('theme-two', { estimateMin: 5, lane: { owns: ['src/features/theme/**'], reads: [] } }),
    ]);
    const suggestion = onlySuggestion(plan, 'merge');

    expect(suggestion.patch).toEqual({ kind: 'merge', keep: 'theme', absorb: 'theme-two' });
    expect(suggestion.rationale).toContain('100%');
  });

  test('apply folds fields, sums estimates and repoints dependents', () => {
    const plan = planOf([
      task('theme', {
        estimateMin: 10,
        deliverables: ['one.ts'],
        lane: { owns: ['src/features/theme/**'], reads: ['src/main.ts'] },
      }),
      task('theme-two', {
        estimateMin: 5,
        deliverables: ['two.ts'],
        lane: { owns: ['src/features/theme/**'], reads: ['src/store/todos.ts'] },
      }),
      task('consumer', {
        dependsOn: ['theme-two'],
        lane: { owns: ['src/features/consumer/**'], reads: [] },
      }),
    ]);

    const applied = applyLaneSuggestion(plan, onlySuggestion(plan, 'merge'));
    const merged = applied.tasks.find((entry) => entry.key === 'theme');
    const consumer = applied.tasks.find((entry) => entry.key === 'consumer');

    expect(applied.tasks.map((entry) => entry.key)).toEqual(['theme', 'consumer']);
    expect(merged?.estimateMin).toBe(15);
    expect(merged?.deliverables).toEqual(['one.ts', 'two.ts']);
    expect(merged?.lane.reads).toEqual(['src/main.ts', 'src/store/todos.ts']);
    expect(consumer?.dependsOn).toEqual(['theme']);
    expect(errorSignatures(applied)).toEqual(new Set());
  });

  test('a mostly-disjoint pair is not merged', () => {
    const plan = planOf([
      task('theme', { lane: { owns: ['src/features/theme/**'], reads: [] } }),
      task('search', { lane: { owns: ['src/ui/styles.css'], reads: [] } }),
    ]);
    expect(suggestLanes(plan, map).some((entry) => entry.kind === 'merge')).toBe(false);
  });
});

describe('applyLaneSuggestion — safety', () => {
  test('every suggestion on a mixed plan applies without a new error', () => {
    const plan = planOf([
      task('root', { estimateMin: 30 }),
      task('a', { dependsOn: ['root'], lane: { owns: ['src/ui/**'], reads: [] } }),
      task('b', { lane: { owns: ['src/ui/styles.css'], reads: [] } }),
      task('c', { lane: { owns: ['src/features/theme/**'], reads: [] } }),
      task('d', { lane: { owns: ['src/features/theme/**'], reads: [] } }),
    ]);
    const before = errorSignatures(plan);
    const suggestions = suggestLanes(plan, map);
    expect(suggestions.length).toBeGreaterThan(2);

    for (const suggestion of suggestions) {
      const after = errorSignatures(applyLaneSuggestion(plan, suggestion));
      for (const signature of after) {
        expect(before.has(signature) || !signature.startsWith('lane-overlap:')).toBe(true);
      }
    }
  });

  test('a patch for an unknown task throws INVALID_ARGUMENT', () => {
    const plan = planOf([task('a')]);
    try {
      applyLaneSuggestion(plan, {
        kind: 'serialise',
        taskKeys: ['a', 'ghost'],
        rationale: 'test',
        patch: { kind: 'serialise', task: 'ghost', dependsOn: 'a' },
      });
      throw new Error('expected applyLaneSuggestion to throw');
    } catch (err) {
      expect(isStarlingError(err, 'INVALID_ARGUMENT')).toBe(true);
    }
  });

  test('a mismatched kind/patch pair throws INVALID_ARGUMENT', () => {
    const plan = planOf([task('a'), task('b')]);
    try {
      applyLaneSuggestion(plan, {
        kind: 'merge',
        taskKeys: ['a', 'b'],
        rationale: 'test',
        patch: { kind: 'serialise', task: 'b', dependsOn: 'a' },
      });
      throw new Error('expected applyLaneSuggestion to throw');
    } catch (err) {
      expect(isStarlingError(err, 'INVALID_ARGUMENT')).toBe(true);
    }
  });
});
