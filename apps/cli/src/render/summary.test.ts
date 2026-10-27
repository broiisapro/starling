import { describe, expect, test } from 'bun:test';
import { FINISHED_RUN, RUN } from '../testing/fixtures';
import { stripAnsi, visibleLength } from './format';
import { plainPalette } from './palette';
import { renderSummary } from './summary';

describe('renderSummary', () => {
  const plain = plainPalette();

  test('renders a finished-run box (non-TTY snapshot)', () => {
    const text = renderSummary(
      FINISHED_RUN,
      'All three tasks merged. One audit failure on theme was fixed on attempt 2. 🐦',
      { palette: plain, width: 78 },
    );
    expect(text).not.toContain('\x1b[');
    expect(text).toContain('run finished');
    expect(text).toContain('3 merged');
    expect(text).toContain('branch starling/000000/integration');
    expect(text).toMatchSnapshot();
  });

  test('keeps every line the same visible width, even with colours', () => {
    const text = renderSummary(RUN, 'Still running.', { palette: plain, width: 60 });
    const widths = new Set(text.split('\n').map((line) => visibleLength(line)));
    expect(widths.size).toBe(1);
  });

  test('wraps a long summary inside the box', () => {
    const text = renderSummary(FINISHED_RUN, 'word '.repeat(60), { palette: plain, width: 60 });
    for (const line of text.split('\n')) expect(visibleLength(line)).toBe(60);
    expect(text).toContain('word word word');
    expect(stripAnsi(text)).toContain('╰');
  });
});
