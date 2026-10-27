import { expect, test } from 'bun:test';
import { annotateWordDiffs, type PatchLine, wordDiff } from './diff';

function changedText(segments: { text: string; changed: boolean }[]): string {
  return segments
    .filter((segment) => segment.changed)
    .map((segment) => segment.text)
    .join('');
}

test('wordDiff marks only the words that actually changed', () => {
  const diff = wordDiff('export const theme = "light";', 'export const theme = "dark";');

  expect(changedText(diff.before)).toBe('light');
  expect(changedText(diff.after)).toBe('dark');
  expect(diff.before.map((segment) => segment.text).join('')).toBe('export const theme = "light";');
  expect(diff.after.map((segment) => segment.text).join('')).toBe('export const theme = "dark";');
});

test('wordDiff keeps identical lines entirely unchanged', () => {
  const diff = wordDiff('const keep = 1;', 'const keep = 1;');

  expect(diff.before.some((segment) => segment.changed)).toBe(false);
  expect(diff.after.some((segment) => segment.changed)).toBe(false);
});

test('wordDiff handles pure inserts and pure deletes', () => {
  const inserted = wordDiff('const a = 1;', 'const a = 1; const b = 2;');
  expect(changedText(inserted.after)).toContain('b');
  expect(changedText(inserted.before)).toBe('');

  const deleted = wordDiff('const a = 1; const b = 2;', 'const a = 1;');
  expect(changedText(deleted.before)).toContain('b');
  expect(changedText(deleted.after)).toBe('');
});

test('very long lines fall back to a whole-line mark instead of a token diff', () => {
  const long = `${'token '.repeat(300)}end`;
  const diff = wordDiff(long, `${long} more`);

  expect(diff.before).toHaveLength(1);
  expect(diff.before[0]?.changed).toBe(true);
});

test('annotateWordDiffs pairs deletions and additions inside a small hunk', () => {
  const lines: PatchLine[] = [
    { kind: 'meta', text: 'diff --git a/a.ts b/a.ts' },
    { kind: 'hunk', text: '@@ -1,2 +1,2 @@' },
    { kind: 'del', text: '-const theme = "light";' },
    { kind: 'add', text: '+const theme = "dark";' },
    { kind: 'ctx', text: ' const keep = 1;' },
  ];

  const view = annotateWordDiffs(lines);
  expect(view[2]?.segments).toBeDefined();
  expect(changedText(view[2]?.segments ?? [])).toBe('light');
  expect(changedText(view[3]?.segments ?? [])).toBe('dark');
  expect(view[2]?.text).toBe('-const theme = "light";');
});

test('a large rewrite keeps plain line colouring', () => {
  const lines: PatchLine[] = [
    { kind: 'hunk', text: '@@ -1,7 +1,7 @@' },
    ...Array.from({ length: 7 }, (_, index) => ({ kind: 'del' as const, text: `-old ${index}` })),
    ...Array.from({ length: 7 }, (_, index) => ({ kind: 'add' as const, text: `+new ${index}` })),
  ];

  const view = annotateWordDiffs(lines);
  expect(view.some((line) => line.segments !== undefined)).toBe(false);
});

test('per-side over the limit also skips the word diff', () => {
  const lines: PatchLine[] = [
    { kind: 'del', text: '-one' },
    ...Array.from({ length: 6 }, (_, index) => ({ kind: 'del' as const, text: `-old ${index}` })),
    { kind: 'add', text: '+two' },
  ];

  const view = annotateWordDiffs(lines, 3);
  expect(view.some((line) => line.segments !== undefined)).toBe(false);
});
