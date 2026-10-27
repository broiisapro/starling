/**
 * The CLI: the read path must be free (no network, no refresh import), the refresh path must be one
 * request, and the flags/env must agree with the snippets.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { locateCache, readSegment, readState } from './cache.ts';
import type { FetchLike } from './refresh.ts';
import { parseArgs, runCli } from './starling-prompt.ts';
import { makeRun, T0 } from './test-support.ts';

const ROOT = mkdtempSync(join(tmpdir(), 'starling-prompt-cli-'));
const CLI = join(import.meta.dir, 'starling-prompt.ts');
const SHIM = join(import.meta.dir, 'starling-prompt');

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

let counter = 0;

interface Sandbox {
  env: Record<string, string | undefined>;
  print: (text: string) => void;
  output: string[];
  errors: string[];
  cacheDir: string;
}

function sandbox(extraEnv: Record<string, string | undefined> = {}): Sandbox {
  counter += 1;
  const cacheDir = join(ROOT, `case-${counter}`, 'cache');
  mkdirSync(cacheDir, { recursive: true });
  const output: string[] = [];
  const errors: string[] = [];
  return {
    env: {
      // Defaults first, so a test can set NO_COLOR / STARLING_HUB_URL and have it stick.
      STARLING_HUB_URL: undefined,
      NO_COLOR: undefined,
      ...extraEnv,
      STARLING_PROMPT_CACHE_DIR: cacheDir,
    },
    print: (text) => output.push(text),
    output,
    errors,
    cacheDir,
  };
}

/** A fetch that would fail the test if the read path ever called it. */
function forbiddenFetch(): { fn: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fn: FetchLike = async (url) => {
    calls.push({ url });
    throw new Error('the read path must not call fetch');
  };
  return { fn, calls };
}

interface Call {
  url: string;
}

function run(box: Sandbox, argv: string[], fetchFn: FetchLike) {
  return runCli(argv, {
    env: box.env,
    print: box.print,
    printError: (text) => box.errors.push(text),
    fetch: fetchFn,
    now: () => T0,
  });
}

describe('the read path', () => {
  test('prints exactly what the cache holds, with one trailing newline', async () => {
    const box = sandbox();
    const location = locateCache('http://127.0.0.1:7777', { cacheDir: box.cacheDir });
    mkdirSync(location.dir, { recursive: true });
    writeFileSync(location.segmentPath, '\u{1F426} 12/30');
    const fetch = forbiddenFetch();
    expect(await run(box, [], fetch.fn)).toBe(0);
    expect(box.output).toEqual(['\u{1F426} 12/30']);
    expect(fetch.calls).toEqual([]);
  });

  test('a cold cache prints nothing and still exits 0', async () => {
    const box = sandbox();
    const fetch = forbiddenFetch();
    expect(await run(box, [], fetch.fn)).toBe(0);
    expect(box.output).toEqual([]);
    expect(fetch.calls).toEqual([]);
  });

  test('a hub that is down costs nothing: the read path never dials it', async () => {
    const box = sandbox({ STARLING_PROMPT_SERVER: 'http://127.0.0.1:9' });
    const fetch = forbiddenFetch();
    const started = performance.now();
    expect(await run(box, ['--server', 'http://127.0.0.1:9'], fetch.fn)).toBe(0);
    expect(performance.now() - started).toBeLessThan(100);
    expect(fetch.calls).toEqual([]);
  });

  test('--ascii on the read path changes nothing: the cache is already rendered', async () => {
    const box = sandbox();
    const location = locateCache('http://127.0.0.1:7777', { cacheDir: box.cacheDir });
    mkdirSync(location.dir, { recursive: true });
    writeFileSync(location.segmentPath, 'st 2/4');
    await run(box, ['--ascii'], forbiddenFetch().fn);
    expect(box.output).toEqual(['st 2/4']);
  });

  test('--path prints the cache path the snippets read', async () => {
    const box = sandbox();
    await run(box, ['--path', '--server', 'http://hub:7777'], forbiddenFetch().fn);
    expect(box.output).toEqual([join(box.cacheDir, 'prompt-bf3b24b4.txt')]);
  });
});

