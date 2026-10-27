/**
 * Guards the checked-in opencode config: one provider (`ollama`), one model, and a default that
 * matches it. A typo here means `--fully-open` silently talks to the wrong model — or to nothing.
 *
 * Reading JSON only: no opencode, no Ollama, no network.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const HERE = dirname(new URL(import.meta.url).pathname);

interface OpencodeConfig {
  $schema?: string;
  model?: string | { providerID?: string; model?: string };
  providers?: Record<string, { name?: string; models?: Record<string, { capabilities?: unknown }> }>;
  /** opencode v1 spelling, still accepted but deprecated. */
  provider?: unknown;
}

function readConfig(): OpencodeConfig {
  return JSON.parse(readFileSync(join(HERE, 'opencode-ollama.json'), 'utf8')) as OpencodeConfig;
}

describe('tools/fully-open/opencode-ollama.json', () => {
  test('declares exactly one ollama model and defaults to it', () => {
    const config = readConfig();
    const providers = Object.keys(config.providers ?? {});
    expect(providers).toEqual(['ollama']);

    const models = Object.keys(config.providers?.ollama?.models ?? {});
    expect(models).toHaveLength(1);
    const [model] = models;
    expect(model).toBe('qwen3.8:27b-mlx');

    // A string `model` is normalised by opencode 2.x into {providerID, model}; accept both shapes.
    const ref =
      typeof config.model === 'string' ? config.model : `${config.model?.providerID}/${config.model?.model}`;
    expect(ref).toBe(`ollama/${model}`);
  });

  test('ships the v2 config shape (providers, not the deprecated provider)', () => {
    const config = readConfig();
    expect(config.$schema).toBe('https://opencode.ai/config.json');
    expect(config.provider).toBeUndefined();
    expect(config.providers?.ollama?.name).toContain('Ollama');
  });

  test('the model is marked tool-capable, because workers edit files', () => {
    const config = readConfig();
    const model = Object.keys(config.providers?.ollama?.models ?? {})[0] ?? '';
    const capabilities = config.providers?.ollama?.models?.[model]?.capabilities as
      | { tools?: boolean }
      | undefined;
    expect(capabilities?.tools).toBe(true);
  });
});
