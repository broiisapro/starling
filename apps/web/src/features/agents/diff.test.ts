import './test-env';
import { describe, expect, test } from 'bun:test';
import type { DiffSummary } from '@starling/core';
import { classifyPatchLine, diffFiles, parsePatch } from './diff';

const PATCH = [
  'diff --git a/src/lib/dates.ts b/src/lib/dates.ts',
  'index 1111111..2222222 100644',
  '--- a/src/lib/dates.ts',
  '+++ b/src/lib/dates.ts',
  '@@ -1,3 +1,4 @@',
  ' const keep = 1;',
  '-const old = 2;',
  '+const next = 2;',
  '+const added = 3;',
  ' export { keep };',
  'diff --git a/src/features/theme/index.ts b/src/features/theme/index.ts',
  'new file mode 100644',
  '--- /dev/null',
  '+++ b/src/features/theme/index.ts',
  '@@ -0,0 +1,2 @@',
  '+export const theme = "dark";',
  '+export const toggle = () => {};',
].join('\n');

describe('parsePatch', () => {
  test('splits a multi-file patch and counts additions and removals', () => {
    const files = parsePatch(PATCH);
    expect(files.map((file) => file.path)).toEqual(['src/lib/dates.ts', 'src/features/theme/index.ts']);
    expect(files[0]).toMatchObject({ added: 2, removed: 1 });
    expect(files[1]).toMatchObject({ added: 2, removed: 0 });
  });

  test('classifies every line kind', () => {
    expect(classifyPatchLine('@@ -1 +1 @@')).toBe('hunk');
    expect(classifyPatchLine('+added')).toBe('add');
    expect(classifyPatchLine('-removed')).toBe('del');
    expect(classifyPatchLine(' context')).toBe('ctx');
    expect(classifyPatchLine('+++ b/file.ts')).toBe('meta');
    expect(classifyPatchLine('index 111..222')).toBe('meta');
    expect(classifyPatchLine('\\ No newline at end of file')).toBe('meta');
  });

  test('handles a hunk-only patch by naming it (patch)', () => {
    const files = parsePatch('@@ -1 +1 @@\n-old\n+new');
    expect(files[0]?.path).toBe('(patch)');
    expect(files[0]?.added).toBe(1);
    expect(files[0]?.removed).toBe(1);
  });

  test('returns an empty list for an empty patch', () => {
    expect(parsePatch('')).toEqual([]);
  });
});

describe('diffFiles', () => {
  const summary: DiffSummary = {
    files: [
      { path: 'src/lib/dates.ts', added: 2, removed: 1 },
      { path: 'src/ui/binary.png', added: 0, removed: 0 },
    ],
    patch: PATCH,
    truncated: true,
  };

  test('joins summary counts with parsed lines', () => {
    const files = diffFiles(summary);
    expect(files[0]?.path).toBe('src/lib/dates.ts');
    expect(files[0]?.added).toBe(2);
    expect(files[0]?.lines.some((line) => line.kind === 'add')).toBe(true);
    expect(files[1]?.lines).toEqual([]);
  });

  test('keeps files that only appear in the patch', () => {
    const files = diffFiles(summary);
    expect(files.map((file) => file.path)).toContain('src/features/theme/index.ts');
  });

  test('returns nothing for a missing diff', () => {
    expect(diffFiles(undefined)).toEqual([]);
  });
});
