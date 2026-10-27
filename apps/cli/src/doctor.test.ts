import { describe, expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ExecResult } from '@starling/core';
import { defaultConfig, StarlingError } from '@starling/core';
import type { DoctorDeps, DoctorExec } from './doctor';
import { doctorJson, runDoctor, suggestMaxParallel } from './doctor';
import type { DoctorSpawn } from './doctor-probes';
import { tmpDir } from './testing/tmp';

function result(stdout: string, code = 0): ExecResult {
  return { code, stdout, stderr: code === 0 ? '' : 'failed', durationMs: 1 };
}

const GOOD_MODELS = [
  'ollama/qwen3.8:27b-mlx',
  'opencode-go/deepseek-v4.1-flash',
  'opencode-go/deepseek-v4.1-pro',
  '',
].join('\n');

const DF = [
  'Filesystem     1024-blocks     Used Available Capacity  iused    ifree %iused  Mounted on',
  '/dev/disk3s1s1   971350180 12345678  52428800     2%   123456 12345678    0%   /',
].join('\n');

const RECOMMENDATION = JSON.stringify({
  mbp: { auditor: 'qwen3.8:27b-mlx', summarizer: 'qwen3.8:27b-mlx' },
  air: { auditor: 'qwen3.6:8b', summarizer: 'qwen3.6:8b' },
});

function execMap(overrides: Record<string, ExecResult> = {}): DoctorExec {
  const defaults: Record<string, ExecResult> = {
    'git --version': result('git version 2.54.0\n'),
    'opencode --version': result('opencode v2.1.2\n'),
    'opencode models': result(GOOD_MODELS),
    'gh auth status': result('Logged in to github.com\n'),
    'df -k /repo': result(DF),
    'sh -c ulimit -n': result('1048576\n'),
  };
  return async (cmd) => {
    const key = cmd.join(' ');
    const found = overrides[key] ?? defaults[key];
    if (found !== undefined) return found;
    return result('', 127);
  };
}

/** A fake `opencode serve` that prints its listening URL and then exits cleanly. */
function listeningSpawn(url = 'http://127.0.0.1:54321', exitCode = 0): DoctorSpawn {
  return () => ({
    stdout: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`server listening on ${url}\n`));
        controller.close();
      },
    }),
    stderr: null,
    exited: Promise.resolve(exitCode),
    kill: () => {},
  });
}

/** A fake server that never says anything and never exits (the timeout branch). */
function silentSpawn(): DoctorSpawn {
  return () => ({
    stdout: new ReadableStream<Uint8Array>({ start() {} }),
    stderr: null,
    exited: new Promise<number>(() => {}),
    kill: () => {},
  });
}

function deadSpawn(exitCode: number): DoctorSpawn {
  return () => ({
    stdout: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    }),
    stderr: null,
    exited: Promise.resolve(exitCode),
    kill: () => {},
  });
}

const OLLAMA_BODY = JSON.stringify({ models: [{ name: 'qwen3.8:27b-mlx' }] });

/** Answers both the Ollama tag list and the opencode `/api/info` probe. */
function routedFetch(overrides: { ollama?: () => Response | Promise<Response>; info?: () => Response } = {}) {
  const calls: string[] = [];
  const fn = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith('/api/tags')) {
      return overrides.ollama?.() ?? new Response(OLLAMA_BODY, { status: 200 });
    }
    if (url.endsWith('/api/info')) {
      return overrides.info?.() ?? new Response('{"version":"2.1.2"}', { status: 200 });
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
  return { fetchFn: fn, calls };
}

function deps(overrides: Partial<DoctorDeps> = {}): DoctorDeps {
  return {
    execFn: execMap(),
    cwd: '/repo',
    configPath: undefined,
    loadConfigFn: () => defaultConfig,
    env: { DEEPSEEK_API_KEY: 'sk-x' },
    freeMemGb: () => 20,
    totalMemGb: () => 32,
    cpuCores: () => 10,
    fetchFn: routedFetch().fetchFn,
    spawnFn: listeningSpawn(),
    freePort: () => 54321,
    portFree: async () => true,
    networkInterfacesFn: () => ({
      lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
      en0: [{ address: '192.168.1.23', family: 'IPv4', internal: false }],
    }),
    readFileFn: (path) => (path.endsWith('recommendation.json') ? RECOMMENDATION : undefined),
    now: () => 1000,
    bunVersion: '1.4.4',
    platform: 'darwin',
    arch: 'arm64',
    ...overrides,
  };
}

function check(report: Awaited<ReturnType<typeof runDoctor>>, name: string) {
  return report.checks.find((entry) => entry.name === name);
}

