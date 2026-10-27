import { describe, expect, test } from 'bun:test';
import type { RepoMap } from '@starling/core';
import { renderRepoMap } from './render-map';
import { loadRepoMapFixture } from './test-fixtures';

const map = loadRepoMapFixture();

describe('renderRepoMap', () => {
  test('renders header facts, tree and files', () => {
    const text = renderRepoMap(map);
    expect(text).toContain('Root: examples/sky-todo');
    expect(text).toContain('Test command: bun test');
    expect(text).toContain('Lint command: bunx biome check .');
    expect(text).toContain(`Files: ${map.files.length}`);
    expect(text).toContain('Tree:');
    expect(text).toContain('src/features/theme/index.ts');
    expect(text).toContain('symbols: mount, handleSubmit');
    expect(text).toContain('Creates the store, wires the form');
  });

  test('orders languages by file count', () => {
    const text = renderRepoMap(map);
    expect(text).toContain('Languages: typescript 13, json 2, css 1, html 1');
  });

  test('sorts files by path', () => {
    const text = renderRepoMap(map);
    const index = text.indexOf('index.html');
    const main = text.indexOf('src/main.ts');
    expect(index).toBeGreaterThan(-1);
    expect(index).toBeLessThan(main);
  });

  test('caps the file list and says how many were omitted', () => {
    const text = renderRepoMap(map, { maxFiles: 3 });
    expect(text).toContain(`… ${map.files.length - 3} more files omitted`);
    const listed = text.split('\n').filter((line) => line.startsWith('- '));
    expect(listed).toHaveLength(3);
  });

  test('caps symbols per file and marks the truncation', () => {
    const text = renderRepoMap(map, { maxSymbols: 1 });
    expect(text).toContain('symbols: mount, …');
    expect(text).not.toContain('mount, handleSubmit');
  });

  test('truncates long summaries with an ellipsis', () => {
    const text = renderRepoMap(map, { summaryChars: 12 });
    expect(text).toContain('— Creates the…');
  });

  test('caps the tree and reports omitted lines', () => {
    const text = renderRepoMap(map, { maxTreeLines: 2 });
    expect(text).toContain('more tree lines omitted');
  });

  test('handles a sparse map without crashing', () => {
    const sparse: RepoMap = {
      root: '/tmp/empty',
      tree: '',
      files: [],
      languages: {},
      tokenEstimate: 0,
      createdAt: 0,
    };
    const text = renderRepoMap(sparse);
    expect(text).toContain('Root: /tmp/empty');
    expect(text).toContain('Languages: unknown');
    expect(text).toContain('Test command: unknown — infer from the map');
    expect(text).not.toContain('Tree:');
    expect(text).toContain('Files (path (bytes, language)');
  });
});
