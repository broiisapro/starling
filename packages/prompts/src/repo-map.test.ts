import { describe, expect, test } from 'bun:test';
import type { RepoMap } from '@starling/core';
import { rankRepoFiles, renderRepoMap } from './index.ts';
import { skyTodoContext, skyTodoMap } from './testing/context.ts';

const ctx = skyTodoContext('csv-export');
const map = skyTodoMap();
const rendered = renderRepoMap(map, { lane: ctx.task.lane });

describe('rankRepoFiles', () => {
  const ranked = rankRepoFiles(map, ctx.task.lane);

  test('puts every editable file in the owned bucket', () => {
    expect(ranked.owned.map((file) => file.path)).toEqual(['src/features/export/index.ts']);
  });

  test('puts read globs in the read bucket', () => {
    const paths = ranked.read.map((file) => file.path);
    expect(paths).toContain('src/store/todos.ts');
    expect(paths).toContain('src/main.ts');
  });

  test('keeps sibling and unrelated files out of the lane buckets', () => {
    const owned = ranked.owned.map((file) => file.path);
    expect(owned).not.toContain('src/features/theme/index.ts');
    expect(ranked.other.map((file) => file.path)).toContain('src/features/theme/index.ts');
  });

  test('is sorted by path inside every bucket', () => {
    for (const bucket of [ranked.owned, ranked.read, ranked.other]) {
      const paths = bucket.map((file) => file.path);
      expect(paths).toEqual([...paths].sort());
    }
  });
});

describe('renderRepoMap', () => {
  test('starts with the repo header and tool lines', () => {
    expect(rendered.text.startsWith('Repo: examples/sky-todo · 18 files · ')).toBe(true);
    expect(rendered.text).toContain('Tools: test `bun test` · lint `bunx biome check .`');
  });

  test('orders groups from editable to orientation-only', () => {
    const editable = rendered.text.indexOf('In your lane (editable):');
    const read = rendered.text.indexOf('You will read:');
    const other = rendered.text.indexOf('Other files (orientation only):');
    expect(editable).toBeGreaterThanOrEqual(0);
    expect(read).toBeGreaterThan(editable);
    expect(other).toBeGreaterThan(read);
  });

  test('shows symbols and summaries in full style', () => {
    expect(rendered.text).toContain('src/store/todos.ts · typescript · 1.6 kB · symbols: createTodoStore');
    expect(rendered.text).toContain('In-memory todo store');
  });

  test('is deterministic', () => {
    expect(renderRepoMap(map, { lane: ctx.task.lane }).text).toBe(rendered.text);
  });

  test('shows everything when the budget allows it', () => {
    expect(rendered.filesShown).toBe(map.files.length);
    expect(rendered.truncated).toBe(false);
    expect(rendered.text).not.toContain('more files not shown');
  });

  test('never exceeds the character budget', () => {
    for (const budget of [3000, 900, 400, 200]) {
      expect(renderRepoMap(map, { lane: ctx.task.lane, maxChars: budget }).text.length).toBeLessThanOrEqual(
        budget,
      );
    }
  });

  test('marks the output truncated when files are dropped', () => {
    const small = renderRepoMap(map, { lane: ctx.task.lane, maxChars: 900 });
    expect(small.truncated).toBe(true);
    expect(small.filesShown).toBeLessThan(map.files.length);
    expect(small.text).toContain('more file');
  });

  test('never hides an editable file, even at the smallest budget', () => {
    const tiny = renderRepoMap(map, { lane: ctx.task.lane, maxChars: 400 });
    expect(tiny.text).toContain('src/features/export/index.ts');
  });

  test('compact style drops summaries and the orientation tail', () => {
    const compact = renderRepoMap(map, { lane: ctx.task.lane, style: 'compact' });
    expect(compact.text).not.toContain('In-memory todo store');
    expect(compact.text).not.toContain('Other files (orientation only):');
    expect(compact.text).toContain('In your lane (editable):');
    expect(compact.text.length).toBeLessThan(rendered.text.length);
  });

  test('renders a plain file list when no lane is given', () => {
    const noLane = renderRepoMap(map, { maxChars: 6000 });
    expect(noLane.text).toContain('Files (18):');
    expect(noLane.text).not.toContain('In your lane');
  });

  test('handles an empty map without crashing', () => {
    const empty: RepoMap = { ...map, files: [], languages: {} };
    const text = renderRepoMap(empty, { lane: ctx.task.lane });
    expect(text.filesTotal).toBe(0);
    expect(text.filesShown).toBe(0);
    expect(text.text.startsWith('Repo: examples/sky-todo · 0 files')).toBe(true);
  });
});
