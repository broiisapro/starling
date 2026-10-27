import { describe, expect, test } from 'bun:test';
import { formatBytes, formatMs, percentileSorted, renderTable, round, summarise } from './stats.ts';

describe('percentiles', () => {
  test('interpolates between neighbours', () => {
    expect(percentileSorted([10, 20, 30, 40], 0.5)).toBe(25);
    expect(percentileSorted([10, 20, 30, 40], 0)).toBe(10);
    expect(percentileSorted([10, 20, 30, 40], 1)).toBe(40);
    expect(percentileSorted([42], 0.95)).toBe(42);
    expect(percentileSorted([], 0.95)).toBe(0);
  });

  test('summarise reports count, total and the tail', () => {
    const summary = summarise([1, 2, 3, 100]);
    expect(summary.count).toBe(4);
    expect(summary.minMs).toBe(1);
    expect(summary.maxMs).toBe(100);
    expect(summary.totalMs).toBe(106);
    expect(summary.p50Ms).toBe(2.5);
    expect(summary.p95Ms).toBeGreaterThan(summary.p50Ms);
  });

  test('empty input is all zeroes, never NaN', () => {
    const summary = summarise([]);
    expect(Object.values(summary).every((value) => value === 0)).toBe(true);
  });
});

describe('formatting', () => {
  test('micro, milli and seconds', () => {
    expect(formatMs(0.004)).toBe('4µs');
    expect(formatMs(1.25)).toBe('1.3ms');
    expect(formatMs(250)).toBe('250ms');
    expect(formatMs(2_500)).toBe('2.5s');
  });

  test('bytes', () => {
    expect(formatBytes(512)).toBe('512B');
    expect(formatBytes(2_048)).toBe('2KB');
    expect(formatBytes(3 * 1024 ** 2)).toBe('3MB');
  });

  test('round keeps one decimal by default', () => {
    expect(round(1.23456)).toBe(1.2);
    expect(round(1.23456, 3)).toBe(1.235);
  });
});

describe('renderTable', () => {
  test('aligns labels left and values right', () => {
    const table = renderTable(
      'Table',
      ['value', 'p50'],
      [
        { label: 'a', values: ['1', '2'] },
        { label: 'longer label', values: ['10', '—'] },
      ],
    );
    const lines = table.split('\n');
    expect(lines[0]).toBe('Table');
    expect(lines[1]).toContain('metric');
    expect(lines[3]).toContain('a');
    expect(lines[4]).toContain('longer label');
    expect(lines[4]).toContain('10');
    expect(lines[4]?.endsWith('—')).toBe(true);
  });
});
