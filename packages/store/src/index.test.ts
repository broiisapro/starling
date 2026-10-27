import { describe, expect, test } from 'bun:test';
import { PACKAGE as CORE_PACKAGE, newId } from '@starling/core';
import { makeGoal } from '@starling/core/testing';
import {
  attachRecorder,
  createReplayer,
  createSqliteStore,
  deriveRun,
  importJsonl,
  PACKAGE,
  parseJsonl,
} from './index.ts';

describe('@starling/store public surface', () => {
  test('exports its package name', () => {
    expect(PACKAGE).toBe('@starling/store');
  });

  test('imports @starling/core, not a sibling Wave 1 package', () => {
    expect(CORE_PACKAGE).toBe('@starling/core');
    expect(newId()).toHaveLength(26);
    expect(makeGoal().text.length).toBeGreaterThan(0);
  });

  test('exports the store, replay, record/replay and reducer entry points', () => {
    expect(typeof createSqliteStore).toBe('function');
    expect(typeof attachRecorder).toBe('function');
    expect(typeof createReplayer).toBe('function');
    expect(typeof deriveRun).toBe('function');
    expect(typeof importJsonl).toBe('function');
    expect(typeof parseJsonl).toBe('function');
  });
});
