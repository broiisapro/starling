import { describe, expect, test } from 'bun:test';
import { diffSignals, isBehaviourPath, isTestPath, prioritiseDiff, signalsFor, splitDiff } from './diff.ts';
import { csvDiff, EXPORT_PATCH } from './test-support.ts';

const STYLES_BLOCK = `diff --git a/src/ui/styles.css b/src/ui/styles.css
index 1111111..2222222 100644
--- a/src/ui/styles.css
+++ b/src/ui/styles.css
@@ -1,2 +1,2 @@
-:root { --bg: #fff; }
+:root { --bg: #111; }
+[data-theme="dark"] { --bg: #000; }`;

const HELP_BLOCK = `diff --git a/src/features/help/index.ts b/src/features/help/index.ts
--- /dev/null
+++ b/src/features/help/index.ts
@@ -0,0 +1,1 @@
+export const help = true;`;

describe('test/behaviour detection', () => {
  test('recognises colocated and directory test layouts', () => {
    expect(isTestPath('src/lib/dates.test.ts')).toBe(true);
    expect(isTestPath('src/lib/dates.spec.tsx')).toBe(true);
    expect(isTestPath('pkg/server/handler_test.go')).toBe(true);
    expect(isTestPath('tests/integration/export.py')).toBe(true);
    expect(isTestPath('src/features/export/index.ts')).toBe(false);
    expect(isTestPath('src/testing/make-todo.ts')).toBe(false);
  });

  test('treats executable source as behaviour and skips config, tests and declarations', () => {
    expect(isBehaviourPath('src/features/export/index.ts')).toBe(true);
    expect(isBehaviourPath('src/features/export/index.test.ts')).toBe(false);
    expect(isBehaviourPath('vite.config.ts')).toBe(false);
    expect(isBehaviourPath('src/env.d.ts')).toBe(false);
    expect(isBehaviourPath('src/ui/styles.css')).toBe(false);
  });

  test('flags the seeded csv-export miss: behaviour, no test file', () => {
    const signals = diffSignals(['src/features/export/index.ts']);
    expect(signals).toEqual({
      testsChanged: false,
      behaviourChanged: true,
      newBehaviourWithoutTests: true,
    });
  });

  test('clears the flag when the diff also changes a test file', () => {
    expect(diffSignals(['src/features/export/index.ts', 'src/features/export/index.test.ts'])).toEqual({
      testsChanged: true,
      behaviourChanged: true,
      newBehaviourWithoutTests: false,
    });
  });

  test('a docs-only diff is neither behaviour nor a miss', () => {
    expect(diffSignals(['README.md']).newBehaviourWithoutTests).toBe(false);
  });

  test('falls back to the diff file list when changedFiles is empty', () => {
    expect(signalsFor(csvDiff(), []).newBehaviourWithoutTests).toBe(true);
  });
});

describe('splitDiff', () => {
  test('splits a git diff on every file header without losing text', () => {
    const patch = [EXPORT_PATCH, STYLES_BLOCK, HELP_BLOCK].join('\n');
    const blocks = splitDiff(patch);
    expect(blocks.map((block) => block.path)).toEqual([
      'src/features/export/index.ts',
      'src/ui/styles.css',
      'src/features/help/index.ts',
    ]);
    expect(blocks.map((block) => block.text).join('\n')).toBe(patch);
  });

  test('falls back to --- headers for hand-written patches', () => {
    const patch = `--- a/src/lib/dates.ts
+++ b/src/lib/dates.ts
@@ -1 +1 @@
-const x = 1;
+const x = 2;
--- /dev/null
+++ b/src/lib/dates.test.ts
@@ -0,0 +1 @@
+test('x', () => {});`;
    expect(splitDiff(patch).map((block) => block.path)).toEqual([
      'src/lib/dates.ts',
      'src/lib/dates.test.ts',
    ]);
  });

  test('returns nothing for an empty patch', () => {
    expect(splitDiff('   ')).toEqual([]);
  });
});

describe('prioritiseDiff', () => {
  test('returns a diff that fits byte-for-byte, without reordering', () => {
    const patch = [HELP_BLOCK, EXPORT_PATCH].join('\n');
    const result = prioritiseDiff(patch, { owns: ['src/features/export/**'], maxChars: 10_000 });
    expect(result.truncated).toBe(false);
    expect(result.patch).toBe(patch);
    expect(result.omittedFiles).toEqual([]);
  });

  test('emits owned files before out-of-lane files and keeps every header', () => {
    const padding = 'p'.repeat(5_000);
    const hugeHelp = `${HELP_BLOCK}\n${padding}`;
    const patch = [hugeHelp, EXPORT_PATCH].join('\n');
    const result = prioritiseDiff(patch, {
      owns: ['src/features/export/**'],
      maxChars: EXPORT_PATCH.length + 400,
    });

    expect(result.truncated).toBe(true);
    expect(result.patch.indexOf('src/features/export/index.ts')).toBeLessThan(
      result.patch.indexOf('src/features/help/index.ts'),
    );
    expect(result.patch).toContain('diff --git a/src/features/export/index.ts');
    expect(result.patch).toContain('--- /dev/null');
    expect(result.patch).toContain('+++ b/src/features/export/index.ts');
    expect(result.patch).toContain('[truncated: src/features/help/index.ts]');
    expect(result.patch.length).toBeLessThanOrEqual(EXPORT_PATCH.length + 400);
  });

  test('falls back to a head slice for a single huge block', () => {
    const huge = `${EXPORT_PATCH}\n${'z'.repeat(4_000)}`;
    const result = prioritiseDiff(huge, { owns: ['src/features/export/**'], maxChars: 500 });
    expect(result.truncated).toBe(true);
    expect(result.patch.length).toBeLessThanOrEqual(500);
    expect(result.patch).toContain('diff --git a/src/features/export/index.ts');
    expect(result.patch).toContain('[diff truncated]');
  });

  test('records omitted files when there is no room for them at all', () => {
    const patch = [EXPORT_PATCH, STYLES_BLOCK, HELP_BLOCK].join('\n');
    const result = prioritiseDiff(patch, {
      owns: ['src/features/export/**'],
      maxChars: EXPORT_PATCH.length + 60,
    });
    expect(result.truncated).toBe(true);
    expect(result.omittedFiles).toContain('src/features/help/index.ts');
    expect(result.omittedFiles).toContain('src/ui/styles.css');
  });
});
