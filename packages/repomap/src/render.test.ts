import { describe, expect, test } from 'bun:test';
import type { RepoFile, RepoMap } from '@starling/core';
import { renderRepoMap } from './render';

function makeFile(overrides: Partial<RepoFile> & Pick<RepoFile, 'path'>): RepoFile {
  return { bytes: 100, lang: 'typescript', symbols: [], ...overrides };
}

function makeMap(files: RepoFile[], overrides: Partial<RepoMap> = {}): RepoMap {
  return {
    root: '/tmp/demo',
    tree: 'demo\n└── src/\n    └── main.ts',
    files,
    languages: { typescript: files.filter((file) => file.lang === 'typescript').length, json: 1 },
    testCommand: 'bun run test',
    lintCommand: 'bun run lint',
    tokenEstimate: 100,
    createdAt: 1,
    ...overrides,
  };
}

describe('renderRepoMap', () => {
  test('renders header, tree, commands and per-file detail', () => {
    const map = makeMap([
      makeFile({ path: 'src/main.ts', symbols: ['main'], summary: 'Entry point.' }),
      makeFile({ path: 'package.json', lang: 'json' }),
    ]);
    expect(renderRepoMap(map, { maxTokens: 2000 })).toBe(`# Repo map: /tmp/demo
Languages: json 1, typescript 1
Test: bun run test
Lint: bun run lint

demo
└── src/
    └── main.ts

Files (2):
- src/main.ts (typescript): main — Entry point.
- package.json (json)`);
  });

  test('focus expands matching files and compacts the rest', () => {
    const map = makeMap([
      makeFile({
        path: 'src/features/theme/index.ts',
        symbols: ['toggleTheme'],
        summary: 'Theme toggle.',
      }),
      makeFile({ path: 'src/lib/dates.ts', symbols: ['formatIso'], summary: 'Date helpers.' }),
    ]);
    const text = renderRepoMap(map, { maxTokens: 2000, focus: ['src/features/theme/**'] });
    expect(text).toContain('- src/features/theme/index.ts (typescript): toggleTheme — Theme toggle.');
    expect(text).toContain('- src/lib/dates.ts (typescript)');
    expect(text).not.toContain('formatIso');
    expect(text.indexOf('src/features/theme')).toBeLessThan(text.indexOf('src/lib/dates.ts'));
  });

  test('respects the token budget and reports omitted files', () => {
    const files = Array.from({ length: 200 }, (_, i) => makeFile({ path: `src/file-${i}.ts` }));
    const text = renderRepoMap(makeMap(files, { languages: { typescript: 200 } }), {
      maxTokens: 200,
    });
    expect(text.length).toBeLessThanOrEqual(800);
    expect(text).toContain('more files');
  });

  test('zero budget renders nothing', () => {
    expect(renderRepoMap(makeMap([makeFile({ path: 'a.ts' })]), { maxTokens: 0 })).toBe('');
  });

  test('keeps file lines bounded even with long symbol lists and summaries', () => {
    const symbols = Array.from({ length: 40 }, (_, i) => `veryLongSymbolName${i}`);
    const map = makeMap([makeFile({ path: 'src/main.ts', symbols, summary: 'x'.repeat(300) })]);
    const text = renderRepoMap(map, { maxTokens: 3000 });
    for (const line of text.split('\n')) {
      expect(line.length).toBeLessThanOrEqual(220);
    }
  });

  test('omits commands that were not detected', () => {
    const map = makeMap([makeFile({ path: 'src/a.ts' })], {
      testCommand: undefined,
      lintCommand: undefined,
    });
    const text = renderRepoMap(map, { maxTokens: 1000 });
    expect(text).not.toContain('Test:');
    expect(text).not.toContain('Lint:');
  });
});
