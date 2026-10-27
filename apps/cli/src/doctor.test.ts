import { describe, expect, test } from 'bun:test';
import type { ExecResult } from '@starling/core';
import { defaultConfig, StarlingError } from '@starling/core';
import type { DoctorDeps, DoctorExec } from './doctor';
import { runDoctor } from './doctor';
import { tmpDir } from './testing/tmp';

function result(stdout: string, code = 0): ExecResult {
  return { code, stdout, stderr: code === 0 ? '' : 'failed', durationMs: 1 };
}

const GOOD_MODELS = 'ollama/qwen3.8:27b-mlx\nopencode-go/deepseek-v4.1-flash\n';

function execMap(overrides: Record<string, ExecResult> = {}): DoctorExec {
  const defaults: Record<string, ExecResult> = {
    'git --version': result('git version 2.54.0\n'),
    'opencode --version': result('opencode v2.1.2\n'),
    'opencode models': result(GOOD_MODELS),
    'gh auth status': result('Logged in to github.com\n'),
  };
  return async (cmd) => {
    const key = cmd.join(' ');
    const found = overrides[key] ?? defaults[key];
    if (found !== undefined) return found;
    return result('', 127);
  };
}

const okFetch = (async () =>
  new Response(JSON.stringify({ models: [{ name: 'qwen3.6:35b-a3b' }] }), {
    status: 200,
  })) as unknown as typeof fetch;

const failFetch = (async () => {
  throw new Error('connect ECONNREFUSED');
}) as unknown as typeof fetch;

function deps(overrides: Partial<DoctorDeps> = {}): DoctorDeps {
  return {
    execFn: execMap(),
    cwd: tmpDir(),
    configPath: undefined,
    loadConfigFn: () => defaultConfig,
    freeMemGb: () => 12,
    totalMemGb: () => 32,
    fetchFn: okFetch,
    bunVersion: '1.4.4',
    platform: 'darwin',
    arch: 'arm64',
    ...overrides,
  };
}

function check(resultValue: Awaited<ReturnType<typeof runDoctor>>, name: string) {
  return resultValue.checks.find((entry) => entry.name === name);
}

describe('runDoctor', () => {
  test('reports all green with every check', async () => {
    const report = await runDoctor(deps());
    expect(report.ok).toBe(true);
    expect(report.failCount).toBe(0);
    expect(report.warnCount).toBe(0);
    expect(report.checks.map((entry) => entry.name)).toEqual([
      'bun',
      'git',
      'opencode',
      'deepseek',
      'gh',
      'config',
      'ollama',
      'ram',
    ]);
    expect(check(report, 'ollama')?.detail).toContain('1 local model');
  });

  test('fails an old git and points at the brew upgrade', async () => {
    const report = await runDoctor(
      deps({ execFn: execMap({ 'git --version': result('git version 2.30.1\n') }) }),
    );
    expect(report.ok).toBe(false);
    expect(check(report, 'git')?.status).toBe('fail');
    expect(check(report, 'git')?.hint).toBe('brew upgrade git');
  });

  test('fails a missing opencode and warns that the model listing was skipped', async () => {
    const report = await runDoctor(deps({ execFn: execMap({ 'opencode --version': result('', 127) }) }));
    expect(check(report, 'opencode')?.status).toBe('fail');
    expect(check(report, 'deepseek')?.status).toBe('warn');
    expect(report.ok).toBe(false);
  });

  test('fails when the model listing has no DeepSeek V4.1 Flash id', async () => {
    const report = await runDoctor(
      deps({ execFn: execMap({ 'opencode models': result('opencode-go/gpt-5.6-luna\n') }) }),
    );
    expect(check(report, 'deepseek')?.status).toBe('fail');
    expect(check(report, 'deepseek')?.detail).toContain('no DeepSeek V4.1 Flash');
  });

  test('fails unauthenticated gh', async () => {
    const report = await runDoctor(deps({ execFn: execMap({ 'gh auth status': result('', 1) }) }));
    expect(check(report, 'gh')?.status).toBe('fail');
    expect(check(report, 'gh')?.hint).toBe('gh auth login');
  });

  test('warns but stays green when Ollama is offline', async () => {
    const report = await runDoctor(deps({ fetchFn: failFetch }));
    expect(check(report, 'ollama')?.status).toBe('warn');
    expect(report.ok).toBe(true);
    expect(report.warnCount).toBe(1);
  });

  test('fails an invalid config with the loader’s message', async () => {
    const report = await runDoctor(
      deps({
        loadConfigFn: () => {
          throw new StarlingError('CONFIG_INVALID', 'Invalid config at /tmp/starling.config.yaml');
        },
      }),
    );
    expect(check(report, 'config')?.status).toBe('fail');
    expect(check(report, 'config')?.detail).toContain('Invalid config');
    expect(report.ok).toBe(false);
  });

  test('warns about low RAM without failing the doctor', async () => {
    const report = await runDoctor(deps({ freeMemGb: () => 1.2 }));
    expect(check(report, 'ram')?.status).toBe('warn');
    expect(report.ok).toBe(true);
  });

  test('fails an old bun', async () => {
    const report = await runDoctor(deps({ bunVersion: '1.2.9' }));
    expect(check(report, 'bun')?.status).toBe('fail');
    expect(check(report, 'bun')?.hint).toContain('bun upgrade');
  });

  test('fails when not running under Bun at all', async () => {
    const report = await runDoctor(deps({ bunVersion: null }));
    expect(check(report, 'bun')?.status).toBe('fail');
    expect(check(report, 'bun')?.detail).toContain('not running under Bun');
  });

  test('a missing config file is fine and reports defaults', async () => {
    const report = await runDoctor(deps());
    expect(check(report, 'config')?.status).toBe('ok');
    expect(check(report, 'config')?.detail).toContain('defaults');
  });
});
