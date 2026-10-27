import { describe, expect, test } from 'bun:test';
import {
  globsOverlap,
  globToRegExp,
  lanesDisjoint,
  matchesAny,
  matchesGlob,
  normalizeGlobPath,
} from './glob';

describe('normalizeGlobPath', () => {
  test('strips ./ and duplicate/trailing slashes', () => {
    expect(normalizeGlobPath('./src//ui/')).toBe('src/ui');
    expect(normalizeGlobPath('src\\ui\\render.ts')).toBe('src/ui/render.ts');
    expect(normalizeGlobPath('/')).toBe('/');
  });
});

describe('globToRegExp / matchesGlob', () => {
  test('literal paths', () => {
    expect(matchesGlob('src/main.ts', 'src/main.ts')).toBe(true);
    expect(matchesGlob('src/Main.ts', 'src/main.ts')).toBe(false);
  });

  test('* stays inside one segment', () => {
    expect(matchesGlob('src/main.ts', 'src/*.ts')).toBe(true);
    expect(matchesGlob('src/ui/render.ts', 'src/*.ts')).toBe(false);
    expect(matchesGlob('index.html', '*')).toBe(true);
    expect(matchesGlob('src/main.ts', '*')).toBe(false);
  });

  test('** crosses segments, including zero', () => {
    expect(matchesGlob('src/main.ts', 'src/**/*.ts')).toBe(true);
    expect(matchesGlob('src/ui/render.ts', 'src/**/*.ts')).toBe(true);
    expect(matchesGlob('src/a/b/c.ts', 'src/**')).toBe(true);
    expect(matchesGlob('README.md', '**/*.md')).toBe(true);
    expect(matchesGlob('src/a/b.ts', 'src/**/b.ts')).toBe(true);
    expect(matchesGlob('src/a/mid/b.ts', 'src/**/b.ts')).toBe(true);
  });

  test('? matches exactly one non-slash character', () => {
    expect(matchesGlob('src/a.ts', 'src/?.ts')).toBe(true);
    expect(matchesGlob('src/ab.ts', 'src/?.ts')).toBe(false);
    expect(globToRegExp('src/?.ts').test('src//.ts')).toBe(false);
  });

  test('character classes and negation', () => {
    expect(matchesGlob('src/a.ts', 'src/[abc].ts')).toBe(true);
    expect(matchesGlob('src/d.ts', 'src/[abc].ts')).toBe(false);
    expect(matchesGlob('src/d.ts', 'src/[!abc].ts')).toBe(true);
  });

  test('directory globs own everything beneath them', () => {
    expect(matchesGlob('src/ui', 'src/ui')).toBe(true);
    expect(matchesGlob('src/ui/render.ts', 'src/ui')).toBe(true);
    expect(matchesGlob('src/ui/render.ts', 'src/ui/**')).toBe(true);
    expect(matchesGlob('src/ui', 'src/ui/**')).toBe(true);
    expect(matchesGlob('src/utility.ts', 'src/ui')).toBe(false);
  });

  test('dotfiles are ordinary characters', () => {
    expect(matchesGlob('.github/workflows/ci.yml', '.github/**')).toBe(true);
    expect(matchesGlob('.github', '.github/**')).toBe(true);
  });

  test('matchesAny checks every glob', () => {
    expect(matchesAny('src/ui/render.ts', ['README.md', 'src/ui/**'])).toBe(true);
    expect(matchesAny('src/ui/render.ts', ['README.md', 'src/store/**'])).toBe(false);
    expect(matchesAny('src/ui/render.ts', [])).toBe(false);
  });
});

describe('globsOverlap', () => {
  test('identical globs overlap', () => {
    expect(globsOverlap(['src/main.ts'], ['src/main.ts'])).toEqual(['src/main.ts <=> src/main.ts']);
  });

  test('** overlaps everything (conservative by design)', () => {
    expect(globsOverlap(['**'], ['src/store/**'])).toHaveLength(1);
    expect(lanesDisjoint(['**'], ['README.md'])).toBe(false);
  });

  test('sibling feature lanes are disjoint', () => {
    expect(globsOverlap(['src/features/theme/**'], ['src/features/search/**'])).toEqual([]);
    expect(globsOverlap(['src/features/theme/**'], ['src/features/export/**'])).toEqual([]);
  });

  test('different extensions in one directory are disjoint', () => {
    expect(globsOverlap(['src/*.ts'], ['src/*.md'])).toEqual([]);
    expect(globsOverlap(['src/ui/*.css'], ['src/ui/*.ts'])).toEqual([]);
  });

  test('directory and child path overlap', () => {
    expect(globsOverlap(['src/ui'], ['src/ui/render.ts'])).toHaveLength(1);
    expect(globsOverlap(['src/ui/**'], ['src/ui/render.ts'])).toHaveLength(1);
  });

  test('a single-segment wildcard cannot swallow deeper paths', () => {
    expect(globsOverlap(['src/*'], ['src/ui/render.ts'])).toEqual([]);
  });

  test('patterns meeting at the same middle segment overlap', () => {
    expect(globsOverlap(['src/*/index.ts'], ['src/ui/*.ts'])).toHaveLength(1);
    expect(globsOverlap(['src/*/index.ts'], ['src/ui/main.ts'])).toEqual([]);
  });

  test('root-level files', () => {
    expect(globsOverlap(['*.md'], ['README.md'])).toHaveLength(1);
    expect(globsOverlap(['*.md'], ['LICENSE'])).toEqual([]);
    expect(globsOverlap(['package.json'], ['bun.lock'])).toEqual([]);
  });

  test('single-character wildcards intersect with star wildcards', () => {
    expect(globsOverlap(['src/*.ts'], ['src/?.ts'])).toHaveLength(1);
  });

  test('serialised ranges overlap', () => {
    expect(globsOverlap(['src/[ab]/x.ts'], ['src/[bc]/x.ts'])).toHaveLength(1);
    expect(globsOverlap(['src/[ab]/x.ts'], ['src/[cd]/x.ts'])).toEqual([]);
  });

  test('every overlapping pair is reported', () => {
    const hits = globsOverlap(['src/ui/**', 'README.md'], ['src/ui/render.ts', 'README.md']);
    expect(hits).toContain('src/ui/** <=> src/ui/render.ts');
    expect(hits).toContain('README.md <=> README.md');
    expect(hits).toHaveLength(2);
  });

  test('lanesDisjoint is the boolean view', () => {
    expect(lanesDisjoint(['src/features/theme/**'], ['src/features/search/**'])).toBe(true);
    expect(lanesDisjoint(['src/features/theme/**'], ['src/features/theme/index.ts'])).toBe(false);
  });

  test('a lane never overlaps itself', () => {
    expect(globsOverlap(['src/ui/**', 'README.md'], ['src/ui/**', 'README.md'])).toHaveLength(2);
  });
});
