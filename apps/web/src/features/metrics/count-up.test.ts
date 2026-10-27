import { expect, test } from 'bun:test';
import { COUNT_UP_MS, countUpValue, easeOutCubic, interpolate } from './count-up';

test('easeOutCubic starts fast, lands exactly on 1 and clamps outside 0..1', () => {
  expect(easeOutCubic(0)).toBe(0);
  expect(easeOutCubic(1)).toBe(1);
  expect(easeOutCubic(-2)).toBe(0);
  expect(easeOutCubic(4)).toBe(1);
  // 63% of the distance is covered in the first third of the time.
  expect(easeOutCubic(1 / 3)).toBeGreaterThan(0.6);
});

test('interpolate never overshoots its endpoints', () => {
  expect(interpolate(0, 10, 0)).toBe(0);
  expect(interpolate(0, 10, 0.5)).toBe(5);
  expect(interpolate(0, 10, 2)).toBe(10);
  expect(interpolate(0.04, 0.01, 0.5)).toBeCloseTo(0.025, 6);
  expect(interpolate(Number.NaN, 3, 0.5)).toBe(3);
});

test('countUpValue is exact at the endpoints and monotonic in between', () => {
  expect(countUpValue(0, 0.04, 0)).toBe(0);
  expect(countUpValue(0, 0.04, COUNT_UP_MS)).toBe(0.04);
  expect(countUpValue(0, 0.04, COUNT_UP_MS * 2)).toBe(0.04);

  const midpoint = countUpValue(0, 1, COUNT_UP_MS / 2);
  expect(midpoint).toBeGreaterThan(0.5);
  expect(midpoint).toBeLessThan(1);
});

test('a zero duration snaps straight to the target', () => {
  expect(countUpValue(0, 9, 0, 0)).toBe(9);
  expect(countUpValue(5, 9, 1, 0)).toBe(9);
});
