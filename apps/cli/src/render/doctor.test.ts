import { describe, expect, test } from 'bun:test';
import { DOCTOR_OK } from '../testing/fixtures';
import { renderDoctor } from './doctor';
import { plainPalette } from './palette';

describe('renderDoctor', () => {
  const plain = plainPalette();

  test('renders every check, hint and the totals (non-TTY snapshot)', () => {
    const text = renderDoctor(DOCTOR_OK, {
      palette: plain,
      width: 110,
      banner: 'darwin/arm64 · bun 1.4.4',
    });
    expect(text).not.toContain('\x1b[');
    expect(text).toContain('Starling doctor');
    expect(text).toContain('✔ bun');
    expect(text).toContain('! ollama');
    expect(text).toContain('hint: ollama serve');
    expect(text).toContain('7 ok');
    expect(text).toContain('1 warning');
    expect(text).toContain('Ready to fly');
    expect(text).toMatchSnapshot();
  });

  test('shows failures, their hints and the retry advice', () => {
    const text = renderDoctor(
      {
        checks: [
          { name: 'git', status: 'fail', detail: '2.30.0 is too old', hint: 'brew upgrade git' },
          { name: 'gh', status: 'fail', detail: 'not authenticated', hint: 'gh auth login' },
        ],
        ok: false,
        okCount: 0,
        failCount: 2,
        warnCount: 0,
      },
      { palette: plain, width: 100 },
    );
    expect(text).toContain('✘ git');
    expect(text).toContain('hint: brew upgrade git');
    expect(text).toContain('2 failed');
    expect(text).toContain('Fix the ✘ items');
  });
});
