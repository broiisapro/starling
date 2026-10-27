import { describe, expect, test } from 'bun:test';
import {
  fmtDuration,
  fmtTokens,
  fmtUsd,
  padEndVisible,
  renderTable,
  stripAnsi,
  truncate,
  visibleLength,
} from './format';
import { fixedPalette } from './palette';

describe('format helpers', () => {
  test('formats short durations with tenths and long ones as clock time', () => {
    expect(fmtDuration(0)).toBe('0.0s');
    expect(fmtDuration(420)).toBe('0.4s');
    expect(fmtDuration(9_949)).toBe('9.9s');
    expect(fmtDuration(62_000)).toBe('1:02');
    expect(fmtDuration(3_723_000)).toBe('1:02:03');
  });

  test('formats money for the cost meter', () => {
    expect(fmtUsd(0)).toBe('$0.000');
    expect(fmtUsd(0.0123)).toBe('$0.012');
    expect(fmtUsd(1.204)).toBe('$1.20');
    expect(fmtUsd(Number.NaN)).toBe('$0.000');
  });

  test('formats token counts compactly', () => {
    expect(fmtTokens(900)).toBe('900');
    expect(fmtTokens(12_400)).toBe('12.4k');
    expect(fmtTokens(1_250_000)).toBe('1.3M');
  });

  test('ANSI-aware length, padding and truncation', () => {
    const red = fixedPalette(true).red('abc');
    expect(stripAnsi(red)).toBe('abc');
    expect(visibleLength(red)).toBe(3);
    expect(padEndVisible(red, 5)).toBe(`${red}  `);
    expect(truncate('abcdefgh', 5)).toBe('abcd…');
    expect(truncate('abc', 5)).toBe('abc');
    expect(truncate('abc', 0)).toBe('');
  });

  test('renders aligned tables with ANSI cells', () => {
    const bold = fixedPalette(true).bold('NAME');
    const table = renderTable(
      [bold, 'N'],
      [
        ['alpha', '1'],
        ['b', '22'],
      ],
      { align: ['left', 'right'] },
    );
    const lines = table.split('\n');
    expect(stripAnsi(lines[0] as string)).toBe('NAME   N');
    expect(stripAnsi(lines[1] as string)).toBe('alpha  1');
    expect(stripAnsi(lines[2] as string)).toBe('b      22');
  });
});
