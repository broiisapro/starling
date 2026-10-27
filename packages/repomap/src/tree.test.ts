import { describe, expect, test } from 'bun:test';
import { renderTree } from './tree';

describe('renderTree', () => {
  test('renders a sorted indented tree with files before directories', () => {
    const tree = renderTree(['package.json', 'src/main.ts', 'src/lib/a.ts', 'src/lib/b.ts'], {
      root: 'demo',
    });
    expect(tree).toBe(`demo
├── package.json
└── src/
    ├── main.ts
    └── lib/
        ├── a.ts
        └── b.ts`);
  });

  test('always collapses a large flat folder', () => {
    const files = Array.from({ length: 25 }, (_, i) => `src/components/part-${i}.tsx`);
    const tree = renderTree(files, { root: 'demo', maxChars: 10_000 });
    expect(tree).toContain('components/ (25 files)');
    expect(tree).not.toContain('part-0.tsx');
  });

  test('accepts RepoFile-shaped objects as well as paths', () => {
    const tree = renderTree([{ path: 'src/a.ts' }, { path: 'README.md' }]);
    expect(tree).toContain('a.ts');
    expect(tree).toContain('README.md');
  });

  test('honours the character budget and says what it dropped', () => {
    const files = Array.from({ length: 120 }, (_, i) => `file-${String(i).padStart(3, '0')}.ts`);
    const tree = renderTree(files, { root: 'flat', maxChars: 300 });
    expect(tree.length).toBeLessThanOrEqual(300);
    expect(tree).toContain('tree truncated');
  });

  test('collapses deeper when a wide tree exceeds the budget', () => {
    const files = Array.from({ length: 40 }, (_, i) => `src/feature-${i}/index.ts`);
    const tree = renderTree(files, { root: 'demo', maxChars: 400 });
    expect(tree.length).toBeLessThanOrEqual(400);
    expect(tree).toContain('(40 files)');
  });

  test('returns an empty string for a zero budget', () => {
    expect(renderTree(['a.ts'], { maxChars: 0 })).toBe('');
  });

  test('truncates very long individual lines', () => {
    const long = `src/${'x'.repeat(400)}.ts`;
    const tree = renderTree([long], { root: 'demo', maxChars: 5000 });
    for (const line of tree.split('\n')) {
      expect(line.length).toBeLessThanOrEqual(160);
    }
  });
});
