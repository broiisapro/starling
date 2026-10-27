import { describe, expect, test } from 'bun:test';
import type { MergePreflight, Merger } from '@starling/core';
import {
  createMergeQueue,
  createMerger,
  mergeTask,
  PACKAGE,
  parseMergeTree,
  runPreflight,
  sanitizeBranchName,
} from './index.ts';

describe('@starling/merger exports', () => {
  test('exports its package name and the production factory', () => {
    expect(PACKAGE).toBe('@starling/merger');
    expect(typeof createMerger).toBe('function');
  });

  test('exports the building blocks the engine and tests compose', () => {
    expect(typeof createMergeQueue).toBe('function');
    expect(typeof mergeTask).toBe('function');
    expect(typeof runPreflight).toBe('function');
    expect(typeof parseMergeTree).toBe('function');
    expect(sanitizeBranchName('starling/abc/integration')).toBe('starling-abc-integration');
  });

  test('a MergerService is a core Merger, preflight included', async () => {
    const merger = createMerger({ worktreeRoot: '/tmp/starling-worktrees-test' });
    // Compile-time: the optional port method narrows to PreflightResult, which extends MergePreflight.
    const port: Merger = merger;
    expect(typeof port.merge).toBe('function');
    const preflight: Merger['preflight'] = merger.preflight.bind(merger);
    const typed: (repo: string, integration: string, branch: string) => Promise<MergePreflight> = preflight;
    expect(typeof typed).toBe('function');
    await merger.dispose();
  });
});
