import { describe, expect, test } from 'bun:test';
import { PACKAGE as CORE_PACKAGE, newId } from '@starling/core';
import { makeGoal } from '@starling/core/testing';
import { PACKAGE } from './index.ts';

describe('@starling/perch skeleton', () => {
  test('exports its package name', () => {
    expect(PACKAGE).toBe('@starling/perch');
  });

  test('imports @starling/core and @starling/core/testing', () => {
    expect(CORE_PACKAGE).toBe('@starling/core');
    expect(newId()).toHaveLength(26);
    expect(makeGoal().text.length).toBeGreaterThan(0);
  });
});
