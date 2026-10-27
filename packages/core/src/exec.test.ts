import { describe, expect, test } from 'bun:test';
import { StarlingError } from './errors';
import { exec } from './exec';

describe('exec', () => {
  test('captures stdout and a zero exit code', async () => {
    const result = await exec(['printf', 'hello'], { cwd: process.cwd() });
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('hello');
    expect(result.stderr).toBe('');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  test('a non-zero exit is returned, never thrown', async () => {
    const result = await exec(['sh', '-c', 'printf oops >&2; exit 7'], { cwd: process.cwd() });
    expect(result.code).toBe(7);
    expect(result.stderr).toBe('oops');
  });

  test('honours cwd', async () => {
    const result = await exec(['pwd'], { cwd: '/' });
    expect(result.stdout.trim()).toBe('/');
  });

  test('merges extra env without losing the process env', async () => {
    const result = await exec(['sh', '-c', 'printf %s "$STARLING_TEST_VAR-$HOME"'], {
      cwd: process.cwd(),
      env: { STARLING_TEST_VAR: 'starling' },
    });
    expect(result.stdout.startsWith('starling-/')).toBe(true);
  });

  test('pipes input to stdin', async () => {
    const result = await exec(['cat'], { cwd: process.cwd(), input: 'chirp' });
    expect(result.stdout).toBe('chirp');
  });

  test('timeouts throw EXEC_TIMEOUT and the process is killed', async () => {
    const started = performance.now();
    try {
      await exec(['sleep', '5'], { cwd: process.cwd(), timeoutMs: 50 });
      throw new Error('expected a timeout');
    } catch (err) {
      expect(err).toBeInstanceOf(StarlingError);
      expect((err as StarlingError).code).toBe('EXEC_TIMEOUT');
    }
    expect(performance.now() - started).toBeLessThan(2000);
  });

  test('a missing binary is EXEC_FAILED', async () => {
    try {
      await exec(['starling-does-not-exist-xyz'], { cwd: process.cwd() });
      throw new Error('expected exec to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(StarlingError);
      expect((err as StarlingError).code).toBe('EXEC_FAILED');
    }
  });

  test('an empty argv is INVALID_ARGUMENT', async () => {
    try {
      await exec([], { cwd: process.cwd() });
      throw new Error('expected exec to throw');
    } catch (err) {
      expect((err as StarlingError).code).toBe('INVALID_ARGUMENT');
    }
  });
});
