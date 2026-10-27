import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defaultConfig, isStarlingError, loadConfig } from '@starling/core';
import { initCommand } from './commands/init';
import type { CliDeps } from './context';
import { createCliContext } from './context';
import type { DoctorExec } from './doctor';
import type { HardwareInfo } from './init';
import {
  CONFIG_FILE,
  detectHardware,
  detectModelProfile,
  detectProfile,
  initConfig,
  renderConfigYaml,
} from './init';
import { tmpDir } from './testing/tmp';

function execWith(stdout: string, code = 0): DoctorExec {
  return async () => ({ code, stdout, stderr: '', durationMs: 1 });
}

const OPENCODE_MODELS = [
  'ollama/qwen3.8:27b-mlx',
  'opencode-go/claude-haiku-5-5',
  'opencode-go/deepseek-v4.1-flash',
  '',
].join('\n');

const HARDWARE: HardwareInfo = {
  cpuCores: 10,
  freeMemGb: 20,
  totalMemGb: 32,
  suggestedMaxParallel: 8,
};

function makeContext(overrides: Partial<CliDeps> = {}) {
  const chunks: string[] = [];
  const context = createCliContext({
    io: { write: (text) => chunks.push(text), isTTY: false, columns: 100 },
    color: false,
    cwd: tmpDir(),
    env: {},
    ...overrides,
  });
  return { context, chunks, text: () => chunks.join('') };
}

describe('detectProfile', () => {
  test('prefers an opencode DeepSeek V4.1 Flash login over a DeepSeek key', async () => {
    const detected = await detectProfile({
      execFn: execWith(OPENCODE_MODELS),
      env: { DEEPSEEK_API_KEY: 'sk-x' },
      cwd: '/tmp',
    });
    expect(detected).toEqual({
      profile: 'opencode',
      opencodeModel: 'opencode-go/deepseek-v4.1-flash',
      source: 'opencode',
    });
    expect(
      await detectModelProfile({
        execFn: execWith(OPENCODE_MODELS),
        env: { DEEPSEEK_API_KEY: 'sk-x' },
        cwd: '/tmp',
      }),
    ).toBe('opencode');
  });

  test('takes the model id from whichever provider lists it', async () => {
    const detected = await detectProfile({
      execFn: execWith('deepseek/deepseek-v4.1-flash\n'),
      env: {},
      cwd: '/tmp',
    });
    expect(detected.opencodeModel).toBe('deepseek/deepseek-v4.1-flash');
  });

  test('falls back to a direct DeepSeek key when opencode lists nothing useful', async () => {
    expect(
      await detectProfile({
        execFn: execWith('opencode-go/gpt-5.6-luna\n'),
        env: { DEEPSEEK_API_KEY: 'sk-x' },
        cwd: '/tmp',
      }),
    ).toEqual({ profile: 'deepseek', source: 'deepseek-key' });
  });

  test('falls back to local when there is no key and no opencode', async () => {
    const missing: DoctorExec = async () => {
      throw new Error('spawn opencode ENOENT');
    };
    expect(await detectProfile({ execFn: missing, env: {}, cwd: '/tmp' })).toEqual({
      profile: 'local',
      source: 'fallback',
    });
    expect(await detectProfile({ execFn: execWith('', 127), env: {}, cwd: '/tmp' })).toEqual({
      profile: 'local',
      source: 'fallback',
    });
    expect(
      await detectProfile({ execFn: execWith('', 0), env: { DEEPSEEK_API_KEY: '' }, cwd: '/tmp' }),
    ).toEqual({ profile: 'local', source: 'fallback' });
  });
});

describe('detectHardware', () => {
  test('suggests maxParallel from cores and free RAM', async () => {
    const hardware = await detectHardware({ cpuCores: () => 10, freeMemGb: () => 6, totalMemGb: () => 32 });
    expect(hardware).toEqual({ cpuCores: 10, freeMemGb: 6, totalMemGb: 32, suggestedMaxParallel: 3 });
  });
});

