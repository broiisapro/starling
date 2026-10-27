import { describe, expect, test } from 'bun:test';
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
});
