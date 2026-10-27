import { describe, expect, test } from 'bun:test';
import { computeIncomingCounts, extractImportSpecifiers, isTestFile } from './summaries';

describe('import heuristic', () => {
  test('extracts relative imports and requires, ignoring packages', () => {
    const source = `
import { a } from './a'
import type { B } from "../lib/b"
import './side-effect.css'
export { c } from './c.js'
const d = require('./d')
const e = await import('./e')
import React from 'react'
`;
    expect(extractImportSpecifiers(source).sort()).toEqual([
      '../lib/b',
      './a',
      './c.js',
      './d',
      './e',
      './side-effect.css',
    ]);
  });

  test('counts incoming imports with extension and index resolution', () => {
    const files = [
      { path: 'src/a.ts', imports: ['./b', './dir'] },
      { path: 'src/b.ts', imports: ['./b'] },
      { path: 'src/c.ts', imports: ['../src/a'] },
      { path: 'src/dir/index.ts', imports: [] },
      { path: 'src/dir/helper.ts', imports: ['../b.ts'] },
    ];
    const counts = computeIncomingCounts(files);
    expect(counts.get('src/b.ts')).toBe(2);
    expect(counts.get('src/a.ts')).toBe(1);
    expect(counts.get('src/dir/index.ts')).toBe(1);
    // Self-imports are ignored.
    expect(counts.get('src/c.ts')).toBeUndefined();
  });

  test('recognises test files across common conventions', () => {
    expect(isTestFile('src/a.test.ts')).toBe(true);
    expect(isTestFile('src/a.spec.tsx')).toBe(true);
    expect(isTestFile('tests/helper.py')).toBe(true);
    expect(isTestFile('src/__tests__/x.ts')).toBe(true);
    expect(isTestFile('src/testing/dom.ts')).toBe(false);
    expect(isTestFile('src/testimony.ts')).toBe(false);
  });
});