describe('initConfig', () => {
  test('writes a valid opencode-profile config with the detected model id', async () => {
    const cwd = tmpDir();
    const result = await initConfig({
      cwd,
      execFn: execWith(OPENCODE_MODELS),
      env: {},
      hardware: HARDWARE,
    });
    expect(result.profile).toBe('opencode');
    expect(result.overwrote).toBe(false);
    expect(result.written).toBe(true);
    expect(result.maxParallel).toBe(8);
    expect(existsSync(join(cwd, CONFIG_FILE))).toBe(true);

    const config = loadConfig(join(cwd, CONFIG_FILE));
    for (const role of ['planner', 'worker', 'resolver', 'auditor', 'summarizer', 'writer'] as const) {
      expect(config.models[role]).toEqual({
        provider: 'opencode',
        model: 'opencode-go/deepseek-v4.1-flash',
      });
    }
    expect(config.providers.opencode?.baseUrl).toBe('http://127.0.0.1:4096');
    expect(config.providers.opencode?.apiKeyEnv).toBe('OPENCODE_SERVER_PASSWORD');
    expect(config.maxParallel).toBe(8);
    expect(config.flock.hubMaxSessions).toBe(8);
    expect(config.flock.enabled).toBe(true);
  });

  test('writes a fully local profile', async () => {
    const cwd = tmpDir();
    await initConfig({ cwd, execFn: execWith(''), env: {}, profile: 'local' });
    const config = loadConfig(join(cwd, CONFIG_FILE));
    for (const role of ['planner', 'worker', 'resolver', 'auditor'] as const) {
      expect(config.models[role].provider).toBe('ollama');
    }
  });

  test('keeps the auditor local on the deepseek profile', async () => {
    const cwd = tmpDir();
    await initConfig({ cwd, execFn: execWith(''), env: {}, profile: 'deepseek' });
    const config = loadConfig(join(cwd, CONFIG_FILE));
    expect(config.models.worker).toEqual({ provider: 'deepseek', model: 'deepseek-v4.1-flash' });
    expect(config.models.auditor.provider).toBe('ollama');
    expect(config.providers.deepseek?.apiKeyEnv).toBe('DEEPSEEK_API_KEY');
  });

  test('honours an explicit maxParallel and flock setting', async () => {
    const cwd = tmpDir();
    const result = await initConfig({
      cwd,
      execFn: execWith(''),
      env: {},
      profile: 'local',
      maxParallel: 3,
      flockEnabled: false,
    });
    expect(result.maxParallel).toBe(3);
    const config = loadConfig(join(cwd, CONFIG_FILE));
    expect(config.maxParallel).toBe(3);
    expect(config.flock.hubMaxSessions).toBe(3);
    expect(config.flock.enabled).toBe(false);
  });

  test('refuses to overwrite without --force and leaves the file alone', async () => {
    const cwd = tmpDir();
    const path = join(cwd, CONFIG_FILE);
    writeFileSync(path, 'maxParallel: 2\n');

    try {
      await initConfig({ cwd, execFn: execWith(''), env: {} });
      throw new Error('expected the overwrite guard to throw');
    } catch (err) {
      expect(isStarlingError(err, 'INVALID_ARGUMENT')).toBe(true);
      expect(String((err as Error).message)).toContain('--force');
    }
    expect(readFileSync(path, 'utf8')).toBe('maxParallel: 2\n');
  });

  test('overwrites with --force and reports it', async () => {
    const cwd = tmpDir();
    const path = join(cwd, CONFIG_FILE);
    writeFileSync(path, 'maxParallel: 2\n');
    const result = await initConfig({
      cwd,
      force: true,
      profile: 'deepseek',
      execFn: execWith(''),
      env: {},
    });
    expect(result.overwrote).toBe(true);
    expect(readFileSync(path, 'utf8')).toContain('Model profile: deepseek');
  });

  test('--dry-run returns the YAML and touches nothing, even over an existing file', async () => {
    const cwd = tmpDir();
    const path = join(cwd, CONFIG_FILE);
    writeFileSync(path, 'maxParallel: 2\n');
    const result = await initConfig({
      cwd,
      dryRun: true,
      profile: 'local',
      execFn: execWith(''),
      env: {},
      hardware: HARDWARE,
    });
    expect(result.written).toBe(false);
    expect(result.yaml).toContain('maxParallel: 8');
    expect(readFileSync(path, 'utf8')).toBe('maxParallel: 2\n');

    const empty = tmpDir();
    await initConfig({ cwd: empty, dryRun: true, profile: 'local', execFn: execWith(''), env: {} });
    expect(existsSync(join(empty, CONFIG_FILE))).toBe(false);
  });

  test('skips the opencode probe when a profile is given', async () => {
    const calls: string[][] = [];
    const execFn: DoctorExec = async (cmd) => {
      calls.push(cmd);
      return { code: 0, stdout: OPENCODE_MODELS, stderr: '', durationMs: 1 };
    };
    await initConfig({ cwd: tmpDir(), execFn, env: {}, profile: 'local' });
    expect(calls).toEqual([]);
  });
});