describe('the refresh path', () => {
  test('one request, one cache write, the rendered segment on stdout', async () => {
    const box = sandbox();
    const calls: { url: string; headers?: Record<string, string> }[] = [];
    const fetchFn: FetchLike = async (url, init) => {
      calls.push({ url, headers: init?.headers });
      return {
        ok: true,
        status: 200,
        json: async () => [makeRun({ taskStatuses: ['merged', 'running', 'merged'] })],
      };
    };
    expect(await run(box, ['--refresh', '--server', 'http://hub:7777'], fetchFn)).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('http://hub:7777/api/runs');
    expect(box.output).toEqual(['\u{1F426} 1/3']);
    const location = locateCache('http://hub:7777', { cacheDir: box.cacheDir });
    expect(readSegment(location)).toBe('\u{1F426} 1/3');
    expect(readState(location)).toEqual({ updatedAt: T0, failures: 0 });
  });

  test('sends x-flock-token from --token and from STARLING_TOKEN', async () => {
    const seen: (string | undefined)[] = [];
    const fetchFn: FetchLike = async (_url, init) => {
      seen.push(init?.headers?.['x-flock-token']);
      return { ok: true, status: 200, json: async () => [] };
    };
    const viaFlag = sandbox();
    await run(viaFlag, ['--refresh', '--token', 'FLAG-CODE'], fetchFn);
    const viaEnv = sandbox({ STARLING_TOKEN: 'ENV-CODE' });
    await run(viaEnv, ['--refresh'], fetchFn);
    expect(seen).toEqual(['FLAG-CODE', 'ENV-CODE']);
  });

  test('--ascii renders the ascii form into the cache', async () => {
    const box = sandbox();
    const fetchFn: FetchLike = async () => ({
      ok: true,
      status: 200,
      json: async () => [makeRun({ taskStatuses: ['running', 'merged', 'pending', 'failed'] })],
    });
    await run(box, ['--refresh', '--ascii'], fetchFn);
    expect(box.output).toEqual(['st 1/4 x1']);
  });

  test('NO_COLOR forces a plain segment even when the shell asks for zsh escapes', async () => {
    const box = sandbox({ NO_COLOR: '' });
    const fetchFn: FetchLike = async () => ({
      ok: true,
      status: 200,
      json: async () => [makeRun({ taskStatuses: ['running'] })],
    });
    await run(box, ['--refresh', '--style', 'zsh'], fetchFn);
    expect(box.output).toEqual(['\u{1F426} 1/1']);
    expect(box.output.join('')).not.toContain('\u001b');
  });

  test('--style zsh stores the wrapped form when colour is allowed', async () => {
    const box = sandbox();
    const fetchFn: FetchLike = async () => ({
      ok: true,
      status: 200,
      json: async () => [makeRun({ taskStatuses: ['running'] })],
    });
    await run(box, ['--refresh', '--style', 'zsh'], fetchFn);
    expect(box.output).toEqual(['%{\u001b[36m%}\u{1F426} 1/1%{\u001b[0m%}']);
  });

  test('a failing hub exits 0 and leaves an empty segment (the prompt just disappears)', async () => {
    const box = sandbox();
    const fetchFn: FetchLike = async () => {
      throw new Error('offline');
    };
    expect(await run(box, ['--refresh', '--server', 'http://hub:7777'], fetchFn)).toBe(0);
    expect(box.output).toEqual([]);
    const location = locateCache('http://hub:7777', { cacheDir: box.cacheDir });
    expect(readSegment(location)).toBe('');
    expect(readState(location).failures).toBe(1);
  });

  test('--interval-ms is passed through to the throttle', async () => {
    const box = sandbox();
    let calls = 0;
    const fetchFn: FetchLike = async () => {
      calls += 1;
      return { ok: true, status: 200, json: async () => [] };
    };
    await run(box, ['--refresh', '--server', 'http://hub:7777'], fetchFn);
    // The fake clock is frozen at T0, so one second later is still inside a 2 s window.
    await run(box, ['--refresh', '--server', 'http://hub:7777', '--interval-ms', '2000'], fetchFn);
    expect(calls).toBe(1);
  });
});

