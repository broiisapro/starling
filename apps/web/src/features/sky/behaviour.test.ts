import { describe, expect, test } from 'bun:test';
import type { TaskStatus } from '@starling/core';
import { behaviourFor, behaviourTable, migrateBehaviour, STATIC_KINDS, scatterBehaviour } from './behaviour';
// `TASK_STATUSES` lives in the palette module (the shared status list the whole feature uses).
import { FALLBACK_STATUS_COLORS, STATUS_SHEEN, TASK_STATUSES as STATUSES } from './palette';

describe('behaviour table', () => {
  test('is total: every TaskStatus has a documented kind, tint and alpha', () => {
    for (const status of STATUSES) {
      const behaviour = behaviourFor(status);
      expect(behaviour.kind).toBeString();
      expect(behaviour.tint).toBe(FALLBACK_STATUS_COLORS[status]);
      expect(behaviour.alpha).toBeGreaterThanOrEqual(0);
      expect(behaviour.alpha).toBeLessThanOrEqual(1);
      expect(behaviour.speed).toBeGreaterThanOrEqual(0);
    }
    expect(behaviourTable()).toBe(behaviourTable());
  });

  test('static kinds are exactly the placed states (no boids)', () => {
    expect([...STATIC_KINDS].sort()).toEqual(['fall', 'hopping', 'perched', 'wirePerch']);
    expect(STATIC_KINDS.has(behaviourFor('pending').kind)).toBe(true);
    expect(STATIC_KINDS.has(behaviourFor('merged').kind)).toBe(true);
    expect(STATIC_KINDS.has(behaviourFor('running').kind)).toBe(false);
  });

  test('every status maps to a distinct visual kind', () => {
    const kinds = STATUSES.map((status: TaskStatus) => behaviourFor(status).kind);
    expect(new Set(kinds).size).toBe(STATUSES.length);
  });

  test('migration and scatter are overrides, not statuses', () => {
    expect(migrateBehaviour().kind).toBe('migrate');
    expect(migrateBehaviour().trail).toBe(true);
    expect(scatterBehaviour().kind).toBe('scatter');
    expect(STATIC_KINDS.has(migrateBehaviour().kind)).toBe(false);
    expect(STATIC_KINDS.has(scatterBehaviour().kind)).toBe(false);
  });

  test('the iridescent palette pre-blends twelve stroke colours per status', () => {
    for (const status of STATUSES) {
      const sheen = STATUS_SHEEN[status];
      expect(sheen.length).toBe(12);
      expect(new Set(sheen).size).toBeGreaterThan(4);
      for (const colour of sheen) expect(colour).toStartWith('rgb(');
    }
  });
});