describe('renderConfigYaml', () => {
  test('renders every profile deterministically with a comment on each field', () => {
    const text = renderConfigYaml('deepseek');
    expect(text).toContain('generated by `starling init`');
    expect(text).toContain('apiKeyEnv: DEEPSEEK_API_KEY');
    expect(text).toContain('models:');
    expect(text).toContain('flock:');
    expect(text).toContain('# agents running at once');
    expect(text).toContain('# spawn | attach');
    expect(text).toContain('# the branch a run starts from');
    expect(text).toContain('# sessions this machine lends when it is a perch');
    expect(renderConfigYaml('deepseek')).toBe(text);
  });

  test('explains the hardware suggestion when it is known', () => {
    const text = renderConfigYaml('opencode', {
      hardware: HARDWARE,
      opencodeModel: 'opencode-go/deepseek-v4.1-flash',
    });
    expect(text).toContain('# Hardware: 10 cores, 20.0 GB RAM available of 32 GB');
    expect(text).toContain('# → 8 parallel agents');
    expect(text).toContain('provider: opencode, model: opencode-go/deepseek-v4.1-flash');
  });

  test('parses for every profile and every flock setting', () => {
    for (const profile of ['opencode', 'deepseek', 'local'] as const) {
      for (const flockEnabled of [true, false]) {
        const cwd = tmpDir();
        const path = join(cwd, CONFIG_FILE);
        writeFileSync(path, renderConfigYaml(profile, { flockEnabled, maxParallel: 2 }));
        const config = loadConfig(path);
        expect(config.maxParallel).toBe(2);
        expect(config.flock.enabled).toBe(flockEnabled);
        expect(config.server.port).toBe(defaultConfig.server.port);
      }
    }
  });
});

