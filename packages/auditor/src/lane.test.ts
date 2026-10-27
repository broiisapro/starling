import { describe, expect, test } from 'bun:test';
import { canonicalLanePath, checkLane, isBookkeepingPath, STARLING_BOOKKEEPING_GLOBS } from './lane.ts';

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

describe('canonicalLanePath (Epic 103, SEC-08)', () => {
  test('normalises backslashes and a ./ prefix', () => {
    expect(canonicalLanePath('.\\src\\ui\\a.ts')).toEqual({ path: 'src/ui/a.ts' });
    expect(canonicalLanePath('./src//ui/../ui/a.ts').problem).toBe('traversal');
  });

  test('resolves .. in the reported path and flags it', () => {
    expect(canonicalLanePath('src/../secrets.env')).toEqual({
      path: 'secrets.env',
      problem: 'traversal',
    });
  });

  test('flags a traversal that normalises back inside the lane', () => {
    expect(canonicalLanePath('src/../src/a.ts')).toEqual({
      path: 'src/a.ts',
      problem: 'traversal',
    });
  });

  test('flags a backslash traversal', () => {
    expect(canonicalLanePath('src\\..\\secrets.env')).toEqual({
      path: 'secrets.env',
      problem: 'traversal',
    });
  });

  test('flags a path that is exactly ..', () => {
    expect(canonicalLanePath('..').problem).toBe('traversal');
  });

  test('flags a Unix absolute path', () => {
    expect(canonicalLanePath('/etc/passwd')).toEqual({
      path: '/etc/passwd',
      problem: 'absolute',
    });
  });

  test('flags a Windows drive path', () => {
    expect(canonicalLanePath('C:\\Users\\me\\secrets.env')).toEqual({
      path: 'C:/Users/me/secrets.env',
      problem: 'absolute',
    });
  });

  test('flags a UNC path', () => {
    expect(canonicalLanePath('\\\\server\\share\\x').problem).toBe('absolute');
  });

  test('flags an empty or whitespace-only path', () => {
    expect(canonicalLanePath('')).toEqual({ path: '', problem: 'invalid' });
    expect(canonicalLanePath('   ')).toEqual({ path: '', problem: 'invalid' });
  });

  test('flags a NUL byte as invalid', () => {
    const result = canonicalLanePath('src/a\0.ts');
    expect(result.problem).toBe('invalid');
  });

  test('leaves a normal path untouched', () => {
    expect(canonicalLanePath('src/features/export/index.ts')).toEqual({
      path: 'src/features/export/index.ts',
    });
  });
});

describe('checkLane — hostile paths (Epic 103, SEC-08)', () => {
  test('reports the raw traversal string as the violation, with the reason', () => {
    const result = checkLane(['src/../secrets.env'], ['src/**']);
    expect(result.ok).toBe(false);
    expect(result.violations).toEqual(['src/../secrets.env']);
    expect(result.problems).toEqual({ 'src/../secrets.env': 'traversal' });
  });

  test('a traversal that normalises back into the lane is still a violation', () => {
    const result = checkLane(['src/../src/features/export/index.ts'], ['src/**']);
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual({
      'src/../src/features/export/index.ts': 'traversal',
    });
  });

  test('a backslash traversal is a violation', () => {
    const result = checkLane(['src\\..\\secrets.env'], ['src/**']);
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual({ 'src\\..\\secrets.env': 'traversal' });
  });

  test('an absolute path is a violation whatever the lane owns', () => {
    const result = checkLane(['/etc/passwd'], ['**']);
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual({ '/etc/passwd': 'absolute' });
  });

  test('an absolute path that looks like bookkeeping is not exempt', () => {
    const result = checkLane(['/.starling/events.jsonl'], ['**']);
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual({ '/.starling/events.jsonl': 'absolute' });
  });

  test('distinguishes an outside-lane file from a traversal', () => {
    const result = checkLane(['docs/readme.md', '../escape.ts'], ['src/**']);
    expect(result.violations).toEqual(['docs/readme.md', '../escape.ts']);
    expect(result.problems).toEqual({
      'docs/readme.md': 'outside-lane',
      '../escape.ts': 'traversal',
    });
  });

  test('reports no problems when every file is owned', () => {
    const result = checkLane(['src/a.ts'], ['src/**']);
    expect(result.ok).toBe(true);
    expect(result.problems).toEqual({});
  });

  test('a traversal never resolves into a bookkeeping exemption', () => {
    const result = checkLane(['.starling/../package.json'], ['.starling/**']);
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual({ '.starling/../package.json': 'traversal' });
  });
});

describe('isBookkeepingPath — canonical paths only (Epic 103)', () => {
  test('a traversal out of .starling is not bookkeeping', () => {
    expect(isBookkeepingPath('.starling/../package.json')).toBe(false);
    expect(isBookkeepingPath('.starling/../.starling/starling.db')).toBe(false);
  });

  test('an absolute .starling path is not bookkeeping', () => {
    expect(isBookkeepingPath('/.starling/starling.db')).toBe(false);
  });
});
