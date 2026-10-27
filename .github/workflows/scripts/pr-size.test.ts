import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  applySizeLabel,
  type ChangedFile,
  changedLines,
  type GhRunner,
  IGNORED_PATTERNS,
  isIgnored,
  normalizePath,
  parseChangedFiles,
  SIZE_LABELS,
  sizeLabel,
} from './pr-size.ts';

function file(path: string, additions: number, deletions = 0): ChangedFile {
  return { path, additions, deletions };
}

/** A fake `gh` that answers label listings and records every command it was asked to run. */
function fakeGh(existing: string[] = []): { calls: string[][]; run: GhRunner } {
  const calls: string[][] = [];
  const run: GhRunner = (args) => {
    calls.push([...args]);
    if (args[0] === 'api' && args[1]?.includes('/labels') && args.includes('--jq')) {
      return { stdout: existing.map((name) => `${name}\n`).join(''), stderr: '', exitCode: 0 };
    }
    return { stdout: '', stderr: '', exitCode: 0 };
  };
  return { calls, run };
}

describe('sizeLabel thresholds', () => {
  test('an empty change set is size/XS', () => {
    expect(sizeLabel([])).toBe('size/XS');
  });

  test('exactly 10 changed lines is still size/XS', () => {
    expect(sizeLabel([file('src/a.ts', 6, 4)])).toBe('size/XS');
  });

  test('11 changed lines is size/S', () => {
    expect(sizeLabel([file('src/a.ts', 7, 4)])).toBe('size/S');
  });

  test('exactly 100 is size/S, 101 is size/M', () => {
    expect(sizeLabel([file('a.ts', 60, 40)])).toBe('size/S');
    expect(sizeLabel([file('a.ts', 61, 40)])).toBe('size/M');
  });

  test('exactly 500 is size/M, 501 is size/L', () => {
    expect(sizeLabel([file('a.ts', 300, 200)])).toBe('size/M');
    expect(sizeLabel([file('a.ts', 301, 200)])).toBe('size/L');
  });

  test('exactly 1000 is size/L, 1001 is size/XL', () => {
    expect(sizeLabel([file('a.ts', 800, 200)])).toBe('size/L');
    expect(sizeLabel([file('a.ts', 801, 200)])).toBe('size/XL');
  });

  test('additions and deletions of several files are summed', () => {
    const files = [file('a.ts', 200, 200), file('b.ts', 50, 51)];
    expect(sizeLabel(files)).toBe('size/L');
    expect(changedLines(files)).toBe(501);
  });

  test('negative counts cannot lower the total', () => {
    expect(changedLines([file('a.ts', -5, 12)])).toBe(12);
  });

  test('every size label has a colour and description', () => {
    expect(SIZE_LABELS.map((label) => label.name)).toEqual([
      'size/XS',
      'size/S',
      'size/M',
      'size/L',
      'size/XL',
    ]);
    for (const label of SIZE_LABELS) {
      expect(label.color).toMatch(/^[0-9a-f]{6}$/);
      expect(label.description.length).toBeGreaterThan(0);
    }
  });
});

describe('ignored paths', () => {
  test('the lockfile is ignored', () => {
    expect(isIgnored('bun.lock')).toBe(true);
    expect(sizeLabel([file('bun.lock', 9_000, 1_000)])).toBe('size/XS');
  });

  test('fixtures at any depth are ignored', () => {
    expect(isIgnored('fixtures/runs/demo.jsonl')).toBe(true);
    expect(isIgnored('fixtures/plans/big.json')).toBe(true);
  });

  test('snapshots and screenshots are ignored', () => {
    expect(isIgnored('apps/web/src/foo/__snapshots__/x.snap')).toBe(true);
    expect(isIgnored('apps/web/e2e/__screenshots__/end.png')).toBe(true);
  });

  test('recordings (*.jsonl) are ignored anywhere', () => {
    expect(isIgnored('fixtures/runs/x.jsonl')).toBe(true);
    expect(isIgnored('recordings/live.jsonl')).toBe(true);
  });

  test('generated tool results are ignored but ordinary tools files are not', () => {
    expect(isIgnored('tools/load/results/engine-quick.json')).toBe(true);
    expect(isIgnored('tools/stats/out/stats.json')).toBe(true);
    expect(isIgnored('tools/flock/loopback.ts')).toBe(false);
    expect(isIgnored('packages/core/src/index.ts')).toBe(false);
  });

  test('every ignore pattern is listed exactly once', () => {
    expect(new Set(IGNORED_PATTERNS).size).toBe(IGNORED_PATTERNS.length);
  });

  test('normalizePath strips ./ and backslashes', () => {
    expect(normalizePath('./fixtures\\runs/x.json')).toBe('fixtures/runs/x.json');
  });
});

describe('changed-file parsing', () => {
  test('parses the gh TSV, including zero-change files', () => {
    const tsv = 'src/a.ts\t12\t3\nbin/asset.png\t0\t0\n';
    expect(parseChangedFiles(tsv)).toEqual([
      { path: 'src/a.ts', additions: 12, deletions: 3 },
      { path: 'bin/asset.png', additions: 0, deletions: 0 },
    ]);
  });

  test('ignores blank lines', () => {
    expect(parseChangedFiles('\n\nsrc/a.ts\t1\t1\n\n')).toHaveLength(1);
  });
});

describe('applySizeLabel', () => {
  test('creates the labels once, adds the new one and removes the stale one', () => {
    const { calls, run } = fakeGh(['size/S']);
    const result = applySizeLabel(run, 'o/r', '7', [file('src/a.ts', 250, 250)]);
    expect(result).toEqual({ label: 'size/M', lines: 500 });
    const creates = calls.filter((call) => call[0] === 'label' && call[1] === 'create');
    expect(creates).toHaveLength(5);
    expect(calls.some((call) => call.includes('--method') && call.includes('DELETE'))).toBe(true);
    expect(calls.some((call) => call.includes('--method') && call.includes('POST'))).toBe(true);
  });

  test('does not add a label that is already applied', () => {
    const { calls, run } = fakeGh(['size/XS']);
    applySizeLabel(run, 'o/r', '8', [file('src/a.ts', 2, 2)]);
    expect(calls.filter((call) => call.includes('POST'))).toHaveLength(0);
    expect(calls.filter((call) => call.includes('DELETE'))).toHaveLength(0);
  });

  test('removes every stale size label (not just the first)', () => {
    const { calls, run } = fakeGh(['size/S', 'size/XL']);
    applySizeLabel(run, 'o/r', '9', [file('src/a.ts', 2, 2)]);
    const deletes = calls.filter((call) => call.includes('DELETE'));
    expect(deletes).toHaveLength(2);
  });
});

describe('main helpers stay side-effect free', () => {
  test('a temporary directory is not a fixture path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'starling-size-'));
    writeFileSync(join(dir, 'x.ts'), 'export const x = 1;\n');
    expect(isIgnored(join(dir, 'x.ts'))).toBe(false);
  });
});
