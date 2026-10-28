import { describe, expect, test } from 'bun:test';
import { makeStartTaskOptions } from './test-helpers';
import {
  isSafeId,
  isSafeRef,
  PERCH_ID_MAX_LENGTH,
  PERCH_REF_MAX_LENGTH,
  PerchCollectSchema,
  PerchStartTaskSchema,
} from './validate';

describe('isSafeRef', () => {
  test('accepts ordinary branch names, tags and commit shas', () => {
    for (const ref of [
      'main',
      'refs/heads/main',
      'starling/run1/theme',
      'v1.2.3',
      'release/2026-10-27',
      'feature/a.b-c_d',
      '4f3a2b1c9d8e7f60',
      'HEAD',
    ]) {
      expect(isSafeRef(ref)).toBe(true);
    }
  });

  test('rejects traversal, options and revision syntax', () => {
    for (const ref of [
      '',
      '-x',
      '--upload-pack=touch /tmp/pwned',
      '../../../../tmp/escaping',
      'main..other',
      'refs/heads/../main',
      'a//b',
      '/main',
      'main/',
      'main branch',
      'main\n',
      'HEAD@{1}',
      'main~1',
      'main^',
      'main:path',
      'main?',
      'main*',
      'main[0]',
      'main\\evil',
      'main;rm -rf /',
    ]) {
      expect(isSafeRef(ref)).toBe(false);
    }
  });

  test('enforces the length limit', () => {
    expect(isSafeRef('a'.repeat(PERCH_REF_MAX_LENGTH))).toBe(true);
    expect(isSafeRef('a'.repeat(PERCH_REF_MAX_LENGTH + 1))).toBe(false);
  });

  test('reflog syntax is never allowed, even when a caller asks', () => {
    // `allowReflog` is typed `false`; an untyped caller passing `true` still must not smuggle `@{`.
    expect(isSafeRef('HEAD@{1}', { allowReflog: true as never })).toBe(false);
  });
});

describe('isSafeId', () => {
  test('accepts kebab/snake/dot ids within the limit', () => {
    for (const id of ['run-1', 'theme', 'a.b_c-1', 'x'.repeat(PERCH_ID_MAX_LENGTH)]) {
      expect(isSafeId(id)).toBe(true);
    }
  });

  test('rejects slashes, spaces, empty values and oversize ids', () => {
    for (const id of ['', 'run/1', 'run 1', 'run:1', 'x'.repeat(PERCH_ID_MAX_LENGTH + 1)]) {
      expect(isSafeId(id)).toBe(false);
    }
  });
});

describe('PerchStartTaskSchema', () => {
  test('accepts a well-formed task', () => {
    const parsed = PerchStartTaskSchema.safeParse(makeStartTaskOptions());
    expect(parsed.success).toBe(true);
  });

  test('rejects a hostile branch and fromRef, naming both fields', () => {
    const parsed = PerchStartTaskSchema.safeParse(
      makeStartTaskOptions({
        branch: '../../../../tmp/starling-probe-escape',
        fromRef: '--upload-pack=touch /tmp/starling-probe-pwned',
      }),
    );
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues.map((issue) => issue.path.join('.'))).toEqual(['branch', 'fromRef']);
    expect(parsed.error.issues[0]?.message).toContain('must match');
  });

  test('rejects a runId or taskKey that is not a single path segment', () => {
    const parsed = PerchStartTaskSchema.safeParse(
      makeStartTaskOptions({ runId: 'run/../escape', taskKey: 'a b' }),
    );
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues.map((issue) => issue.path.join('.'))).toEqual(['runId', 'taskKey']);
  });

  test('keeps the frozen contract’s own validation', () => {
    const parsed = PerchStartTaskSchema.safeParse({ ...makeStartTaskOptions(), branch: undefined });
    expect(parsed.success).toBe(false);
  });
});

describe('PerchCollectSchema', () => {
  test('accepts a plain ref and rejects option-shaped ones', () => {
    expect(PerchCollectSchema.safeParse({ baseRef: 'main' }).success).toBe(true);
    expect(PerchCollectSchema.safeParse({ baseRef: 'starling/run1/integration' }).success).toBe(true);
    expect(PerchCollectSchema.safeParse({ baseRef: '' }).success).toBe(false);
    expect(PerchCollectSchema.safeParse({ baseRef: '--exec=rm' }).success).toBe(false);
    expect(PerchCollectSchema.safeParse({ baseRef: 'HEAD@{1}' }).success).toBe(false);
  });
});
