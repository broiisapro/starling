import { describe, expect, test } from 'bun:test';
import type { ModelRole } from '@starling/core';
import { defaultConfig, StarlingError } from '@starling/core';
import {
  applyProfile,
  DEFAULT_LLM_PROFILE,
  LLM_PROFILES,
  LOCAL_DEFAULT_MODEL,
  OPENCODE_DEFAULT_MODEL,
  parseProfile,
} from './profiles.ts';

const ROLES: ModelRole[] = ['planner', 'worker', 'resolver', 'auditor', 'summarizer', 'writer'];

describe('profiles', () => {
  test('the default profile is deepseek and leaves config untouched', () => {
    expect(DEFAULT_LLM_PROFILE).toBe('deepseek');
    const applied = applyProfile(defaultConfig, 'deepseek');
    expect(applied).toBe(defaultConfig);
    expect(LLM_PROFILES).toEqual(['opencode', 'deepseek', 'local']);
  });

  test('local sends every role to Ollama and guarantees the provider exists', () => {
    const config = applyProfile({ ...defaultConfig, providers: {} }, 'local');
    for (const role of ROLES) {
      expect(config.models[role]).toEqual({ provider: 'ollama', model: LOCAL_DEFAULT_MODEL });
    }
    expect(config.providers.ollama?.baseUrl).toContain('11434');
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

  test('parseProfile defaults, trims, and rejects unknown values', () => {
    expect(parseProfile(undefined)).toBe('deepseek');
    expect(parseProfile('  local ')).toBe('local');
    expect(() => parseProfile('gpt-9')).toThrow(StarlingError);
  });
});
