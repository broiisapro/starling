import { describe, expect, test } from 'bun:test';
import {
  averagePosition,
  createFlock,
  defaultCount,
  type Flock,
  MAX_SPEED,
  MIN_SPEED,
  stepFlock,
} from './boids';

const OPTIONS = { width: 1200, height: 700, count: 80, seed: 42 } as const;

function speeds(flock: Flock): number[] {
  const out: number[] = [];
  for (let i = 0; i < flock.count; i += 1) {
    out.push(Math.hypot(flock.vx[i] ?? 0, flock.vy[i] ?? 0));
  }
  return out;
}

describe('createFlock', () => {
  test('is deterministic for a seed', () => {
    const a = createFlock(OPTIONS);
    const b = createFlock(OPTIONS);
    expect([...a.x]).toEqual([...b.x]);
    expect([...a.vy]).toEqual([...b.vy]);
  });

  test('a different seed opens differently', () => {
    const a = createFlock(OPTIONS);
    const b = createFlock({ ...OPTIONS, seed: 43 });
    expect([...a.x]).not.toEqual([...b.x]);
  });

  test('scales the bird count with the viewport, within rails', () => {
    const phone = defaultCount(390, 700);
    const laptop = defaultCount(1440, 900);
    const huge = defaultCount(3840, 2160);
    expect(phone).toBeGreaterThanOrEqual(52);
    expect(laptop).toBeGreaterThan(phone);
    expect(huge).toBeLessThanOrEqual(210);
  });

  test('starts the flock near the middle', () => {
    const flock = createFlock(OPTIONS);
    const centre = averagePosition(flock);
    expect(Math.abs(centre.x - OPTIONS.width / 2)).toBeLessThan(OPTIONS.width * 0.12);
    expect(Math.abs(centre.y - OPTIONS.height / 2)).toBeLessThan(OPTIONS.height * 0.12);
  });
});

describe('stepFlock', () => {
  test('stays finite and inside the speed envelope', () => {
    const flock = createFlock(OPTIONS);
    for (let i = 0; i < 240; i += 1) stepFlock(flock, 1 / 60);
    for (const speed of speeds(flock)) {
      expect(Number.isFinite(speed)).toBe(true);
      expect(speed).toBeGreaterThanOrEqual(MIN_SPEED - 0.01);
      expect(speed).toBeLessThanOrEqual(MAX_SPEED + 0.01);
    }
    for (let i = 0; i < flock.count; i += 1) {
      expect(Number.isFinite(flock.x[i])).toBe(true);
      expect(Number.isFinite(flock.y[i])).toBe(true);
    }
  });

  test('clamps a huge dt instead of exploding the flock', () => {
    const stalled = createFlock(OPTIONS);
    const normal = createFlock(OPTIONS);
    stepFlock(stalled, 12);
    stepFlock(normal, 1 / 30);
    expect([...stalled.x]).toEqual([...normal.x]);
    expect([...stalled.y]).toEqual([...normal.y]);
  });

  test('ignores a zero or negative dt', () => {
    const flock = createFlock(OPTIONS);
    const before = [...flock.x];
    stepFlock(flock, 0);
    stepFlock(flock, -1);
    expect([...flock.x]).toEqual(before);
  });

  test('the pointer scatters a bird away from the cursor', () => {
    const flock = createFlock({ width: 1200, height: 700, count: 1, seed: 7 });
    flock.x[0] = 600;
    flock.y[0] = 350;
    flock.vx[0] = 0;
    flock.vy[0] = 0;
    for (let i = 0; i < 60; i += 1) {
      stepFlock(flock, 1 / 60, { pointer: { x: 614, y: 350 }, focus: { x: 900, y: 350 } });
    }
    expect(flock.x[0] ?? 600).toBeLessThan(590);
  });

  test('soft edges keep the flock on screen while it chases an edge focus', () => {
    const flock = createFlock({ width: 800, height: 600, count: 60, seed: 9 });
    for (let i = 0; i < 900; i += 1) {
      stepFlock(flock, 1 / 60, { focus: { x: 0, y: 0 } });
    }
    for (let i = 0; i < flock.count; i += 1) {
      expect(flock.x[i] ?? 0).toBeGreaterThan(-80);
      expect(flock.x[i] ?? 0).toBeLessThan(880);
      expect(flock.y[i] ?? 0).toBeGreaterThan(-80);
      expect(flock.y[i] ?? 0).toBeLessThan(680);
    }
  });

  test('moves the flock toward a new roost', () => {
    const flock = createFlock({ width: 1200, height: 700, count: 70, seed: 11 });
    const before = averagePosition(flock);
    for (let i = 0; i < 420; i += 1) {
      stepFlock(flock, 1 / 60, { focus: { x: 1050, y: 300 } });
    }
    const after = averagePosition(flock);
    expect(after.x).toBeGreaterThan(before.x + 60);
  });
});
