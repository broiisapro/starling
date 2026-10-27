import { describe, expect, test } from 'bun:test';

import { seriesFromHistory, sparklineGeometry } from './sparkline';

const BOX = { width: 100, height: 40, padding: 4 } as const;

describe('sparklineGeometry', () => {
  test('draws nothing for an empty series', () => {
    const geometry = sparklineGeometry([], BOX);
    expect(geometry.path).toBe('');
    expect(geometry.areaPath).toBe('');
    expect(geometry.points).toEqual([]);
    expect(geometry.min).toBe(0);
    expect(geometry.max).toBe(0);
  });

  test('a single sample is a flat line ending at the right edge', () => {
    const geometry = sparklineGeometry([3], BOX);
    expect(geometry.points).toHaveLength(1);
    expect(geometry.points[0]?.x).toBe(96);
    expect(geometry.points[0]?.y).toBe(20);
    expect(geometry.path).toBe('M 4 20 L 96 20');
    expect(geometry.areaPath).toBe('');
  });

  test('maps values into the padded viewBox, low to bottom and high to top', () => {
    const geometry = sparklineGeometry([0, 5, 10], BOX);
    expect(geometry.points[0]).toEqual({ x: 4, y: 36 });
    expect(geometry.points[1]).toEqual({ x: 50, y: 20 });
    expect(geometry.points[2]).toEqual({ x: 96, y: 4 });
    expect(geometry.min).toBe(0);
    expect(geometry.max).toBe(10);
  });

  test('starts the path with a moveto and continues with linetos', () => {
    const geometry = sparklineGeometry([1, 2, 3, 4], BOX);
    expect(geometry.path.startsWith('M ')).toBe(true);
    expect(geometry.path.split(' L ')).toHaveLength(4);
  });

  test('a flat series sits on the midline instead of dividing by zero', () => {
    const geometry = sparklineGeometry([7, 7, 7], BOX);
    expect(geometry.points.every((point) => point.y === 20)).toBe(true);
    expect(geometry.min).toBe(7);
    expect(geometry.max).toBe(7);
  });

  test('non-finite values become zero and never leak NaN into the path', () => {
    const geometry = sparklineGeometry([1, Number.NaN, 3], BOX);
    expect(geometry.path).not.toContain('NaN');
    expect(geometry.points[1]?.y).toBe(36);
  });

  test('keeps every coordinate inside the viewBox', () => {
    const values = [0, 3, 1, 9, 4, 4, 12, 2];
    const geometry = sparklineGeometry(values, BOX);
    for (const point of geometry.points) {
      expect(point.x).toBeGreaterThanOrEqual(4);
      expect(point.x).toBeLessThanOrEqual(96);
      expect(point.y).toBeGreaterThanOrEqual(4);
      expect(point.y).toBeLessThanOrEqual(36);
    }
  });

  test('the area path closes down to the baseline', () => {
    const geometry = sparklineGeometry([2, 4], BOX);
    expect(geometry.areaPath.endsWith('Z')).toBe(true);
    expect(geometry.areaPath).toContain('L 96 36');
    expect(geometry.areaPath).toContain('L 4 36');
    expect(geometry.baselineY).toBe(36);
  });

  test('survives a one-pixel viewBox without negative padding', () => {
    const geometry = sparklineGeometry([1, 2], { width: 1, height: 1 });
    for (const point of geometry.points) {
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
    }
  });
});

describe('seriesFromHistory', () => {
  test('picks one field per sample in order', () => {
    const history = [{ v: 1 }, { v: 4 }, { v: 2 }];
    expect(seriesFromHistory(history, (sample) => sample.v)).toEqual([1, 4, 2]);
  });

  test('clamps junk to zero', () => {
    expect(seriesFromHistory([{ v: -2 }, { v: Number.NaN }], (sample) => sample.v)).toEqual([0, 0]);
  });

  test('keeps only the newest samples when capped', () => {
    const history = Array.from({ length: 10 }, (_, index) => ({ v: index }));
    expect(seriesFromHistory(history, (sample) => sample.v, 3)).toEqual([7, 8, 9]);
  });
});
