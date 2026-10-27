import { describe, expect, test } from 'bun:test';
import {
  buildDiffSummary,
  countNewFileLines,
  isBinary,
  mergeStats,
  newFilePatch,
  PATCH_LIMIT_BYTES,
  parseNumstat,
  truncatePatch,
  UNTRACKED_MAX_BYTES,
} from './diff.ts';

const encoder = new TextEncoder();
const bytes = (text: string) => encoder.encode(text);

describe('parseNumstat', () => {
  test('parses added/removed counts and paths', () => {
    const stats = parseNumstat('3\t1\tsrc/a.ts\n0\t7\tsrc/b.ts\n');
    expect(stats).toEqual([
      { path: 'src/a.ts', added: 3, removed: 1 },
      { path: 'src/b.ts', added: 0, removed: 7 },
    ]);
  });

  test('counts binary files as 0/0 and keeps paths containing tabs intact', () => {
    const stats = parseNumstat('-\t-\timg/logo.png\n2\t0\todd\tname.ts\n');
    expect(stats).toEqual([
      { path: 'img/logo.png', added: 0, removed: 0 },
      { path: 'odd\tname.ts', added: 2, removed: 0 },
    ]);
  });

  test('ignores blank and malformed lines', () => {
    expect(parseNumstat('\nnot-a-stat\n\n')).toEqual([]);
  });
});

describe('mergeStats', () => {
  test('preserves first-seen order and sums per path', () => {
    const merged = mergeStats(
      [
        { path: 'a.ts', added: 2, removed: 1 },
        { path: 'b.ts', added: 1, removed: 0 },
      ],
      [
        { path: 'b.ts', added: 5, removed: 2 },
        { path: 'c.ts', added: 0, removed: 0 },
      ],
    );
    expect(merged).toEqual([
      { path: 'a.ts', added: 2, removed: 1 },
      { path: 'b.ts', added: 6, removed: 2 },
      { path: 'c.ts', added: 0, removed: 0 },
    ]);
  });
});

describe('countNewFileLines', () => {
  test('counts newline-terminated lines', () => {
    expect(countNewFileLines(bytes('a\nb\n')).added).toBe(2);
  });

  test('counts a final line without a trailing newline', () => {
    expect(countNewFileLines(bytes('a\nb')).added).toBe(2);
  });

  test('treats an empty file as zero lines', () => {
    expect(countNewFileLines(new Uint8Array(0))).toEqual({ added: 0, binary: false });
  });

  test('detects binary content by its NUL byte', () => {
    expect(isBinary(new Uint8Array([0x41, 0x00, 0x42]))).toBe(true);
    expect(countNewFileLines(new Uint8Array([0x41, 0x00, 0x42]))).toEqual({
      added: 0,
      binary: true,
    });
  });

  test('skips oversized files', () => {
    const huge = new Uint8Array(UNTRACKED_MAX_BYTES + 1);
    expect(countNewFileLines(huge)).toEqual({ added: 0, binary: true });
  });
});

describe('newFilePatch', () => {
  test('emits a proper all-added hunk for a new text file', () => {
    const patch = newFilePatch('src/new.ts', bytes('export const a = 1;\nexport const b = 2;\n'));
    expect(patch).toContain('diff --git a/src/new.ts b/src/new.ts');
    expect(patch).toContain('new file mode 100644');
    expect(patch).toContain('--- /dev/null');
    expect(patch).toContain('+++ b/src/new.ts');
    expect(patch).toContain('@@ -0,0 +1,2 @@');
    expect(patch).toContain('+export const a = 1;');
    expect(patch.endsWith('\n')).toBe(true);
  });

  test('marks a missing trailing newline the way git does', () => {
    const patch = newFilePatch('notes.txt', bytes('one line, no newline'));
    expect(patch).toContain('+one line, no newline');
    expect(patch).toContain('\\ No newline at end of file');
  });

  test('emits only a header for an empty file', () => {
    const patch = newFilePatch('empty.txt', new Uint8Array(0));
    expect(patch).toContain('new file mode 100644');
    expect(patch).not.toContain('@@');
  });

  test('describes binary files instead of inlining them', () => {
    const patch = newFilePatch('logo.png', new Uint8Array([0x89, 0x50, 0x00, 0x01]));
    expect(patch).toContain('Binary files /dev/null and b/logo.png differ');
  });

  test('records the executable bit in the mode line', () => {
    const patch = newFilePatch('bin/run.sh', bytes('#!/bin/sh\n'), '100755');
    expect(patch).toContain('new file mode 100755');
  });
});

describe('truncatePatch', () => {
  test('leaves a small patch untouched', () => {
    const result = truncatePatch('diff --git a b\n', 1024);
    expect(result.truncated).toBe(false);
    expect(result.patch).toBe('diff --git a b\n');
  });

  test('cuts at the byte budget and reports truncation', () => {
    const big = 'x'.repeat(300_000);
    const result = truncatePatch(big, 1000);
    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(result.patch, 'utf8')).toBeLessThanOrEqual(1000);
    expect(result.patch).toContain('[patch truncated]');
  });

  test('never leaves a half-decoded multi-byte character', () => {
    const result = truncatePatch('é'.repeat(5000), 1001);
    expect(result.truncated).toBe(true);
    expect(result.patch.includes('\uFFFD')).toBe(false);
    expect(Buffer.byteLength(result.patch, 'utf8')).toBeLessThanOrEqual(1001);
  });

  test('uses the 200 KB default cap', () => {
    expect(PATCH_LIMIT_BYTES).toBe(200 * 1024);
    const result = truncatePatch('y'.repeat(PATCH_LIMIT_BYTES + 10));
    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(result.patch, 'utf8')).toBeLessThanOrEqual(PATCH_LIMIT_BYTES);
  });
});

describe('buildDiffSummary', () => {
  test('assembles files, patch and truncation flag', () => {
    const summary = buildDiffSummary([{ path: 'a.ts', added: 1, removed: 2 }], ['diff one\n', 'diff two']);
    expect(summary.files).toEqual([{ path: 'a.ts', added: 1, removed: 2 }]);
    expect(summary.patch).toBe('diff one\ndiff two\n');
    expect(summary.truncated).toBe(false);
  });
});
