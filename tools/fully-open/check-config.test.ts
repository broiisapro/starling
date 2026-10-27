import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// The local profile is the source of truth for the tag and the URL; the JSON has to follow it.
import { LOCAL_BASE_URL, LOCAL_DEFAULT_MODEL, LOCAL_PROVIDER } from '../../packages/llm/src/profiles.ts';
import {
  checkOpencodeConfig,
  checkOpencodeConfigFile,
  OPENCODE_PROVIDER_ID,
  OPENCODE_PROVIDER_PACKAGE,
} from './check-config.ts';

const CONFIG_PATH = join(import.meta.dir, 'opencode-ollama.json');

/** A minimal config that mirrors the shipped file, so a test can break exactly one thing. */
function validConfig(overrides: { model?: string; baseUrl?: string } = {}): Record<string, unknown> {
  const model = overrides.model ?? 'qwen3.8:27b-mlx';
  return {
    $schema: 'https://opencode.ai/config.json',
    model: `ollama/${model}`,
    providers: {
      ollama: {
        name: 'Ollama (local)',
        package: OPENCODE_PROVIDER_PACKAGE,
        settings: { baseURL: overrides.baseUrl ?? LOCAL_BASE_URL },
        models: {
          [model]: {
            modelID: model,
            name: 'Qwen3.8 27B MLX (local)',
            capabilities: { tools: true, temperature: true },
          },
        },
      },
    },
  };
}

describe('opencode Ollama config', () => {
  test('the shipped file matches the compiled-in local profile', () => {
    expect(LOCAL_PROVIDER).toBe(OPENCODE_PROVIDER_ID);
    const result = checkOpencodeConfigFile(CONFIG_PATH, { model: LOCAL_DEFAULT_MODEL });
    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
  });

  test('a valid config is ok and reports no problems', () => {
    const result = checkOpencodeConfig(validConfig(), { model: 'qwen3.8:27b-mlx' });
    expect(result.ok).toBe(true);
    expect(result.problems).toEqual([]);
  });

  test('an opencode v1-style `provider` key is caught', () => {
    const config = { ...validConfig(), provider: { ollama: {} } };
    const result = checkOpencodeConfig(config, { model: 'qwen3.8:27b-mlx' });
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toContain('opencode v1');
  });

  test('a base URL without /v1 is a problem, not a silent 404', () => {
    const result = checkOpencodeConfig(validConfig({ baseUrl: 'http://127.0.0.1:11434' }), {
      model: 'qwen3.8:27b-mlx',
    });
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toContain('settings.baseURL');
  });

  test('a trailing slash on the base URL is fine', () => {
    const result = checkOpencodeConfig(validConfig({ baseUrl: `${LOCAL_BASE_URL}/` }), {
      model: 'qwen3.8:27b-mlx',
    });
    expect(result.ok).toBe(true);
  });

  test('a missing model entry is flagged, because it makes workers depend on live discovery', () => {
    const result = checkOpencodeConfig(validConfig(), { model: 'qwen3.8:4b-mlx' });
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toContain('qwen3.8:4b-mlx');
  });

  test('a modelID that disagrees with its map key is flagged', () => {
    const config = validConfig();
    const provider = (config.providers as Record<string, Record<string, unknown>>).ollama as Record<
      string,
      Record<string, Record<string, unknown>>
    >;
    (provider.models['qwen3.8:27b-mlx'] as Record<string, unknown>).modelID = 'qwen3:27b';
    const result = checkOpencodeConfig(config, { model: 'qwen3.8:27b-mlx' });
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toContain('modelID');
  });

  test('tools must be enabled: a worker without tools cannot edit a repo', () => {
    const config = validConfig();
    const models = (
      (config.providers as Record<string, Record<string, unknown>>).ollama as Record<string, unknown>
    ).models as Record<string, Record<string, unknown>>;
    (models['qwen3.8:27b-mlx'] as Record<string, Record<string, unknown>>).capabilities = { tools: false };
    const result = checkOpencodeConfig(config, { model: 'qwen3.8:27b-mlx' });
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toContain('capabilities.tools');
  });

  test('a top-level model pointing somewhere else is flagged', () => {
    const result = checkOpencodeConfig(
      { ...validConfig(), model: 'opencode-go/deepseek-v4.1-flash' },
      { model: 'qwen3.8:27b-mlx' },
    );
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toContain('top-level `model`');
  });

  test('a missing $schema is a note, never a problem', () => {
    const config = validConfig();
    delete (config as Record<string, unknown>).$schema;
    const result = checkOpencodeConfig(config, { model: 'qwen3.8:27b-mlx' });
    expect(result.ok).toBe(true);
    expect(result.notes.join(' ')).toContain('$schema');
  });

  test('a missing providers object stops with a single clear problem', () => {
    const result = checkOpencodeConfig({ model: 'ollama/x' }, { model: 'x' });
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual(['missing `providers` object']);
  });

  test('non-object roots and invalid JSON are problems, not exceptions', () => {
    expect(checkOpencodeConfig('nope', { model: 'x' }).ok).toBe(false);
    const dir = mkdtempSync(join(tmpdir(), 'fully-open-'));
    const broken = join(dir, 'broken.json');
    writeFileSync(broken, '{ "providers": ', 'utf8');
    expect(checkOpencodeConfigFile(broken, { model: 'x' }).problems.join(' ')).toContain('not valid JSON');
    expect(checkOpencodeConfigFile(join(dir, 'absent.json'), { model: 'x' }).problems.join(' ')).toContain(
      'cannot read',
    );
  });
});
