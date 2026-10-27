import { describe, expect, test } from 'bun:test';
import type { ModelRole } from '@starling/core';
import { defaultConfig, StarlingError } from '@starling/core';
import {
  applyProfile,
  DEFAULT_LLM_PROFILE,
  describeProfile,
  LLM_PROFILES,
  LOCAL_DEFAULT_MODEL,
  MIXED_CLOUD_ROLES,
  MIXED_LOCAL_ROLES,
  OPENCODE_DEFAULT_MODEL,
  parseProfile,
  resolveProfile,
} from './profiles.ts';

const ROLES: ModelRole[] = ['planner', 'worker', 'resolver', 'auditor', 'summarizer', 'writer'];

describe('profiles', () => {
  test('the default profile is deepseek and leaves config untouched', () => {
    expect(DEFAULT_LLM_PROFILE).toBe('deepseek');
    const applied = applyProfile(defaultConfig, 'deepseek');
    expect(applied).toBe(defaultConfig);
    expect(LLM_PROFILES).toEqual(['opencode', 'deepseek', 'local', 'mixed']);
  });

  test('local sends every role to Ollama and guarantees the provider exists', () => {
    const config = applyProfile({ ...defaultConfig, providers: {} }, 'local');
    for (const role of ROLES) {
      expect(config.models[role]).toEqual({ provider: 'ollama', model: LOCAL_DEFAULT_MODEL });
    }
    expect(config.providers.ollama?.baseUrl).toContain('11434');
  });

  test("local's compiled-in default is the measured 27B MLX model, not a guess", () => {
    // docs/epic-28-local-bench.md: 18 GB resident, ~18 tok/s warm on the M5 Pro.
    expect(LOCAL_DEFAULT_MODEL).toBe('qwen3.8:27b-mlx');
  });

  test('local uses the recommended large model for reasoning and the small one for prose', () => {
    const config = applyProfile(defaultConfig, 'local', {
      localModel: 'qwen3.8:27b-mlx',
      localSmallModel: 'qwen3.8:4b-mlx',
    });
    expect(config.models.planner.model).toBe('qwen3.8:27b-mlx');
    expect(config.models.worker.model).toBe('qwen3.8:27b-mlx');
    expect(config.models.auditor.model).toBe('qwen3.8:27b-mlx');
    expect(config.models.summarizer.model).toBe('qwen3.8:4b-mlx');
    expect(config.models.writer.model).toBe('qwen3.8:4b-mlx');
    for (const role of ROLES) expect(config.models[role].provider).toBe('ollama');
  });

  test("local keeps a user's own Ollama base URL", () => {
    const config = applyProfile(
      { ...defaultConfig, providers: { ollama: { baseUrl: 'http://192.168.1.9:11434/v1' } } },
      'local',
    );
    expect(config.providers.ollama?.baseUrl).toBe('http://192.168.1.9:11434/v1');
  });

  test('opencode sends every role through the local server with providerID/modelID', () => {
    const config = applyProfile(defaultConfig, 'opencode');
    for (const role of ROLES) {
      expect(config.models[role]).toEqual({ provider: 'opencode', model: OPENCODE_DEFAULT_MODEL });
    }
    expect(config.providers.opencode).toEqual({
      baseUrl: `http://127.0.0.1:${defaultConfig.opencode.port}`,
      apiKeyEnv: 'OPENCODE_SERVER_PASSWORD',
    });
    expect(OPENCODE_DEFAULT_MODEL.split('/')).toEqual(['opencode-go', 'deepseek-v4.1-flash']);
  });

  test('an attached opencode URL wins over the port', () => {
    const config = applyProfile(
      { ...defaultConfig, opencode: { ...defaultConfig.opencode, url: 'http://10.0.0.5:9999' } },
      'opencode',
    );
    expect(config.providers.opencode?.baseUrl).toBe('http://10.0.0.5:9999');
  });

  test('mixed keeps the hard work on DeepSeek and the prose local', () => {
    const config = applyProfile({ ...defaultConfig, providers: {} }, 'mixed', {
      localModel: 'qwen3.8:27b-mlx',
      localSmallModel: 'qwen3.8:4b-mlx',
    });
    for (const role of MIXED_CLOUD_ROLES) {
      expect(config.models[role]).toEqual({ provider: 'opencode', model: OPENCODE_DEFAULT_MODEL });
    }
    expect(config.models.auditor).toEqual({ provider: 'ollama', model: 'qwen3.8:27b-mlx' });
    expect(config.models.summarizer).toEqual({ provider: 'ollama', model: 'qwen3.8:4b-mlx' });
    expect(config.models.writer.provider).toBe('ollama');
    // The router needs both provider entries to exist.
    expect(config.providers.opencode?.baseUrl).toContain(String(defaultConfig.opencode.port));
    expect(config.providers.ollama?.baseUrl).toContain('11434');
  });

  test('mixed falls back to opencode for the local roles with a warning, not an error', () => {
    const resolution = resolveProfile(defaultConfig, 'mixed', { localAvailable: false });
    for (const role of MIXED_LOCAL_ROLES) {
      expect(resolution.config.models[role]).toEqual({
        provider: 'opencode',
        model: OPENCODE_DEFAULT_MODEL,
      });
    }
    expect(resolution.warnings).toHaveLength(1);
    expect(resolution.warnings[0]?.code).toBe('local-unavailable');
    expect(resolution.localRoles).toEqual([]);
    expect(resolution.opencodeRoles).toEqual([...ROLES]);
  });

  test('the fallback carries why it happened (model missing vs daemon down)', () => {
    const missing = resolveProfile(defaultConfig, 'mixed', {
      localAvailable: false,
      localReason: 'local-model-missing',
    });
    expect(missing.warnings[0]?.code).toBe('local-model-missing');
    expect(missing.warnings[0]?.message).toContain('local-model-missing');
  });

  test('mixed is local-first when availability is unknown', () => {
    const resolution = resolveProfile(defaultConfig, 'mixed');
    expect(resolution.warnings).toEqual([]);
    expect(resolution.localRoles).toEqual([...MIXED_LOCAL_ROLES]);
    expect(resolution.opencodeRoles).toEqual([...MIXED_CLOUD_ROLES]);
  });

  test('resolveProfile never mutates the input config', () => {
    const before = JSON.stringify(defaultConfig);
    resolveProfile(defaultConfig, 'local', { localModel: 'tiny:1b' });
    resolveProfile(defaultConfig, 'mixed', { localAvailable: false });
    expect(JSON.stringify(defaultConfig)).toBe(before);
  });

  test('parseProfile defaults, trims, accepts the fully-open alias and rejects unknown values', () => {
    expect(parseProfile(undefined)).toBe('deepseek');
    expect(parseProfile('')).toBe('deepseek');
    expect(parseProfile('  local ')).toBe('local');
    expect(parseProfile('mixed')).toBe('mixed');
    expect(parseProfile('fully-open')).toBe('local');
    expect(() => parseProfile('gpt-9')).toThrow(StarlingError);
  });

  test('describeProfile lists every role and every warning', () => {
    const resolution = resolveProfile(defaultConfig, 'mixed', { localAvailable: false });
    const lines = describeProfile(resolution);
    expect(lines[0]).toContain('profile mixed');
    for (const role of ROLES) expect(lines[0]).toContain(`${role}=`);
    expect(lines.some((line) => line.startsWith('warn local-unavailable:'))).toBe(true);
  });
});