describe('opt-out and argument parsing', () => {
  test('STARLING_PROMPT=off prints nothing and never fetches, even with --refresh', async () => {
    const box = sandbox({ STARLING_PROMPT: 'off' });
    const fetch = forbiddenFetch();
    expect(await run(box, ['--refresh'], fetch.fn)).toBe(0);
    expect(await run(box, [], fetch.fn)).toBe(0);
    expect(box.output).toEqual([]);
    expect(fetch.calls).toEqual([]);
  });

  test('--help exits 0 and documents the flags', async () => {
    const box = sandbox();
    expect(await run(box, ['--help'], forbiddenFetch().fn)).toBe(0);
    const help = box.output.join('\n');
    expect(help).toContain('--refresh');
    expect(help).toContain('--style');
    expect(help).toContain('STARLING_PROMPT=off');
  });

  test('a bad option exits 2 with a message on stderr', async () => {
    const box = sandbox();
    expect(await run(box, ['--nope'], forbiddenFetch().fn)).toBe(2);
    expect(box.errors[0]).toContain('unknown option --nope');
    expect(box.output).toEqual([]);
  });

  test('a bad --style value is an error, not a silent fallback', async () => {
    const box = sandbox();
    expect(await run(box, ['--style', 'fish'], forbiddenFetch().fn)).toBe(2);
    expect(box.errors[0]).toContain('plain|zsh|bash');
  });

  test('parseArgs prefers --server, then STARLING_PROMPT_SERVER, then STARLING_HUB_URL', () => {
    expect(parseArgs(['--server', 'http://flag:1'], {}).serverUrl).toBe('http://flag:1');
    expect(parseArgs([], { STARLING_PROMPT_SERVER: 'http://prompt:1' }).serverUrl).toBe('http://prompt:1');
    expect(parseArgs([], { STARLING_HUB_URL: 'http://hub:1' }).serverUrl).toBe('http://hub:1');
    expect(parseArgs([], {}).serverUrl).toBe('http://127.0.0.1:7777');
  });

  test('STARLING_PROMPT_ASCII=1 is the same as --ascii', () => {
    expect(parseArgs([], { STARLING_PROMPT_ASCII: '1' }).ascii).toBe(true);
    expect(parseArgs([], { STARLING_PROMPT_ASCII: '0' }).ascii).toBe(false);
    expect(parseArgs(['--ascii'], {}).ascii).toBe(true);
  });

  test('NO_COLOR wins over --style', () => {
    expect(parseArgs(['--style', 'bash'], { NO_COLOR: '1' }).style).toBe('plain');
    expect(parseArgs(['--style', 'bash'], {}).style).toBe('bash');
  });
});

describe('the installed executable', () => {
  test('the sh shim is executable and resolves its own directory', () => {
    chmodSync(SHIM, 0o755);
    const proc = Bun.spawnSync({
      cmd: [SHIM, '--path'],
      env: { ...process.env, XDG_CACHE_HOME: join(ROOT, 'shim-xdg'), STARLING_PROMPT: '' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(proc.exitCode).toBe(0);
    const path = proc.stdout.toString().trim();
    expect(path).toBe(join(ROOT, 'shim-xdg', 'starling', 'prompt-409ae7be.txt'));
  });

  test('with a hand-written cache the shim prints the segment and touches nothing else', () => {
    const xdg = join(ROOT, 'shim-cache');
    const location = locateCache('http://127.0.0.1:7777', { cacheDir: join(xdg, 'starling') });
    mkdirSync(location.dir, { recursive: true });
    writeFileSync(location.segmentPath, '\u{1F426} 12/30');
    const proc = Bun.spawnSync({
      cmd: [SHIM, '--server', 'http://127.0.0.1:7777'],
      env: { ...process.env, XDG_CACHE_HOME: xdg, STARLING_PROMPT: '' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(proc.exitCode).toBe(0);
    expect(proc.stdout.toString().trim()).toBe('\u{1F426} 12/30');
    expect(proc.stderr.toString()).toBe('');
  });

  test('the .ts entry point is what the shim runs', () => {
    const proc = Bun.spawnSync({
      cmd: [process.execPath, CLI, '--help'],
      env: { ...process.env, STARLING_PROMPT: '' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(proc.exitCode).toBe(0);
    expect(proc.stdout.toString()).toContain('starling-prompt');
  });
});
