import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultConfig, StarlingError } from '@starling/core';
import {
  AUDITOR_PROFILES,
  chooseAuditorModel,
  createLlmFor,
  DEFAULT_AUDITOR_PROFILE,
  defaultLlmMode,
  localAuditorModel,
  OPENCODE_AUDITOR_MODEL,
  parseAuditorProfile,
  probeOllamaModel,
  RECOMMENDATION_PATH,
  RECOMMENDED_LOCAL_AUDITOR_MODEL,
} from './model-choice.ts';

const dirs: string[] = [];

function tempRepo(recommendation?: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'starling-auditor-choice-'));
  dirs.push(dir);
  if (recommendation !== undefined) {
    const path = join(dir, RECOMMENDATION_PATH);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, `${JSON.stringify(recommendation, null, 2)}\n`, 'utf8');
  }
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('parseAuditorProfile', () => {
  test('defaults to the demo default (mixed) and accepts the core profile name as an alias', () => {
    expect(DEFAULT_AUDITOR_PROFILE).toBe('mixed');
    expect(parseAuditorProfile(undefined)).toBe('mixed');
    expect(parseAuditorProfile('  ')).toBe('mixed');
    expect(parseAuditorProfile('deepseek')).toBe('mixed');
    for (const profile of AUDITOR_PROFILES) expect(parseAuditorProfile(profile)).toBe(profile);
  });

  test('rejects an unknown profile instead of silently falling back', () => {
    expect(() => parseAuditorProfile('ollama')).toThrow(StarlingError);
    try {
      parseAuditorProfile('ollama');
    } catch (err) {
      expect((err as StarlingError).code).toBe('CONFIG_INVALID');
      expect((err as Error).message).toContain('opencode, local, mixed');
    }
  });
});

describe('defaultLlmMode', () => {
  test('stays off unless the operator asked for a profile', () => {
    expect(defaultLlmMode({})).toBe('off');
    expect(defaultLlmMode({ STARLING_LLM_PROFILE: '' })).toBe('off');
    expect(defaultLlmMode({ STARLING_LLM_PROFILE: 'opencode' })).toBe('auto');
    expect(defaultLlmMode({ STARLING_AUDITOR_PROFILE: 'local' })).toBe('auto');
  });
});

describe('localAuditorModel', () => {
  test('STARLING_AUDITOR_MODEL wins over everything and loses the provider prefix', () => {
    const model = localAuditorModel({
      env: { STARLING_AUDITOR_MODEL: 'ollama/qwen3.5:9b' },
      cwd: tempRepo({ mbp: { auditor: 'gemma4:26b-a4b' }, air: { auditor: 'gemma4:12b-it-qat' } }),
      ramGb: 32,
    });
    expect(model).toBe('qwen3.5:9b');
  });

  test('uses Epics 28/72 recommendation.json for the matching laptop profile', () => {
    const cwd = tempRepo({
      mbp: { auditor: 'qwen3.6:35b-a3b', summarizer: 'qwen3.5:9b' },
      air: { auditor: 'qwen3.5:9b', summarizer: 'qwen3.5:4b' },
    });
    expect(localAuditorModel({ env: {}, cwd, ramGb: 32 })).toBe('qwen3.6:35b-a3b');
    expect(localAuditorModel({ env: {}, cwd, ramGb: 16 })).toBe('qwen3.5:9b');
  });

  test('falls back to the one model this repo has measured when no recommendation exists', () => {
    expect(localAuditorModel({ env: {}, cwd: tempRepo(), ramGb: 32 })).toBe(RECOMMENDED_LOCAL_AUDITOR_MODEL);
  });
});

