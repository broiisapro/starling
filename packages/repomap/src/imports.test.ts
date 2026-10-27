import { describe, expect, test } from 'bun:test';
import type { RepoFile, RepoMap } from '@starling/core';
import {
  attachImportGraph,
  buildImportGraph,
  importGraphOf,
  relatedFiles,
  resolveImportPath,
} from './imports';

function file(path: string): RepoFile {
  return { path, bytes: 10, lang: 'typescript', symbols: [] };
}

function map(files: string[]): RepoMap {
  return {
    root: '/tmp/demo',
    tree: '',
    files: files.map(file),
    languages: { typescript: files.length },
    tokenEstimate: 0,
    createdAt: 1,
  };
}

describe('resolveImportPath', () => {
  const known = new Set(['src/lib/b.ts', 'src/lib/index.ts', 'src/a.ts']);

  test('resolves a relative specifier with the usual suffixes', () => {
    expect(resolveImportPath('src/a.ts', './lib/b', known)).toBe('src/lib/b.ts');
    expect(resolveImportPath('src/a.ts', './lib', known)).toBe('src/lib/index.ts');
    expect(resolveImportPath('src/a.ts', './lib/b.ts', known)).toBe('src/lib/b.ts');
  });

  test('returns undefined for unknown targets', () => {
    expect(resolveImportPath('src/a.ts', './lib/missing', known)).toBeUndefined();
    expect(resolveImportPath('src/a.ts', 'react', known)).toBeUndefined();
  });
});

describe('buildImportGraph', () => {
  const graph = buildImportGraph([
    { path: 'src/a.ts', imports: ['./lib/b', './lib/b', 'react'] },
    { path: 'src/c.ts', imports: ['./lib/b', './a'] },
    { path: 'src/lib/b.ts', imports: [] },
  ]);

  test('records outgoing edges, deduped and sorted', () => {
    expect(graph.imports.get('src/a.ts')).toEqual(['src/lib/b.ts']);
    expect(graph.imports.get('src/lib/b.ts')).toBeUndefined();
  });

  test('records importers in both directions, sorted', () => {
    expect(graph.importers.get('src/lib/b.ts')).toEqual(['src/a.ts', 'src/c.ts']);
    expect(graph.importers.get('src/a.ts')).toEqual(['src/c.ts']);
  });
});

describe('relatedFiles', () => {
  const demo = map(['src/a.ts', 'src/c.ts', 'src/lib/b.ts', 'src/lib/other.ts', 'src/zzz.ts']);
  attachImportGraph(
    demo,
    buildImportGraph([
      { path: 'src/a.ts', imports: ['./lib/b'] },
      { path: 'src/c.ts', imports: ['./lib/b'] },
      { path: 'src/lib/b.ts', imports: [] },
    ]),
  );

  test('ranks importers, then imports, then siblings', () => {
    expect(relatedFiles(demo, ['src/lib/b.ts'])).toEqual(['src/a.ts', 'src/c.ts', 'src/lib/other.ts']);
  });

  test('never returns the seed itself', () => {
    expect(relatedFiles(demo, ['src/a.ts'])).not.toContain('src/a.ts');
  });

  test('honours the limit', () => {
    expect(relatedFiles(demo, ['src/lib/b.ts'], { limit: 2 })).toEqual(['src/a.ts', 'src/c.ts']);
  });

  test('can skip siblings', () => {
    expect(relatedFiles(demo, ['src/lib/b.ts'], { includeSiblings: false })).toEqual([
      'src/a.ts',
      'src/c.ts',
    ]);
  });

  test('falls back to siblings when the map has no graph', () => {
    const plain = map(['src/lib/b.ts', 'src/lib/other.ts', 'src/a.ts']);
    expect(relatedFiles(plain, ['src/lib/b.ts'])).toEqual(['src/lib/other.ts']);
  });

  test('empty or unknown seeds produce nothing', () => {
    expect(relatedFiles(demo, [])).toEqual([]);
    expect(relatedFiles(demo, ['nope.ts'])).toEqual([]);
  });

  test('a map that never saw the mapper has no graph', () => {
    expect(importGraphOf(map(['src/a.ts']))).toBeUndefined();
  });
});
