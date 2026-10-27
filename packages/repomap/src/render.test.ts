import { describe, expect, test } from 'bun:test';
import type { RepoFile, RepoMap } from '@starling/core';
import { renderRepoMap, renderRepoMapDetail } from './render';

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

describe('renderRepoMapDetail — lane mode', () => {
  const files = [
    makeFile({ path: 'src/features/export/index.ts', symbols: ['exportCsv'], summary: 'CSV export.' }),
    makeFile({ path: 'src/store/todos.ts', symbols: ['createTodoStore'], summary: 'Todo store.' }),
    makeFile({ path: 'src/main.ts', symbols: ['mount'], summary: 'Entry point.' }),
    makeFile({ path: 'src/ui/render.ts', symbols: ['render'], summary: 'Renderer.' }),
    makeFile({ path: 'src/features/theme/index.ts', symbols: ['toggle'], summary: 'Theme.' }),
  ];
  const laneMap = makeMap(files);
  const lanes = { owns: ['src/features/export/**'], reads: ['src/store/todos.ts'] };

  test('groups editable, read, neighbours and orientation, in that order', () => {
    const { text } = renderRepoMapDetail(laneMap, {
      lanes,
      related: ['src/main.ts'],
      maxChars: 6000,
    });
    const headings = [
      'In your lane (editable):',
      'You will read:',
      'Neighbours (importers, imports, siblings):',
      'Other files (orientation only):',
    ];
    const positions = headings.map((heading) => text.indexOf(heading));
    for (const [index, position] of positions.entries()) {
      expect(position).toBeGreaterThanOrEqual(0);
      if (index > 0) expect(position).toBeGreaterThan(positions[index - 1] as number);
    }
  });

  test('puts related files above the rest and gives them symbols', () => {
    const { text } = renderRepoMapDetail(laneMap, {
      lanes,
      related: ['src/main.ts'],
      maxChars: 6000,
      bytes: true,
    });
    expect(text).toContain('src/main.ts · typescript · 100 B · symbols: mount — Entry point.');
    expect(text.indexOf('src/main.ts')).toBeLessThan(text.indexOf('src/features/theme/index.ts'));
    // Orientation files stay one line: no symbols, no summaries.
    expect(text).not.toContain('src/features/theme/index.ts · typescript · 100 B · symbols');
  });

  test('never hides an editable file, even at the smallest budget', () => {
    const { text } = renderRepoMapDetail(laneMap, {
      lanes,
      related: ['src/main.ts'],
      maxChars: 260,
    });
    expect(text).toContain('src/features/export/index.ts');
    expect(text.length).toBeLessThanOrEqual(260);
  });

  test('reports what it hid and says so in the footer', () => {
    const small = renderRepoMapDetail(laneMap, { lanes, maxChars: 400 });
    expect(small.truncated).toBe(true);
    expect(small.filesShown).toBeLessThan(small.filesTotal);
    expect(small.text).toContain('more files not shown');
  });

  test('compact drops summaries and the orientation tail', () => {
    const full = renderRepoMapDetail(laneMap, { lanes, maxChars: 6000 });
    const compact = renderRepoMapDetail(laneMap, { lanes, maxChars: 6000, style: 'compact' });
    expect(compact.text).not.toContain('Todo store.');
    expect(compact.text).not.toContain('Other files (orientation only):');
    expect(compact.text).toContain('In your lane (editable):');
    expect(compact.text.length).toBeLessThan(full.text.length);
  });

  test('respects per-bucket caps', () => {
    const many = makeMap(
      Array.from({ length: 30 }, (_, i) =>
        makeFile({ path: `src/features/export/file-${i}.ts`, symbols: ['x'] }),
      ),
    );
    const { filesShown } = renderRepoMapDetail(many, {
      lanes,
      maxChars: 100_000,
      caps: { owned: 5 },
    });
    expect(filesShown).toBe(5);
  });

  test('zero budget renders nothing', () => {
    expect(renderRepoMapDetail(laneMap, { lanes, maxChars: 0 }).text).toBe('');
  });

  test('is deterministic', () => {
    const first = renderRepoMapDetail(laneMap, { lanes, related: ['src/main.ts'], maxChars: 6000 });
    const second = renderRepoMapDetail(laneMap, { lanes, related: ['src/main.ts'], maxChars: 6000 });
    expect(first.text).toBe(second.text);
    expect(first.filesShown).toBe(second.filesShown);
  });
});
