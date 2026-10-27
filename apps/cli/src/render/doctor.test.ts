import { describe, expect, test } from 'bun:test';
import { DOCTOR_OK } from '../testing/fixtures';
import { renderDoctor } from './doctor';
import { plainPalette } from './palette';

describe('renderDoctor', () => {
  const plain = plainPalette();

  test('renders every check, fix and the totals (non-TTY snapshot)', () => {
    const text = renderDoctor(DOCTOR_OK, {
      palette: plain,
      width: 110,
      banner: 'darwin/arm64 · bun 1.4.4',
    });
    expect(text).not.toContain('\x1b[');
    expect(text).toContain('Starling doctor');
    expect(text).toContain('✔ bun');
    expect(text).toContain('! ollama');
    expect(text).toContain('fix: ollama serve');
    expect(text).toContain('7 ok');
    expect(text).toContain('1 warning');
    expect(text).toContain('Ready to fly');
    expect(text).toMatchSnapshot();
  });

  test('shows failures, their fixes and the retry advice', () => {
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
    expect(text).toContain('fix: brew upgrade git');
    expect(text).toContain('2 failed');
    expect(text).toContain('Fix the ✘ items');
  });

  test('prints the parallel-agent suggestion when the doctor computed one', () => {
    const text = renderDoctor({ ...DOCTOR_OK, suggestedMaxParallel: 6 }, { palette: plain, width: 110 });
    expect(text).toContain('maxParallel 6 suggested');
    expect(text).toContain('one worker ≈ 2 GB RAM and one core');
  });

  test('can hide the capacity line', () => {
    const text = renderDoctor(
      { ...DOCTOR_OK, suggestedMaxParallel: 6 },
      { palette: plain, width: 110, showCapacity: false },
    );
    expect(text).not.toContain('maxParallel 6 suggested');
  });

  test('truncates a long detail to the terminal width', () => {
    const text = renderDoctor(
      {
        checks: [{ name: 'ollama', status: 'ok', detail: `${'x'.repeat(200)}` }],
        ok: true,
        okCount: 1,
        failCount: 0,
        warnCount: 0,
      },
      { palette: plain, width: 60 },
    );
    expect(text).toContain('…');
    expect(text.split('\n')[2]?.length ?? 0).toBeLessThanOrEqual(60);
  });
});