describe('runDoctor', () => {
  test('reports every check and goes all green on a healthy machine', async () => {
    const report = await runDoctor(deps());
    expect(report.checks.map((entry) => entry.name)).toEqual([
      'bun',
      'git',
      'opencode',
      'opencode server',
      'deepseek',
      'deepseek key',
      'gh',
      'config',
      'ollama',
      'ram',
      'disk',
      'network',
      'ulimit',
    ]);
    expect(report.failCount).toBe(0);
    expect(report.warnCount).toBe(0);
    expect(report.ok).toBe(true);
    expect(report.okCount).toBe(13);
    expect(report.suggestedMaxParallel).toBe(8);
    expect(check(report, 'deepseek')?.detail).toContain('opencode-go/deepseek-v4.1-flash');
    expect(check(report, 'deepseek')?.detail).not.toContain('deepseek-v4.1-pro');
    expect(check(report, 'opencode server')?.detail).toContain('answered /api/info');
    expect(check(report, 'opencode server')?.detail).toContain('· stopped');
    expect(check(report, 'ram')?.detail).toContain('room for ≈ 8 parallel agents');
    expect(check(report, 'network')?.detail).toContain('192.168.1.23');
  });

  test('fails an old git and points at the brew upgrade', async () => {
    const report = await runDoctor(
      deps({ execFn: execMap({ 'git --version': result('git version 2.30.1\n') }) }),
    );
    expect(report.ok).toBe(false);
    expect(check(report, 'git')?.status).toBe('fail');
    expect(check(report, 'git')?.hint).toBe('brew upgrade git');
  });

  test('fails a missing git', async () => {
    const report = await runDoctor(deps({ execFn: execMap({ 'git --version': result('', 127) }) }));
    expect(check(report, 'git')?.detail).toContain('not found on PATH');
  });

  test('fails an old bun', async () => {
    const report = await runDoctor(deps({ bunVersion: '1.2.9' }));
    expect(check(report, 'bun')?.status).toBe('fail');
    expect(check(report, 'bun')?.hint).toContain('bun upgrade');
  });

  test('fails when not running under Bun at all', async () => {
    const report = await runDoctor(deps({ bunVersion: null }));
    expect(check(report, 'bun')?.detail).toContain('not running under Bun');
  });

  test('fails a missing opencode and skips the two checks that need it', async () => {
    const report = await runDoctor(deps({ execFn: execMap({ 'opencode --version': result('', 127) }) }));
    expect(check(report, 'opencode')?.status).toBe('fail');
    expect(check(report, 'opencode server')?.detail).toContain('skipped');
    expect(check(report, 'deepseek')?.status).toBe('warn');
    expect(report.ok).toBe(false);
  });

  test('reports the server probe as skipped when it is turned off', async () => {
    const report = await runDoctor(deps({ serverProbe: false }));
    expect(check(report, 'opencode server')?.status).toBe('warn');
    expect(check(report, 'opencode server')?.detail).toBe('probe skipped');
  });

  test('fails when `opencode serve` cannot be spawned', async () => {
    const report = await runDoctor(
      deps({
        spawnFn: () => {
          throw new Error('spawn opencode ENOENT');
        },
      }),
    );
    expect(check(report, 'opencode server')?.status).toBe('fail');
    expect(check(report, 'opencode server')?.detail).toContain('ENOENT');
  });

  test('fails when the server never starts listening', async () => {
    const report = await runDoctor(deps({ spawnFn: silentSpawn(), serverTimeoutMs: 50 }));
    expect(check(report, 'opencode server')?.status).toBe('fail');
    expect(check(report, 'opencode server')?.detail).toContain('did not start within 50 ms');
  });

  test('fails when the server exits before listening', async () => {
    const report = await runDoctor(deps({ spawnFn: deadSpawn(3) }));
    expect(check(report, 'opencode server')?.detail).toContain('exited with code 3');
  });

  test('fails when /api/info answers non-2xx and still kills the child', async () => {
    let killed = false;
    const spawn: DoctorSpawn = (cmd) => ({
      ...listeningSpawn()(cmd, { cwd: '/repo' }),
      kill: () => {
        killed = true;
      },
    });
    const report = await runDoctor(
      deps({
        spawnFn: spawn,
        fetchFn: routedFetch({ info: () => new Response('nope', { status: 401 }) }).fetchFn,
      }),
    );
    expect(check(report, 'opencode server')?.detail).toContain('answered 401');
    expect(killed).toBe(true);
  });

  test('fails when the info request throws, with the error in the detail', async () => {
    const failing = (async (input: string | URL | Request) => {
      if (String(input).endsWith('/api/info')) throw new Error('socket hang up');
      return new Response(OLLAMA_BODY, { status: 200 });
    }) as unknown as typeof fetch;
    const report = await runDoctor(deps({ fetchFn: failing }));
    expect(check(report, 'opencode server')?.status).toBe('fail');
    expect(check(report, 'opencode server')?.detail).toContain('socket hang up');
  });

  test('fails when the model listing has no DeepSeek V4.1 Flash id', async () => {
    const report = await runDoctor(
      deps({ execFn: execMap({ 'opencode models': result('opencode-go/gpt-5.6-luna\n') }) }),
    );
    expect(check(report, 'deepseek')?.status).toBe('fail');
    expect(check(report, 'deepseek')?.detail).toContain('no DeepSeek V4.1 Flash');
  });

  test('fails when `opencode models` itself fails', async () => {
    const report = await runDoctor(deps({ execFn: execMap({ 'opencode models': result('', 2) }) }));
    expect(check(report, 'deepseek')?.detail).toContain('could not list opencode models');
  });

  test('notes an available DeepSeek key and warns when it is absent', async () => {
    const withKey = await runDoctor(deps());
    expect(check(withKey, 'deepseek key')?.status).toBe('ok');
    const withoutKey = await runDoctor(deps({ env: {} }));
    expect(check(withoutKey, 'deepseek key')?.status).toBe('warn');
    expect(check(withoutKey, 'deepseek key')?.detail).toContain('opencode profile needs no key');
    expect(withoutKey.ok).toBe(true);
  });

  test('warns on unauthenticated gh and on a missing gh', async () => {
    const unauth = await runDoctor(deps({ execFn: execMap({ 'gh auth status': result('', 1) }) }));
    expect(check(unauth, 'gh')?.status).toBe('warn');
    expect(check(unauth, 'gh')?.hint).toBe('gh auth login');

    const missing = await runDoctor(deps({ execFn: execMap({ 'gh auth status': result('', 127) }) }));
    expect(check(missing, 'gh')?.detail).toContain('not installed');
    expect(check(missing, 'gh')?.hint).toBe('brew install gh');
  });

  test('fails an invalid config with the loader message', async () => {
    const report = await runDoctor(
      deps({
        cwd: tmpDir(),
        loadConfigFn: () => {
          throw new StarlingError('CONFIG_INVALID', 'Invalid config at /tmp/starling.config.yaml');
        },
      }),
    );
    expect(check(report, 'config')?.status).toBe('fail');
    expect(check(report, 'config')?.detail).toContain('Invalid config');
    expect(report.ok).toBe(false);
  });

  test('reports defaults when no config file exists and validates one when it does', async () => {
    const missing = await runDoctor(deps({ cwd: tmpDir() }));
    expect(check(missing, 'config')?.detail).toContain('defaults');

    const dir = tmpDir();
    writeFileSync(join(dir, 'starling.config.yaml'), 'maxParallel: 2\n');
    const present = await runDoctor(deps({ cwd: dir }));
    expect(check(present, 'config')?.detail).toBe('starling.config.yaml is valid');
  });

  test('warns but stays green when Ollama is offline', async () => {
    const { fetchFn } = routedFetch({
      ollama: () => {
        throw new Error('connect ECONNREFUSED');
      },
    });
    const report = await runDoctor(deps({ fetchFn }));
    expect(check(report, 'ollama')?.status).toBe('warn');
    expect(report.warnCount).toBe(1);
    expect(report.ok).toBe(true);
  });

  test('warns when Ollama answers with an error status', async () => {
    const { fetchFn } = routedFetch({ ollama: () => new Response('', { status: 500 }) });
    const report = await runDoctor(deps({ fetchFn }));
    expect(check(report, 'ollama')?.detail).toContain('answered 500');
  });

  test('reports local models without a recommendation file', async () => {
    const report = await runDoctor(deps({ readFileFn: () => undefined }));
    expect(check(report, 'ollama')?.status).toBe('ok');
    expect(check(report, 'ollama')?.detail).toContain('no local benchmark yet');
  });

  test('warns when a recommended local model has not been pulled', async () => {
    const { fetchFn } = routedFetch({
      ollama: () => new Response(JSON.stringify({ models: [{ name: 'llama3:8b' }] }), { status: 200 }),
    });
    const report = await runDoctor(deps({ fetchFn }));
    expect(check(report, 'ollama')?.status).toBe('warn');
    expect(check(report, 'ollama')?.detail).toContain('qwen3.8:27b-mlx not pulled');
    expect(check(report, 'ollama')?.hint).toBe('ollama pull qwen3.8:27b-mlx');
  });

  test('picks the air recommendation on a 16 GB machine', async () => {
    const readPaths: string[] = [];
    const { fetchFn } = routedFetch();
    const report = await runDoctor(
      deps({
        fetchFn,
        totalMemGb: () => 16,
        readFileFn: (path) => {
          readPaths.push(path);
          return RECOMMENDATION;
        },
      }),
    );
    expect(check(report, 'ollama')?.status).toBe('warn');
    expect(check(report, 'ollama')?.detail).toContain('qwen3.6:8b');
    expect(readPaths[0]).toContain('tools/local-models/results/recommendation.json');
  });

  test('warns about low RAM and keeps the suggestion at one agent', async () => {
    const report = await runDoctor(deps({ freeMemGb: () => 1.2 }));
    expect(check(report, 'ram')?.status).toBe('warn');
    expect(check(report, 'ram')?.hint).toContain('maxParallel: 1');
    expect(report.suggestedMaxParallel).toBe(1);
    expect(report.ok).toBe(true);
  });

  test('warns when free disk is unreadable or low', async () => {
    const unreadable = await runDoctor(deps({ execFn: execMap({ 'df -k /repo': result('', 1) }) }));
    expect(check(unreadable, 'disk')?.status).toBe('warn');
    expect(check(unreadable, 'disk')?.hint).toBe('df -h .');

    const low = await runDoctor(
      deps({
        execFn: execMap({
          'df -k /repo': result(
            'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/disk3s1 1000000 999000 1024000 97% /\n',
          ),
        }),
      }),
    );
    expect(check(low, 'disk')?.status).toBe('warn');
    expect(check(low, 'disk')?.detail).toContain('under 5 GB');
  });

  test('warns when a flock port is taken, naming the port and the lsof command', async () => {
    const report = await runDoctor(deps({ portFree: async (port) => port !== 7778 }));
    expect(check(report, 'network')?.status).toBe('warn');
    expect(check(report, 'network')?.detail).toContain('7778');
    expect(check(report, 'network')?.hint).toBe('lsof -nP -iTCP:7778 -sTCP:LISTEN');
  });

  test('warns when there is no LAN address', async () => {
    const report = await runDoctor(deps({ networkInterfacesFn: () => ({}) }));
    expect(check(report, 'network')?.status).toBe('warn');
    expect(check(report, 'network')?.detail).toContain('no LAN IPv4 address');
  });

  test('warns on a silly-low open-file limit and when it cannot be read', async () => {
    const low = await runDoctor(deps({ execFn: execMap({ 'sh -c ulimit -n': result('256\n') }) }));
    expect(check(low, 'ulimit')?.status).toBe('warn');
    expect(check(low, 'ulimit')?.hint).toContain('ulimit -n 10240');

    const unreadable = await runDoctor(deps({ execFn: execMap({ 'sh -c ulimit -n': result('', 1) }) }));
    expect(check(unreadable, 'ulimit')?.detail).toContain('could not read');
  });
});