describe('chooseAuditorModel', () => {
  test('opencode: DeepSeek through the user opencode server, and the config routes the auditor there', async () => {
    const choice = await chooseAuditorModel({ profile: 'opencode', env: {}, cwd: tempRepo() });
    expect(choice.profile).toBe('opencode');
    expect(choice.model).toEqual(OPENCODE_AUDITOR_MODEL);
    expect(choice.local).toBe(false);
    expect(choice.warning).toBeUndefined();
    expect(choice.config.models.auditor).toEqual(OPENCODE_AUDITOR_MODEL);
    expect(choice.config.providers.opencode?.baseUrl).toContain('127.0.0.1');
    // The rest of the profile still maps every other role through opencode.
    expect(choice.config.models.worker.provider).toBe('opencode');
  });

  test('local: the recommended Ollama model, and nothing leaves the laptop', async () => {
    const choice = await chooseAuditorModel({
      profile: 'local',
      env: { STARLING_AUDITOR_MODEL: 'qwen3.5:9b' },
      cwd: tempRepo(),
    });
    expect(choice.profile).toBe('local');
    expect(choice.model).toEqual({ provider: 'ollama', model: 'qwen3.5:9b' });
    expect(choice.local).toBe(true);
    expect(choice.config.models.auditor).toEqual({ provider: 'ollama', model: 'qwen3.5:9b' });
    expect(choice.config.models.worker.provider).toBe('ollama');
    expect(choice.config.providers.ollama?.baseUrl).toBe('http://127.0.0.1:11434/v1');
  });

  test('mixed with Ollama reachable and the model pulled: auditors stay local while workers use DeepSeek', async () => {
    const probes: string[] = [];
    const choice = await chooseAuditorModel({
      profile: 'mixed',
      env: { STARLING_AUDITOR_MODEL: 'qwen3.8:27b-mlx' },
      cwd: tempRepo(),
      probe: async (model) => {
        probes.push(model.model);
        return true;
      },
    });
    expect(probes).toEqual(['qwen3.8:27b-mlx']);
    expect(choice.model).toEqual({ provider: 'ollama', model: 'qwen3.8:27b-mlx' });
    expect(choice.warning).toBeUndefined();
  });

  test('mixed without Ollama falls back to opencode and explains itself', async () => {
    const choice = await chooseAuditorModel({
      profile: 'mixed',
      env: { STARLING_AUDITOR_MODEL: 'qwen3.8:27b-mlx' },
      cwd: tempRepo(),
      probe: async () => false,
    });
    expect(choice.model).toEqual(OPENCODE_AUDITOR_MODEL);
    expect(choice.local).toBe(false);
    expect(choice.warning).toContain('fell back to the opencode profile');
    expect(choice.warning).toContain('qwen3.8:27b-mlx');
  });

  test('no profile in the environment means the demo default: mixed', async () => {
    const choice = await chooseAuditorModel({
      env: {},
      cwd: tempRepo(),
      probe: async () => false,
    });
    expect(choice.profile).toBe('opencode');
    expect(choice.warning).toBeDefined();
  });

  test('STARLING_AUDITOR_PROFILE is not needed when STARLING_LLM_PROFILE is set', async () => {
    const choice = await chooseAuditorModel({ env: { STARLING_LLM_PROFILE: 'opencode' }, cwd: tempRepo() });
    expect(choice.profile).toBe('opencode');
    expect(choice.model).toEqual(OPENCODE_AUDITOR_MODEL);
  });

  test('createLlmFor builds a router for the chosen config without touching the network', async () => {
    const choice = await chooseAuditorModel({ profile: 'opencode', env: {}, cwd: tempRepo() });
    const llm = createLlmFor(choice, { env: {} });
    expect(typeof llm.complete).toBe('function');
    expect(typeof llm.completeJson).toBe('function');
  });
});

describe('probeOllamaModel', () => {
  const server = (handler: (url: string) => Response) =>
    Bun.serve({ port: 0, fetch: (request) => handler(new URL(request.url).pathname) });

  test('is true when /api/tags lists the tag, and normalises :latest', async () => {
    const fake = server(
      () =>
        new Response(JSON.stringify({ models: [{ name: 'qwen3.8:27b-mlx' }, { name: 'gemma4' }] }), {
          headers: { 'content-type': 'application/json' },
        }),
    );
    try {
      const config = {
        ...defaultConfig,
        providers: { ollama: { baseUrl: `http://127.0.0.1:${fake.port}/v1` } },
      };
      expect(await probeOllamaModel({ provider: 'ollama', model: 'qwen3.8:27b-mlx' }, config, fetch)).toBe(
        true,
      );
      expect(await probeOllamaModel({ provider: 'ollama', model: 'gemma4:latest' }, config, fetch)).toBe(
        true,
      );
      expect(await probeOllamaModel({ provider: 'ollama', model: 'qwen3.5:9b' }, config, fetch)).toBe(false);
    } finally {
      fake.stop(true);
    }
  });

  test('is false, not an exception, when the daemon is down or the provider is unknown', async () => {
    const fake = server(() => new Response('nope', { status: 500 }));
    const url = `http://127.0.0.1:${fake.port}/v1`;
    try {
      expect(
        await probeOllamaModel(
          { provider: 'ollama', model: 'x' },
          {
            ...defaultConfig,
            providers: { ollama: { baseUrl: url } },
          },
        ),
      ).toBe(false);
      expect(
        await probeOllamaModel(
          { provider: 'deepseek', model: 'x' },
          {
            ...defaultConfig,
            providers: { deepseek: { baseUrl: 'http://127.0.0.1:9/v1' } },
          },
          fetch,
          100,
        ),
      ).toBe(false);
    } finally {
      fake.stop(true);
    }
  });
});
