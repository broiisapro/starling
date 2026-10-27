import { describe, expect, test } from 'bun:test';
import { checkLane, isBookkeepingPath, STARLING_BOOKKEEPING_GLOBS } from './lane.ts';

describe('checkLane', () => {
  test('passes when every file is owned by the task', () => {
    const result = checkLane(
      ['src/features/export/index.ts', 'src/features/export/index.test.ts'],
      ['src/features/export/**'],
    );
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
    expect(result.checked).toBe(2);
  });

  test('reports out-of-lane files in diff order and normalises them', () => {
    const result = checkLane(
      ['./src/features/export/index.ts', 'src/ui/render.ts', 'package.json'],
      ['src/features/export/**'],
    );
    expect(result.ok).toBe(false);
    expect(result.violations).toEqual(['src/ui/render.ts', 'package.json']);
  });

  test('honours directory semantics for a literal lane path', () => {
    expect(checkLane(['src/ui/render.ts'], ['src/ui']).ok).toBe(true);
    expect(checkLane(['src/ui-extra/render.ts'], ['src/ui']).ok).toBe(false);
  });

  test('an empty owns list is a violation, never a wildcard', () => {
    const result = checkLane(['src/features/export/index.ts'], []);
    expect(result.ok).toBe(false);
    expect(result.violations).toEqual(['src/features/export/index.ts']);
  });

  test('exempts Starling bookkeeping files', () => {
    const result = checkLane(
      ['src/features/export/index.ts', '.starling/runs/run-1.jsonl', '.starling-worktrees/run-1/README.md'],
      ['src/features/export/**'],
    );
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });
});

describe('isBookkeepingPath', () => {
  test('recognises the framework paths only', () => {
    expect(STARLING_BOOKKEEPING_GLOBS).toContain('.starling/**');
    expect(isBookkeepingPath('.starling/starling.db')).toBe(true);
    expect(isBookkeepingPath('./.starling/events/run-1.jsonl')).toBe(true);
    expect(isBookkeepingPath('src/.starling/notes.md')).toBe(false);
    expect(isBookkeepingPath('bun.lock')).toBe(false);
  });
});