describe('suggestMaxParallel', () => {
  test('is bounded by memory, cores and the cap', () => {
    expect(suggestMaxParallel({ cpuCores: 10, freeMemGb: 20 })).toBe(8);
    expect(suggestMaxParallel({ cpuCores: 10, freeMemGb: 5 })).toBe(2);
    expect(suggestMaxParallel({ cpuCores: 2, freeMemGb: 64 })).toBe(1);
    expect(suggestMaxParallel({ cpuCores: 64, freeMemGb: 128 })).toBe(8);
    expect(suggestMaxParallel({ cpuCores: 1, freeMemGb: 0.5 })).toBe(1);
  });
});

describe('doctorJson', () => {
  test('is parseable, ANSI-free and carries the counts and the suggestion', async () => {
    const report = await runDoctor(deps());
    const text = doctorJson(report, { platform: 'darwin', arch: 'arm64', bun: '1.4.4' });
    expect(text).not.toContain('\x1b[');
    const parsed = JSON.parse(text) as {
      ok: boolean;
      host: { bun: string };
      counts: { ok: number; warn: number; fail: number };
      suggestedMaxParallel: number;
      checks: { name: string; status: string; hint?: string }[];
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.host.bun).toBe('1.4.4');
    expect(parsed.counts).toEqual({ ok: 13, warn: 0, fail: 0 });
    expect(parsed.suggestedMaxParallel).toBe(8);
    expect(parsed.checks).toHaveLength(13);
    expect(parsed.checks.find((entry) => entry.name === 'ollama')?.hint).toBeUndefined();
  });

  test('keeps the hint of a failing check', async () => {
    const report = await runDoctor(deps({ execFn: execMap({ 'gh auth status': result('', 1) }) }));
    const parsed = JSON.parse(doctorJson(report, { platform: 'linux', arch: 'x64', bun: null })) as {
      checks: { name: string; hint?: string }[];
    };
    expect(parsed.checks.find((entry) => entry.name === 'gh')?.hint).toBe('gh auth login');
  });
});