describe('starling init (command)', () => {
  test('--yes writes the detected profile with the suggested maxParallel', async () => {
    const { context, text } = makeContext();
    const code = await initCommand({}, context, {
      hardware: HARDWARE,
      detected: { profile: 'opencode', opencodeModel: 'opencode-go/deepseek-v4.1-flash', source: 'opencode' },
    });
    expect(code).toBe(0);
    const config = loadConfig(join(context.cwd, CONFIG_FILE));
    expect(config.maxParallel).toBe(8);
    expect(config.models.worker.provider).toBe('opencode');
    expect(text()).toContain('opencode-go (no API key needed)');
    expect(text()).toContain('starling plan');
    expect(text()).toContain('starling run');
    expect(text()).toContain('starling dash');
    expect(text()).not.toContain('\x1b[');
  });

  test('--dry-run prints the YAML and writes nothing', async () => {
    const { context, text } = makeContext();
    const code = await initCommand({ dryRun: true }, context, {
      hardware: HARDWARE,
      detected: { profile: 'local', source: 'fallback' },
    });
    expect(code).toBe(0);
    expect(existsSync(join(context.cwd, CONFIG_FILE))).toBe(false);
    expect(text()).toContain('would write');
    expect(text()).toContain('dry run');
    expect(text()).toContain('maxParallel: 8');
    expect(text()).toContain('every role on Ollama');
  });

  test('asks three questions on a TTY and uses the answers', async () => {
    const { context, text } = makeContext();
    const asked: string[] = [];
    const answers = ['local', '4', 'n'];
    const code = await initCommand({}, context, {
      hardware: HARDWARE,
      detected: { profile: 'opencode', opencodeModel: 'opencode-go/deepseek-v4.1-flash', source: 'opencode' },
      interactive: true,
      ask: async (question, fallback) => {
        asked.push(`${question} [${fallback}]`);
        return answers.shift() ?? '';
      },
    });
    expect(code).toBe(0);
    expect(asked).toEqual([
      'model profile (opencode / deepseek / local) [opencode]',
      'maxParallel (agents at once) [8]',
      'enable flock (lend/borrow LAN agents) (y/n) [y]',
    ]);
    const config = loadConfig(join(context.cwd, CONFIG_FILE));
    expect(config.models.worker.provider).toBe('ollama');
    expect(config.maxParallel).toBe(4);
    expect(config.flock.enabled).toBe(false);
    expect(text()).toContain('detected');
    expect(text()).toContain('opencode-go/deepseek-v4.1-flash');
  });

  test('accepts every default by pressing enter, and ignores nonsense answers', async () => {
    const { context } = makeContext();
    const answers = ['nonsense', '0', 'maybe'];
    const code = await initCommand({}, context, {
      hardware: HARDWARE,
      detected: { profile: 'opencode', opencodeModel: 'opencode-go/deepseek-v4.1-flash', source: 'opencode' },
      interactive: true,
      ask: async (_question, fallback) => `${answers.shift() ?? fallback}`,
    });
    expect(code).toBe(0);
    const config = loadConfig(join(context.cwd, CONFIG_FILE));
    expect(config.models.worker.provider).toBe('opencode');
    expect(config.maxParallel).toBe(8);
    expect(config.flock.enabled).toBe(true);
  });

  test('never prompts when stdin is not a TTY', async () => {
    const { context } = makeContext();
    let asked = 0;
    await initCommand({}, context, {
      hardware: HARDWARE,
      detected: { profile: 'local', source: 'fallback' },
      ask: async () => {
        asked += 1;
        return 'local';
      },
    });
    expect(asked).toBe(0);
    expect(existsSync(join(context.cwd, CONFIG_FILE))).toBe(true);
  });

  test('honours --profile, --max-parallel and --no-flock', async () => {
    const { context } = makeContext();
    await initCommand({ profile: 'deepseek', maxParallel: 2, flock: false }, context, {
      hardware: HARDWARE,
      detected: { profile: 'opencode', source: 'opencode' },
    });
    const config = loadConfig(join(context.cwd, CONFIG_FILE));
    expect(config.models.worker.provider).toBe('deepseek');
    expect(config.maxParallel).toBe(2);
    expect(config.flock.enabled).toBe(false);
  });

  test('rejects an unknown --profile', async () => {
    const { context } = makeContext();
    try {
      await initCommand({ profile: 'gpt' }, context, { hardware: HARDWARE });
      throw new Error('expected a rejection');
    } catch (err) {
      expect(isStarlingError(err, 'INVALID_ARGUMENT')).toBe(true);
    }
  });

  test('propagates the overwrite guard as an exit code of 1', async () => {
    const { context, text } = makeContext();
    writeFileSync(join(context.cwd, CONFIG_FILE), 'maxParallel: 2\n');
    const code = await initCommand({}, context, {
      hardware: HARDWARE,
      detected: { profile: 'local', source: 'fallback' },
    }).catch((err: unknown) => (isStarlingError(err, 'INVALID_ARGUMENT') ? 1 : -1));
    expect(code).toBe(1);
    expect(text()).toBe('');
  });
});
