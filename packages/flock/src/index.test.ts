import { describe, expect, test } from 'bun:test';
import { PACKAGE as CORE_PACKAGE, newId } from '@starling/core';
import { makeGoal, makeNodeInfo } from '@starling/core/testing';
import { freeSlots, generateJoinCode, PACKAGE, rankNodes } from './index.ts';

describe('@starling/flock public surface', () => {
  test('exports its package name and re-exports core types', () => {
    expect(PACKAGE).toBe('@starling/flock');
    expect(CORE_PACKAGE).toBe('@starling/core');
    expect(newId()).toHaveLength(26);
    expect(makeGoal().text.length).toBeGreaterThan(0);
  });

  test('exposes the pure flock helpers from the package root', () => {
    expect(generateJoinCode()).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const air = makeNodeInfo({ id: 'air', kind: 'remote', maxSessions: 4, activeSessions: 3 });
    expect(freeSlots(air)).toBe(1);
    expect(rankNodes([air])[0]?.id).toBe('air');
  });
});
